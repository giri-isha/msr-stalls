import { type OnboardingRow, STAGE_LABEL, formatInr } from '@msr/stalls';
import { useState } from 'react';
import * as api from '../api';
import { Grid, Mono, Sub } from '../components/Grid';
import { StagePill, TypeTag } from '../components/StatusPill';
import { formatDate, formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import { Dialog } from '../ui/components/Dialog';
import { StatTiles } from '../ui/components/StatTiles';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, ErrorBox, H1, KV, Loading, Tag, Toolbar, toolBtnStyle } from '../ui/ui';

/** Requirements 4–5, 7–8: every selected vendor and where they stand — bank
 *  details in, payment quoted and sent, confirmed, FSSAI, coupon. The place a
 *  coordinator works from between selection and the event. */
export function Onboarding() {
  const { can } = useMe();
  const toast = useToast();
  const rows = useLoad(api.onboardingRows);
  const [stage, setStage] = useState<string>('All');
  const [open, setOpen] = useState<OnboardingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const canComms = can('comms:write');
  const canWrite = can('requests:write');

  if (rows.loading) return <Loading />;
  if (rows.error || !rows.data) return <ErrorBox>{rows.error?.message}</ErrorBox>;
  const all = rows.data;
  const shown = stage === 'All' ? all : all.filter((r) => STAGE_LABEL[r.stage] === stage);
  const counts = new Map<string, number>();
  for (const r of all) counts.set(STAGE_LABEL[r.stage], (counts.get(STAGE_LABEL[r.stage]) ?? 0) + 1);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.ok(label);
      rows.reload();
      setOpen(null);
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <H1 icon={<Icon name='users' size={20} />} sub='Selected vendors, from confirmation through payment to FSSAI and staff coupons.'>
        Vendor Onboarding
      </H1>
      <StatTiles
        noun='vendor'
        tiles={[{ label: 'All', count: all.length }, ...[...counts.entries()].map(([label, count]) => ({ label, count }))]}
        active={stage}
        onPick={setStage}
      />
      <Toolbar>
        {['All', ...Object.values(STAGE_LABEL)].map((s) => (
          <button type='button' key={s} onClick={() => setStage(s)} aria-pressed={stage === s} style={toolBtnStyle(stage === s)}>
            {s}
            {s !== 'All' && counts.get(s) ? ` · ${counts.get(s)}` : ''}
          </button>
        ))}
      </Toolbar>
      <Grid
        rows={shown}
        rowKey={(r) => r.id}
        onRow={setOpen}
        selectedKey={open?.id ?? null}
        empty='No selected vendors at this stage.'
        columns={[
          {
            key: 'stall',
            header: 'Stall',
            width: '1.6fr',
            mobile: 'title',
            render: (r) => (
              <>
                <b>{r.stallName}</b>
                <Sub>
                  <Mono>{r.reference}</Mono> · {r.requesterName} · {r.contactNumber}
                </Sub>
              </>
            ),
          },
          { key: 'type', header: 'Type', width: '110px', render: (r) => <TypeTag type={r.requestType} size='sm' /> },
          { key: 'alloc', header: 'Stalls', width: '100px', render: (r) => <Mono>{r.allocatedStalls.join(', ')}</Mono> },
          { key: 'stage', header: 'Stage', width: '150px', render: (r) => <StagePill stage={r.stage} size='sm' /> },
          {
            key: 'bank',
            header: 'Bank',
            width: '110px',
            render: (r) => (r.bankSubmittedAt ? <Tag tone='ok' size='sm'>{formatDate(r.bankSubmittedAt)}</Tag> : r.lastSent.SELECTION_VENDOR || r.lastSent.SELECTION_LOCAL_WELFARE ? <Tag tone='warn' size='sm'>Awaited</Tag> : <Tag size='sm'>—</Tag>),
          },
          {
            key: 'pay',
            header: 'Payment',
            width: '150px',
            render: (r) =>
              r.payment ? (
                <>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatInr(r.payment.totalPayablePaise)}</span>
                  <Sub>{r.payment.confirmedAt ? 'Confirmed' : r.payment.emailSentAt ? 'Sent, awaiting' : 'Quoted'}</Sub>
                </>
              ) : (
                <span style={{ color: 'var(--mfg)' }}>—</span>
              ),
          },
          {
            key: 'fssai',
            header: 'FSSAI',
            width: '100px',
            render: (r) => (r.fssai ? <Tag tone={r.fssai.verifiedAt ? 'ok' : 'warn'} size='sm'>{r.fssai.verifiedAt ? 'Verified' : 'Uploaded'}</Tag> : <span style={{ color: 'var(--mfg)' }}>—</span>),
          },
          { key: 'coupon', header: 'Staff', width: '90px', render: (r) => (r.coupon ? <span>{r.coupon.registeredCount}/{r.coupon.maxStaff}</span> : <span style={{ color: 'var(--mfg)' }}>—</span>) },
        ]}
      />

      {open && (
        <Dialog width={620} title={open.stallName} note={`${open.reference} · ${open.allocatedStalls.join(', ') || 'no stall yet'}`} onClose={() => setOpen(null)}>
          <Detail r={open} canComms={canComms} canWrite={canWrite} busy={busy} run={run} />
        </Dialog>
      )}
    </div>
  );
}

function Detail({ r, canComms, canWrite, busy, run }: { r: OnboardingRow; canComms: boolean; canWrite: boolean; busy: boolean; run: (l: string, f: () => Promise<unknown>) => Promise<void> }) {
  const pay = useLoad(() => api.payment(r.id), [r.id]);
  const bank = useLoad(() => api.bankDetails(r.id), [r.id]);
  const fssai = useLoad(() => api.fssaiFor(r.id), [r.id]);
  const isAshram = r.requestType === 'ASHRAM' || r.requestType === 'ASHRAM_FOOD';
  const selectionKey = r.requestType === 'VENDOR' ? 'SELECTION_VENDOR' : r.requestType === 'LOCAL_WELFARE' ? 'SELECTION_LOCAL_WELFARE' : 'SELECTION_ASHRAM';

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <KV k='Stage' v={<StagePill stage={r.stage} size='sm' />} />
      <KV
        k='Confirmation email'
        v={
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {r.lastSent[selectionKey] ? `Sent ${formatDateTime(r.lastSent[selectionKey]!)}` : 'Not sent'}
            {canComms && !r.lastSent[selectionKey] && (
              <Btn disabled={busy} onClick={() => run('Confirmation sent', () => api.sendEmails({ requestIds: [r.id], templateKey: selectionKey, force: false }))}>
                Send now
              </Btn>
            )}
          </span>
        }
      />
      {!isAshram && (
        <KV
          k='Bank details'
          v={
            bank.data ? (
              <span>
                {bank.data.accountHolder}, {bank.data.bankName} {bank.data.branch} · A/c ••••{bank.data.accountNumber.slice(-4)} · {bank.data.ifsc} · PAN {bank.data.panNumber} · GST {bank.data.gstNumber}
                <Sub>Received {formatDateTime(bank.data.submittedAt)}</Sub>
              </span>
            ) : (
              <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                Awaited
                {canComms && r.lastSent[selectionKey] && (
                  <Btn disabled={busy} onClick={() => run('Reminder sent', () => api.sendEmails({ requestIds: [r.id], templateKey: 'BANK_REMINDER', force: true }))}>
                    Send reminder
                  </Btn>
                )}
              </span>
            )
          }
        />
      )}
      {!isAshram && (
        <KV
          k='Payment'
          v={
            pay.data ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 16px', fontSize: 12.5 }}>
                  {pay.data.lines.map((l) => (
                    <div key={l.label} style={{ display: 'contents' }}>
                      <span style={{ color: 'var(--mfg)' }}>{l.label}</span>
                      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatInr(l.amountPaise)}</span>
                    </div>
                  ))}
                  <span style={{ fontWeight: 700 }}>Total payable</span>
                  <span style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatInr(pay.data.totalPayablePaise)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {pay.data.confirmedAt ? (
                    <Tag tone='ok'>Confirmed {formatDate(pay.data.confirmedAt)} · {pay.data.referenceNo}</Tag>
                  ) : (
                    <>
                      {pay.data.emailSentAt ? <Tag tone='info'>Payment email sent {formatDateTime(pay.data.emailSentAt)}</Tag> : <Tag>Quoted, not yet sent</Tag>}
                      {canComms && (
                        <Btn kind={pay.data.emailSentAt ? 'ghost' : 'primary'} disabled={busy} onClick={() => run('Payment details sent', () => api.sendPaymentEmail(r.id))}>
                          {pay.data.emailSentAt ? 'Re-send payment email' : 'Send payment email'}
                        </Btn>
                      )}
                      {canComms && pay.data.emailSentAt && (
                        <Btn disabled={busy} onClick={() => run('Reminder sent', () => api.sendEmails({ requestIds: [r.id], templateKey: 'PAYMENT_REMINDER', force: true }))}>
                          Send reminder
                        </Btn>
                      )}
                      {canComms && (
                        <Btn disabled={busy} onClick={() => run('Re-quoted', () => api.requote(r.id))}>
                          Re-quote
                        </Btn>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : pay.error ? (
              <span style={{ color: 'var(--des-fg)' }}>{pay.error.message}</span>
            ) : (
              'Loading…'
            )
          }
        />
      )}
      <KV
        k='FSSAI'
        v={
          fssai.data ? (
            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {fssai.data.viewUrl ? (
                <a href={fssai.data.viewUrl} target='_blank' rel='noreferrer'>
                  {fssai.data.fileName}
                </a>
              ) : (
                fssai.data.fileName
              )}
              {fssai.data.licenseNumber && <Mono>{fssai.data.licenseNumber}</Mono>}
              {fssai.data.verifiedAt ? (
                <Tag tone='ok' size='sm'>Verified</Tag>
              ) : fssai.data.rejectedReason ? (
                <Tag tone='des' size='sm'>Rejected: {fssai.data.rejectedReason}</Tag>
              ) : (
                <Tag tone='warn' size='sm'>Awaiting review</Tag>
              )}
              {canWrite && !fssai.data.verifiedAt && (
                <>
                  <Btn kind='primary' disabled={busy} onClick={() => run('FSSAI verified', () => api.reviewFssai(r.id, 'VERIFY'))}>
                    Verify
                  </Btn>
                  <Btn kind='danger' disabled={busy} onClick={() => run('FSSAI rejected', () => api.reviewFssai(r.id, 'REJECT', 'Certificate not acceptable — please upload a valid one'))}>
                    Reject
                  </Btn>
                </>
              )}
            </span>
          ) : (
            <span style={{ color: 'var(--mfg)' }}>Not uploaded</span>
          )
        }
      />
      <KV
        k='Staff coupon'
        v={
          r.coupon ? (
            <span>
              <Mono>{r.coupon.code}</Mono> · {r.coupon.registeredCount} of {r.coupon.maxStaff} registered
            </span>
          ) : (
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              Not issued
              {canWrite && (
                <Btn disabled={busy} onClick={() => run('Coupon issued', () => api.issueCoupon(r.id))}>
                  Issue now
                </Btn>
              )}
            </span>
          )
        }
      />
      {canComms && r.coupon && !r.lastSent.POST_PAYMENT && (
        <div style={{ marginTop: 8 }}>
          <Btn disabled={busy} onClick={() => run('Post-payment mail sent', () => api.sendEmails({ requestIds: [r.id], templateKey: 'POST_PAYMENT', force: false }))}>
            Send FSSAI & staff-registration mail
          </Btn>
        </div>
      )}
    </div>
  );
}
