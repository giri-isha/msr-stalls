import { type FinanceRow, formatInr, paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { useState } from 'react';
import * as api from '../api';
import { Field, Row2, SelectInput, TextArea, TextInput } from '../components/FormControls';
import { Grid, Mono, Sub } from '../components/Grid';
import { formatDate, formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import { Dialog } from '../ui/components/Dialog';
import { StatTiles } from '../ui/components/StatTiles';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, ErrorBox, H1, Loading, Tag, Toolbar, toolBtnStyle } from '../ui/ui';

const MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CASH', 'CHEQUE', 'OTHER'] as const;

/** Requirement 6: finance sees the payable amount per selected vendor and
 *  records what actually arrived — reference, mode, amount, date — for the
 *  payments that did not come through the system. */
export function Finance() {
  const { can } = useMe();
  const toast = useToast();
  const [pending, setPending] = useState(true);
  const rows = useLoad(() => api.financeRows(pending), [pending]);
  const [confirming, setConfirming] = useState<FinanceRow | null>(null);
  const canWrite = can('finance:write');

  if (rows.loading && !rows.data) return <Loading />;
  if (rows.error) return <ErrorBox>{rows.error.message}</ErrorBox>;
  const data = rows.data ?? [];
  const totalDue = data.filter((r) => !r.confirmedAt).reduce((n, r) => n + r.totalPayablePaise, 0);
  const totalIn = data.reduce((n, r) => n + (r.amountReceivedPaise ?? 0), 0);

  return (
    <div>
      <H1 icon={<Icon name='file-text' size={20} />} sub='Payment details sent to vendors, and what arrived. Confirming a payment issues the staff coupon and sends the FSSAI and staff-registration mail.'>
        Finance
      </H1>
      <StatTiles
        noun='payment'
        tiles={[
          { label: 'Pending', count: data.filter((r) => !r.confirmedAt).length },
          { label: 'Confirmed', count: data.filter((r) => r.confirmedAt).length },
        ]}
      />
      <Toolbar>
        <button type='button' onClick={() => setPending(true)} aria-pressed={pending} style={toolBtnStyle(pending)}>
          Pending confirmation
        </button>
        <button type='button' onClick={() => setPending(false)} aria-pressed={!pending} style={toolBtnStyle(!pending)}>
          All quoted
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
          {pending ? `Outstanding ${formatInr(totalDue)}` : `Received ${formatInr(totalIn)}`}
        </span>
      </Toolbar>
      <Grid
        rows={data}
        rowKey={(r) => r.id}
        empty={pending ? 'Nothing awaiting confirmation.' : 'No payments quoted yet.'}
        columns={[
          {
            key: 'stall',
            header: 'Stall',
            width: '1.5fr',
            mobile: 'title',
            render: (r) => (
              <>
                <b>{r.stallName}</b>
                <Sub>
                  <Mono>{r.reference}</Mono> · {r.requesterName}
                </Sub>
              </>
            ),
          },
          {
            key: 'invoice',
            header: 'Invoice name / GST',
            width: '1.2fr',
            render: (r) => (
              <>
                {r.invoiceName ?? <span style={{ color: 'var(--mfg)' }}>bank details awaited</span>}
                {r.gstNumber && <Sub>GST {r.gstNumber}</Sub>}
              </>
            ),
          },
          { key: 'due', header: 'Payable', width: '120px', align: 'right', render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{formatInr(r.totalPayablePaise)}</span> },
          { key: 'sent', header: 'Email sent', width: '120px', render: (r) => (r.emailSentAt ? formatDate(r.emailSentAt) : <Tag size='sm'>Not sent</Tag>) },
          {
            key: 'status',
            header: 'Status',
            width: '170px',
            render: (r) =>
              r.confirmedAt ? (
                <>
                  <Tag tone='ok' size='sm'>Confirmed {formatDate(r.confirmedAt)}</Tag>
                  {r.differencePaise !== null && r.differencePaise !== 0 && (
                    <Sub>
                      <span style={{ color: r.differencePaise < 0 ? 'var(--des-fg)' : 'var(--ok-fg)' }}>
                        {r.differencePaise < 0 ? 'Short' : 'Over'} {formatInr(Math.abs(r.differencePaise))}
                      </span>
                    </Sub>
                  )}
                </>
              ) : (
                <Tag tone='warn' size='sm'>Pending</Tag>
              ),
          },
        ]}
        actions={(r) =>
          !r.confirmedAt && canWrite ? (
            <Btn kind='primary' onClick={() => setConfirming(r)}>
              Confirm…
            </Btn>
          ) : null
        }
      />
      {confirming && (
        <ConfirmDialog
          row={confirming}
          onClose={() => setConfirming(null)}
          onDone={(msg) => {
            setConfirming(null);
            toast.ok(msg);
            rows.reload();
          }}
          onError={toast.fail}
        />
      )}
    </div>
  );
}

function ConfirmDialog({ row, onClose, onDone, onError }: { row: FinanceRow; onClose: () => void; onDone: (m: string) => void; onError: (e: unknown) => void }) {
  const [form, setForm] = useState({
    creditDate: new Date().toISOString().slice(0, 10),
    referenceNo: '',
    ecollectCode: '',
    remitterName: row.invoiceName ?? '',
    mode: 'NEFT' as (typeof MODES)[number],
    amount: String(paiseToRupees(row.totalPayablePaise)),
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm({ ...form, ...p });
  const amountPaise = rupeesToPaise(Number(form.amount) || 0);
  const diff = amountPaise - row.totalPayablePaise;

  const save = async () => {
    if (busy || !form.referenceNo.trim()) return;
    setBusy(true);
    try {
      const res = await api.confirmPayment(row.id, {
        creditDate: form.creditDate,
        referenceNo: form.referenceNo.trim(),
        ecollectCode: form.ecollectCode.trim() || undefined,
        remitterName: form.remitterName.trim() || undefined,
        mode: form.mode,
        amountReceivedPaise: amountPaise,
        notes: form.notes.trim() || undefined,
      });
      const mail = res.postPaymentMail.sent.length ? 'post-payment mail sent' : `mail not sent (${res.postPaymentMail.skipped[0]?.reason ?? res.postPaymentMail.failed[0]?.error ?? 'nothing to send'})`;
      onDone(`Payment confirmed for ${row.stallName} — ${mail}`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      width={560}
      title={`Confirm payment — ${row.stallName}`}
      note={`${row.reference} · payable ${formatInr(row.totalPayablePaise)}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' disabled={busy || !form.referenceNo.trim()} onClick={save}>
            {busy ? 'Saving…' : 'Confirm payment'}
          </Btn>
        </>
      }
    >
      <Row2>
        <Field id='cd' label='Credit date' required>
          <TextInput id='cd' type='date' value={form.creditDate} onChange={(e) => set({ creditDate: e.target.value })} />
        </Field>
        <Field id='mode' label='Mode' required>
          <SelectInput id='mode' value={form.mode} onChange={(e) => set({ mode: e.target.value as (typeof MODES)[number] })}>
            {MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </SelectInput>
        </Field>
        <Field id='ref' label='Reference no' required>
          <TextInput id='ref' value={form.referenceNo} onChange={(e) => set({ referenceNo: e.target.value })} autoFocus />
        </Field>
        <Field id='ecol' label='E-collect code'>
          <TextInput id='ecol' value={form.ecollectCode} onChange={(e) => set({ ecollectCode: e.target.value })} />
        </Field>
        <Field id='rem' label='Remitter name'>
          <TextInput id='rem' value={form.remitterName} onChange={(e) => set({ remitterName: e.target.value })} />
        </Field>
        <Field id='amt' label='Amount received (₹)' required help={diff === 0 ? 'Matches the payable amount' : diff < 0 ? `Short by ${formatInr(-diff)}` : `Over by ${formatInr(diff)}`}>
          <TextInput id='amt' inputMode='decimal' value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
        </Field>
      </Row2>
      <Field id='notes' label='Notes'>
        <TextArea id='notes' rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
      {row.emailSentAt && <div style={{ fontSize: 12, color: 'var(--mfg)' }}>Payment email was sent {formatDateTime(row.emailSentAt)}.</div>}
    </Dialog>
  );
}
