import type { ChallanView, EquipmentAction, EquipmentFound, EquipmentRow } from '@stalls/core';
import { formatInr } from '@stalls/core';
import { useMemo, useState } from 'react';
import {
  equipmentAction,
  equipmentHistory,
  getChallan,
  listEquipment,
  patchEquipment,
} from '../api';
import { ActivityTimeline } from './ActivityTimeline';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Dialog,
  Empty,
  ErrorBox,
  FormField,
  H1,
  Icon,
  IconBtn,
  Input,
  Loading,
  Pager,
  RowActions,
  Search,
  Tag,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  toolBtnStyle,
  ColumnsButton,
  useColumns,
  type ColumnDef,
  useIsMobile,
  usePaged,
  useToast,
  titleCase,
} from '../ui';

/**
 * Chairs and tables, over the two days of the counter.
 *
 * Day one: hand out what was ordered online, add anything extra and take cash
 * for it, print the two-part challan. Day two: collect, and note what is
 * missing or broken — which is what the refund screen then deducts from the
 * deposit.
 *
 * ⚠️ The "Requested" column is a SNAPSHOT taken when the row was opened, not a
 * live read of the request. The vendor is standing at the counter holding a
 * printed challan; if the request were edited that evening the paper and the
 * screen would disagree, and the paper is what was signed.
 */
/** ⚠️ The actions column has no entry and cannot be hidden. It is not a fact
 *  about the stall, it is the way to act on it — a counter that hid it would
 *  have a table it can read and cannot use, and no way back but the picker it
 *  would have to find first. */
const COLUMNS: ColumnDef[] = [
  { key: 'stall', label: 'Stall', locked: true },
  { key: 'ordered', label: 'Ordered' },
  { key: 'extraChairs', label: 'Extra Chairs' },
  { key: 'extraTables', label: 'Extra Tables' },
  { key: 'cash', label: 'Cash Due' },
  { key: 'returned', label: 'Returned' },
  { key: 'condition', label: 'Condition' },
];

export function Equipment() {
  const toast = useToast();
  const { can } = useMe();
  const { data, error, loading, reload, setData } = useLoad(listEquipment);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'out' | 'flagged'>('all');
  const [challan, setChallan] = useState<ChallanView | null>(null);
  // ⚠️ The page holds them, not the row: a dialog is a <div>, and a <div>
  // inside a <tr> is markup React will not have.
  const [editing, setEditing] = useState<EquipmentRow | null>(null);
  const [collecting, setCollecting] = useState<EquipmentRow | null>(null);
  const [distributing, setDistributing] = useState<EquipmentRow | null>(null);
  const [history, setHistory] = useState<EquipmentRow | null>(null);
  const mobile = useIsMobile();
  const canWrite = can('equipment.write');
  const columns = useColumns('equipment', COLUMNS);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (r) =>
          !term ||
          r.stallName.toLowerCase().includes(term) ||
          r.stallNumbers.some((n) => n.toLowerCase().includes(term)),
      )
      .filter((r) => {
        if (filter === 'todo') return r.distributedAt === null;
        if (filter === 'out') return r.distributedAt !== null && r.collectedAt === null;
        if (filter === 'flagged') return r.flagged;
        return true;
      });
  }, [data, q, filter]);

  // A narrowing returns to the first page — otherwise the filter reads as
  // lost rows rather than as a page number left behind.
  const { slice, pager } = usePaged('equipment', rows, `${q}|${filter}`);

  const replace = (row: EquipmentRow) =>
    setData((prev) => (prev ?? []).map((r) => (r.requestId === row.requestId ? row : r)));

  const run = async (fn: () => Promise<EquipmentRow>, message?: string) => {
    try {
      replace(await fn());
      if (message) toast.ok(message);
      return true;
    } catch (e) {
      toast.fail(e);
      reload();
      return false;
    }
  };

  const openChallan = async (id: string) => {
    try {
      setChallan(await getChallan(id));
    } catch (e) {
      toast.fail(e);
    }
  };

  return (
    <div>
      <H1
        icon={<Icon name='layout-grid' size={18} />}
        sub='Distribute what was ordered, charge for extras at the counter, then collect and note anything missing or broken.'
      >
        Chairs &amp; Tables
      </H1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <Search value={q} onChange={setQ} placeholder='Search stall or stall number…' />
        {(
          [
            ['all', 'All'],
            ['todo', 'To distribute'],
            ['out', 'Out — to collect'],
            ['flagged', 'Flagged only'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type='button'
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            style={toolBtnStyle(filter === key)}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {!mobile && <ColumnsButton state={columns} />}
      </div>

      {error && <ErrorBox>{error.message}</ErrorBox>}
      {loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No stalls ordered chairs or tables.</Empty>
      ) : mobile ? (
        <>
          <div style={{ display: 'grid', gap: 10 }}>
            {slice.map((r) => (
              <EquipmentCard
                key={r.requestId}
                row={r}
                canWrite={canWrite}
                onRun={run}
                onEdit={() => setEditing(r)}
                onCollect={() => setCollecting(r)}
                onDistribute={() => setDistributing(r)}
                onHistory={() => setHistory(r)}
                onChallan={() => openChallan(r.requestId)}
              />
            ))}
          </div>
          <Card pad={0} style={{ marginTop: 12, overflow: 'hidden' }}>
            <Pager {...pager} noun='stall' />
          </Card>
        </>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Stall</TH>
                {columns.shown('ordered') && <TH align='right'>Ordered</TH>}
                {columns.shown('extraChairs') && <TH align='right'>Extra Chairs</TH>}
                {columns.shown('extraTables') && <TH align='right'>Extra Tables</TH>}
                {columns.shown('cash') && <TH align='right'>Cash Due</TH>}
                {columns.shown('returned') && <TH>Returned</TH>}
                {columns.shown('condition') && <TH>Condition</TH>}
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {slice.map((r) => (
                <TR key={r.requestId}>
                  <TD>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {r.stallName}
                      {r.flagged && (
                        <Tag tone='des' size='sm' style={{ marginLeft: 6 }}>
                          Flagged
                        </Tag>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: 'ui-monospace,Menlo,monospace',
                        fontSize: 11.5,
                        color: 'var(--mfg)',
                      }}
                    >
                      {r.stallNumbers.join(', ') || '—'}
                    </div>
                  </TD>
                  {columns.shown('ordered') && (
                    <TD align='right' style={{ whiteSpace: 'nowrap' }}>
                      {r.chairsRequested} ch / {r.tablesRequested} tb
                    </TD>
                  )}
                  {columns.shown('extraChairs') && (
                    <TD align='right' style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.extraChairs || <span style={{ color: 'var(--mfg)' }}>—</span>}
                    </TD>
                  )}
                  {columns.shown('extraTables') && (
                    <TD align='right' style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.extraTables || <span style={{ color: 'var(--mfg)' }}>—</span>}
                    </TD>
                  )}
                  {columns.shown('cash') && (
                    <TD align='right'>
                      {r.extraChargePaise > 0 ? (
                        <Tag tone={r.extraCollectedAt ? 'ok' : 'warn'} size='sm'>
                          {formatInr(r.extraChargePaise)}
                          {r.extraCollectedAt ? ' paid' : ''}
                        </Tag>
                      ) : (
                        <span style={{ color: 'var(--mfg)' }}>—</span>
                      )}
                    </TD>
                  )}
                  {columns.shown('returned') && (
                    <TD>
                      <StageTag row={r} />
                    </TD>
                  )}
                  {columns.shown('condition') && (
                    <TD>
                      <ConditionSummary row={r} />
                    </TD>
                  )}
                  <TD align='right'>
                    <Actions
                      row={r}
                      canWrite={canWrite}
                      onRun={run}
                      onEdit={() => setEditing(r)}
                      onCollect={() => setCollecting(r)}
                      onDistribute={() => setDistributing(r)}
                      onHistory={() => setHistory(r)}
                      onChallan={() => openChallan(r.requestId)}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pager {...pager} noun='stall' />
        </Card>
      )}

      {editing && <CounterDialog row={editing} onRun={run} onClose={() => setEditing(null)} />}
      {collecting && (
        <CollectDialog row={collecting} onRun={run} onClose={() => setCollecting(null)} />
      )}
      {distributing && (
        <DistributeDialog row={distributing} onRun={run} onClose={() => setDistributing(null)} />
      )}
      {history && <HistoryDialog row={history} onClose={() => setHistory(null)} />}
      {challan && <ChallanDialog data={challan} onClose={() => setChallan(null)} />}
    </div>
  );
}

/** ⚠️ Answers whether it went through, so the counter dialog can stay open on a
 *  refusal rather than closing and taking the figures with it. */
type Run = (fn: () => Promise<EquipmentRow>, message?: string) => Promise<boolean>;

function StageTag({ row }: { row: EquipmentRow }) {
  if (row.collectedAt) {
    return (
      <Tag tone='ok' size='sm'>
        Collected
      </Tag>
    );
  }
  if (row.distributedAt) {
    return (
      <Tag tone='info' size='sm'>
        Out
      </Tag>
    );
  }
  return (
    <Tag tone='neutral' size='sm'>
      Not Out
    </Tag>
  );
}

/**
 * What was found when the chairs came back — read here, changed in the dialog.
 *
 * ⚠️ Nothing at all when nothing is wrong. The overwhelming majority of rows
 * return complete, and a column of empty fields and unticked boxes made the
 * handful that did not look exactly like the ones that did.
 */
function ConditionSummary({ row }: { row: EquipmentRow }) {
  const counts = (chairs: number, tables: number) =>
    [chairs > 0 ? `${chairs} ch` : null, tables > 0 ? `${tables} tb` : null]
      .filter(Boolean)
      .join(' / ');
  const missing = counts(row.missingChairs, row.missingTables);
  const damaged = counts(row.damagedChairs, row.damagedTables);
  const clean = !missing && !damaged && !row.note;

  if (clean) return <span style={{ color: 'var(--mfg)' }}>—</span>;

  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {missing && (
          <Tag tone='warn' size='sm'>
            {missing} missing
          </Tag>
        )}
        {damaged && (
          <Tag tone='des' size='sm'>
            {damaged} damaged
          </Tag>
        )}
      </div>
      {row.note && <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{row.note}</span>}
      {row.deductionPaise > 0 && (
        <span style={{ fontSize: 11, color: 'var(--warn-fg,var(--mfg))' }}>
          Deduction {formatInr(row.deductionPaise)}
        </span>
      )}
    </div>
  );
}

/**
 * The four figures the counter reads off the returned stack, and the note.
 *
 * 🔴 ONE set of fields, used by the dialog that takes them at collection and
 * the dialog that corrects them afterwards. Two copies of this form is how the
 * collect screen and the edit screen start asking for different things — and
 * the deduction is priced off whichever one was open.
 *
 * Held as strings while they are typed: a half-typed figure is not a number
 * yet, and the value the vendor is charged must not pass through one.
 */
interface FoundDraft {
  missingChairs: string;
  missingTables: string;
  damagedChairs: string;
  damagedTables: string;
  /** How many days it was actually out. One day was paid in cash when it was
   *  handed over; the rest is settled against the deposit. */
  daysHeld: string;
  /** Keyed by item id, not by name — the item can be renamed between the day it
   *  went out and the day it came back. */
  items: Record<string, { missing: string; damaged: string }>;
  note: string;
}

const COUNTS = ['missingChairs', 'missingTables', 'damagedChairs', 'damagedTables'] as const;

const draftOf = (row: EquipmentRow): FoundDraft => ({
  missingChairs: String(row.missingChairs),
  missingTables: String(row.missingTables),
  damagedChairs: String(row.damagedChairs),
  damagedTables: String(row.damagedTables),
  daysHeld: String(row.daysHeld),
  items: Object.fromEntries(
    row.items.map((i) => [i.itemId, { missing: String(i.missing), damaged: String(i.damaged) }]),
  ),
  note: row.note ?? '',
});

const num = (s: string) => {
  const x = Number(s);
  return Number.isInteger(x) && x >= 0 && x <= 500 ? x : null;
};

const days = (s: string) => {
  const x = Number(s);
  return Number.isInteger(x) && x >= 1 && x <= 60 ? x : null;
};

const foundValid = (d: FoundDraft) =>
  COUNTS.every((k) => num(d[k]) !== null) &&
  days(d.daysHeld) !== null &&
  Object.values(d.items).every((i) => num(i.missing) !== null && num(i.damaged) !== null);

const foundOf = (d: FoundDraft): EquipmentFound => ({
  missingChairs: num(d.missingChairs) ?? 0,
  missingTables: num(d.missingTables) ?? 0,
  damagedChairs: num(d.damagedChairs) ?? 0,
  damagedTables: num(d.damagedTables) ?? 0,
  daysHeld: days(d.daysHeld) ?? 1,
  items: Object.entries(d.items).map(([itemId, i]) => ({
    itemId,
    missing: num(i.missing) ?? 0,
    damaged: num(i.damaged) ?? 0,
  })),
  note: d.note.trim(),
});

/** 🔴 Missing and damaged are counted APART, and each is counted per chair and
 *  per table. Damaged used to be one tick for the whole stall: the counter
 *  standing over a stack with three broken chairs could say only that
 *  something was broken, and the refund charged the penalty once. Two piles
 *  come back — what never came back at all, and what came back unusable — and
 *  the counter is looking at both. */
function FoundFields({
  row,
  value,
  onChange,
}: {
  row: EquipmentRow;
  value: FoundDraft;
  onChange: (d: FoundDraft) => void;
}) {
  const field = (k: (typeof COUNTS)[number]) => ({
    type: 'number' as const,
    min: 0,
    value: value[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [k]: e.target.value }),
  });
  const itemField = (itemId: string, k: 'missing' | 'damaged') => ({
    type: 'number' as const,
    min: 0,
    value: value.items[itemId]?.[k] ?? '0',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({
        ...value,
        items: {
          ...value.items,
          [itemId]: {
            missing: value.items[itemId]?.missing ?? '0',
            damaged: value.items[itemId]?.damaged ?? '0',
            [k]: e.target.value,
          },
        },
      }),
  });

  // Only what this stall actually took. Every item in the catalogue drawn
  // against every stall is a form the counter scrolls past to reach the two
  // lines that matter.
  const taken = row.items.filter((i) => i.count > 0);

  return (
    <>
      <Pair>
        <FormField id='eq-mch' label='Chairs Missing'>
          <Input id='eq-mch' {...field('missingChairs')} />
        </FormField>
        <FormField id='eq-mtb' label='Tables Missing'>
          <Input id='eq-mtb' {...field('missingTables')} />
        </FormField>
      </Pair>
      <Pair>
        <FormField id='eq-dch' label='Chairs Damaged'>
          <Input id='eq-dch' {...field('damagedChairs')} />
        </FormField>
        <FormField id='eq-dtb' label='Tables Damaged'>
          <Input id='eq-dtb' {...field('damagedTables')} />
        </FormField>
      </Pair>
      {taken.map((item) => (
        <Pair key={item.itemId}>
          <FormField id={`eq-m-${item.itemId}`} label={`${item.name} Missing`}>
            <Input id={`eq-m-${item.itemId}`} {...itemField(item.itemId, 'missing')} />
          </FormField>
          <FormField id={`eq-d-${item.itemId}`} label={`${item.name} Damaged`}>
            <Input id={`eq-d-${item.itemId}`} {...itemField(item.itemId, 'damaged')} />
          </FormField>
        </Pair>
      ))}
      {/* 🔴 Not the configured "days furniture is held" — that is what the
          payment letter PLANNED for and billed the ordered furniture at. This
          is what actually happened, and it is the only figure that can settle
          the days nobody has been charged for. Defaults to 1, which charges
          nothing extra: the number has to be entered, not assumed. */}
      <FormField id='eq-days' label='Days Held'>
        <Input
          id='eq-days'
          type='number'
          min={1}
          max={60}
          value={value.daysHeld}
          onChange={(e) => onChange({ ...value, daysHeld: e.target.value })}
        />
      </FormField>
      <FormField id='eq-note' label='Condition Note'>
        <Input
          id='eq-note'
          value={value.note}
          placeholder='e.g. 1 chair broken'
          onChange={(e) => onChange({ ...value, note: e.target.value })}
        />
      </FormField>
    </>
  );
}

/**
 * Handing it over: count what leaves the store, take the cash, stamp it out.
 *
 * 🔴 TOTALS, not extras. The dialog asks "how many chairs are you handing
 * over" and works out the extra by subtracting what was ordered, because a
 * volunteer asked for "the extra" does the subtraction in their head while a
 * vendor waits — and gets it wrong. The figure they are looking at on the
 * trolley is the total.
 *
 * 🔴 Distribute used to be a bare button that stamped the time, and the extras
 * were typed into a separate Edit dialog somebody had to know to open first.
 * Two screens for one act at the counter is how a stall goes out marked
 * distributed with no record of the four extra chairs that went with it.
 *
 * ⚠️ The cash shown is ONE day for the per-day things, however long they are
 * kept. The payment letter already priced the ordered furniture for the days it
 * was planned to be held; nobody knows on the morning it goes out how many days
 * it will really be, so the rest is settled at return, against the deposit.
 */
function DistributeDialog({
  row,
  onRun,
  onClose,
}: {
  row: EquipmentRow;
  onRun: Run;
  onClose: () => void;
}) {
  const [chairs, setChairs] = useState(String(row.chairsRequested + row.extraChairs));
  const [tables, setTables] = useState(String(row.tablesRequested + row.extraTables));
  const [items, setItems] = useState<Record<string, string>>(
    Object.fromEntries(row.items.map((i) => [i.itemId, String(i.count)])),
  );
  const [saving, setSaving] = useState(false);

  const valid =
    num(chairs) !== null &&
    num(tables) !== null &&
    Object.values(items).every((c) => num(c) !== null);

  // Priced exactly as the server prices it, so the counter and the till never
  // disagree — see `extraCharge` in the API.
  const extraChairs = Math.max(0, (num(chairs) ?? 0) - row.chairsRequested);
  const extraTables = Math.max(0, (num(tables) ?? 0) - row.tablesRequested);
  const cashPaise = row.items.reduce(
    (total, i) => total + (num(items[i.itemId] ?? '0') ?? 0) * i.ratePaise,
    extraChairs * row.chairRatePaise + extraTables * row.tableRatePaise,
  );

  const distribute = async () => {
    setSaving(true);
    const ok = await onRun(
      () =>
        equipmentAction(row.requestId, 'DISTRIBUTE', undefined, {
          chairs: num(chairs) ?? 0,
          tables: num(tables) ?? 0,
          items: row.items.map((i) => ({
            itemId: i.itemId,
            count: num(items[i.itemId] ?? '0') ?? 0,
          })),
        }),
      'Distributed.',
    );
    if (ok) onClose();
    else setSaving(false);
  };

  const countField = (value: string, set: (v: string) => void) => ({
    type: 'number' as const,
    min: 0,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value),
  });

  return (
    <Dialog
      title={`Distribute — ${row.stallName}`}
      note={`${row.stallNumbers.join(', ') || 'No stall number'} · ordered ${row.chairsRequested} chairs and ${row.tablesRequested} tables.`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={distribute} disabled={saving || !valid}>
            <Icon name='package' size={14} />
            Distribute
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
          Count what is going out. Chairs and tables start at what was ordered — change them if the
          vendor is taking more.
        </div>
        <Pair>
          <FormField id='eq-hch' label='Chairs Out'>
            <Input id='eq-hch' {...countField(chairs, setChairs)} />
          </FormField>
          <FormField id='eq-htb' label='Tables Out'>
            <Input id='eq-htb' {...countField(tables, setTables)} />
          </FormField>
        </Pair>
        {/* Every item the edition lends, at zero — unlike the collect dialog,
            which shows only what this stall took. Nothing has gone out yet, so
            a list filtered to what went out would be empty. */}
        {row.items.length > 0 && (
          <Pair>
            {row.items.map((item) => (
              <FormField key={item.itemId} id={`eq-h-${item.itemId}`} label={item.name}>
                <Input
                  id={`eq-h-${item.itemId}`}
                  {...countField(items[item.itemId] ?? '0', (v) =>
                    setItems({ ...items, [item.itemId]: v }),
                  )}
                />
              </FormField>
            ))}
          </Pair>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--rail)',
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--mfg)' }}>Cash to take now</span>
          <strong style={{ fontSize: 16 }}>{formatInr(cashPaise)}</strong>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          One day’s rent on anything beyond what the payment letter already covered. If it is kept
          longer, the remaining days are charged against the deposit when it comes back.
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Collecting: count the stack, then mark it in — one act, one write.
 *
 * 🔴 The figures belong to THIS step, not to an edit somebody remembers to
 * make afterwards. Collect used to be a bare button that stamped the time, so
 * what came back short was recorded — if at all — later, from memory, by
 * whoever opened the row next. The vendor is standing there while the chairs
 * are counted; that is the only moment the count is free.
 *
 * ⚠️ Zeroes are the answer for almost every stall, so the dialog opens ready
 * to be confirmed: two taps for a complete return, and the fields are there
 * for the few that are not.
 */
function CollectDialog({
  row,
  onRun,
  onClose,
}: {
  row: EquipmentRow;
  onRun: Run;
  onClose: () => void;
}) {
  const [v, setV] = useState(draftOf(row));
  const [saving, setSaving] = useState(false);
  const outChairs = row.chairsRequested + row.extraChairs;
  const outTables = row.tablesRequested + row.extraTables;

  const collect = async () => {
    setSaving(true);
    const ok = await onRun(
      () => equipmentAction(row.requestId, 'COLLECT', foundOf(v)),
      'Collected.',
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title={`Collect — ${row.stallName}`}
      note={`${row.stallNumbers.join(', ') || 'No stall number'} · ${outChairs} chairs and ${outTables} tables went out.`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={collect} disabled={saving || !foundValid(v)}>
            <Icon name='package' size={14} />
            Collect
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
          Count what came back against what went out. Leave the figures at zero if everything
          returned whole.
        </div>
        <FoundFields row={row} value={v} onChange={setV} />
        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          What is missing is priced at the admin’s replacement rate and what came back damaged at
          the damage penalty, per item; both are deducted from this stall’s deposit on the refund
          screen.
        </div>
      </div>
    </Dialog>
  );
}

/**
 * What collection recorded, corrected afterwards.
 *
 * 🔴 One PATCH, not six. These were six inline controls that each fired on its
 * own blur or tick, so a counter correcting an entry — two chairs missing, no,
 * three, and one of them broken — sent three requests, and the middle one was
 * a figure nobody meant. Here the figures are settled first and sent once.
 *
 * ⚠️ The extras are NOT here any more. What goes out is counted on Distribute,
 * with the vendor in front of the trolley; typing it here as well meant two
 * screens could set the same charged figure, and the one somebody happened to
 * open last won. Undoing the distribution is the way to change it, and that is
 * logged.
 *
 * ⚠️ What was found on return is NOT offered before the stall is collected.
 * Filling it in here would leave the deduction priced against a row that still
 * reads as out — furniture nobody has confirmed is back — and the counter
 * would have no way to tell which rows they had actually walked to.
 */
function CounterDialog({
  row,
  onRun,
  onClose,
}: {
  row: EquipmentRow;
  onRun: Run;
  onClose: () => void;
}) {
  const [v, setV] = useState(draftOf(row));
  const [saving, setSaving] = useState(false);

  const collected = row.collectedAt !== null;
  const valid = foundValid(v);

  // Nothing has been counted yet, so there is nothing here to correct. Saving
  // anyway would file an edit that changed nothing, and the history is worth
  // more than the rows nobody caused.
  const editable = collected;

  const save = async () => {
    setSaving(true);
    const ok = await onRun(
      () => patchEquipment(row.requestId, collected ? foundOf(v) : {}),
      'Saved.',
    );
    if (ok) onClose();
    else setSaving(false);
  };

  return (
    <Dialog
      title={row.stallName}
      note={`${row.stallNumbers.join(', ') || 'No stall number'} · ordered ${row.chairsRequested} chairs and ${row.tablesRequested} tables.`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={save} disabled={saving || !valid || !editable}>
            <Icon name='check' size={14} />
            Save
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {/* Read-only. What went out is set on Distribute and nowhere else —
            see the note on this dialog. */}
        <Section title='Taken at the Counter'>
          <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
            {row.extraChairs} extra chairs and {row.extraTables} extra tables
            {row.items.filter((i) => i.count > 0).length > 0 &&
              `, ${row.items
                .filter((i) => i.count > 0)
                .map((i) => `${i.count} ${i.name}`)
                .join(', ')}`}
            {' · '}
            {formatInr(row.extraChargePaise)}
            {row.extraCollectedAt ? ' collected in cash.' : ' due in cash.'}
          </div>
        </Section>

        {collected ? (
          <Section title='Found on Return'>
            <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
              Recorded when this stall was collected. Correcting a figure here changes the
              deduction, and the history says who changed it.
            </div>
            <FoundFields row={row} value={v} onChange={(d) => setV({ ...v, ...d })} />
          </Section>
        ) : (
          <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
            What came back is counted on the Collect step, with the vendor standing there.
          </div>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Everything that has happened to this stall's furniture, newest first.
 *
 * 🔴 The counter's OWN trail, not the request's. It is read with
 * `equipment.read`, so the volunteer at the table can see it — they are the
 * one being asked "we returned those chairs this morning, who took them?" —
 * while the rest of the request's log, which they have no business with, stays
 * behind `audit.read` on the request page.
 */
function HistoryDialog({ row, onClose }: { row: EquipmentRow; onClose: () => void }) {
  const { data, error, loading } = useLoad(() => equipmentHistory(row.requestId), [row.requestId]);

  return (
    <Dialog
      title='Counter History'
      note={`${row.stallName} · ${row.stallNumbers.join(', ') || 'No stall number'}`}
      onClose={onClose}
      width={560}
      footer={<Btn onClick={onClose}>Close</Btn>}
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox>{error.message}</ErrorBox>
      ) : !data || data.length === 0 ? (
        <Empty>Nothing has happened at this counter yet.</Empty>
      ) : (
        <ActivityTimeline events={data} />
      )}
    </Dialog>
  );
}

/** A titled block inside the counter dialog. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.6px',
          textTransform: 'uppercase',
          color: 'var(--mfg)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/** Two fields side by side, stacking on a phone. */
function Pair({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function Actions({
  row,
  canWrite,
  onRun,
  onEdit,
  onCollect,
  onDistribute,
  onHistory,
  onChallan,
}: {
  row: EquipmentRow;
  canWrite: boolean;
  onRun: Run;
  onEdit: () => void;
  onCollect: () => void;
  onDistribute: () => void;
  onHistory: () => void;
  onChallan: () => void;
}) {
  const act = (action: EquipmentAction, message: string) =>
    onRun(() => equipmentAction(row.requestId, action), message);

  return (
    <RowActions wrap>
      {canWrite && <IconBtn label={`Edit ${row.stallName}`} glyph='pencil' onClick={onEdit} />}
      {/* Readable by anyone who can see the page: settling "who collected this
          already" is the counter's question, not the auditor's. */}
      <IconBtn label={`History for ${row.stallName}`} glyph='clock' onClick={onHistory} />
      {canWrite &&
        (row.distributedAt ? (
          <Btn onClick={() => act('UNDISTRIBUTE', 'Marked not distributed.')}>
            <Icon name='undo' size={14} />
            Undo
          </Btn>
        ) : (
          // Opens the count rather than stamping the time, the way Collect
          // does: what goes out is written down while the vendor is standing
          // there, not remembered and typed in afterwards.
          <Btn kind='primary' onClick={onDistribute}>
            <Icon name='package' size={14} />
            Distribute
          </Btn>
        ))}
      {canWrite && row.extraChargePaise > 0 && !row.extraCollectedAt && (
        <Btn onClick={() => act('COLLECT_EXTRA_PAYMENT', 'Cash recorded.')}>
          <Icon name='rupee' size={14} />
          Cash Taken
        </Btn>
      )}
      {canWrite &&
        row.distributedAt &&
        (row.collectedAt ? (
          <Btn onClick={() => act('UNCOLLECT', 'Marked not collected.')}>
            <Icon name='undo' size={14} />
            Undo Collect
          </Btn>
        ) : (
          // Opens the count rather than stamping the time: what came back is
          // recorded with the vendor there, not remembered afterwards.
          <Btn onClick={onCollect}>
            <Icon name='package' size={14} />
            Collect
          </Btn>
        ))}
      {canWrite && (
        <Btn
          kind={row.flagged ? 'danger' : 'ghost'}
          onClick={() => onRun(() => patchEquipment(row.requestId, { flagged: !row.flagged }))}
        >
          <Icon name='alert-triangle' size={13} />
          {row.flagged ? 'Unflag' : 'Flag'}
        </Btn>
      )}
      <Btn onClick={onChallan}>
        <Icon name='printer' size={14} />
        Challan
      </Btn>
    </RowActions>
  );
}

function EquipmentCard({
  row,
  canWrite,
  onRun,
  onEdit,
  onCollect,
  onDistribute,
  onHistory,
  onChallan,
}: {
  row: EquipmentRow;
  canWrite: boolean;
  onRun: Run;
  onEdit: () => void;
  onCollect: () => void;
  onDistribute: () => void;
  onHistory: () => void;
  onChallan: () => void;
}) {
  return (
    <Card pad={14} style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{row.stallName}</div>
          <div
            style={{
              fontFamily: 'ui-monospace,Menlo,monospace',
              fontSize: 11.5,
              color: 'var(--mfg)',
            }}
          >
            {row.stallNumbers.join(', ') || '—'} · {row.chairsRequested} chairs /{' '}
            {row.tablesRequested} tables
          </div>
        </div>
        <StageTag row={row} />
      </div>
      {/* The extras and the cash line, which the desktop table gives their own
          columns — a card has no columns, so they are said here. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(row.extraChairs > 0 || row.extraTables > 0) && (
          <Tag size='sm'>
            +{row.extraChairs} ch / +{row.extraTables} tb
          </Tag>
        )}
        {row.extraChargePaise > 0 && (
          <Tag tone={row.extraCollectedAt ? 'ok' : 'warn'} size='sm'>
            {formatInr(row.extraChargePaise)}
            {row.extraCollectedAt ? ' paid' : ''}
          </Tag>
        )}
        <ConditionSummary row={row} />
      </div>
      <Actions
        row={row}
        canWrite={canWrite}
        onRun={onRun}
        onEdit={onEdit}
        onCollect={onCollect}
        onDistribute={onDistribute}
        onHistory={onHistory}
        onChallan={onChallan}
      />
    </Card>
  );
}

// ── The paper challan ───────────────────────────────────────────────────────

/**
 * Two identical halves — vendor copy and office copy — on one sheet, with blank
 * boxes for the figures written in by hand at the counter.
 *
 * The blanks are deliberate and copy the 2025 slip: rent, advance, total and
 * returned are filled in with a pen while the vendor watches, then signed. The
 * system records the counts; the paper records the cash.
 */
function ChallanDialog({ data, onClose }: { data: ChallanView; onClose: () => void }) {
  return (
    <Dialog
      title='Chairs and Tables Challan'
      onClose={onClose}
      width={760}
      footer={
        <Btn kind='primary' onClick={() => window.print()}>
          <Icon name='download' size={14} />
          Print
        </Btn>
      }
    >
      <style>{CHALLAN_CSS}</style>
      <div className='stalls-challan' style={{ display: 'grid', gap: 14 }}>
        {(['Vendor copy', 'Office copy'] as const).map((copy) => (
          <div
            key={copy}
            style={{
              border: '1px solid var(--bd)',
              borderRadius: 'var(--r2)',
              padding: 14,
              fontSize: 12.5,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              <span>
                Chairs and Tables Challan — {copy} · {data.editionName}
              </span>
              <span>Category: {titleCase(data.category)}</span>
            </div>
            <div style={{ display: 'grid', gap: 3, marginBottom: 8 }}>
              <div>
                Stall Number: <strong>{data.stallNumber}</strong> &nbsp;&nbsp; Stall Name:{' '}
                <strong>{data.stallName}</strong>
              </div>
              <div>
                Owner: <strong>{data.ownerName}</strong> &nbsp;&nbsp; Contact:{' '}
                <strong>{data.contactNumber}</strong>
              </div>
              <div>
                Ordered online: <strong>{data.chairsOnline}</strong> chairs,{' '}
                <strong>{data.tablesOnline}</strong> tables
              </div>
              <div>
                Extra at counter: <strong>{data.extraChairs}</strong> chairs,{' '}
                <strong>{data.extraTables}</strong> tables — {formatInr(data.extraChargePaise)}
              </div>
              {/* 🔴 On the PAPER, not only on the screen. This is the copy the
                  vendor signs and takes away; a fan that left the store with no
                  line on it has no record the vendor ever saw. */}
              {data.items.length > 0 && (
                <div>Also taken: {data.items.map((i) => `${i.count} × ${i.name}`).join(', ')}</div>
              )}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={cell} />
                  <th style={cell}>Chairs</th>
                  <th style={cell}>Tables</th>
                </tr>
              </thead>
              <tbody>
                {['Paid in cash on event day — rent', 'Advance', 'Total', 'Returned'].map(
                  (label) => (
                    <tr key={label}>
                      <td style={cell}>{label}</td>
                      <td style={cell}>&nbsp;</td>
                      <td style={cell}>&nbsp;</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <div style={{ marginTop: 10, color: 'var(--mfg)' }}>
              Signature: ______________________
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

const cell: React.CSSProperties = {
  border: '1px solid var(--bd)',
  padding: '4px 6px',
  textAlign: 'left',
};

const CHALLAN_CSS = `
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body * { visibility: hidden; }
  .stalls-challan, .stalls-challan * { visibility: visible; }
  .stalls-challan { position: absolute; inset: 0; color: #000; }
  .stalls-challan td, .stalls-challan th { border: 1px solid #000 !important; }
}
`;
