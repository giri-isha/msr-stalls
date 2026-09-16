import type { PatchRequestInput, RequestDetail } from '@stalls/core';
import { useState } from 'react';
import { ApiError } from '../api-client';
import { listZones, patchRequest } from '../api';
import { ApplianceRows, type ApplianceRow } from '../components/ApplianceRows';
import { useLoad } from '../hooks';
import { Btn, Dialog, FormField, Icon, Input, Select, Textarea, useToast } from '../ui';

/** Correcting an application the team has taken over the phone.
 *
 *  🔴 "In case there are any other changes, we anyway speak to them over call
 *  and make that" — a number typed wrong, a chair count that moved, an item
 *  list a vendor revised in January against a form they filled in November.
 *
 *  🔴 The bay is the field that matters most here. A shortlisted requester is
 *  routinely moved — "why don't you look at this side, that side is filled up"
 *  — and the bay they settle on is what the rent is read from, months before a
 *  stall number exists. "Bay agreed" is that record; it is not the bay they
 *  asked for, and the two are shown side by side so nobody confuses them.
 *
 *  What this dialog does NOT offer is the point of it: status, allocation,
 *  money and the agreement timestamps are not editable here. Each has its own
 *  action with its own guard and its own trail entry.
 */
export function AmendDialog({
  request: r,
  onClose,
  onDone,
}: {
  request: RequestDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { data: zones } = useLoad(() => listZones(), []);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    requesterName: r.requesterName,
    email: r.email,
    contactNumber: r.contactNumber,
    address: r.address ?? '',
    stallName: r.stallName,
    stallType: r.stallType,
    preferredZoneCode: r.preferredZoneCode,
    agreedZoneCode: r.agreedZoneCode ?? '',
    itemsSelling: r.itemsSelling,
    numStallsRequested: String(r.numStallsRequested),
    remarks: r.remarks ?? '',
    plugs5a: String(r.plugs5a),
    plugs15a: String(r.plugs15a),
    gasStoves: String(r.gasStoves),
    tablesNeeded: String(r.tablesNeeded),
    chairsNeeded: String(r.chairsNeeded),
    passes2w: String(r.passes2w),
    passes4w: String(r.passes4w),
    passesStaff: String(r.passesStaff),
  });
  const [appliances, setAppliances] = useState<ApplianceRow[]>(
    r.appliances.map((a) => ({ name: a.name, watts: String(a.watts) })),
  );

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const bays = zones ?? [];
  const count = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));

  const save = async () => {
    setBusy(true);
    // Only what changed is sent. A patch carrying every field would overwrite a
    // colleague's edit made while this dialog was open, on fields nobody here
    // touched.
    const body: PatchRequestInput = {};
    const text = ['requesterName', 'email', 'contactNumber', 'stallName', 'itemsSelling'] as const;
    for (const k of text) if (form[k] !== r[k]) body[k] = form[k];
    if (form.address !== (r.address ?? '')) body.address = form.address || null;
    if (form.remarks !== (r.remarks ?? '')) body.remarks = form.remarks || null;
    if (form.stallType !== r.stallType) {
      body.stallType = form.stallType === 'FOOD' ? 'FOOD' : 'NON_FOOD';
    }
    if (form.preferredZoneCode !== r.preferredZoneCode) {
      body.preferredZoneCode = form.preferredZoneCode;
    }
    if (form.agreedZoneCode !== (r.agreedZoneCode ?? '')) {
      body.agreedZoneCode = form.agreedZoneCode || null;
    }
    if (count(form.numStallsRequested) !== r.numStallsRequested) {
      body.numStallsRequested = count(form.numStallsRequested);
    }
    const counts = [
      'plugs5a',
      'plugs15a',
      'gasStoves',
      'tablesNeeded',
      'chairsNeeded',
      'passes2w',
      'passes4w',
      'passesStaff',
    ] as const;
    for (const k of counts) if (count(form[k]) !== r[k]) body[k] = count(form[k]);

    const rows = appliances
      .filter((a) => a.name.trim().length > 0)
      .map((a) => ({ name: a.name.trim(), watts: count(a.watts) }));
    const same =
      rows.length === r.appliances.length &&
      rows.every((a, i) => a.name === r.appliances[i].name && a.watts === r.appliances[i].watts);
    if (!same) body.appliances = rows;

    if (Object.keys(body).length === 0) {
      toast.ok('Nothing changed');
      setBusy(false);
      onClose();
      return;
    }
    try {
      await patchRequest(r.id, body);
      toast.ok('Request amended');
      onDone();
    } catch (e) {
      toast.fail(e instanceof ApiError ? e : new Error('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const num = (id: string, label: string, k: keyof typeof form, max: number) => (
    <FormField id={id} label={label}>
      <Input
        id={id}
        type='number'
        min={0}
        max={max}
        value={form[k]}
        onChange={(e) => set(k)(e.target.value)}
      />
    </FormField>
  );

  return (
    <Dialog
      title={`Amend ${r.reference}`}
      note='What the requester told the team since they filed. Status, stalls and money are not edited here.'
      onClose={onClose}
      width={640}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' disabled={busy} onClick={save}>
            <Icon name='check' size={14} />
            {busy ? 'Saving…' : 'Save changes'}
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          <FormField id='am-name' label='Requester'>
            <Input
              id='am-name'
              value={form.requesterName}
              onChange={(e) => set('requesterName')(e.target.value)}
            />
          </FormField>
          <FormField id='am-stall' label='Stall Name'>
            <Input
              id='am-stall'
              value={form.stallName}
              onChange={(e) => set('stallName')(e.target.value)}
            />
          </FormField>
          <FormField id='am-email' label='Email'>
            <Input
              id='am-email'
              type='email'
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
            />
          </FormField>
          <FormField id='am-contact' label='Contact Number'>
            <Input
              id='am-contact'
              value={form.contactNumber}
              onChange={(e) => set('contactNumber')(e.target.value)}
            />
          </FormField>
        </div>

        <FormField id='am-address' label='Address'>
          <Textarea
            id='am-address'
            rows={2}
            value={form.address}
            onChange={(e) => set('address')(e.target.value)}
          />
        </FormField>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
          <FormField id='am-pref' label='Bay Requested' help='What they asked for.'>
            <Select
              id='am-pref'
              value={form.preferredZoneCode}
              onChange={(v) => set('preferredZoneCode')(v)}
            >
              {bays.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.code} — {z.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id='am-agreed'
            label='Bay Agreed'
            help='What they are priced at. Blank until the conversation has happened.'
          >
            <Select
              id='am-agreed'
              value={form.agreedZoneCode}
              onChange={(v) => set('agreedZoneCode')(v)}
            >
              <option value=''>Not Agreed Yet</option>
              {bays.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.code} — {z.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id='am-type' label='Stall Type'>
            <Select id='am-type' value={form.stallType} onChange={(v) => set('stallType')(v)}>
              <option value='FOOD'>Food</option>
              <option value='NON_FOOD'>Non-Food</option>
            </Select>
          </FormField>
          {num('am-stalls', 'Stalls requested', 'numStallsRequested', 20)}
        </div>

        <FormField id='am-items' label='Items'>
          <Textarea
            id='am-items'
            rows={2}
            value={form.itemsSelling}
            onChange={(e) => set('itemsSelling')(e.target.value)}
          />
        </FormField>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          {num('am-p5', '5 A points', 'plugs5a', 50)}
          {num('am-p15', '15 A points', 'plugs15a', 50)}
          {num('am-gas', 'Gas Stoves', 'gasStoves', 10)}
          {num('am-tables', 'Tables', 'tablesNeeded', 50)}
          {num('am-chairs', 'Chairs', 'chairsNeeded', 200)}
          {num('am-staff', 'Staff passes', 'passesStaff', 200)}
          {num('am-2w', '2-wheeler passes', 'passes2w', 50)}
          {num('am-4w', '4-wheeler passes', 'passes4w', 50)}
        </div>

        <FormField id='am-appliances' label='Appliances'>
          <ApplianceRows id='am-appliances' value={appliances} onChange={setAppliances} />
        </FormField>

        <FormField id='am-remarks' label='Remarks'>
          <Textarea
            id='am-remarks'
            rows={2}
            value={form.remarks}
            onChange={(e) => set('remarks')(e.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}
