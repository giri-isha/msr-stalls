import type { PaymentRow, RefundRow } from '@msr/stalls';
import { formatInr, paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { useMemo, useState } from 'react';
import {
  confirmPayment,
  deletePaymentRecord,
  getConfig,
  listPayments,
  listRefunds,
  sendEmails,
  setDiscretionaryFee,
  setVoucherRef,
  submitRefund,
} from '../api';
import { formatDate, useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Checkbox,
  Dialog,
  Empty,
  ErrorBox,
  FormField,
  H1,
  Icon,
  Input,
  Loading,
  Search,
  Select,
  Tag,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  useIsMobile,
  useToast,
} from '../ui';
import { Tabs } from './Communication';

/**
 * Finance — what is owed, what has arrived, and what goes back.
 *
 * ⚠️ **No money is collected on this screen.** The requirement is explicit that
 * payment happens by NEFT to a virtual account; every figure here records what
 * has already happened on a bank statement. The three tabs follow the money in
 * order: tell the vendor what to pay, tick off the credit when it lands, hand
 * the balance back after the event.
 */
export function Finance() {
  const [tab, setTab] = useState<'due' | 'confirm' | 'refund'>('due');
  const { can } = useMe();

  if (!can('finance.read')) {
    return (
      <div>
        <H1 icon={<Icon name='bar-chart' size={18} />}>Finance</H1>
        <Empty>You do not have access to the finance screens.</Empty>
      </div>
    );
  }

  return (
    <div>
      <H1
        icon={<Icon name='bar-chart' size={18} />}
        sub='Payment details, confirmation of credits received, and refunds after the event.'
      >
        Finance
      </H1>
      <Tabs
        tabs={[
          ['due', 'Payment details'],
          ['confirm', 'Payment confirmation'],
          ['refund', 'Refunds & deductions'],
        ]}
        active={tab}
        onPick={(t) => setTab(t as typeof tab)}
      />
      {tab === 'due' && <DuePanel />}
      {tab === 'confirm' && <ConfirmPanel />}
      {tab === 'refund' && <RefundPanel />}
    </div>
  );
}

function useSearch<T>(rows: T[] | null, match: (r: T, term: string) => boolean) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !term || match(r, term));
  }, [rows, q, match]);
  return { q, setQ, filtered };
}

const matchPayment = (r: PaymentRow, t: string) =>
  r.stallName.toLowerCase().includes(t) ||
  r.requesterName.toLowerCase().includes(t) ||
  r.reference.toLowerCase().includes(t);

// ── Tab 1: what is due ──────────────────────────────────────────────────────

function DuePanel() {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload } = useLoad(listPayments);
  const { q, setQ, filtered } = useSearch(data, matchPayment);
  const mobile = useIsMobile();
  const [busy, setBusy] = useState<string | null>(null);

  const sendPayment = async (row: PaymentRow) => {
    setBusy(row.requestId);
    try {
      const result = await sendEmails('PAYMENT_DETAILS', [row.requestId]);
      if (result.sent.length > 0) toast.ok(`Payment details sent to ${row.stallName}.`);
      else toast.info(`${row.stallName}: ${result.skipped[0]?.reason ?? 'not sent'}`);
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', maxWidth: 680 }}>
        Once a vendor's bank details are in, send them the payment details with the calculation
        below. Payment is made by NEFT to the Isha Foundation account sent separately — nothing is
        collected here.
      </div>
      <Search value={q} onChange={setQ} placeholder='Search vendor…' />

      {filtered.length === 0 ? (
        <Empty>No selected vendors owe anything yet.</Empty>
      ) : mobile ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map((r) => (
            <Card key={r.requestId} pad={14} style={{ display: 'grid', gap: 8 }}>
              <div style={{ fontWeight: 600 }}>{r.stallName}</div>
              <Money row={r} />
              {can('comms.write') && !r.paymentEmailSentAt && (
                <Btn kind='primary' onClick={() => sendPayment(r)} disabled={busy === r.requestId}>
                  Send payment email
                </Btn>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH align='right'>Stall fee</TH>
                <TH align='right'>Plugs</TH>
                <TH align='right'>Chairs/tables</TH>
                <TH align='right'>GST</TH>
                <TH align='right'>Total due</TH>
                <TH>Bank details</TH>
                <TH>Payment email</TH>
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((r) => (
                <TR key={r.requestId}>
                  <TD>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.stallName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                      {r.stallNumbers.join(', ') || '—'}
                    </div>
                  </TD>
                  {r.quote.unpriced ? (
                    <TD colSpan={5} muted>
                      No rent is quoted for this zone — priced by the team.
                    </TD>
                  ) : (
                    <>
                      <TD align='right'>{formatInr(r.quote.stallFeePaise)}</TD>
                      <TD align='right'>{formatInr(r.quote.plugFeePaise)}</TD>
                      <TD align='right'>{formatInr(r.quote.equipmentFeePaise)}</TD>
                      <TD align='right' muted>
                        {formatInr(r.quote.gstPaise)}
                      </TD>
                      <TD align='right' style={{ fontWeight: 700 }}>
                        {formatInr(r.quote.grandTotalPaise)}
                        <div style={{ fontSize: 10.5, color: 'var(--mfg)', fontWeight: 400 }}>
                          incl. {formatInr(r.quote.depositTotalPaise)} deposit
                        </div>
                        {/* The total already follows the concession. Without
                            this line it silently disagrees with the itemised
                            columns beside it, which still show the card rate. */}
                        {r.quote.discretionaryFeePaise !== null && (
                          <div style={{ fontSize: 10.5, color: 'var(--mfg)', fontWeight: 400 }}>
                            Agreed fee {formatInr(r.quote.payableFeePaise)} —{' '}
                            {r.quote.discretionaryReason}
                          </div>
                        )}
                      </TD>
                    </>
                  )}
                  <TD>
                    <Tag tone={r.bankDetailsReceivedAt ? 'ok' : 'warn'} size='sm'>
                      {r.bankDetailsReceivedAt ? 'Received' : 'Pending'}
                    </Tag>
                  </TD>
                  <TD>
                    {r.paymentEmailSentAt ? (
                      <Tag tone='ok' size='sm'>
                        Sent {formatDate(r.paymentEmailSentAt)}
                      </Tag>
                    ) : (
                      <Tag tone='neutral' size='sm'>
                        Not sent
                      </Tag>
                    )}
                  </TD>
                  <TD align='right'>
                    {can('comms.write') && !r.paymentEmailSentAt && (
                      <Btn onClick={() => sendPayment(r)} disabled={busy === r.requestId}>
                        Send
                      </Btn>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function Money({ row }: { row: PaymentRow }) {
  if (row.quote.unpriced) {
    return <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>No rent quoted for this zone.</div>;
  }
  const conceded = row.quote.discretionaryFeePaise !== null;
  return (
    <div style={{ fontSize: 12.5, display: 'grid', gap: 2 }}>
      {/* Both figures, always, where a concession stands: what the requester was
          TOLD and what they OWE are different facts, and Finance reconciling a
          season six months later needs to see the gap rather than infer it. */}
      <div style={conceded ? { textDecoration: 'line-through', color: 'var(--mfg)' } : undefined}>
        Fee incl. GST: {formatInr(row.quote.feeTotalPaise)}
      </div>
      {conceded && (
        <div>
          Agreed fee: {formatInr(row.quote.payableFeePaise)}
          <span style={{ color: 'var(--mfg)' }}> — {row.quote.discretionaryReason}</span>
        </div>
      )}
      <div>Deposit: {formatInr(row.quote.depositTotalPaise)}</div>
      <div style={{ fontWeight: 700 }}>Total: {formatInr(row.quote.grandTotalPaise)}</div>
    </div>
  );
}

// ── Tab 2: confirming a credit ──────────────────────────────────────────────

function ConfirmPanel() {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload } = useLoad(listPayments);
  const { q, setQ, filtered } = useSearch(data, matchPayment);
  const [open, setOpen] = useState<PaymentRow | null>(null);
  const canWrite = can('finance.write');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', maxWidth: 680 }}>
        When a credit lands, record its reference number, amount and date here. Rent and deposit are
        recorded separately because they usually arrive as separate transfers.
      </div>
      <Search value={q} onChange={setQ} placeholder='Search vendor…' />

      {filtered.length === 0 ? (
        <Empty>Nothing to confirm.</Empty>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH align='right'>Fee due</TH>
                <TH align='right'>Deposit due</TH>
                <TH align='right'>Rent received</TH>
                <TH align='right'>Deposit received</TH>
                <TH>Credits</TH>
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((r) => (
                <TR key={r.requestId}>
                  <TD>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.stallName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{r.requesterName}</div>
                  </TD>
                  <TD align='right'>{formatInr(r.quote.feeTotalPaise)}</TD>
                  <TD align='right'>{formatInr(r.quote.depositTotalPaise)}</TD>
                  <TD align='right'>{formatInr(r.receivedRentPaise)}</TD>
                  <TD align='right'>{formatInr(r.receivedDepositPaise)}</TD>
                  <TD>
                    {r.records.length === 0 ? (
                      <Tag tone='warn' size='sm'>
                        None
                      </Tag>
                    ) : (
                      <Tag tone={r.fullySettled ? 'ok' : 'info'} size='sm'>
                        {r.records.length} · {r.fullySettled ? 'settled' : 'part paid'}
                      </Tag>
                    )}
                  </TD>
                  <TD align='right'>
                    <Btn onClick={() => setOpen(r)}>{canWrite ? 'Record credit' : 'View'}</Btn>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {open && (
        <ConfirmDialog
          row={open}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onDone={() => {
            reload();
            setOpen(null);
          }}
          onToast={toast}
        />
      )}
    </div>
  );
}

/** Recording what the team actually agreed to collect on one stall.
 *
 *  🔴 "For A3 the cost is 10,000 — for the coconut wala, probably we will give
 *  that stall at 5,000." Local welfare pitches are priced off the rate card and
 *  then settled at whatever the local welfare team judged that trader could
 *  give. The card figure stays as it is; this is the other number, and without
 *  it a stall that paid exactly what was agreed never reads as settled.
 *
 *  The reason is required, and that is not ceremony: a figure below the card
 *  rate with nothing beside it is indistinguishable from a typo six months on,
 *  when whoever agreed it has moved on and Finance is closing the season.
 */
function Concession({
  row,
  onToast,
  onDone,
}: {
  row: PaymentRow;
  onToast: ReturnType<typeof useToast>;
  onDone: () => void;
}) {
  const set = row.quote.discretionaryFeePaise !== null;
  const [open, setOpen] = useState(set);
  const [fee, setFee] = useState(
    set ? String(paiseToRupees(row.quote.discretionaryFeePaise ?? 0)) : '',
  );
  const [reason, setReason] = useState(row.quote.discretionaryReason ?? '');
  const [busy, setBusy] = useState(false);

  if (row.quote.unpriced) return null;

  const save = async (clear: boolean) => {
    const rupees = Number(fee);
    if (!clear && (!Number.isFinite(rupees) || rupees < 0)) {
      onToast.fail(new Error('Enter the amount agreed.'));
      return;
    }
    if (!clear && reason.trim().length === 0) {
      onToast.fail(new Error('Say why the amount was reduced.'));
      return;
    }
    setBusy(true);
    try {
      await setDiscretionaryFee(row.requestId, {
        discretionaryFeePaise: clear ? null : rupeesToPaise(rupees),
        reason: clear ? null : reason.trim(),
      });
      onToast.ok(clear ? 'Back to the quoted fee.' : 'Agreed fee recorded.');
      onDone();
    } catch (e) {
      onToast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Btn onClick={() => setOpen(true)}>Agree a different fee for this stall…</Btn>;
  }

  return (
    <Card pad={12} style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
        Quoted {formatInr(row.quote.feeTotalPaise)} incl. GST. Recording a different figure leaves
        the quote untouched — both are kept.
      </div>
      <FormField id='concession-fee' label='Fee agreed (₹)'>
        <Input
          id='concession-fee'
          type='number'
          min={0}
          value={fee}
          onChange={(e) => setFee(e.target.value)}
        />
      </FormField>
      <FormField id='concession-reason' label='Why'>
        <Input
          id='concession-reason'
          value={reason}
          placeholder='e.g. Local welfare — agreed by the department'
          onChange={(e) => setReason(e.target.value)}
        />
      </FormField>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn kind='primary' disabled={busy} onClick={() => save(false)}>
          Save agreed fee
        </Btn>
        {set && (
          <Btn disabled={busy} onClick={() => save(true)}>
            Back to the quoted fee
          </Btn>
        )}
      </div>
    </Card>
  );
}

function ConfirmDialog({
  row,
  canWrite,
  onClose,
  onDone,
  onToast,
}: {
  row: PaymentRow;
  canWrite: boolean;
  onClose: () => void;
  onDone: () => void;
  onToast: ReturnType<typeof useToast>;
}) {
  const [purpose, setPurpose] = useState<'RENT' | 'DEPOSIT'>('RENT');
  const [referenceNo, setReferenceNo] = useState('');
  const [eCollectCode, setECollect] = useState('');
  const [amount, setAmount] = useState(
    String(paiseToRupees(row.quote.payableFeePaise - row.receivedRentPaise)),
  );
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [remitterName, setRemitter] = useState('');
  const [mode, setMode] = useState<'NEFT' | 'CASH' | 'CHEQUE' | 'UPI' | 'OTHER'>('NEFT');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      onToast.fail(new Error('Enter the amount received.'));
      return;
    }
    setBusy(true);
    try {
      await confirmPayment(row.requestId, {
        purpose,
        referenceNo: referenceNo.trim(),
        eCollectCode: eCollectCode.trim() || undefined,
        amountPaise: rupeesToPaise(rupees),
        receivedOn,
        remitterName: remitterName.trim() || undefined,
        mode,
      });
      onToast.ok('Credit recorded.');
      onDone();
    } catch (e) {
      onToast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={row.stallName}
      note={`${row.reference} · fee ${formatInr(row.quote.feeTotalPaise)}, deposit ${formatInr(row.quote.depositTotalPaise)}`}
      onClose={onClose}
      width={560}
      footer={
        canWrite ? (
          <Btn kind='primary' onClick={save} disabled={busy || referenceNo.trim().length === 0}>
            Record credit
          </Btn>
        ) : undefined
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {row.records.length > 0 && (
          <Card pad={0} style={{ overflow: 'hidden' }}>
            <Table>
              <THead>
                <TR>
                  <TH>Purpose</TH>
                  <TH>Reference</TH>
                  <TH align='right'>Amount</TH>
                  <TH>Date</TH>
                  <TH> </TH>
                </TR>
              </THead>
              <TBody>
                {row.records.map((rec) => (
                  <TR key={rec.id}>
                    <TD>{rec.purpose === 'RENT' ? 'Rent' : 'Deposit'}</TD>
                    <TD mono style={{ fontSize: 11.5 }}>
                      {rec.referenceNo}
                    </TD>
                    <TD align='right'>{formatInr(rec.amountPaise)}</TD>
                    <TD muted style={{ fontSize: 11.5 }}>
                      {rec.receivedOn}
                    </TD>
                    <TD align='right'>
                      {canWrite && (
                        <Btn
                          kind='danger'
                          onClick={async () => {
                            try {
                              await deletePaymentRecord(rec.id);
                              onToast.ok('Credit removed.');
                              onDone();
                            } catch (e) {
                              onToast.fail(e);
                            }
                          }}
                        >
                          Remove
                        </Btn>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}

        {canWrite && <Concession row={row} onToast={onToast} onDone={onDone} />}

        {canWrite && (
          <>
            <FormField id='credit-purpose' label='What this credit is for'>
              <Select
                id='credit-purpose'
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as 'RENT' | 'DEPOSIT')}
              >
                <option value='RENT'>Rent (fee incl. GST)</option>
                <option value='DEPOSIT'>Refundable deposit</option>
              </Select>
            </FormField>
            <FormField id='credit-reference' label='Reference number'>
              <Input
                id='credit-reference'
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder='e.g. YESBN12025022406216143'
              />
            </FormField>
            <FormField id='credit-ecollect' label='E-collect code (optional)'>
              <Input
                id='credit-ecollect'
                value={eCollectCode}
                onChange={(e) => setECollect(e.target.value)}
              />
            </FormField>
            <FormField id='credit-amount' label='Amount received (₹)'>
              <Input
                id='credit-amount'
                type='number'
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FormField>
            <FormField id='credit-date' label='Credit date'>
              <Input
                id='credit-date'
                type='date'
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            </FormField>
            <FormField id='credit-remitter' label='Remitter name (optional)'>
              <Input
                id='credit-remitter'
                value={remitterName}
                onChange={(e) => setRemitter(e.target.value)}
              />
            </FormField>
            <FormField id='credit-mode' label='Mode'>
              <Select
                id='credit-mode'
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                {['NEFT', 'CASH', 'CHEQUE', 'UPI', 'OTHER'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ── Tab 3: refunds ──────────────────────────────────────────────────────────

function RefundPanel() {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload } = useLoad(listRefunds);
  const config = useLoad(getConfig);
  const { q, setQ, filtered } = useSearch(
    data,
    (r: RefundRow, t) =>
      r.stallName.toLowerCase().includes(t) || r.requesterName.toLowerCase().includes(t),
  );
  const [open, setOpen] = useState<RefundRow | null>(null);
  const canWrite = can('finance.write');

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', maxWidth: 680 }}>
        Chairs and tables not returned or damaged, and unclean-stall penalties, are deducted from
        the deposit before the refund is sent to Finance. No payment is made from this screen.
      </div>
      <Search value={q} onChange={setQ} placeholder='Search vendor…' />

      {filtered.length === 0 ? (
        <Empty>No deposits held.</Empty>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH align='right'>Deposit held</TH>
                <TH align='right'>Chairs/tables</TH>
                <TH align='right'>Penalties</TH>
                <TH align='right'>Refund due</TH>
                <TH>Voucher</TH>
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((r) => (
                <TR key={r.requestId}>
                  <TD>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.stallName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{r.requesterName}</div>
                  </TD>
                  <TD align='right'>{formatInr(r.depositHeldPaise)}</TD>
                  <TD align='right'>
                    {formatInr(r.equipmentDeductionPaise)}
                    {!r.submittedAt &&
                      r.suggestedEquipmentDeductionPaise !== r.equipmentDeductionPaise && (
                        <div style={{ fontSize: 10.5, color: 'var(--mfg)' }}>
                          suggested {formatInr(r.suggestedEquipmentDeductionPaise)}
                        </div>
                      )}
                  </TD>
                  <TD align='right'>{formatInr(r.fineDeductionPaise)}</TD>
                  <TD align='right' style={{ fontWeight: 700 }}>
                    {formatInr(r.refundDuePaise)}
                    {r.shortfallPaise > 0 && (
                      <div style={{ fontSize: 10.5, color: 'var(--des-fg)', fontWeight: 400 }}>
                        {formatInr(r.shortfallPaise)} still owed
                      </div>
                    )}
                  </TD>
                  <TD>
                    {r.voucherRef ? (
                      <Tag tone='ok' size='sm'>
                        {r.voucherRef}
                      </Tag>
                    ) : r.submittedAt ? (
                      <Tag tone='info' size='sm'>
                        With Finance
                      </Tag>
                    ) : (
                      <Tag tone='neutral' size='sm'>
                        Not sent
                      </Tag>
                    )}
                  </TD>
                  <TD align='right'>
                    <Btn onClick={() => setOpen(r)}>{r.submittedAt ? 'Voucher' : 'Prepare'}</Btn>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {open && (
        <RefundDialog
          row={open}
          canWrite={canWrite}
          fineTypes={(config.data?.fineTypes ?? []).filter((f) => f.isActive)}
          onClose={() => setOpen(null)}
          onDone={() => {
            reload();
            setOpen(null);
          }}
          onToast={toast}
        />
      )}
    </div>
  );
}

function RefundDialog({
  row,
  canWrite,
  fineTypes,
  onClose,
  onDone,
  onToast,
}: {
  row: RefundRow;
  canWrite: boolean;
  fineTypes: Array<{ id: string; reason: string; defaultAmountPaise: number }>;
  onClose: () => void;
  onDone: () => void;
  onToast: ReturnType<typeof useToast>;
}) {
  const [deduction, setDeduction] = useState(String(paiseToRupees(row.equipmentDeductionPaise)));
  const [fines, setFines] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('0');
  const [extraReason, setExtraReason] = useState('');
  const [voucher, setVoucher] = useState(row.voucherRef ?? '');
  const [busy, setBusy] = useState(false);

  const finesTotal =
    fineTypes.filter((f) => fines.has(f.id)).reduce((t, f) => t + f.defaultAmountPaise, 0) +
    rupeesToPaise(Number(extra) || 0);
  // 🔴 Each deduction against ITS OWN deposit, the same rule the API applies:
  // furniture losses off the chairs-and-tables deposit, fines off the stall
  // deposit. Taking both off a pooled total would preview a refund the vendor
  // will not receive whenever one bucket over-runs.
  const equipmentRefund = Math.max(
    0,
    row.equipmentDepositPaise - rupeesToPaise(Number(deduction) || 0),
  );
  const stallRefund = Math.max(0, row.stallDepositPaise - finesTotal);
  const preview = equipmentRefund + stallRefund;

  return (
    <Dialog
      title={row.stallName}
      note={`Deposit held ${formatInr(row.depositHeldPaise)} — stall ${formatInr(row.stallDepositPaise)}, chairs and tables ${formatInr(row.equipmentDepositPaise)}`}
      onClose={onClose}
      width={560}
      footer={
        canWrite ? (
          row.submittedAt ? (
            <Btn
              kind='primary'
              disabled={busy || voucher.trim().length === 0}
              onClick={async () => {
                setBusy(true);
                try {
                  await setVoucherRef(row.requestId, voucher.trim());
                  onToast.ok('Voucher recorded.');
                  onDone();
                } catch (e) {
                  onToast.fail(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save voucher number
            </Btn>
          ) : (
            <Btn
              kind='primary'
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await submitRefund(row.requestId, {
                    equipmentDeductionPaise: rupeesToPaise(Number(deduction) || 0),
                    fineTypeIds: [...fines],
                    extraFinePaise: rupeesToPaise(Number(extra) || 0),
                    extraFineReason: extraReason.trim() || undefined,
                  });
                  onToast.ok('Sent to Finance.');
                  onDone();
                } catch (e) {
                  onToast.fail(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send to Finance
            </Btn>
          )
        ) : undefined
      }
    >
      {row.submittedAt ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 12.5 }}>
            Sent to Finance on {formatDate(row.submittedAt)}. The figures below are frozen.
          </div>
          <Card pad={14} style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            {/* Two deposits, each shown with what came off it — a single
                "deposit held" line cannot explain a refund where one bucket
                over-ran and the other came back whole. */}
            <Line label='Chairs and tables deposit' value={formatInr(row.equipmentDepositPaise)} />
            <Line label='Chairs and tables' value={`− ${formatInr(row.equipmentDeductionPaise)}`} />
            {row.equipmentShortfallPaise > 0 && (
              <Line
                label='Beyond that deposit'
                value={`${formatInr(row.equipmentShortfallPaise)} to recover`}
              />
            )}
            <Line label='Stall deposit' value={formatInr(row.stallDepositPaise)} />
            <Line label='Penalties' value={`− ${formatInr(row.fineDeductionPaise)}`} />
            {row.fines.map((f) => (
              <div key={f.reason} style={{ fontSize: 11.5, color: 'var(--mfg)', paddingLeft: 12 }}>
                {f.reason} — {formatInr(f.amountPaise)}
              </div>
            ))}
            {row.stallShortfallPaise > 0 && (
              <Line
                label='Beyond that deposit'
                value={`${formatInr(row.stallShortfallPaise)} to recover`}
              />
            )}
            <Line label='Refund due' value={formatInr(row.refundDuePaise)} bold />
            {row.shortfallPaise > 0 && (
              <Line label='Still owed by vendor' value={formatInr(row.shortfallPaise)} />
            )}
          </Card>
          {canWrite && (
            <FormField id='refund-voucher' label='Voucher number'>
              <Input
                id='refund-voucher'
                value={voucher}
                onChange={(e) => setVoucher(e.target.value)}
              />
            </FormField>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <FormField id='refund-deduction' label='Chairs and tables deduction (₹)'>
            <Input
              id='refund-deduction'
              type='number'
              min={0}
              value={deduction}
              onChange={(e) => setDeduction(e.target.value)}
              disabled={!canWrite}
            />
          </FormField>
          {row.suggestedEquipmentDeductionPaise > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
              Chairs &amp; Tables recorded missing or damaged items worth{' '}
              {formatInr(row.suggestedEquipmentDeductionPaise)}.{' '}
              <button
                type='button'
                onClick={() =>
                  setDeduction(String(paiseToRupees(row.suggestedEquipmentDeductionPaise)))
                }
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  color: 'var(--pri)',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                Apply
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Penalties</span>
            {fineTypes.length === 0 ? (
              <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                No fine categories configured. Add them on the Admin screen.
              </span>
            ) : (
              fineTypes.map((f) => (
                <label
                  key={f.id}
                  htmlFor={`fine-${f.id}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}
                >
                  <Checkbox
                    id={`fine-${f.id}`}
                    checked={fines.has(f.id)}
                    disabled={!canWrite}
                    onChange={() =>
                      setFines((prev) => {
                        const next = new Set(prev);
                        if (next.has(f.id)) next.delete(f.id);
                        else next.add(f.id);
                        return next;
                      })
                    }
                  />
                  {f.reason} — {formatInr(f.defaultAmountPaise)}
                </label>
              ))
            )}
          </div>

          <FormField id='refund-extra' label='Other penalty (₹)'>
            <Input
              id='refund-extra'
              type='number'
              min={0}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              disabled={!canWrite}
            />
          </FormField>
          {Number(extra) > 0 && (
            <FormField id='refund-extra-reason' label='Reason for the other penalty'>
              <Input
                id='refund-extra-reason'
                value={extraReason}
                onChange={(e) => setExtraReason(e.target.value)}
                placeholder='e.g. Blocked the fire lane'
              />
            </FormField>
          )}

          <Card pad={14} style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            <Line label='Deposit held' value={formatInr(row.depositHeldPaise)} />
            <Line
              label='Deductions'
              value={`− ${formatInr(rupeesToPaise(Number(deduction) || 0) + finesTotal)}`}
            />
            <Line label='Refund due' value={formatInr(preview)} bold />
          </Card>
        </div>
      )}
    </Dialog>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontWeight: bold ? 700 : 400,
        borderTop: bold ? '1px solid var(--line)' : undefined,
        paddingTop: bold ? 6 : 0,
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
