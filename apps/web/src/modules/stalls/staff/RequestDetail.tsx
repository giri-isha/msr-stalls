import type { RequestDetail as Detail } from '@msr/stalls';
import { Flag, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Dialog } from '../../../components/ui/dialog';
import { Textarea } from '../../../components/ui/input';
import { ApiError } from '../../../lib/api-client';
import * as api from '../api';
import { StatusPill, TypeBadge } from '../components/StatusPill';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import { SelectDialog } from './SelectDialog';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  return (
    <div className='grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm'>
      <dt className='text-ink-2'>{label}</dt>
      <dd className='min-w-0 break-words'>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='border-t border-line pt-3'>
      <h3 className='mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2'>{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

const USAGE: Record<string, string> = {
  DEPT_DISPLAY: 'Used by Department for Display',
  DEPT_SALES: 'Used by Department for Sales',
  VENDOR_SALES: 'Giving to Vendor for sales',
  SPONSOR: 'Giving to Sponsor',
  OTHER: 'Other — see remarks',
};

/** The right-hand panel: the whole application, and every action the caller
 *  is allowed to take on it. Actions call the API and then tell the list to
 *  refresh; the API decides what is allowed, the buttons only reflect it. */
export function RequestDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useMe();
  const { data: r, error, loading, reload } = useLoad(() => api.getRequest(id), [id]);
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<'reject' | 'flag' | null>(null);
  const [reason, setReason] = useState('');
  const [selecting, setSelecting] = useState(false);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      reload();
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const submitReason = async () => {
    if (!r || !reasonFor || !reason.trim()) return;
    const text = reason.trim();
    setReasonFor(null);
    setReason('');
    if (reasonFor === 'reject') await run('Rejected', () => api.reject(r.id, text));
    else await run('Flagged', () => api.flagRequest(r.id, text));
  };

  const canSelect = can('selection:write');
  const canWrite = can('requests:write');

  return (
    <aside
      className='fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl'
      aria-label='Request detail'
    >
      <div className='flex items-start justify-between gap-3 border-b border-line p-4'>
        <div className='min-w-0'>
          {r && (
            <>
              <div className='font-mono text-xs text-ink-2'>{r.reference}</div>
              <h2 className='truncate text-lg font-bold'>{r.stallName}</h2>
              <div className='mt-1 flex flex-wrap items-center gap-2'>
                <TypeBadge type={r.requestType} />
                <StatusPill status={r.status} />
                {r.flagged && (
                  <span className='inline-flex items-center gap-1 text-xs text-warn'>
                    <Flag className='h-3 w-3' /> {r.flagReason}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <Button variant='ghost' size='icon' onClick={onClose} aria-label='Close'>
          <X className='h-4 w-4' />
        </Button>
      </div>

      {loading && <p className='p-4 text-sm text-ink-2'>Loading…</p>}
      {error && (
        <p role='alert' className='p-4 text-sm text-bad'>
          {error.message}
        </p>
      )}

      {r && (
        <>
          <div className='flex flex-wrap gap-2 border-b border-line bg-surface-2 p-3'>
            {canSelect && (r.status === 'SUBMITTED' || r.status === 'BACKUP') && (
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() => run('Shortlisted', () => api.shortlist(r.id))}
              >
                Shortlist
              </Button>
            )}
            {canSelect && r.status === 'SHORTLISTED' && (
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() => run('Back to submitted', () => api.unshortlist(r.id))}
              >
                Unshortlist
              </Button>
            )}
            {canSelect && (r.status === 'SUBMITTED' || r.status === 'SHORTLISTED') && (
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() => run('Moved to backup', () => api.backup(r.id))}
              >
                Backup
              </Button>
            )}
            {canSelect && r.status !== 'REJECTED' && r.status !== 'CANCELLED' && (
              <Button size='sm' disabled={busy} onClick={() => setSelecting(true)}>
                {r.status === 'SELECTED' ? 'Add stall' : 'Select…'}
              </Button>
            )}
            {canSelect && r.status !== 'REJECTED' && r.status !== 'CANCELLED' && (
              <Button
                size='sm'
                variant='destructive'
                disabled={busy}
                onClick={() => setReasonFor('reject')}
              >
                Reject…
              </Button>
            )}
            {canSelect && r.status === 'SELECTED' && (
              <Button
                size='sm'
                variant='ghost'
                disabled={busy}
                onClick={() => run('Cancelled', () => api.cancel(r.id))}
              >
                Cancel
              </Button>
            )}
            {canWrite &&
              (r.flagged ? (
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={busy}
                  onClick={() => run('Unflagged', () => api.unflagRequest(r.id))}
                >
                  Unflag
                </Button>
              ) : (
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={busy}
                  onClick={() => setReasonFor('flag')}
                >
                  <Flag className='h-3.5 w-3.5' /> Flag for follow-up
                </Button>
              ))}
          </div>

          <div className='flex-1 space-y-3 overflow-y-auto p-4'>
            {r.allocations.length > 0 && (
              <Section title='Allocation'>
                {r.allocations.map((a) => (
                  <div key={a.id} className='flex items-center justify-between py-1 text-sm'>
                    <span>
                      <span className='font-mono font-semibold'>{a.stallNumber}</span>
                      <span className='ml-2 text-ink-2'>
                        {a.category.replace(/_/g, ' ').toLowerCase()} ·{' '}
                        {formatDateTime(a.allocatedAt)}
                      </span>
                    </span>
                    {canSelect && (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={busy}
                        onClick={() => run('Released', () => api.releaseAllocation(a.id))}
                      >
                        Release
                      </Button>
                    )}
                  </div>
                ))}
              </Section>
            )}
            {r.rejectReason && (
              <Section title='Rejection'>
                <Row label='Reason' value={r.rejectReason} />
              </Section>
            )}

            <Section title='Application'>
              <Row label='Requester' value={r.requesterName} />
              <Row label='Email' value={r.email} />
              <Row label='Contact' value={r.contactNumber} />
              <Row label='Address' value={r.address} />
              <Row label='Stall type' value={r.stallType === 'FOOD' ? 'Food' : 'Non-food'} />
              <Row label='Preferred location' value={r.preferredZoneCode} />
              <Row label='Stalls requested' value={r.numStallsRequested} />
              <Row label='Items' value={r.itemsSelling} />
              <Row label='Remarks' value={r.remarks} />
              <Row label='Submitted' value={formatDateTime(r.submittedAt)} />
              <Row label='Deposit acknowledged' value={r.depositAcknowledgedAt ? 'Yes' : null} />
            </Section>

            {r.ashram && (
              <Section title='Department'>
                <Row label='Department' value={r.ashram.department} />
                <Row
                  label='Department head'
                  value={`${r.ashram.departmentHead} · ${r.ashram.departmentHeadContact}`}
                />
                <Row
                  label='Requested by'
                  value={`${r.ashram.requestedBy} · ${r.ashram.requesterContact}`}
                />
                <Row label='Usage' value={USAGE[r.ashram.usage] ?? r.ashram.usage} />
                <Row
                  label='Credit card facility'
                  value={r.ashram.creditCardNeeded ? 'Yes' : 'No'}
                />
                <Row label='Tamil Thembu (11 days)' value={r.ashram.wantsThembu ? 'Yes' : 'No'} />
                <Row
                  label='FSSAI expected'
                  value={
                    r.ashram.fssaiExpected === null ? null : r.ashram.fssaiExpected ? 'Yes' : 'No'
                  }
                />
              </Section>
            )}

            {(r.plugs5a || r.plugs15a || r.gasStoves || r.appliances.length) > 0 && (
              <Section title='Electrical'>
                <Row label='5 A plug points' value={r.plugs5a} />
                <Row label='15 A plug points' value={r.plugs15a} />
                <Row label='Gas stoves' value={r.gasStoves} />
                {r.appliances.length > 0 && (
                  <Row
                    label='Appliances'
                    value={
                      <ul className='space-y-0.5'>
                        {r.appliances.map((a, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: display only
                          <li key={i}>
                            {a.name} <span className='text-ink-2'>— {a.watts} W</span>
                          </li>
                        ))}
                        <li className='text-xs text-ink-2'>
                          Total {r.appliances.reduce((n, a) => n + a.watts, 0)} W
                        </li>
                      </ul>
                    }
                  />
                )}
              </Section>
            )}

            {(r.tablesNeeded || r.chairsNeeded || r.passes2w || r.passes4w || r.passesStaff) >
              0 && (
              <Section title='Logistics'>
                <Row label='Tables' value={r.tablesNeeded} />
                <Row label='Chairs' value={r.chairsNeeded} />
                <Row label='2-wheeler passes' value={r.passes2w} />
                <Row label='4-wheeler passes' value={r.passes4w} />
                <Row label='Staff passes' value={r.passesStaff} />
              </Section>
            )}

            {r.customValues.length > 0 && (
              <Section title='Additional'>
                {r.customValues.map((v) => (
                  <Row key={v.fieldId} label={v.label} value={v.value} />
                ))}
              </Section>
            )}
          </div>
        </>
      )}

      <Dialog
        open={reasonFor !== null}
        onClose={() => setReasonFor(null)}
        title={reasonFor === 'reject' ? 'Reject this request' : 'Flag for follow-up'}
        description={
          reasonFor === 'reject'
            ? 'The reason is kept on the record and is not shown to the vendor.'
            : 'A short note for whoever picks this up next.'
        }
        footer={
          <>
            <Button variant='outline' onClick={() => setReasonFor(null)}>
              Back
            </Button>
            <Button
              variant={reasonFor === 'reject' ? 'destructive' : 'default'}
              disabled={!reason.trim()}
              onClick={submitReason}
            >
              {reasonFor === 'reject' ? 'Reject' : 'Flag'}
            </Button>
          </>
        }
      >
        <Textarea
          aria-label='Reason'
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
        />
      </Dialog>

      {r && selecting && (
        <SelectDialog
          request={r}
          onClose={() => setSelecting(false)}
          onDone={() => {
            setSelecting(false);
            reload();
            onChanged();
          }}
        />
      )}
    </aside>
  );
}

export type { Detail };
