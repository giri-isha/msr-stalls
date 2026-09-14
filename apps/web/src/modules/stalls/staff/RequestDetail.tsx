import type { RequestDetail as Detail } from '@msr/stalls';
import { useState } from 'react';
import { ApiError } from '../api-client';
import * as api from '../api';
import { TextArea } from '../components/FormControls';
import { Mono } from '../components/Grid';
import { StagePill, StatusPill, TypeTag } from '../components/StatusPill';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import { Dialog } from '../ui/components/Dialog';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, ErrorBox, KV, Loading, Tag } from '../ui/ui';
import { useIsMobile } from '../ui/useBreakpoint';
import { SelectDialog } from './SelectDialog';

const USAGE: Record<string, string> = {
  DEPT_DISPLAY: 'Used by Department for Display',
  DEPT_SALES: 'Used by Department for Sales',
  VENDOR_SALES: 'Giving to Vendor for sales',
  SPONSOR: 'Giving to Sponsor',
  OTHER: 'Other — see remarks',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--mfg)', marginBottom: 2 }}>{title}</div>
      {children}
    </section>
  );
}

const show = (v: unknown) => v !== null && v !== undefined && v !== '' && v !== 0;

/** The right-hand panel: the whole application, and every action the caller
 *  is allowed to take on it. The API decides what is allowed; the buttons only
 *  reflect it. */
export function RequestDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useMe();
  const toast = useToast();
  const mobile = useIsMobile();
  const { data: r, error, loading, reload } = useLoad(() => api.getRequest(id), [id]);
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<'reject' | 'flag' | null>(null);
  const [reason, setReason] = useState('');
  const [selecting, setSelecting] = useState(false);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.ok(label);
      reload();
      onChanged();
    } catch (e) {
      toast.fail(e instanceof ApiError ? e : new Error('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const submitReason = async () => {
    if (!r || !reasonFor || !reason.trim()) return;
    const text = reason.trim();
    const kind = reasonFor;
    setReasonFor(null);
    setReason('');
    if (kind === 'reject') await run('Rejected', () => api.reject(r.id, text));
    else await run('Flagged', () => api.flagRequest(r.id, text));
  };

  const canSelect = can('selection:write');
  const canWrite = can('requests:write');
  const live = r && r.status !== 'REJECTED' && r.status !== 'CANCELLED';

  return (
    <aside
      aria-label='Request detail'
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: mobile ? '100%' : 'min(600px, 100%)',
        zIndex: 150,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--card)',
        borderLeft: '1px solid var(--bd)',
        boxShadow: 'var(--sh-3)',
        animation: 'msrs-rise .18s ease both',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {r && (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                <Mono>{r.reference}</Mono>
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.stallName}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <TypeTag type={r.requestType} size='sm' />
                <StatusPill status={r.status} size='sm' />
                {r.status === 'SELECTED' && <StagePill stage={r.stage} size='sm' />}
                {r.flagged && (
                  <Tag tone='warn' size='sm' title={r.flagReason ?? undefined}>
                    ⚑ {r.flagReason}
                  </Tag>
                )}
              </div>
            </>
          )}
        </div>
        <button type='button' onClick={onClose} aria-label='Close' style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--mfg)', display: 'flex', padding: 4 }}>
          <Icon name='x' size={18} />
        </button>
      </div>

      {loading && <Loading />}
      {error && (
        <div style={{ padding: 16 }}>
          <ErrorBox>{error.message}</ErrorBox>
        </div>
      )}

      {r && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--line)', background: 'var(--mut)' }}>
            {canSelect && (r.status === 'SUBMITTED' || r.status === 'BACKUP') && (
              <Btn disabled={busy} onClick={() => run('Shortlisted', () => api.shortlist(r.id))}>
                Shortlist
              </Btn>
            )}
            {canSelect && r.status === 'SHORTLISTED' && (
              <Btn disabled={busy} onClick={() => run('Back to submitted', () => api.unshortlist(r.id))}>
                Unshortlist
              </Btn>
            )}
            {canSelect && (r.status === 'SUBMITTED' || r.status === 'SHORTLISTED') && (
              <Btn disabled={busy} onClick={() => run('Moved to backup', () => api.backup(r.id))}>
                Backup
              </Btn>
            )}
            {canSelect && live && (
              <Btn kind='primary' disabled={busy} onClick={() => setSelecting(true)}>
                {r.status === 'SELECTED' ? 'Add stall' : 'Select…'}
              </Btn>
            )}
            {canSelect && live && (
              <Btn kind='danger' disabled={busy} onClick={() => setReasonFor('reject')}>
                Reject…
              </Btn>
            )}
            {canSelect && r.status === 'SELECTED' && (
              <Btn disabled={busy} onClick={() => run('Cancelled', () => api.cancel(r.id))}>
                Cancel
              </Btn>
            )}
            {canWrite &&
              (r.flagged ? (
                <Btn disabled={busy} onClick={() => run('Unflagged', () => api.unflagRequest(r.id))}>
                  Unflag
                </Btn>
              ) : (
                <Btn disabled={busy} onClick={() => setReasonFor('flag')}>
                  ⚑ Flag for follow-up
                </Btn>
              ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 20px' }}>
            {r.allocations.length > 0 && (
              <Section title='Allocation'>
                {r.allocations.map((a) => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
                    <b>
                      <Mono>{a.stallNumber}</Mono>
                    </b>
                    <span style={{ color: 'var(--mfg)', flex: 1 }}>
                      {a.category.replace(/_/g, ' ').toLowerCase()} · {formatDateTime(a.allocatedAt)}
                    </span>
                    {canSelect && (
                      <Btn disabled={busy} onClick={() => run('Released', () => api.releaseAllocation(a.id))}>
                        Release
                      </Btn>
                    )}
                  </div>
                ))}
              </Section>
            )}
            {r.rejectReason && (
              <Section title='Rejection'>
                <KV k='Reason' v={r.rejectReason} />
              </Section>
            )}

            <Section title='Application'>
              <KV k='Requester' v={r.requesterName} />
              <KV k='Email' v={r.email} />
              <KV k='Contact' v={r.contactNumber} />
              {show(r.address) && <KV k='Address' v={r.address} />}
              <KV k='Stall type' v={r.stallType === 'FOOD' ? 'Food' : 'Non-food'} />
              <KV k='Preferred location' v={r.preferredZoneCode} />
              <KV k='Stalls requested' v={r.numStallsRequested} />
              <KV k='Items' v={r.itemsSelling} />
              {show(r.remarks) && <KV k='Remarks' v={r.remarks} />}
              <KV k='Submitted' v={formatDateTime(r.submittedAt)} />
              {r.depositAcknowledgedAt && <KV k='Deposit acknowledged' v='Yes' />}
            </Section>

            {r.ashram && (
              <Section title='Department'>
                <KV k='Department' v={r.ashram.department} />
                <KV k='Department head' v={`${r.ashram.departmentHead} · ${r.ashram.departmentHeadContact}`} />
                <KV k='Requested by' v={`${r.ashram.requestedBy} · ${r.ashram.requesterContact}`} />
                <KV k='Usage' v={USAGE[r.ashram.usage] ?? r.ashram.usage} />
                <KV k='Credit card facility' v={r.ashram.creditCardNeeded ? 'Yes' : 'No'} />
                <KV k='Tamil Thembu (11 days)' v={r.ashram.wantsThembu ? 'Yes' : 'No'} />
                {r.ashram.fssaiExpected !== null && <KV k='FSSAI expected' v={r.ashram.fssaiExpected ? 'Yes' : 'No'} />}
              </Section>
            )}

            {(r.plugs5a > 0 || r.plugs15a > 0 || r.gasStoves > 0 || r.appliances.length > 0) && (
              <Section title='Electrical'>
                {show(r.plugs5a) && <KV k='5 A plug points' v={r.plugs5a} />}
                {show(r.plugs15a) && <KV k='15 A plug points' v={r.plugs15a} />}
                {show(r.gasStoves) && <KV k='Gas stoves' v={r.gasStoves} />}
                {r.appliances.length > 0 && (
                  <KV
                    k='Appliances'
                    v={
                      <div>
                        {r.appliances.map((a, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: display only
                          <div key={i}>
                            {a.name} <span style={{ color: 'var(--mfg)' }}>— {a.watts} W</span>
                          </div>
                        ))}
                        <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>Total {r.appliances.reduce((n, a) => n + a.watts, 0)} W</div>
                      </div>
                    }
                  />
                )}
              </Section>
            )}

            {(r.tablesNeeded > 0 || r.chairsNeeded > 0 || r.passes2w > 0 || r.passes4w > 0 || r.passesStaff > 0) && (
              <Section title='Logistics'>
                {show(r.tablesNeeded) && <KV k='Tables' v={r.tablesNeeded} />}
                {show(r.chairsNeeded) && <KV k='Chairs' v={r.chairsNeeded} />}
                {show(r.passes2w) && <KV k='2-wheeler passes' v={r.passes2w} />}
                {show(r.passes4w) && <KV k='4-wheeler passes' v={r.passes4w} />}
                {show(r.passesStaff) && <KV k='Staff passes' v={r.passesStaff} />}
              </Section>
            )}

            {r.customValues.length > 0 && (
              <Section title='Additional'>
                {r.customValues.map((v) => (
                  <KV key={v.fieldId} k={v.label} v={v.value} />
                ))}
              </Section>
            )}
          </div>
        </>
      )}

      {reasonFor && (
        <Dialog
          title={reasonFor === 'reject' ? 'Reject this request' : 'Flag for follow-up'}
          note={reasonFor === 'reject' ? 'The reason is kept on the record and is not shown to the vendor.' : 'A short note for whoever picks this up next.'}
          onClose={() => setReasonFor(null)}
          footer={
            <>
              <Btn onClick={() => setReasonFor(null)}>Back</Btn>
              <Btn kind={reasonFor === 'reject' ? 'danger' : 'primary'} disabled={!reason.trim()} onClick={submitReason}>
                {reasonFor === 'reject' ? 'Reject' : 'Flag'}
              </Btn>
            </>
          }
        >
          <TextArea aria-label='Reason' value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Dialog>
      )}

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
