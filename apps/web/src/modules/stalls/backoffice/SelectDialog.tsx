import type { RequestDetail } from '@stalls/core';
import { useState } from 'react';
import { ApiError } from '../api-client';
import { availableStalls, listZones, patchRequest, select } from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import { Btn, Dialog, Icon, Input, Select, useToast } from '../ui';
import { StallPicker } from './StallPicker';

/** Pick free stalls for a request. Shows only AVAILABLE stalls, opens on the
 *  vendor's preferred zone, and caps the pick at the number of stalls this
 *  request is being given minus what it already holds. A 409 means someone took
 *  a stall between the list loading and the click — the list reloads and the
 *  toast says so.
 *
 *  🔴 The bay is the other half of this dialog, and on most selections it is
 *  the ONLY half: "the side will be decided, but the stall number may not be
 *  still put at the time of the payment". The bay is what the rent is read
 *  from, so a vendor moved from the bay they asked for has to be recorded as
 *  agreed to the new one before the payment letter goes out — months before
 *  any number exists. Confirm is therefore enabled by either choice. */
export function SelectDialog({
  request: r,
  onClose,
  onDone,
}: {
  request: RequestDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { can } = useMe();
  const [zone, setZone] = useState<string>(r.preferredZoneCode);
  const { data, loading, reload } = useLoad(() => availableStalls(zone || undefined), [zone]);
  const { data: zones } = useLoad(() => listZones(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [agreedZone, setAgreedZone] = useState<string>(
    r.agreedZoneCode ?? r.preferredZoneCode ?? '',
  );
  /** 🔴 Asked here because the number of stalls is renegotiated in the same
   *  phone call the bay is — "they asked for three, we can give them two" — and
   *  until it was on this screen the only way to record it was to leave the
   *  dialog for Amend, which meant it was usually not recorded at all. It is
   *  what the request is PRICED on until a stall number exists, so a stale
   *  three here is a payment letter for three stalls.
   *
   *  ⚠️ Not required, and left alone it changes nothing: blank means "whatever
   *  the form said", not zero. */
  const [countText, setCountText] = useState(String(r.numStallsRequested));
  const [busy, setBusy] = useState(false);

  const bays = zones ?? [];
  const canAmend = can('requests.write');
  const held = r.allocations.length;
  const typed = countText.trim();
  const parsed = Number(typed);
  const countOk =
    typed !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 && parsed >= held;
  // A number that cannot be honoured is refused rather than quietly ignored —
  // the reader typed it, and the dialog acting as though they had not is how a
  // request ends up priced for a count nobody agreed.
  const countError =
    typed === '' || countOk
      ? null
      : parsed >= 1 && parsed < held
        ? `This request already holds ${held}. Release one first.`
        : 'A number between 1 and 20.';
  const wanted = countOk ? parsed : r.numStallsRequested;
  const remaining = Math.max(0, wanted - held);
  const stalls = data ?? [];

  const toggle = (n: string) =>
    setPicked((p) =>
      p.includes(n) ? p.filter((x) => x !== n) : p.length < remaining ? [...p, n] : p,
    );

  const confirm = async () => {
    setBusy(true);
    try {
      // ⚠️ Before the select, not after: the API refuses a selection that
      // offers more stalls than the request asked for, so raising the count is
      // what makes room for the stalls picked below it.
      if (canAmend && countOk && parsed !== r.numStallsRequested) {
        await patchRequest(r.id, { numStallsRequested: parsed });
      }
      const out = await select(r.id, picked, agreedZone || undefined);
      toast.ok(
        out.allocated.length > 0
          ? `Allocated ${out.allocated.join(', ')}`
          : `Selected for ${agreedZone} — stall number to follow`,
      );
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.fail(new Error(`${e.message}. The list has been refreshed.`));
        setPicked([]);
        reload();
      } else {
        toast.fail(e instanceof ApiError ? e : new Error('Something went wrong'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Select ${r.stallName}`}
      note={
        remaining === 0
          ? 'This request already holds every stall it is being given. Release one, or raise the number below, to change it.'
          : `Pick up to ${remaining} stall${remaining > 1 ? 's' : ''} — the request asked for ${r.numStallsRequested}, preferred ${r.preferredZoneCode}.`
      }
      onClose={onClose}
      width={640}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            kind='primary'
            disabled={busy || countError !== null || (picked.length === 0 && !agreedZone)}
            onClick={confirm}
          >
            <Icon name='check' size={14} />
            {busy ? 'Selecting…' : picked.length > 0 ? `Allocate ${picked.length}` : 'Select'}
          </Btn>
        </>
      }
    >
      <div
        style={{
          display: 'grid',
          gap: 12,
          padding: '10px 12px',
          marginBottom: 14,
          border: '1px solid var(--line)',
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'grid', gap: 4 }}>
          <label
            htmlFor='agreed-bay'
            style={{ fontSize: 11, fontWeight: 700, color: 'var(--mfg)' }}
          >
            Bay Agreed with the Requester
          </label>
          <Select
            id='agreed-bay'
            value={agreedZone}
            onChange={(e) => setAgreedZone(e.target.value)}
            style={{ width: 'auto', minWidth: 220 }}
          >
            <option value=''>Not Agreed Yet</option>
            {bays.map((z) => (
              <option key={z.code} value={z.code}>
                {z.code} — {z.name}
              </option>
            ))}
          </Select>
          <span style={{ fontSize: 11, color: 'var(--mfg)' }}>
            This is what the stall is priced at. They asked for {r.preferredZoneCode}.
          </span>
        </div>

        {canAmend && (
          <div style={{ display: 'grid', gap: 4 }}>
            <label
              htmlFor='agreed-stalls'
              style={{ fontSize: 11, fontWeight: 700, color: 'var(--mfg)' }}
            >
              Number of Stalls <span style={{ fontWeight: 600 }}>(optional)</span>
            </label>
            <Input
              id='agreed-stalls'
              type='number'
              min={1}
              max={20}
              value={countText}
              onChange={(e) => setCountText(e.target.value)}
              style={{ width: 'auto', minWidth: 110 }}
            />
            <span style={{ fontSize: 11, color: countError ? 'var(--des-fg)' : 'var(--mfg)' }}>
              {countError ??
                `They asked for ${r.numStallsRequested}. Change it only if the team agreed a different number.`}
            </span>
          </div>
        )}
      </div>

      <StallPicker
        stalls={stalls}
        zones={bays}
        zone={zone}
        onZone={setZone}
        loading={loading}
        picked={picked}
        onPick={toggle}
        atCap={picked.length >= remaining}
        empty={
          <>
            No available stalls{zone ? ` in ${zone}` : ''}. You can still select on the agreed bay
            alone and give the number later.
          </>
        }
      />
    </Dialog>
  );
}
