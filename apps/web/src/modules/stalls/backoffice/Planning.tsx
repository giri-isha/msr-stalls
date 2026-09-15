import { type ZoneCode, type ZonePlanView, suggestStallCount } from '@msr/stalls';
import { useEffect, useState } from 'react';
import { applyPlan, getPlan, putPlan } from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Dialog,
  ErrorBox,
  H1,
  Icon,
  IconBtn,
  Input,
  Loading,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  useToast,
} from '../ui';

/** The grid's columns, in the order the edition put them.
 *
 *  ⚠️ Read off the payload, never a constant in this file. The columns are the
 *  edition's own configuration — the 2025 sheet carried sponsor and Adiyogi
 *  columns an enum never had — and a screen holding its own list would silently
 *  drop a column an admin added, under-counting the bay it stands in. */
type Column = ZonePlanView['categories'][number];

type Draft = {
  crowdPerStall: string;
  rows: Array<{ zoneCode: string; expectedCrowd: string; counts: Record<string, string> }>;
};

const toDraft = (p: ZonePlanView): Draft => ({
  crowdPerStall: String(p.crowdPerStall),
  rows: p.rows.map((r) => ({
    zoneCode: r.zoneCode,
    expectedCrowd: String(r.expectedCrowd),
    counts: Object.fromEntries(p.categories.map((c) => [c.key, String(r.counts[c.key] ?? 0)])),
  })),
});

const n = (s: string) => (s.trim() === '' ? 0 : Math.max(0, Math.floor(Number(s)) || 0));

/** A number cell in the grid. Right-aligned and tabular so a column of counts
 *  reads as a column rather than as ragged text. */
const cellInput: React.CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  padding: '6px 8px',
  fontSize: 12.5,
};

/** The same tabular figures, now that the grid reads rather than takes them. */
const cellFigure: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/**
 * One bay's row of the plan, in a box.
 *
 * ⚠️ Local state applied on Save. The grid is a DRAFT that its own Save writes
 * whole — the totals, the suggestion and the shrink warning all read off it —
 * so the dialog hands back a patch and the page's Save is still the only thing
 * that crosses the wire. The footer says as much.
 */
function ZonePlanDialog({
  row,
  columns,
  divisor,
  existing,
  onApply,
  onClose,
}: {
  row: Draft['rows'][number];
  columns: Column[];
  divisor: number;
  existing: number;
  onApply: (patch: Partial<Draft['rows'][number]>) => void;
  onClose: () => void;
}) {
  const [crowd, setCrowd] = useState(row.expectedCrowd);
  const [counts, setCounts] = useState(row.counts);

  const total = columns.reduce((t, c) => t + n(counts[c.key]), 0);
  const suggested = suggestStallCount(n(crowd), divisor);

  return (
    <Dialog
      title={`${row.zoneCode} — planned stalls`}
      note='Nothing is written until Save, and no stall exists until Apply plan.'
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={() => onApply({ expectedCrowd: crowd, counts })}>
            <Icon name='check' size={14} />
            Done
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <label
          htmlFor='zp-crowd'
          style={{ display: 'grid', gap: 5, fontSize: 12.5, fontWeight: 600 }}
        >
          Expected crowd
          <Input
            id='zp-crowd'
            type='number'
            min={0}
            value={crowd}
            onChange={(e) => setCrowd(e.target.value)}
          />
        </label>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
            gap: 10,
          }}
        >
          {columns.map((c) => (
            <label
              key={c.key}
              htmlFor={`zp-${c.key}`}
              style={{ display: 'grid', gap: 5, fontSize: 12.5, fontWeight: 600 }}
            >
              {c.name}
              <Input
                id={`zp-${c.key}`}
                type='number'
                min={0}
                value={counts[c.key] ?? '0'}
                onChange={(e) => setCounts({ ...counts, [c.key]: e.target.value })}
              />
            </label>
          ))}
        </div>

        {/* The two figures the row is judged against, kept in view while the
            counts are being typed — otherwise the suggestion is behind the
            dialog at exactly the moment it is wanted. */}
        <Card pad={12} style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
          <Line label='Suggested from the crowd' value={String(suggested)} />
          <Line
            label='Planned here'
            value={String(total)}
            tone={total < suggested ? 'var(--warn-fg)' : undefined}
          />
          <Line
            label='Stalls standing today'
            value={String(existing)}
            tone={total < existing ? 'var(--warn-fg)' : undefined}
          />
        </Card>
      </div>
    </Dialog>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--mfg)' }}>{label}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone }}>
        {value}
      </span>
    </div>
  );
}

/** The prototype's planning grid: a row per zone, a column per category, an
 *  expected crowd and a people-per-stall divisor that drive a suggestion, and
 *  live totals. Save writes the plan; Apply turns it into stalls. */
export function Planning() {
  const { can } = useMe();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(getPlan);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  // Which row's dialog is open, by index into the draft. Held here rather than
  // in the row, because a dialog is a <div> and a <div> inside a <tr> is markup
  // React will not have.
  const [editing, setEditing] = useState<number | null>(null);
  const writable = can('planning.write');

  useEffect(() => {
    if (data) setDraft(toDraft(data));
  }, [data]);

  if (loading || !draft) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the plan.'}</ErrorBox>;

  const divisor = n(draft.crowdPerStall);
  const columns: Column[] = data.categories;
  const rowTotal = (r: Draft['rows'][number]) =>
    columns.reduce((t, c) => t + n(r.counts[c.key]), 0);
  const colTotal = (c: string) => draft.rows.reduce((t, r) => t + n(r.counts[c]), 0);
  const grand = draft.rows.reduce((t, r) => t + rowTotal(r), 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(data));
  const shrinking = data.rows.some((r) => {
    const d = draft.rows.find((x) => x.zoneCode === r.zoneCode);
    return d && rowTotal(d) < r.stallsExisting;
  });

  // One patch for the whole row now — the counts come back from the dialog
  // together rather than a cell at a time.
  const setRow = (i: number, patch: Partial<Draft['rows'][number]>) =>
    setDraft((d) => d && { ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  const save = async () => {
    setSaving(true);
    try {
      await putPlan({
        crowdPerStall: divisor || undefined,
        rows: draft.rows.map((r) => ({
          zoneCode: r.zoneCode as ZoneCode,
          expectedCrowd: n(r.expectedCrowd),
          counts: Object.fromEntries(columns.map((c) => [c.key, n(r.counts[c.key])])),
        })),
      });
      toast.ok('Plan saved');
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setSaving(false);
    }
  };

  const apply = async () => {
    setConfirmApply(false);
    setSaving(true);
    try {
      if (dirty) await save();
      const r = await applyPlan();
      toast.ok(
        `Applied: ${r.created.length} created, ${r.removed.length} removed${
          r.kept.length ? `, ${r.kept.length} kept (allocated)` : ''
        }`,
      );
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <H1
        icon={<Icon name='layers' size={18} />}
        sub='Stall count per zone is suggested from the expected crowd ÷ people per stall, then set by hand per category. Apply generates the stall numbers.'
        actions={
          <>
            <label
              htmlFor='cps'
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12.5,
                color: 'var(--mfg)',
              }}
            >
              People per stall
              <Input
                id='cps'
                type='number'
                min={1}
                style={{ width: 90, ...cellInput }}
                value={draft.crowdPerStall}
                disabled={!writable}
                onChange={(e) => setDraft({ ...draft, crowdPerStall: e.target.value })}
              />
            </label>
            <Btn disabled={!writable || !dirty || saving} onClick={save}>
              <Icon name='check' size={14} />
              Save
            </Btn>
            <Btn
              kind='primary'
              disabled={!writable || saving}
              onClick={() => setConfirmApply(true)}
            >
              <Icon name='check' size={14} />
              Apply plan
            </Btn>
          </>
        }
      >
        Planning &amp; Zones
      </H1>

      <Card pad={0} style={{ overflow: 'hidden' }}>
        <Table>
          <THead>
            <TR>
              <TH>Zone</TH>
              <TH align='right'>Crowd</TH>
              <TH align='right' title='Crowd ÷ people per stall, rounded up'>
                Suggested
              </TH>
              {columns.map((c) => (
                <TH key={c.key} align='right'>
                  {c.name}
                </TH>
              ))}
              <TH align='right'>Total</TH>
              <TH align='right'>Existing</TH>
              <TH align='right'>Allocated</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {draft.rows.map((r, i) => {
              const live = data.rows[i];
              const total = rowTotal(r);
              const suggested = suggestStallCount(n(r.expectedCrowd), divisor);
              return (
                <TR key={r.zoneCode}>
                  <TD>
                    <div style={{ fontWeight: 700 }}>{r.zoneCode}</div>
                    <div style={{ fontSize: 11, color: 'var(--mfg)' }}>
                      {live.isClosedToVendors ? 'closed to vendors' : 'open'}
                    </div>
                  </TD>
                  <TD align='right' style={cellFigure}>
                    {n(r.expectedCrowd).toLocaleString('en-IN')}
                  </TD>
                  {/* ⚠️ `--warn`, not `--des`. Planning fewer stalls than the
                      crowd suggests is a judgement somebody may have made on
                      purpose; red would call it an error and there is no error
                      here to fix. */}
                  <TD
                    align='right'
                    style={{ color: total < suggested ? 'var(--warn-fg)' : undefined }}
                  >
                    {suggested}
                  </TD>
                  {columns.map((c) => (
                    <TD key={c.key} align='right' style={cellFigure}>
                      {n(r.counts[c.key] ?? '0')}
                    </TD>
                  ))}
                  <TD align='right' style={{ fontWeight: 700 }}>
                    {total}
                  </TD>
                  <TD
                    align='right'
                    style={{ color: total < live.stallsExisting ? 'var(--warn-fg)' : undefined }}
                  >
                    {live.stallsExisting}
                  </TD>
                  <TD align='right'>{live.stallsAllocated}</TD>
                  <TD align='right'>
                    <IconBtn
                      label={`Edit ${r.zoneCode}`}
                      glyph='pencil'
                      disabled={!writable}
                      onClick={() => setEditing(i)}
                    />
                  </TD>
                </TR>
              );
            })}
            <TR style={{ background: 'var(--rail)', fontWeight: 700 }}>
              <TD>Total</TD>
              <TD align='right'>
                {draft.rows.reduce((t, r) => t + n(r.expectedCrowd), 0).toLocaleString('en-IN')}
              </TD>
              <TD align='right' muted>
                {draft.rows.reduce((t, r) => t + suggestStallCount(n(r.expectedCrowd), divisor), 0)}
              </TD>
              {columns.map((c) => (
                <TD key={c.key} align='right'>
                  {colTotal(c.key)}
                </TD>
              ))}
              <TD align='right' data-testid='grand-total'>
                {grand}
              </TD>
              <TD align='right'>{data.rows.reduce((t, r) => t + r.stallsExisting, 0)}</TD>
              <TD align='right'>{data.rows.reduce((t, r) => t + r.stallsAllocated, 0)}</TD>
              <TD />
            </TR>
          </TBody>
        </Table>
      </Card>

      {editing !== null && draft.rows[editing] && (
        <ZonePlanDialog
          row={draft.rows[editing]}
          columns={columns}
          divisor={divisor}
          existing={data.rows[editing].stallsExisting}
          onClose={() => setEditing(null)}
          onApply={(patch) => {
            setRow(editing, patch);
            setEditing(null);
          }}
        />
      )}

      {confirmApply && (
        <Dialog
          title='Apply this plan?'
          note='Stall numbers are generated to match the counts above. Stalls holding a live allocation are never removed.'
          onClose={() => setConfirmApply(false)}
          footer={
            <>
              <Btn onClick={() => setConfirmApply(false)}>Back</Btn>
              <Btn kind='primary' onClick={apply}>
                <Icon name='check' size={14} />
                Apply
              </Btn>
            </>
          }
        >
          {shrinking && (
            <div
              style={{
                display: 'flex',
                gap: 9,
                padding: '11px 13px',
                borderRadius: 'var(--r2)',
                background: 'var(--warn-t)',
                border: '1px solid var(--warn-b)',
                color: 'var(--warn-fg)',
                fontSize: 12.5,
                lineHeight: 1.55,
              }}
            >
              <span style={{ flex: 'none', marginTop: 1 }}>
                <Icon name='alert-triangle' size={15} />
              </span>
              <span>
                At least one zone now plans fewer stalls than exist. Surplus available stalls will
                be removed; allocated ones are kept and reported.
              </span>
            </div>
          )}
          {dirty && (
            <p style={{ fontSize: 12.5, color: 'var(--mfg)', margin: '10px 0 0' }}>
              Unsaved changes will be saved first.
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
