import type { RequestDetail as Detail } from '@msr/stalls';
import { useRef, useState } from 'react';
import { ApiError } from '../api-client';
import * as api from '../api';
import { StatusPill, TypeBadge } from '../components/StatusPill';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Dialog,
  ErrorBox,
  Icon,
  Loading,
  Tag,
  Textarea,
  useEscape,
  useIsMobile,
  useToast,
} from '../ui';
import { AmendDialog } from './AmendDialog';
import { SelectDialog } from './SelectDialog';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '10.5rem 1fr',
        gap: 10,
        padding: '5px 0',
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <dt style={{ color: 'var(--mfg)' }}>{label}</dt>
      <dd style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
      <h3
        style={{
          margin: '0 0 4px',
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '.8px',
          textTransform: 'uppercase',
          color: 'var(--mfg)',
        }}
      >
        {title}
      </h3>
      <dl style={{ margin: 0 }}>{children}</dl>
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
  const toast = useToast();
  const mobile = useIsMobile();
  const { data: r, error, loading, reload } = useLoad(() => api.getRequest(id), [id]);
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<'reject' | 'flag' | null>(null);
  const [reason, setReason] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [amending, setAmending] = useState(false);
  const panel = useRef<HTMLElement>(null);

  // ⚠️ Only while nothing is stacked on top. The reason prompt and the stall
  // picker are `Dialog`s with their own Escape handler; without this gate one
  // key press closes both, so dismissing a confirm also throws away the record
  // behind it.
  useEscape(onClose, reasonFor === null && !selecting && !amending);

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
    setReasonFor(null);
    setReason('');
    if (reasonFor === 'reject') await run('Rejected', () => api.reject(r.id, text));
    else await run('Flagged', () => api.flagRequest(r.id, text));
  };

  const canSelect = can('selection:write');
  const canWrite = can('requests:write');

  return (
    <aside
      ref={panel}
      aria-label='Request detail'
      style={{
        position: 'fixed',
        top: 0,
        bottom: 0,
        right: 0,
        zIndex: 190,
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        maxWidth: mobile ? '100%' : 600,
        background: 'var(--card)',
        borderLeft: '1px solid var(--bd)',
        boxShadow: 'var(--sh-3)',
        animation: 'msrs-fade .15s ease both',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '14px 18px',
          borderBottom: '1px solid var(--bd)',
          flex: 'none',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          {r && (
            <>
              <div
                style={{
                  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                  fontSize: 11,
                  color: 'var(--mfg)',
                }}
              >
                {r.reference}
              </div>
              <h2
                style={{
                  margin: '2px 0 0',
                  fontFamily: 'var(--font-display)',
                  fontSize: 19,
                  fontWeight: 600,
                  letterSpacing: '-.4px',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.stallName}
              </h2>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 7,
                  marginTop: 8,
                }}
              >
                <TypeBadge type={r.requestType} />
                <StatusPill status={r.status} />
                {r.flagged && (
                  <Tag tone='warn' size='sm' title={r.flagReason ?? undefined}>
                    <Icon name='alert-triangle' size={11} />
                    {r.flagReason}
                  </Tag>
                )}
              </div>
            </>
          )}
        </div>
        <button
          type='button'
          onClick={onClose}
          aria-label='Close'
          style={{
            border: 0,
            background: 'none',
            cursor: 'pointer',
            color: 'var(--mfg)',
            display: 'flex',
            flex: 'none',
            padding: mobile ? 12 : 4,
            margin: mobile ? -12 : -4,
          }}
        >
          <Icon name='x' size={18} />
        </button>
      </div>

      {loading && <Loading />}
      {error && (
        <div style={{ padding: 18 }}>
          <ErrorBox>{error.message}</ErrorBox>
        </div>
      )}

      {r && (
        <>
          {/* The action rail. On the table's own plate rather than the card, so
              the controls read as a toolbar for the record below rather than as
              the record's first row. */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 7,
              padding: '11px 18px',
              borderBottom: '1px solid var(--bd)',
              background: 'var(--rail)',
              flex: 'none',
            }}
          >
            {canSelect && (r.status === 'SUBMITTED' || r.status === 'BACKUP') && (
              <Btn disabled={busy} onClick={() => run('Shortlisted', () => api.shortlist(r.id))}>
                Shortlist
              </Btn>
            )}
            {canSelect && r.status === 'SHORTLISTED' && (
              <Btn
                disabled={busy}
                onClick={() => run('Back to submitted', () => api.unshortlist(r.id))}
              >
                Unshortlist
              </Btn>
            )}
            {canSelect && (r.status === 'SUBMITTED' || r.status === 'SHORTLISTED') && (
              <Btn disabled={busy} onClick={() => run('Moved to backup', () => api.backup(r.id))}>
                Backup
              </Btn>
            )}
            {canSelect && r.status !== 'REJECTED' && r.status !== 'CANCELLED' && (
              <Btn kind='primary' disabled={busy} onClick={() => setSelecting(true)}>
                {r.status === 'SELECTED' ? 'Add stall' : 'Select…'}
              </Btn>
            )}
            {canSelect && r.status !== 'REJECTED' && r.status !== 'CANCELLED' && (
              <Btn kind='danger' disabled={busy} onClick={() => setReasonFor('reject')}>
                Reject…
              </Btn>
            )}
            {canSelect && r.status === 'SELECTED' && (
              <Btn disabled={busy} onClick={() => run('Cancelled', () => api.cancel(r.id))}>
                Cancel
              </Btn>
            )}
            {canWrite && (
              <Btn disabled={busy} onClick={() => setAmending(true)}>
                <Icon name='pencil' size={13} /> Amend…
              </Btn>
            )}
            {canWrite &&
              (r.flagged ? (
                <Btn
                  disabled={busy}
                  onClick={() => run('Unflagged', () => api.unflagRequest(r.id))}
                >
                  Unflag
                </Btn>
              ) : (
                <Btn disabled={busy} onClick={() => setReasonFor('flag')}>
                  <Icon name='alert-triangle' size={13} /> Flag for follow-up
                </Btn>
              ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 18px 24px' }}>
            {r.allocations.length > 0 && (
              <Section title='Allocation'>
                {r.allocations.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 0',
                      fontSize: 12.5,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                        fontWeight: 700,
                        color: 'var(--ok-fg)',
                      }}
                    >
                      {a.stallNumber}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--mfg)' }}>
                      {a.category.replace(/_/g, ' ').toLowerCase()} ·{' '}
                      {formatDateTime(a.allocatedAt)}
                    </span>
                    {canSelect && (
                      <Btn
                        disabled={busy}
                        onClick={() => run('Released', () => api.releaseAllocation(a.id))}
                      >
                        Release
                      </Btn>
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
              <Row label='Bay requested' value={r.preferredZoneCode} />
              {/* 🔴 What the stall is PRICED at, once the team and the requester
                  have settled it — which is routinely not the bay that was asked
                  for, and is settled before any stall number exists. */}
              <Row
                label='Bay agreed'
                value={
                  r.agreedZoneCode ? (
                    <>
                      {r.agreedZoneCode}
                      {r.agreedZoneCode !== r.preferredZoneCode && (
                        <Tag tone='warn' size='sm' style={{ marginLeft: 7 }}>
                          moved from {r.preferredZoneCode}
                        </Tag>
                      )}
                    </>
                  ) : null
                }
              />
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
                      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                        {r.appliances.map((a, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: display only
                          <li key={i}>
                            {a.name} <span style={{ color: 'var(--mfg)' }}>— {a.watts} W</span>
                          </li>
                        ))}
                        <li style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 3 }}>
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

      {reasonFor !== null && (
        <Dialog
          title={reasonFor === 'reject' ? 'Reject this request' : 'Flag for follow-up'}
          note={
            reasonFor === 'reject'
              ? 'The reason is kept on the record and is not shown to the vendor.'
              : 'A short note for whoever picks this up next.'
          }
          onClose={() => setReasonFor(null)}
          footer={
            <>
              <Btn onClick={() => setReasonFor(null)}>Back</Btn>
              <Btn
                kind={reasonFor === 'reject' ? 'danger' : 'primary'}
                disabled={!reason.trim()}
                onClick={submitReason}
              >
                {reasonFor === 'reject' ? 'Reject' : 'Flag'}
              </Btn>
            </>
          }
        >
          <Textarea
            aria-label='Reason'
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            // A one-field prompt, opened by an explicit click: focus belongs in
            // the box the reader came here to type in. `Dialog`'s focus trap
            // sees the focus is already inside and leaves it alone.
            autoFocus
          />
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

      {r && amending && (
        <AmendDialog
          request={r}
          onClose={() => setAmending(false)}
          onDone={() => {
            setAmending(false);
            reload();
            onChanged();
          }}
        />
      )}
    </aside>
  );
}

export type { Detail };
