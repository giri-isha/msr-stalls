import type {
  PaymentClaimRow,
  PaymentRecordView,
  PaymentRow,
  RefundRow,
  ReviewPaymentClaimInput,
} from '@stalls/core';
import { formatInr, paiseToRupees, rupeesToPaise } from '@stalls/core';
import { useMemo, useState } from 'react';
import {
  confirmPayment,
  voidPaymentRecord,
  getConfig,
  getPaymentClaims,
  listPayments,
  listRefunds,
  sendEmails,
  setDiscretionaryFee,
  reviewPaymentClaim,
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
  EditBtn,
  Empty,
  ColumnsButton,
  RowActions,
  useColumns,
  type ColumnDef,
  Toolbar,
  ErrorBox,
  FormField,
  H1,
  Icon,
  Input,
  Loading,
  Pager,
  Search,
  Select,
  Tag,
  Textarea,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tabs,
  useIsMobile,
  usePaged,
  useToast,
} from '../ui';

/**
 * Finance — what is owed, what has arrived, and what goes back.
 *
 * ⚠️ **No money is collected on this screen.** The requirement is explicit that
 * payment happens by NEFT to a virtual account; every figure here records what
 * has already happened on a bank statement. The tabs follow the money in
 * order: what each application owes and what has landed against it, what
 * requesters say they transferred, the credits that have been confirmed, and
 * the balance handed back after the event.
 *
 * ⚠️ Recording a credit happens on **Payment applications**, beside the figure
 * being settled — not on Payment confirmation, which is the ledger of what has
 * already landed and answers a different question ("did this transfer arrive?"
 * across everybody, rather than "what does this one stall still owe?").
 */
export function Finance() {
  const [tab, setTab] = useState<'due' | 'claims' | 'confirm' | 'refund'>('due');
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
        sub='What each application owes, what has been reported and confirmed, and refunds after the event.'
      >
        Finance
      </H1>
      <Tabs
        label='Finance Sections'
        tabs={[
          // ⚠️ The keys are the storage names, not the labels. `due` is also
          // the suffix of the saved column choice (`finance-due`), so renaming
          // it would silently un-hide every column somebody had turned off.
          { key: 'due', label: 'Payment applications', glyph: 'rupee' },
          // 🔴 Between "what to pay" and "what landed": what the vendor SAYS
          // they paid. That step used to be a mailbox — the 2025 letter ended
          // "please send transfer details on E-mail IDs finance.support@…".
          { key: 'claims', label: 'Reported payments', glyph: 'arrow-right' },
          { key: 'confirm', label: 'Payment confirmation', glyph: 'circle-check' },
          { key: 'refund', label: 'Refunds & deductions', glyph: 'undo' },
        ]}
        active={tab}
        onPick={(t) => setTab(t as typeof tab)}
      />
      {tab === 'due' && <ApplicationsPanel />}
      {tab === 'claims' && <ClaimsPanel />}
      {tab === 'confirm' && <ConfirmedPanel />}
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

// ── Tab 1: every application, what it owes and what has landed ──────────────

/** ⚠️ The five money columns are ONE group as far as the unpriced row is
 *  concerned — it draws a single cell spanning all of them — so hiding any of
 *  them has to narrow that span too. `PRICED` names them once; `DuePanel`
 *  counts how many are showing rather than writing `colSpan={5}`, which was
 *  what the row said before any of this was hideable and would now leave a
 *  cell hanging off the end of its own table. */
const PRICED = ['stallFee', 'plugs', 'equipment', 'gst', 'total'] as const;

const DUE_COLUMNS: ColumnDef[] = [
  { key: 'vendor', label: 'Vendor', locked: true },
  { key: 'stallFee', label: 'Stall Fee' },
  { key: 'plugs', label: 'Plugs' },
  { key: 'equipment', label: 'Chairs/tables' },
  { key: 'gst', label: 'GST' },
  { key: 'total', label: 'Total Due' },
  // ⚠️ Outside `PRICED`. A zone with no rate still receives money, so these two
  // are drawn for an unpriced row as well and must not sit under the cell that
  // spans the quote columns.
  { key: 'paid', label: 'Paid' },
  { key: 'remaining', label: 'Remaining' },
  { key: 'bank', label: 'Bank Details' },
  { key: 'email', label: 'Payment Email' },
];

/**
 * What has landed against one application, and what is still short.
 *
 * ⚠️ Against `grandTotalPaise`, which already follows a concession — a local
 * welfare trader who paid exactly the figure the team agreed reads as nothing
 * remaining, not as short by the discount.
 *
 * 🔴 An unpriced zone gets `null`, not zero. Nothing is known about what is
 * owed there, and a zero remainder would read as paid in full.
 */
function settlement(row: PaymentRow) {
  const paidPaise = row.receivedRentPaise + row.receivedDepositPaise;
  return {
    paidPaise,
    remainingPaise: row.quote.unpriced ? null : Math.max(0, row.quote.grandTotalPaise - paidPaise),
  };
}

function ApplicationsPanel() {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload } = useLoad(listPayments);
  const { q, setQ, filtered } = useSearch(data, matchPayment);
  const mobile = useIsMobile();
  const [busy, setBusy] = useState<string | null>(null);
  const [outstanding, setOutstanding] = useState('');
  const columns = useColumns('finance-due', DUE_COLUMNS);
  const pricedSpan = PRICED.filter((k) => columns.shown(k)).length;
  const [open, setOpen] = useState<PaymentRow | null>(null);
  const canWrite = can('finance.write');
  // ⚠️ Separate from `canWrite`. Agreeing a fee and confirming a credit are two
  // acts held by two different sets of people — see `concession.write`.
  const canConcede = can('concession.write');

  const rows = filtered.filter((r) => {
    if (outstanding === 'bank') return r.bankDetailsReceivedAt === null;
    if (outstanding === 'email') return r.paymentEmailSentAt === null;
    // Both in, so the only thing left to wait for is the money itself.
    if (outstanding === 'ready') return r.bankDetailsReceivedAt !== null && !r.paymentEmailSentAt;
    if (outstanding === 'short') return !r.fullySettled;
    return true;
  });
  const { slice, pager } = usePaged('finance-due', rows, `${q}|${outstanding}`);

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
        Every selected application, what it owes, and what has landed against it. Once a vendor's
        bank details are in, send them the payment details with the calculation below; when a credit
        appears on the statement, record it against the row. Payment is made by NEFT to the Isha
        Foundation account sent separately — nothing is collected here.
      </div>
      <Toolbar>
        <Search value={q} onChange={setQ} placeholder='Search vendor…' />
        <Select
          aria-label='Outstanding'
          value={outstanding}
          onChange={(v) => setOutstanding(v)}
          style={{ width: 'auto', minWidth: 200 }}
        >
          <option value=''>Everyone Who Owes</option>
          <option value='bank'>Waiting on Bank Details</option>
          <option value='ready'>Ready to Be Told What to Pay</option>
          <option value='email'>Not Yet Told What to Pay</option>
          <option value='short'>Not Yet Paid in Full</option>
        </Select>
        <div style={{ flex: 1 }} />
        {!mobile && <ColumnsButton state={columns} />}
      </Toolbar>

      {rows.length === 0 ? (
        <Empty>No selected vendors owe anything yet.</Empty>
      ) : mobile ? (
        <>
          <div style={{ display: 'grid', gap: 10 }}>
            {slice.map((r) => (
              <Card key={r.requestId} pad={14} style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontWeight: 600 }}>{r.stallName}</div>
                <Money row={r} />
                {can('comms.write') && !r.paymentEmailSentAt && (
                  <Btn
                    kind='primary'
                    onClick={() => sendPayment(r)}
                    disabled={busy === r.requestId}
                  >
                    <Icon name='send' size={14} />
                    Send Payment Email
                  </Btn>
                )}
                <Btn onClick={() => setOpen(r)}>
                  <Icon name='rupee' size={14} />
                  {canWrite ? 'Record Credit' : 'View Credits'}
                </Btn>
              </Card>
            ))}
          </div>
          <Card pad={0} style={{ marginTop: 12, overflow: 'hidden' }}>
            <Pager {...pager} noun='vendor' />
          </Card>
        </>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                {columns.shown('stallFee') && <TH align='right'>Stall Fee</TH>}
                {columns.shown('plugs') && <TH align='right'>Plugs</TH>}
                {columns.shown('equipment') && <TH align='right'>Chairs/tables</TH>}
                {columns.shown('gst') && <TH align='right'>GST</TH>}
                {columns.shown('total') && <TH align='right'>Total Due</TH>}
                {columns.shown('paid') && <TH align='right'>Paid</TH>}
                {columns.shown('remaining') && <TH align='right'>Remaining</TH>}
                {columns.shown('bank') && <TH>Bank Details</TH>}
                {columns.shown('email') && <TH>Payment Email</TH>}
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {slice.map((r) => {
                const { paidPaise, remainingPaise } = settlement(r);
                return (
                  <TR key={r.requestId}>
                    <TD>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.stallName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                        {r.stallNumbers.join(', ') || '—'}
                      </div>
                    </TD>
                    {r.quote.unpriced ? (
                      // Nothing at all when every priced column is hidden — a
                      // `colSpan={0}` is not a narrower cell, it is a cell that
                      // spans to the end of the row.
                      pricedSpan > 0 && (
                        <TD colSpan={pricedSpan} muted>
                          No rent is quoted for this zone — priced by the team.
                        </TD>
                      )
                    ) : (
                      <>
                        {columns.shown('stallFee') && (
                          <TD align='right'>{formatInr(r.quote.stallFeePaise)}</TD>
                        )}
                        {columns.shown('plugs') && (
                          <TD align='right'>{formatInr(r.quote.plugFeePaise)}</TD>
                        )}
                        {columns.shown('equipment') && (
                          <TD align='right'>{formatInr(r.quote.equipmentFeePaise)}</TD>
                        )}
                        {columns.shown('gst') && (
                          <TD align='right' muted>
                            {formatInr(r.quote.gstPaise)}
                          </TD>
                        )}
                        {columns.shown('total') && (
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
                        )}
                      </>
                    )}
                    {columns.shown('paid') && (
                      <TD align='right'>
                        {paidPaise === 0 ? (
                          <span style={{ color: 'var(--mfg)' }}>—</span>
                        ) : (
                          formatInr(paidPaise)
                        )}
                        {r.records.length > 0 && (
                          <div style={{ fontSize: 10.5, color: 'var(--mfg)' }}>
                            {r.records.length} credit{r.records.length === 1 ? '' : 's'}
                          </div>
                        )}
                      </TD>
                    )}
                    {columns.shown('remaining') && (
                      <TD align='right'>
                        {remainingPaise === null ? (
                          <span style={{ color: 'var(--mfg)' }}>—</span>
                        ) : r.fullySettled ? (
                          <Tag tone='ok' size='sm'>
                            Settled
                          </Tag>
                        ) : (
                          <>
                            <div style={{ fontWeight: 600 }}>{formatInr(remainingPaise)}</div>
                            {/* ⚠️ Rent and deposit settle against their own totals,
                              so the sum can reach zero while one is over and the
                              other is still short. Saying nothing here would make
                              a ₹0 row that is not settled look like a bug. */}
                            {remainingPaise === 0 && (
                              <div style={{ fontSize: 10.5, color: 'var(--mfg)', fontWeight: 400 }}>
                                split across rent and deposit
                              </div>
                            )}
                          </>
                        )}
                      </TD>
                    )}
                    {columns.shown('bank') && (
                      <TD>
                        <Tag tone={r.bankDetailsReceivedAt ? 'ok' : 'warn'} size='sm'>
                          {r.bankDetailsReceivedAt ? 'Received' : 'Pending'}
                        </Tag>
                      </TD>
                    )}
                    {columns.shown('email') && (
                      <TD>
                        {r.paymentEmailSentAt ? (
                          <Tag tone='ok' size='sm'>
                            Sent {formatDate(r.paymentEmailSentAt)}
                          </Tag>
                        ) : (
                          <Tag tone='neutral' size='sm'>
                            Not Sent
                          </Tag>
                        )}
                      </TD>
                    )}
                    <TD align='right'>
                      <RowActions>
                        {can('comms.write') && !r.paymentEmailSentAt && (
                          <Btn onClick={() => sendPayment(r)} disabled={busy === r.requestId}>
                            <Icon name='send' size={14} />
                            Send
                          </Btn>
                        )}
                        <Btn onClick={() => setOpen(r)}>
                          <Icon name='rupee' size={14} />
                          {canWrite ? 'Record Credit' : 'View'}
                        </Btn>
                      </RowActions>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pager {...pager} noun='vendor' />
        </Card>
      )}

      {open && (
        <ConfirmDialog
          row={open}
          canWrite={canWrite}
          canConcede={canConcede}
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

function Money({ row }: { row: PaymentRow }) {
  if (row.quote.unpriced) {
    return <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>No rent quoted for this zone.</div>;
  }
  const conceded = row.quote.discretionaryFeePaise !== null;
  const { paidPaise, remainingPaise } = settlement(row);
  return (
    <div style={{ fontSize: 12.5, display: 'grid', gap: 2 }}>
      {/* Both figures, always, where a concession stands: what the requester was
          TOLD and what they OWE are different facts, and Finance reconciling a
          edition six months later needs to see the gap rather than infer it. */}
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
      <div style={{ color: 'var(--mfg)' }}>Paid: {formatInr(paidPaise)}</div>
      {remainingPaise !== null &&
        (row.fullySettled ? (
          <Tag tone='ok' size='sm'>
            Settled
          </Tag>
        ) : (
          <div style={{ fontWeight: 700 }}>Remaining: {formatInr(remainingPaise)}</div>
        ))}
    </div>
  );
}

// ── Tab 2: what the vendor says they paid ───────────────────────────────────

/**
 * The claims queue.
 *
 * 🔴 A claim is what somebody SAYS they transferred, not money the Foundation
 * has seen. Verifying one writes the `StallPaymentRecord` — that write is what
 * makes it real and what advances the stall's stage — so this screen is the
 * gate, not a notification.
 *
 * ⚠️ `expected` sits beside `claimed` so a mismatch is visible without opening
 * the request. That comparison is the whole job: the common failure is a vendor
 * transferring the rent and the deposit as one amount into one account.
 */
function ClaimsPanel() {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload } = useLoad(getPaymentClaims);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PaymentClaimRow | null>(null);
  const canWrite = can('finance.write');

  // ⚠️ Above the early returns. `usePaged` is a hook, and a hook that only
  // runs once the data has landed is a hook that changes order between
  // renders — React counts them, it does not name them.
  const rows = data?.claims ?? [];
  const { slice, pager } = usePaged('finance-claims', rows);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;

  const settle = async (row: PaymentClaimRow, input: ReviewPaymentClaimInput) => {
    setBusy(row.id);
    try {
      await reviewPaymentClaim(row.id, input);
      toast.ok(input.verdict === 'VERIFY' ? 'Payment confirmed.' : 'Marked as not found.');
      setRejecting(null);
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', maxWidth: 680 }}>
        What requesters have told us they transferred. Check each reference against the bank
        statement. Confirming one records the credit and moves the stall on; if you cannot find it,
        say why — the requester is shown that and can report it again.
      </div>

      {rows.length === 0 ? (
        <Empty>No reported transfers waiting.</Empty>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH>For</TH>
                <TH>Reference</TH>
                <TH align='right'>Claimed</TH>
                <TH align='right'>Expected</TH>
                <TH>Paid on</TH>
                <TH align='right'>{canWrite ? 'Settle' : ''}</TH>
              </TR>
            </THead>
            <TBody>
              {slice.map((c) => {
                // ⚠️ A mismatch is flagged, not refused. A vendor who paid a
                // little over, or whose bank deducted a charge, is a normal
                // case that finance settles by eye.
                const mismatched = c.expectedPaise !== null && c.expectedPaise !== c.amountPaise;
                return (
                  <TR key={c.id}>
                    <TD>
                      <div style={{ fontWeight: 600 }}>{c.stallName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                        {c.reference} · {c.requesterName}
                      </div>
                    </TD>
                    <TD>
                      <Tag tone='neutral' size='sm'>
                        {c.purpose === 'RENT' ? 'Rent' : 'Deposit'}
                      </Tag>
                    </TD>
                    <TD mono style={{ fontSize: 12 }}>
                      {c.referenceNo}
                      {c.remitterName && (
                        <div style={{ fontSize: 11, color: 'var(--mfg)' }}>{c.remitterName}</div>
                      )}
                    </TD>
                    <TD align='right' style={{ color: mismatched ? 'var(--des-fg)' : undefined }}>
                      {formatInr(c.amountPaise)}
                    </TD>
                    <TD align='right' muted>
                      {c.expectedPaise === null ? '—' : formatInr(c.expectedPaise)}
                    </TD>
                    <TD muted style={{ fontSize: 11.5 }}>
                      {formatDate(c.paidOn)}
                    </TD>
                    <TD align='right'>
                      {canWrite && (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <Btn
                            kind='primary'
                            onClick={() => void settle(c, { verdict: 'VERIFY' })}
                            disabled={busy !== null}
                          >
                            {busy === c.id ? 'Saving…' : 'Confirm'}
                          </Btn>
                          <Btn onClick={() => setRejecting(c)} disabled={busy !== null}>
                            Not found
                          </Btn>
                        </div>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pager {...pager} noun='claim' />
        </Card>
      )}

      {rejecting && (
        <RejectDialog
          claim={rejecting}
          busy={busy !== null}
          onClose={() => setRejecting(null)}
          onReject={(reason) => void settle(rejecting, { verdict: 'REJECT', rejectReason: reason })}
        />
      )}
    </div>
  );
}

/** ⚠️ The reason is REQUIRED, and it is shown to the requester. A rejection
 *  they cannot act on sends them back to the mailbox this step replaced. */
function RejectDialog({
  claim,
  busy,
  onClose,
  onReject,
}: {
  claim: PaymentClaimRow;
  busy: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      title='Payment not found'
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            kind='danger'
            onClick={() => onReject(reason.trim())}
            disabled={busy || reason.trim() === ''}
          >
            Mark as not found
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
          {claim.stallName} · {claim.referenceNo} · {formatInr(claim.amountPaise)}
        </div>
        <FormField
          id='reject-reason'
          label='What should they correct?'
          help='The requester is shown this, so write it for them rather than for the file.'
          required
        >
          <Textarea
            id='reject-reason'
            rows={3}
            value={reason}
            placeholder='e.g. No credit against this reference on the statement.'
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

// ── Tab 3: the credits that have landed ─────────────────────────────────────

/**
 * The credits that have actually landed, one row per record.
 *
 * 🔴 A ledger, not a worklist. Recording a credit belongs on Payment
 * applications, beside the figure being settled and the request it settles;
 * this tab answers the other question — "has this transfer arrived?" — across
 * every application at once, which is the question that comes down the phone.
 *
 * ⚠️ Flattened from the same `listPayments` payload the applications tab reads,
 * so the two can never disagree about what has been confirmed.
 */
type ConfirmedCredit = PaymentRecordView & {
  requestId: string;
  reference: string;
  stallName: string;
  requesterName: string;
};

const matchCredit = (c: ConfirmedCredit, t: string) =>
  c.stallName.toLowerCase().includes(t) ||
  c.requesterName.toLowerCase().includes(t) ||
  c.reference.toLowerCase().includes(t) ||
  c.referenceNo.toLowerCase().includes(t);

function ConfirmedPanel() {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload } = useLoad(listPayments);
  const [withdrawing, setWithdrawing] = useState<ConfirmedCredit | null>(null);
  const canWrite = can('finance.write');

  const credits = useMemo(
    () =>
      (data ?? [])
        .flatMap((r) =>
          r.records.map((rec) => ({
            ...rec,
            requestId: r.requestId,
            reference: r.reference,
            stallName: r.stallName,
            requesterName: r.requesterName,
          })),
        )
        // Newest first. The question asked of this screen is almost always
        // about a transfer made this week, not about what February looked like.
        .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn)),
    [data],
  );
  const { q, setQ, filtered } = useSearch(credits, matchCredit);
  // ⚠️ The LIVE ones only. A withdrawn entry is shown so the trail reads, but a
  // total that counted it would be money the Foundation never had.
  const live = filtered.filter((c) => c.voidedAt === null);
  const totalPaise = live.reduce((t, c) => t + c.amountPaise, 0);
  const withdrawnCount = filtered.length - live.length;
  // ⚠️ The total under the table stays the total of everything the search
  // matched, not of the page. A figure that changed as you turned pages would
  // be read as the edition's takings and be wrong on every page but one.
  const { slice, pager } = usePaged('finance-credits', filtered, q);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', maxWidth: 680 }}>
        Every credit confirmed against an application, newest first. Rent and deposit are recorded
        separately because they usually arrive as separate transfers. To record a new one, go to
        Payment applications and open the row it settles. An entry made in error is marked as a
        wrong entry rather than deleted — it stops counting, and it stays on the list so the trail
        can still be read.
      </div>
      <Search value={q} onChange={setQ} placeholder='Search vendor or reference…' />

      {filtered.length === 0 ? (
        <Empty>
          {credits.length === 0 ? 'No credits confirmed yet.' : 'No credits match that search.'}
        </Empty>
      ) : (
        <>
          <Card pad={0} style={{ overflow: 'hidden' }}>
            <Table>
              <THead>
                <TR>
                  <TH>Vendor</TH>
                  <TH>For</TH>
                  <TH>Reference</TH>
                  <TH align='right'>Amount</TH>
                  <TH>Credit Date</TH>
                  <TH>Mode</TH>
                  <TH> </TH>
                </TR>
              </THead>
              <TBody>
                {slice.map((c) => {
                  const withdrawn = c.voidedAt !== null;
                  return (
                    <TR key={c.id}>
                      <TD>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.stallName}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                          {c.reference} · {c.requesterName}
                        </div>
                      </TD>
                      <TD>
                        {withdrawn ? (
                          <Tag tone='warn' size='sm'>
                            Wrong entry
                          </Tag>
                        ) : (
                          <Tag tone='neutral' size='sm'>
                            {c.purpose === 'RENT' ? 'Rent' : 'Deposit'}
                          </Tag>
                        )}
                      </TD>
                      <TD mono style={{ fontSize: 11.5 }}>
                        {c.referenceNo}
                        {c.remitterName && (
                          <div style={{ fontSize: 11, color: 'var(--mfg)' }}>{c.remitterName}</div>
                        )}
                      </TD>
                      {/* 🔴 Struck through, not hidden and not blank. The figure
                          is what somebody entered; the line through it is the
                          fact that it was taken back, and the reason underneath
                          is what a person reconciling this six months on needs. */}
                      <TD
                        align='right'
                        style={
                          withdrawn
                            ? { color: 'var(--mfg)', textDecoration: 'line-through' }
                            : { fontWeight: 700 }
                        }
                      >
                        {formatInr(c.amountPaise)}
                      </TD>
                      <TD muted style={{ fontSize: 11.5 }}>
                        {formatDate(c.receivedOn)}
                        {withdrawn && c.voidReason && (
                          <div style={{ fontSize: 11 }}>Withdrawn — {c.voidReason}</div>
                        )}
                      </TD>
                      <TD muted style={{ fontSize: 11.5 }}>
                        {c.mode}
                      </TD>
                      <TD align='right'>
                        {canWrite && !withdrawn && (
                          <Btn onClick={() => setWithdrawing(c)}>
                            <Icon name='undo' size={14} />
                            Wrong Entry
                          </Btn>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pager {...pager} noun='credit' />
          </Card>
          {/* The sum of what is LISTED, so it follows the search rather than
              claiming to be the edition's total when a filter is on. */}
          <div style={{ fontSize: 12.5, color: 'var(--mfg)', textAlign: 'right' }}>
            {live.length} credit{live.length === 1 ? '' : 's'} ·{' '}
            <strong>{formatInr(totalPaise)}</strong>
            {withdrawnCount > 0 && <> · {withdrawnCount} withdrawn, not counted</>}
          </div>
        </>
      )}

      {withdrawing && (
        <WrongEntryDialog
          record={withdrawing}
          stallName={withdrawing.stallName}
          onClose={() => setWithdrawing(null)}
          onDone={() => {
            setWithdrawing(null);
            reload();
          }}
          onToast={toast}
        />
      )}
    </div>
  );
}

/** ⚠️ The reason is REQUIRED, and it is the point of the whole step. An entry
 *  withdrawn with nothing beside it is indistinguishable from one deleted by
 *  accident, which is the state this replaced. */
function WrongEntryDialog({
  record,
  stallName,
  onClose,
  onDone,
  onToast,
}: {
  record: PaymentRecordView;
  stallName: string;
  onClose: () => void;
  onDone: () => void;
  onToast: ReturnType<typeof useToast>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await voidPaymentRecord(record.id, { reason: reason.trim() });
      onToast.ok('Marked as a wrong entry.');
      onDone();
    } catch (e) {
      onToast.fail(e);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title='Mark as a wrong entry'
      note={`${stallName} · ${record.referenceNo} · ${formatInr(record.amountPaise)}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='danger' disabled={busy || reason.trim() === ''} onClick={save}>
            <Icon name='undo' size={14} />
            Mark as Wrong Entry
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
          The credit stops counting straight away — towards what this stall has paid, whether it is
          settled, and the deposit its refund is measured against. The entry itself stays on the
          list, struck through, with what you write here beside it. The reference number is freed,
          so the corrected entry can carry the same one.
        </div>
        <FormField
          id='void-reason'
          label='What was wrong with it?'
          help='Write it for whoever reconciles this edition months from now.'
          required
        >
          <Textarea
            id='void-reason'
            rows={3}
            value={reason}
            placeholder='e.g. Credited against the wrong stall — belongs to VEN-2026-0042.'
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  );
}

// ── The box both of those tabs hang off: one application's credits ──────────

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
 *  when whoever agreed it has moved on and Finance is closing the edition.
 */
/**
 * The fee actually agreed for one stall, where it differs from the quote.
 *
 * 🔴 Was a form that unfolded INSIDE the row — open by default whenever a
 * concession existed, so a screen of local-welfare stalls was a column of
 * expanded forms and the figures they were supposed to make readable were the
 * hardest thing on the page to find. The agreed fee is a fact the row states;
 * changing it is a dialog, like every other record in the module.
 *
 * ⚠️ Both figures are kept. The quote is what the rates say; this is what was
 * agreed. Neither replaces the other, which is why clearing a concession is
 * "back to the quoted fee" and not a delete.
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
  const [editing, setEditing] = useState(false);

  if (row.quote.unpriced) return null;

  return (
    <>
      {set ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5 }}>
            Agreed{' '}
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatInr(row.quote.discretionaryFeePaise ?? 0)}
            </strong>
            <span style={{ color: 'var(--mfg)' }}>
              {' '}
              — quoted {formatInr(row.quote.feeTotalPaise)}
            </span>
          </span>
          {row.quote.discretionaryReason && (
            <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
              {row.quote.discretionaryReason}
            </span>
          )}
          <EditBtn what='agreed fee' onClick={() => setEditing(true)} />
        </span>
      ) : (
        <Btn onClick={() => setEditing(true)}>
          <Icon name='pencil' size={14} />
          Agree a Different Fee for This Stall
        </Btn>
      )}
      {editing && (
        <ConcessionDialog
          row={row}
          onToast={onToast}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onDone();
          }}
        />
      )}
    </>
  );
}

function ConcessionDialog({
  row,
  onToast,
  onClose,
  onDone,
}: {
  row: PaymentRow;
  onToast: ReturnType<typeof useToast>;
  onClose: () => void;
  onDone: () => void;
}) {
  const set = row.quote.discretionaryFeePaise !== null;
  const [fee, setFee] = useState(
    set ? String(paiseToRupees(row.quote.discretionaryFeePaise ?? 0)) : '',
  );
  const [reason, setReason] = useState(row.quote.discretionaryReason ?? '');
  const [busy, setBusy] = useState(false);

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
      setBusy(false);
    }
  };

  return (
    <Dialog
      title='Fee Agreed for This Stall'
      note={`Quoted ${formatInr(row.quote.feeTotalPaise)} incl. GST. Recording a different figure leaves the quote untouched — both are kept.`}
      onClose={onClose}
      width={460}
      footer={
        <>
          {/* ⚠️ Clearing sits in the footer beside Cancel rather than among the
              fields: it is the other WAY OUT of this box, not another thing to
              fill in, and it is only offered when there is something to clear. */}
          {set && (
            <Btn disabled={busy} onClick={() => save(true)}>
              <Icon name='undo' size={14} />
              Back to the Quoted Fee
            </Btn>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' disabled={busy} onClick={() => save(false)}>
            <Icon name='check' size={14} />
            Save Agreed Fee
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='concession-fee' label='Fee Agreed (₹)'>
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
      </div>
    </Dialog>
  );
}

function ConfirmDialog({
  row,
  canWrite,
  canConcede,
  onClose,
  onDone,
  onToast,
}: {
  row: PaymentRow;
  canWrite: boolean;
  canConcede: boolean;
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
  const [withdrawing, setWithdrawing] = useState<PaymentRecordView | null>(null);

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
            <Icon name='rupee' size={14} />
            Record Credit
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
                {row.records.map((rec) => {
                  const withdrawn = rec.voidedAt !== null;
                  return (
                    <TR key={rec.id}>
                      <TD>
                        {withdrawn ? (
                          <Tag tone='warn' size='sm'>
                            Wrong entry
                          </Tag>
                        ) : rec.purpose === 'RENT' ? (
                          'Rent'
                        ) : (
                          'Deposit'
                        )}
                      </TD>
                      <TD mono style={{ fontSize: 11.5 }}>
                        {rec.referenceNo}
                      </TD>
                      <TD
                        align='right'
                        style={
                          withdrawn
                            ? { color: 'var(--mfg)', textDecoration: 'line-through' }
                            : undefined
                        }
                      >
                        {formatInr(rec.amountPaise)}
                      </TD>
                      <TD muted style={{ fontSize: 11.5 }}>
                        {rec.receivedOn}
                        {withdrawn && rec.voidReason && <div>Withdrawn — {rec.voidReason}</div>}
                      </TD>
                      <TD align='right'>
                        {canWrite && !withdrawn && (
                          <Btn onClick={() => setWithdrawing(rec)}>
                            <Icon name='undo' size={14} />
                            Wrong Entry
                          </Btn>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        )}

        {/* ⚠️ Its own privilege, not `canWrite`. The fee agreed with a trader and
            the credit matched against a statement are two different acts, and
            a lead or the local welfare team holds the first without the
            second — see `concession.write`. */}
        {canConcede && <Concession row={row} onToast={onToast} onDone={onDone} />}

        {canWrite && (
          <>
            <FormField id='credit-purpose' label='What This Credit Is For'>
              <Select
                id='credit-purpose'
                value={purpose}
                onChange={(v) => setPurpose(v as 'RENT' | 'DEPOSIT')}
              >
                <option value='RENT'>Rent (Fee Incl. GST)</option>
                <option value='DEPOSIT'>Refundable Deposit</option>
              </Select>
            </FormField>
            <FormField id='credit-reference' label='Reference Number'>
              <Input
                id='credit-reference'
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder='e.g. YESBN12025022406216143'
              />
            </FormField>
            <FormField id='credit-ecollect' label='E-Collect Code (Optional)'>
              <Input
                id='credit-ecollect'
                value={eCollectCode}
                onChange={(e) => setECollect(e.target.value)}
              />
            </FormField>
            <FormField id='credit-amount' label='Amount Received (₹)'>
              <Input
                id='credit-amount'
                type='number'
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </FormField>
            <FormField id='credit-date' label='Credit Date'>
              <Input
                id='credit-date'
                type='date'
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
              />
            </FormField>
            <FormField id='credit-remitter' label='Remitter Name (Optional)'>
              <Input
                id='credit-remitter'
                value={remitterName}
                onChange={(e) => setRemitter(e.target.value)}
              />
            </FormField>
            <FormField id='credit-mode' label='Mode'>
              <Select id='credit-mode' value={mode} onChange={(v) => setMode(v as typeof mode)}>
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
      {/* ⚠️ A dialog opened FROM a dialog. `Dialog` is built for it — only the
          topmost answers Escape and holds the focus trap — and the alternative,
          sending Finance to another tab to undo an entry they are looking at,
          is the hop this screen was rearranged to remove. */}
      {withdrawing && (
        <WrongEntryDialog
          record={withdrawing}
          stallName={row.stallName}
          onClose={() => setWithdrawing(null)}
          onDone={() => {
            setWithdrawing(null);
            onDone();
          }}
          onToast={onToast}
        />
      )}
    </Dialog>
  );
}

// ── Tab 4: refunds ──────────────────────────────────────────────────────────

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
  const { slice, pager } = usePaged('finance-refunds', filtered, q);

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
                <TH align='right'>Deposit Held</TH>
                <TH align='right'>Chairs/tables</TH>
                <TH align='right'>Penalties</TH>
                <TH align='right'>Refund Due</TH>
                <TH>Voucher</TH>
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {slice.map((r) => (
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
                        Not Sent
                      </Tag>
                    )}
                  </TD>
                  <TD align='right'>
                    <RowActions>
                      <Btn onClick={() => setOpen(r)}>
                        <Icon name='scroll' size={14} />
                        {r.submittedAt ? 'Voucher' : 'Prepare'}
                      </Btn>
                    </RowActions>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pager {...pager} noun='deposit' />
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
              <Icon name='check' size={14} />
              Save Voucher Number
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
              <Icon name='send' size={14} />
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
            <Line label='Chairs and Tables Deposit' value={formatInr(row.equipmentDepositPaise)} />
            <Line label='Chairs and Tables' value={`− ${formatInr(row.equipmentDeductionPaise)}`} />
            {row.equipmentShortfallPaise > 0 && (
              <Line
                label='Beyond That Deposit'
                value={`${formatInr(row.equipmentShortfallPaise)} to recover`}
              />
            )}
            <Line label='Stall Deposit' value={formatInr(row.stallDepositPaise)} />
            <Line label='Penalties' value={`− ${formatInr(row.fineDeductionPaise)}`} />
            {row.fines.map((f) => (
              <div key={f.reason} style={{ fontSize: 11.5, color: 'var(--mfg)', paddingLeft: 12 }}>
                {f.reason} — {formatInr(f.amountPaise)}
              </div>
            ))}
            {row.stallShortfallPaise > 0 && (
              <Line
                label='Beyond That Deposit'
                value={`${formatInr(row.stallShortfallPaise)} to recover`}
              />
            )}
            <Line label='Refund Due' value={formatInr(row.refundDuePaise)} bold />
            {row.shortfallPaise > 0 && (
              <Line label='Still Owed by Vendor' value={formatInr(row.shortfallPaise)} />
            )}
          </Card>
          {canWrite && (
            <FormField id='refund-voucher' label='Voucher Number'>
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
          <FormField id='refund-deduction' label='Chairs and Tables Deduction (₹)'>
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
              {/* 🔴 Itemised, not just totalled. A vendor disputing a deduction
                  argues with one line of it — the extra day, or the fan — and
                  the person settling it has to see which. A single figure can
                  only be accepted or refused whole. */}
              <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
                {row.suggestedEquipmentLines.map((l) => (
                  <li key={l.label}>
                    {l.label} — {formatInr(l.amountPaise)}
                  </li>
                ))}
              </ul>
              Chairs &amp; Tables recorded {formatInr(row.suggestedEquipmentDeductionPaise)} in all.{' '}
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

          <FormField id='refund-extra' label='Other Penalty (₹)'>
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
            <FormField id='refund-extra-reason' label='Reason for the Other Penalty'>
              <Input
                id='refund-extra-reason'
                value={extraReason}
                onChange={(e) => setExtraReason(e.target.value)}
                placeholder='e.g. Blocked the fire lane'
              />
            </FormField>
          )}

          <Card pad={14} style={{ display: 'grid', gap: 6, fontSize: 13 }}>
            <Line label='Deposit Held' value={formatInr(row.depositHeldPaise)} />
            <Line
              label='Deductions'
              value={`− ${formatInr(rupeesToPaise(Number(deduction) || 0) + finesTotal)}`}
            />
            <Line label='Refund Due' value={formatInr(preview)} bold />
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
