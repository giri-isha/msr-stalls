import type { CheckInRow } from '@msr/stalls';
import { useState } from 'react';
import * as api from '../api';
import { Field, NumberInput, Row2, TextArea, TextInput } from '../components/FormControls';
import { Grid, Mono, Sub } from '../components/Grid';
import { TypeTag } from '../components/StatusPill';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import { Dialog } from '../ui/components/Dialog';
import { StatTiles } from '../ui/components/StatTiles';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, ErrorBox, H1, Loading, Tag, Toolbar } from '../ui/ui';

/** Requirement 10: at the gate, the volunteer searches a stall number or
 *  name, sees who it is, how many staff and which passes were asked for, and
 *  what is still pending — then records the arrival and the passes handed out. */
export function CheckIn() {
  const { can } = useMe();
  const toast = useToast();
  const [q, setQ] = useState('');
  const rows = useLoad(() => api.checkInRows(q.trim() || undefined), [q]);
  const [open, setOpen] = useState<CheckInRow | null>(null);
  const canCheck = can('checkin:write');

  const data = rows.data ?? [];
  const done = data.filter((r) => r.checkedInAt).length;

  return (
    <div>
      <H1 icon={<Icon name='log-in' size={20} />} sub='Event day. Search by stall number, name or reference; record the arrival and the passes issued.'>
        Check-in
      </H1>
      <StatTiles
        noun='stall'
        tiles={[
          { label: 'All', count: data.length },
          { label: 'Checked In', count: done },
          { label: 'Pending', count: data.length - done },
        ]}
      />
      <Toolbar>
        <div style={{ flex: 1, minWidth: 240 }}>
          <TextInput aria-label='Search' placeholder='Stall number (A4-17), stall name or reference…' value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
      </Toolbar>
      {rows.error && <ErrorBox>{rows.error.message}</ErrorBox>}
      {rows.loading && !rows.data ? (
        <Loading />
      ) : (
        <Grid
          rows={data}
          rowKey={(r) => r.id}
          onRow={canCheck ? setOpen : undefined}
          empty='No selected stalls match.'
          columns={[
            { key: 'stall', header: 'Stall no', width: '100px', mobile: 'sub', render: (r) => <b><Mono>{r.allocatedStalls.join(', ') || '—'}</Mono></b> },
            {
              key: 'name',
              header: 'Stall',
              width: '1.6fr',
              mobile: 'title',
              render: (r) => (
                <>
                  <b>{r.stallName}</b>
                  <Sub>
                    {r.requesterName} · {r.contactNumber}
                  </Sub>
                </>
              ),
            },
            { key: 'type', header: 'Type', width: '110px', render: (r) => <TypeTag type={r.requestType} size='sm' /> },
            {
              key: 'passes',
              header: 'Passes asked',
              width: '150px',
              render: (r) => (
                <span style={{ fontSize: 12 }}>
                  {r.passesStaff} staff · {r.passes2w} 2W · {r.passes4w} 4W
                  {r.coupon && <Sub>{r.coupon.registeredCount}/{r.coupon.maxStaff} staff registered</Sub>}
                </span>
              ),
            },
            {
              key: 'pending',
              header: 'Pending',
              width: '1.4fr',
              render: (r) =>
                r.pending.length === 0 ? (
                  <Tag tone='ok' size='sm'>All clear</Tag>
                ) : (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {r.pending.map((p) => (
                      <Tag key={p} tone='warn' size='sm'>
                        {p}
                      </Tag>
                    ))}
                  </span>
                ),
            },
            {
              key: 'in',
              header: 'Checked in',
              width: '150px',
              render: (r) => (r.checkedInAt ? <Tag tone='teal' size='sm'>{formatDateTime(r.checkedInAt)}</Tag> : <span style={{ color: 'var(--mfg)' }}>—</span>),
            },
          ]}
          actions={(r) =>
            canCheck ? (
              <Btn kind={r.checkedInAt ? 'ghost' : 'primary'} onClick={() => setOpen(r)}>
                {r.checkedInAt ? 'Edit' : 'Check in'}
              </Btn>
            ) : null
          }
        />
      )}
      {open && (
        <CheckInDialog
          row={open}
          onClose={() => setOpen(null)}
          onDone={(m) => {
            setOpen(null);
            toast.ok(m);
            rows.reload();
          }}
          onError={toast.fail}
        />
      )}
    </div>
  );
}

function CheckInDialog({ row, onClose, onDone, onError }: { row: CheckInRow; onClose: () => void; onDone: (m: string) => void; onError: (e: unknown) => void }) {
  const [f, setF] = useState({
    staffPresent: String(row.coupon?.registeredCount ?? row.passesStaff),
    passes2wIssued: String(row.passes2w),
    passes4wIssued: String(row.passes4w),
    passesStaffIssued: String(row.passesStaff),
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const n = (s: string) => Math.max(0, Number(s) || 0);
  const save = async () => {
    setBusy(true);
    try {
      await api.checkIn(row.id, {
        staffPresent: n(f.staffPresent),
        passes2wIssued: n(f.passes2wIssued),
        passes4wIssued: n(f.passes4wIssued),
        passesStaffIssued: n(f.passesStaffIssued),
        notes: f.notes.trim() || undefined,
      });
      onDone(`${row.stallName} checked in`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      width={520}
      title={`Check in — ${row.stallName}`}
      note={`${row.allocatedStalls.join(', ') || 'no stall'} · ${row.reference}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Record check-in'}
          </Btn>
        </>
      }
    >
      {row.pending.length > 0 && (
        <div style={{ padding: '10px 12px', borderRadius: 'var(--r2)', background: 'var(--warn-t)', color: 'var(--warn-fg)', fontSize: 12.5, border: '1px solid var(--warn-b)', marginBottom: 14 }}>
          Still pending: {row.pending.join(' · ')}. Check-in is allowed; the pending items stay on the record.
        </div>
      )}
      <Row2>
        <Field id='sp' label='Staff present'>
          <NumberInput id='sp' value={f.staffPresent} onChange={(e) => setF({ ...f, staffPresent: e.target.value })} />
        </Field>
        <Field id='ps' label='Staff passes issued' help={`Asked for ${row.passesStaff}`}>
          <NumberInput id='ps' value={f.passesStaffIssued} onChange={(e) => setF({ ...f, passesStaffIssued: e.target.value })} />
        </Field>
        <Field id='p2' label='2-wheeler passes issued' help={`Asked for ${row.passes2w}`}>
          <NumberInput id='p2' value={f.passes2wIssued} onChange={(e) => setF({ ...f, passes2wIssued: e.target.value })} />
        </Field>
        <Field id='p4' label='4-wheeler passes issued' help={`Asked for ${row.passes4w}`}>
          <NumberInput id='p4' value={f.passes4wIssued} onChange={(e) => setF({ ...f, passes4wIssued: e.target.value })} />
        </Field>
      </Row2>
      <Field id='notes' label='Notes'>
        <TextArea id='notes' rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Dialog>
  );
}
