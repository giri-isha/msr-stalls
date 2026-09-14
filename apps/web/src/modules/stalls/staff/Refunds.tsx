import { type RefundRow, formatInr, rupeesToPaise } from '@msr/stalls';
import { useState } from 'react';
import * as api from '../api';
import { Field, Row2, SelectInput, TextInput } from '../components/FormControls';
import { Grid, Mono, Sub } from '../components/Grid';
import { TypeTag } from '../components/StatusPill';
import { formatDate, useLoad } from '../hooks';
import { useMe } from '../me';
import { Dialog } from '../ui/components/Dialog';
import { StatTiles } from '../ui/components/StatTiles';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, ErrorBox, H1, KV, Loading, Tag, Toolbar, toolBtnStyle } from '../ui/ui';

type View = 'all' | 'toPrepare' | 'toSend' | 'withFinance' | 'paid';

/** Requirement 12: what goes back to each vendor. Missing and damaged
 *  furniture and any fines come off the deposit; the team prepares the
 *  voucher, sends the batch to finance, and finance marks each one paid. */
export function Refunds() {
  const { can } = useMe();
  const toast = useToast();
  const rows = useLoad(api.refundRows);
  const cfg = useLoad(api.getConfig);
  const [view, setView] = useState<View>('all');
  const [open, setOpen] = useState<RefundRow | null>(null);
  const [fineFor, setFineFor] = useState<RefundRow | null>(null);
  const [paying, setPaying] = useState<RefundRow | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const canPrepare = can('refunds:write');
  const canPay = can('finance:write');

  if (rows.loading && !rows.data) return <Loading />;
  if (rows.error) return <ErrorBox>{rows.error.message}</ErrorBox>;
  const all = rows.data ?? [];
  const bucket = (r: RefundRow): Exclude<View, 'all'> => (r.paidAt ? 'paid' : r.sentToFinanceAt ? 'withFinance' : r.preparedAt ? 'toSend' : 'toPrepare');
  const data = view === 'all' ? all : all.filter((r) => bucket(r) === view);
  const count = (v: Exclude<View, 'all'>) => all.filter((r) => bucket(r) === v).length;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.ok(label);
      rows.reload();
    } catch (e) {
      toast.fail(e);
    }
  };

  const sendBatch = async () => {
    const ids = [...picked].filter((id) => bucket(all.find((r) => r.id === id)!) === 'toSend');
    if (!ids.length) return toast.info('Pick prepared vouchers that have not gone to finance yet.');
    await run(`${ids.length} voucher${ids.length > 1 ? 's' : ''} sent to finance`, () => api.sendRefunds(ids));
    setPicked(new Set());
  };

  return (
    <div>
      <H1 icon={<Icon name='arrow-left-right' size={20} />} sub='Deposit minus missing or damaged furniture minus fines. Prepare the voucher, send the batch to finance, and finance marks it paid.'>
        Refunds
      </H1>
      <StatTiles
        noun='refund'
        tiles={[
          { label: 'All', count: all.length },
          { label: 'To prepare', count: count('toPrepare') },
          { label: 'Ready to send', count: count('toSend') },
          { label: 'With finance', count: count('withFinance') },
          { label: 'Paid', count: count('paid') },
        ]}
      />
      <Toolbar>
        {(
          [
            ['all', 'All'],
            ['toPrepare', 'To prepare'],
            ['toSend', 'Ready to send'],
            ['withFinance', 'With finance'],
            ['paid', 'Paid'],
          ] as const
        ).map(([v, label]) => (
          <button type='button' key={v} onClick={() => setView(v)} aria-pressed={view === v} style={toolBtnStyle(view === v)}>
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {canPrepare && (
          <Btn kind='primary' disabled={picked.size === 0} onClick={sendBatch}>
            Send {picked.size || ''} to finance
          </Btn>
        )}
      </Toolbar>
      <Grid
        rows={data}
        rowKey={(r) => r.id}
        onRow={setOpen}
        selectedKey={open?.id ?? null}
        empty='No vendors or local welfare stalls with a deposit here.'
        columns={[
          {
            key: 'pick',
            header: '',
            width: '32px',
            mobile: 'hide',
            render: (r) =>
              bucket(r) === 'toSend' ? (
                <input
                  type='checkbox'
                  aria-label={`Select ${r.stallName}`}
                  checked={picked.has(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setPicked((p) => {
                      const s = new Set(p);
                      e.target.checked ? s.add(r.id) : s.delete(r.id);
                      return s;
                    })
                  }
                  style={{ accentColor: 'var(--pri)' }}
                />
              ) : null,
          },
          {
            key: 'stall',
            header: 'Stall',
            width: '1.5fr',
            mobile: 'title',
            render: (r) => (
              <>
                <b>{r.stallName}</b>
                <Sub>
                  <Mono>{r.reference}</Mono> · <TypeTag type={r.requestType} size='sm' />
                </Sub>
              </>
            ),
          },
          { key: 'dep', header: 'Deposit', width: '110px', align: 'right', render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatInr(r.depositTotalPaise)}</span> },
          {
            key: 'ded',
            header: 'Deductions',
            width: '150px',
            align: 'right',
            render: (r) => (
              <span style={{ fontVariantNumeric: 'tabular-nums', color: r.furnitureDeductionPaise + r.finesPaise ? 'var(--des-fg)' : 'var(--mfg)' }}>
                {formatInr(r.furnitureDeductionPaise + r.finesPaise)}
                {r.ledgerFlagged && <Sub>furniture flagged</Sub>}
              </span>
            ),
          },
          { key: 'ref', header: 'Refundable', width: '120px', align: 'right', render: (r) => <b style={{ fontVariantNumeric: 'tabular-nums' }}>{r.preparedAt ? formatInr(r.refundablePaise) : '—'}</b> },
          {
            key: 'status',
            header: 'Status',
            width: '150px',
            render: (r) => {
              const b = bucket(r);
              return b === 'paid' ? (
                <Tag tone='ok' size='sm'>Paid {r.referenceNo}</Tag>
              ) : b === 'withFinance' ? (
                <Tag tone='info' size='sm'>With finance</Tag>
              ) : b === 'toSend' ? (
                <Tag tone='teal' size='sm'>Prepared</Tag>
              ) : (
                <Tag size='sm'>To prepare</Tag>
              );
            },
          },
        ]}
        actions={(r) => {
          const b = bucket(r);
          return (
            <>
              {canPrepare && b !== 'paid' && (
                <Btn onClick={() => setFineFor(r)}>+ Fine</Btn>
              )}
              {canPrepare && (b === 'toPrepare' || b === 'toSend') && (
                <Btn kind='primary' onClick={() => run(`Voucher prepared for ${r.stallName}`, () => api.prepareRefund(r.id))}>
                  {b === 'toSend' ? 'Re-prepare' : 'Prepare'}
                </Btn>
              )}
              {canPay && b === 'withFinance' && (
                <Btn kind='primary' onClick={() => setPaying(r)}>
                  Mark paid
                </Btn>
              )}
            </>
          );
        }}
      />

      {open && (
        <Dialog width={560} title={open.stallName} note={`${open.reference} · voucher`} onClose={() => setOpen(null)} footer={<Btn onClick={() => setOpen(null)}>Close</Btn>}>
          <KV k='Pay to' v={open.accountHolder ? `${open.accountHolder} · ${open.bankName} ${open.accountNumberMasked} · ${open.ifsc}` : 'Bank details not received'} />
          <KV k='Deposit held' v={formatInr(open.depositTotalPaise)} />
          <KV k='Furniture deductions' v={formatInr(open.furnitureDeductionPaise)} />
          <KV
            k='Fines'
            v={
              open.fines.length ? (
                <div>
                  {open.fines.map((f) => (
                    <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
                      <span style={{ flex: 1, textDecoration: f.waivedAt ? 'line-through' : undefined, color: f.waivedAt ? 'var(--mfg)' : undefined }}>
                        {f.reason} — {formatInr(f.amountPaise)}
                      </span>
                      {f.waivedAt ? (
                        <Tag size='sm'>Waived</Tag>
                      ) : canPrepare && !open.paidAt ? (
                        <Btn onClick={() => run('Fine waived', () => api.waiveFine(f.id))}>Waive</Btn>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                'None'
              )
            }
          />
          <KV k='Refundable' v={<b>{open.preparedAt ? formatInr(open.refundablePaise) : 'Not prepared yet'}</b>} />
          {open.shortfallPaise > 0 && <KV k='Shortfall' v={<span style={{ color: 'var(--des-fg)' }}>{formatInr(open.shortfallPaise)} beyond the deposit — to be recovered</span>} />}
          {open.preparedAt && <KV k='Prepared' v={formatDate(open.preparedAt)} />}
          {open.sentToFinanceAt && <KV k='Sent to finance' v={formatDate(open.sentToFinanceAt)} />}
          {open.paidAt && <KV k='Paid' v={`${formatDate(open.paidAt)} · ${open.referenceNo}`} />}
          {cfg.data && (
            <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 10 }}>
              Replacement rates: chair {formatInr(cfg.data.charges.chairReplacementPaise)}, table {formatInr(cfg.data.charges.tableReplacementPaise)}.
            </div>
          )}
        </Dialog>
      )}

      {fineFor && (
        <FineDialog
          row={fineFor}
          fineTypes={cfg.data?.fineTypes.filter((f) => f.isActive) ?? []}
          onClose={() => setFineFor(null)}
          onDone={(m) => {
            setFineFor(null);
            toast.ok(m);
            rows.reload();
          }}
          onError={toast.fail}
        />
      )}

      {paying && (
        <PaidDialog
          row={paying}
          onClose={() => setPaying(null)}
          onDone={(m) => {
            setPaying(null);
            toast.ok(m);
            rows.reload();
          }}
          onError={toast.fail}
        />
      )}
    </div>
  );
}

function FineDialog({ row, fineTypes, onClose, onDone, onError }: { row: RefundRow; fineTypes: Array<{ id: string; reason: string; defaultAmountPaise: number }>; onClose: () => void; onDone: (m: string) => void; onError: (e: unknown) => void }) {
  const [typeId, setTypeId] = useState(fineTypes[0]?.id ?? '');
  const [reason, setReason] = useState(fineTypes[0]?.reason ?? '');
  const [amount, setAmount] = useState(fineTypes[0] ? String(fineTypes[0].defaultAmountPaise / 100) : '');
  const [busy, setBusy] = useState(false);
  const pickType = (id: string) => {
    setTypeId(id);
    const t = fineTypes.find((f) => f.id === id);
    if (t) {
      setReason(t.reason);
      setAmount(String(t.defaultAmountPaise / 100));
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.addFine(row.id, { fineTypeId: typeId || undefined, reason: reason.trim(), amountPaise: rupeesToPaise(Number(amount) || 0) });
      onDone(`Fine recorded for ${row.stallName}`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog width={480} title={`Fine — ${row.stallName}`} note='Deducted from the deposit when the voucher is prepared.' onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind='danger' disabled={busy || !reason.trim() || !amount} onClick={save}>{busy ? 'Saving…' : 'Record fine'}</Btn></>}>
      {fineTypes.length > 0 && (
        <Field id='ft' label='Type'>
          <SelectInput id='ft' value={typeId} onChange={(e) => pickType(e.target.value)}>
            {fineTypes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.reason} — {formatInr(f.defaultAmountPaise)}
              </option>
            ))}
            <option value=''>Other…</option>
          </SelectInput>
        </Field>
      )}
      <Row2>
        <Field id='fr' label='Reason' required>
          <TextInput id='fr' value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field id='fa' label='Amount (₹)' required>
          <TextInput id='fa' inputMode='decimal' value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </Row2>
    </Dialog>
  );
}

function PaidDialog({ row, onClose, onDone, onError }: { row: RefundRow; onClose: () => void; onDone: (m: string) => void; onError: (e: unknown) => void }) {
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.markRefundPaid(row.id, ref.trim());
      onDone(`Refund paid — ${row.stallName}`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog width={440} title={`Mark paid — ${row.stallName}`} note={`${formatInr(row.refundablePaise)} to ${row.accountHolder ?? 'the vendor'}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind='primary' disabled={busy || !ref.trim()} onClick={save}>{busy ? 'Saving…' : 'Mark paid'}</Btn></>}>
      <Field id='pr' label='Transfer reference' required>
        <TextInput id='pr' value={ref} onChange={(e) => setRef(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
