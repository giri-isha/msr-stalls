import { type FurnitureRow, formatInr, paiseToRupees, rupeesToPaise } from '@msr/stalls';
import { useState } from 'react';
import * as api from '../api';
import { CheckRow, Field, NumberInput, Row2, TextArea, TextInput } from '../components/FormControls';
import { Grid, Mono, Sub } from '../components/Grid';
import { TypeTag } from '../components/StatusPill';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import { Dialog } from '../ui/components/Dialog';
import { StatTiles } from '../ui/components/StatTiles';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, ErrorBox, H1, Loading, Tag, Toolbar } from '../ui/ui';

/** Requirement 11: the chairs-and-tables counter. Issue what was ordered plus
 *  any extras (charged, cash collected), then the next day record what came
 *  back — missing and damaged are counted and the stall is flagged for the
 *  refund review. */
export function Furniture() {
  const { can } = useMe();
  const toast = useToast();
  const rows = useLoad(api.furnitureRows);
  const [q, setQ] = useState('');
  const [issue, setIssue] = useState<FurnitureRow | null>(null);
  const [ret, setRet] = useState<FurnitureRow | null>(null);
  const canWrite = can('checkin:write');

  if (rows.loading && !rows.data) return <Loading />;
  if (rows.error) return <ErrorBox>{rows.error.message}</ErrorBox>;
  const all = rows.data ?? [];
  const term = q.trim().toLowerCase();
  const data = term ? all.filter((r) => `${r.stallName} ${r.reference} ${r.allocatedStalls.join(' ')}`.toLowerCase().includes(term)) : all;
  const withOrders = all.filter((r) => r.chairsOrdered + r.tablesOrdered > 0 || r.ledger);

  return (
    <div>
      <H1 icon={<Icon name='check-square' size={20} />} sub='Issue chairs and tables against what each stall ordered; collect for extras; record the return and anything missing or damaged.'>
        Chairs &amp; Tables
      </H1>
      <StatTiles
        noun='stall'
        tiles={[
          { label: 'Ordered', count: withOrders.length },
          { label: 'Issued', count: all.filter((r) => r.ledger?.issuedAt).length },
          { label: 'Returned', count: all.filter((r) => r.ledger?.returnedAt).length },
          { label: 'Flagged', count: all.filter((r) => r.ledger?.flagged).length },
        ]}
      />
      <Toolbar>
        <div style={{ flex: 1, minWidth: 240 }}>
          <TextInput aria-label='Search' placeholder='Stall number, name or reference…' value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
          Cash collected {formatInr(all.reduce((n, r) => n + (r.ledger?.cashCollectedPaise ?? 0), 0))}
        </span>
      </Toolbar>
      <Grid
        rows={data}
        rowKey={(r) => r.id}
        empty='No selected stalls match.'
        columns={[
          { key: 'stall', header: 'Stall no', width: '100px', mobile: 'sub', render: (r) => <b><Mono>{r.allocatedStalls.join(', ') || '—'}</Mono></b> },
          {
            key: 'name',
            header: 'Stall',
            width: '1.5fr',
            mobile: 'title',
            render: (r) => (
              <>
                <b>{r.stallName}</b>
                <Sub>
                  <TypeTag type={r.requestType} size='sm' /> · {r.contactNumber}
                </Sub>
              </>
            ),
          },
          { key: 'ordered', header: 'Ordered', width: '110px', render: (r) => `${r.chairsOrdered} ch · ${r.tablesOrdered} tb` },
          {
            key: 'issued',
            header: 'Issued',
            width: '160px',
            render: (r) =>
              r.ledger?.issuedAt ? (
                <>
                  {r.ledger.chairsIssued + r.ledger.extraChairs} ch · {r.ledger.tablesIssued + r.ledger.extraTables} tb
                  {(r.ledger.extraChairs > 0 || r.ledger.extraTables > 0) && (
                    <Sub>
                      +{r.ledger.extraChairs}/{r.ledger.extraTables} extra · {formatInr(r.ledger.extraChargePaise)}
                    </Sub>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--mfg)' }}>—</span>
              ),
          },
          {
            key: 'ret',
            header: 'Returned',
            width: '180px',
            render: (r) =>
              r.ledger?.returnedAt ? (
                <>
                  {r.ledger.chairsReturned} ch · {r.ledger.tablesReturned} tb
                  {(r.ledger.chairsMissing + r.ledger.tablesMissing + r.ledger.chairsDamaged + r.ledger.tablesDamaged > 0) && (
                    <Sub>
                      <span style={{ color: 'var(--des-fg)' }}>
                        {r.ledger.chairsMissing + r.ledger.tablesMissing} missing · {r.ledger.chairsDamaged + r.ledger.tablesDamaged} damaged
                      </span>
                    </Sub>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--mfg)' }}>—</span>
              ),
          },
          {
            key: 'flag',
            header: 'Status',
            width: '110px',
            render: (r) =>
              r.ledger?.flagged ? <Tag tone='des' size='sm'>Flagged</Tag> : r.ledger?.returnedAt ? <Tag tone='ok' size='sm'>Returned</Tag> : r.ledger?.issuedAt ? <Tag tone='teal' size='sm'>Issued</Tag> : <Tag size='sm'>Pending</Tag>,
          },
        ]}
        actions={(r) =>
          canWrite ? (
            <>
              <Btn onClick={() => setIssue(r)}>{r.ledger?.issuedAt ? 'Edit issue' : 'Issue'}</Btn>
              {r.ledger?.issuedAt && (
                <Btn kind='primary' onClick={() => setRet(r)}>
                  {r.ledger.returnedAt ? 'Edit return' : 'Return'}
                </Btn>
              )}
            </>
          ) : null
        }
      />
      {issue && <IssueDialog row={issue} onClose={() => setIssue(null)} onDone={(m) => { setIssue(null); toast.ok(m); rows.reload(); }} onError={toast.fail} />}
      {ret && <ReturnDialog row={ret} onClose={() => setRet(null)} onDone={(m) => { setRet(null); toast.ok(m); rows.reload(); }} onError={toast.fail} />}
    </div>
  );
}

const n = (s: string) => Math.max(0, Number(s) || 0);

function IssueDialog({ row, onClose, onDone, onError }: { row: FurnitureRow; onClose: () => void; onDone: (m: string) => void; onError: (e: unknown) => void }) {
  const L = row.ledger;
  const [f, setF] = useState({
    chairsIssued: String(L?.chairsIssued ?? row.chairsOrdered),
    tablesIssued: String(L?.tablesIssued ?? row.tablesOrdered),
    extraChairs: String(L?.extraChairs ?? 0),
    extraTables: String(L?.extraTables ?? 0),
    cash: String(paiseToRupees(L?.cashCollectedPaise ?? 0)),
    notes: L?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const out = await api.issueFurniture(row.id, {
        chairsIssued: n(f.chairsIssued),
        tablesIssued: n(f.tablesIssued),
        extraChairs: n(f.extraChairs),
        extraTables: n(f.extraTables),
        cashCollectedPaise: rupeesToPaise(n(f.cash)),
        notes: f.notes.trim() || undefined,
      });
      onDone(`Issued to ${row.stallName}${out.extraChargePaise ? ` — extras ${formatInr(out.extraChargePaise)}` : ''}`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog width={520} title={`Issue — ${row.stallName}`} note={`Ordered online: ${row.chairsOrdered} chairs, ${row.tablesOrdered} tables`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind='primary' disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Record issue'}</Btn></>}>
      <Row2>
        <Field id='ci' label='Chairs issued (ordered)'>
          <NumberInput id='ci' value={f.chairsIssued} onChange={(e) => setF({ ...f, chairsIssued: e.target.value })} />
        </Field>
        <Field id='ti' label='Tables issued (ordered)'>
          <NumberInput id='ti' value={f.tablesIssued} onChange={(e) => setF({ ...f, tablesIssued: e.target.value })} />
        </Field>
        <Field id='ec' label='Extra chairs' help='Charged at this requester’s daily rate'>
          <NumberInput id='ec' value={f.extraChairs} onChange={(e) => setF({ ...f, extraChairs: e.target.value })} />
        </Field>
        <Field id='et' label='Extra tables'>
          <NumberInput id='et' value={f.extraTables} onChange={(e) => setF({ ...f, extraTables: e.target.value })} />
        </Field>
        <Field id='cash' label='Cash collected (₹)'>
          <TextInput id='cash' inputMode='decimal' value={f.cash} onChange={(e) => setF({ ...f, cash: e.target.value })} />
        </Field>
      </Row2>
      <Field id='inotes' label='Notes'>
        <TextArea id='inotes' rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Dialog>
  );
}

function ReturnDialog({ row, onClose, onDone, onError }: { row: FurnitureRow; onClose: () => void; onDone: (m: string) => void; onError: (e: unknown) => void }) {
  const L = row.ledger!;
  const outChairs = L.chairsIssued + L.extraChairs;
  const outTables = L.tablesIssued + L.extraTables;
  const [f, setF] = useState({
    chairsReturned: String(L.chairsReturned ?? outChairs),
    tablesReturned: String(L.tablesReturned ?? outTables),
    chairsDamaged: String(L.chairsDamaged),
    tablesDamaged: String(L.tablesDamaged),
    flagged: L.flagged,
    notes: L.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const missingC = Math.max(0, outChairs - n(f.chairsReturned));
  const missingT = Math.max(0, outTables - n(f.tablesReturned));
  const save = async () => {
    setBusy(true);
    try {
      const out = await api.returnFurniture(row.id, {
        chairsReturned: n(f.chairsReturned),
        tablesReturned: n(f.tablesReturned),
        chairsDamaged: n(f.chairsDamaged),
        tablesDamaged: n(f.tablesDamaged),
        flagged: f.flagged,
        notes: f.notes.trim() || undefined,
      });
      onDone(`Return recorded for ${row.stallName}${out.flagged ? ' — flagged for refund review' : ''}`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog width={520} title={`Return — ${row.stallName}`} note={`Out: ${outChairs} chairs, ${outTables} tables${L.issuedAt ? ` · issued ${formatDateTime(L.issuedAt)}` : ''}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind='primary' disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Record return'}</Btn></>}>
      <Row2>
        <Field id='cr' label='Chairs returned' help={missingC ? `${missingC} missing` : undefined}>
          <NumberInput id='cr' value={f.chairsReturned} onChange={(e) => setF({ ...f, chairsReturned: e.target.value })} />
        </Field>
        <Field id='tr' label='Tables returned' help={missingT ? `${missingT} missing` : undefined}>
          <NumberInput id='tr' value={f.tablesReturned} onChange={(e) => setF({ ...f, tablesReturned: e.target.value })} />
        </Field>
        <Field id='cd' label='Chairs damaged'>
          <NumberInput id='cd' value={f.chairsDamaged} onChange={(e) => setF({ ...f, chairsDamaged: e.target.value })} />
        </Field>
        <Field id='td' label='Tables damaged'>
          <NumberInput id='td' value={f.tablesDamaged} onChange={(e) => setF({ ...f, tablesDamaged: e.target.value })} />
        </Field>
      </Row2>
      <CheckRow id='flag' checked={f.flagged} onChange={(b) => setF({ ...f, flagged: b })} label='Flag this stall for the refund review' help='Set automatically when anything is missing or damaged.' />
      <Field id='rnotes' label='Notes'>
        <TextArea id='rnotes' rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </Dialog>
  );
}
