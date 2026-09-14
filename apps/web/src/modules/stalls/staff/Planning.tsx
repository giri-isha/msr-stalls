import { STALL_CATEGORIES, type ZoneCode, type ZonePlanView, suggestStallCount } from '@msr/stalls';
import { useEffect, useState } from 'react';
import { applyPlan, getPlan, putPlan } from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import { Dialog } from '../ui/components/Dialog';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, Card, ErrorBox, H1, Loading, gridMinWidth } from '../ui/ui';
import { inputStyle } from '../components/FormControls';

const CAT_LABEL: Record<string, string> = {
  VENDOR_FOOD: 'Vendor Food',
  ASHRAM_FOOD: 'Ashram Food',
  LW_FOOD: 'LW Food',
  VENDOR_NON_FOOD: 'Vendor Non-food',
  ASHRAM_NON_FOOD: 'Ashram Non-food',
  HELP_DESK: 'Help Desk',
  BACKUP: 'Backup',
};

type Draft = {
  crowdPerStall: string;
  rows: Array<{ zoneCode: string; expectedCrowd: string; counts: Record<string, string> }>;
};

const toDraft = (p: ZonePlanView): Draft => ({
  crowdPerStall: String(p.crowdPerStall),
  rows: p.rows.map((r) => ({
    zoneCode: r.zoneCode,
    expectedCrowd: String(r.expectedCrowd),
    counts: Object.fromEntries(STALL_CATEGORIES.map((c) => [c, String(r.counts[c] ?? 0)])),
  })),
});
const n = (s: string) => (s.trim() === '' ? 0 : Math.max(0, Math.floor(Number(s)) || 0));

const cell = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  ...inputStyle,
  padding: '6px 8px',
  fontSize: 12.5,
  textAlign: 'right',
  ...extra,
});

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
  const writable = can('planning:write');

  useEffect(() => {
    if (data) setDraft(toDraft(data));
  }, [data]);

  if (loading || !draft) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message}</ErrorBox>;

  const divisor = n(draft.crowdPerStall);
  const rowTotal = (r: Draft['rows'][number]) => STALL_CATEGORIES.reduce((t, c) => t + n(r.counts[c]), 0);
  const colTotal = (c: string) => draft.rows.reduce((t, r) => t + n(r.counts[c]), 0);
  const grand = draft.rows.reduce((t, r) => t + rowTotal(r), 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(data));
  const shrinking = data.rows.some((r) => {
    const d = draft.rows.find((x) => x.zoneCode === r.zoneCode);
    return d && rowTotal(d) < r.stallsExisting;
  });

  const setRow = (i: number, patch: Partial<Draft['rows'][number]>) =>
    setDraft((d) => d && { ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setCount = (i: number, c: string, v: string) =>
    setDraft((d) => d && { ...d, rows: d.rows.map((r, j) => (j === i ? { ...r, counts: { ...r.counts, [c]: v } } : r)) });

  const save = async () => {
    setSaving(true);
    try {
      await putPlan({
        crowdPerStall: divisor || undefined,
        rows: draft.rows.map((r) => ({
          zoneCode: r.zoneCode as ZoneCode,
          expectedCrowd: n(r.expectedCrowd),
          counts: Object.fromEntries(STALL_CATEGORIES.map((c) => [c, n(r.counts[c])])) as Record<(typeof STALL_CATEGORIES)[number], number>,
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
      toast.ok(`Applied: ${r.created.length} created, ${r.removed.length} removed${r.kept.length ? `, ${r.kept.length} kept (allocated)` : ''}`);
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setSaving(false);
    }
  };

  const template = `90px 110px 80px ${STALL_CATEGORIES.map(() => '86px').join(' ')} 70px 80px 80px`;
  const head: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: template,
    gap: 8,
    padding: '10px 14px',
    borderBottom: '1px solid var(--line)',
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: '.5px',
    textTransform: 'uppercase',
    color: 'var(--rail-fg)',
    background: 'var(--rail)',
    alignItems: 'end',
  };
  const line: React.CSSProperties = { display: 'grid', gridTemplateColumns: template, gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--line)', alignItems: 'center', fontSize: 12.5 };
  const right: React.CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

  return (
    <div>
      <H1
        icon={<Icon name='layout-grid' size={20} />}
        sub='Stall count per zone is suggested from the expected crowd ÷ people per stall, then set by hand per category. Apply generates the stall numbers.'
        actions={
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--mfg)' }}>
              People per stall
              <input
                id='cps'
                type='number'
                min={1}
                value={draft.crowdPerStall}
                disabled={!writable}
                onChange={(e) => setDraft({ ...draft, crowdPerStall: e.target.value })}
                style={cell({ width: 90 })}
              />
            </label>
            <Btn disabled={!writable || !dirty || saving} onClick={save}>
              Save
            </Btn>
            <Btn kind='primary' disabled={!writable || saving} onClick={() => setConfirmApply(true)}>
              Apply plan
            </Btn>
          </>
        }
      >
        Planning &amp; Zones
      </H1>

      <Card pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div role='table' style={{ minWidth: gridMinWidth(template, 8, 28) }}>
            <div role='row' style={head}>
              <div>Zone</div>
              <div style={right}>Crowd</div>
              <div style={right} title='Crowd ÷ people per stall, rounded up'>
                Suggested
              </div>
              {STALL_CATEGORIES.map((c) => (
                <div key={c} style={right}>
                  {CAT_LABEL[c]}
                </div>
              ))}
              <div style={right}>Total</div>
              <div style={right}>Existing</div>
              <div style={right}>Allocated</div>
            </div>
            {draft.rows.map((r, i) => {
              const live = data.rows[i]!;
              const total = rowTotal(r);
              const suggested = suggestStallCount(n(r.expectedCrowd), divisor);
              return (
                <div key={r.zoneCode} role='row' style={line}>
                  <div>
                    <b>{r.zoneCode}</b>
                    <div style={{ fontSize: 11, color: 'var(--mfg)' }}>{live.isClosedToVendors ? 'closed to vendors' : 'open'}</div>
                  </div>
                  <input aria-label={`${r.zoneCode} expected crowd`} type='number' min={0} value={r.expectedCrowd} disabled={!writable} onChange={(e) => setRow(i, { expectedCrowd: e.target.value })} style={cell()} />
                  <div style={{ ...right, color: total < suggested ? 'var(--warn-fg)' : 'var(--mfg)' }}>{suggested}</div>
                  {STALL_CATEGORIES.map((c) => (
                    <input key={c} aria-label={`${r.zoneCode} ${CAT_LABEL[c]}`} type='number' min={0} value={r.counts[c]} disabled={!writable} onChange={(e) => setCount(i, c, e.target.value)} style={cell()} />
                  ))}
                  <div style={{ ...right, fontWeight: 700 }}>{total}</div>
                  <div style={{ ...right, color: total < live.stallsExisting ? 'var(--warn-fg)' : undefined }}>{live.stallsExisting}</div>
                  <div style={right}>{live.stallsAllocated}</div>
                </div>
              );
            })}
            <div role='row' style={{ ...line, background: 'var(--mut)', fontWeight: 700 }}>
              <div>Total</div>
              <div style={right}>{draft.rows.reduce((t, r) => t + n(r.expectedCrowd), 0).toLocaleString('en-IN')}</div>
              <div style={{ ...right, color: 'var(--mfg)' }}>{draft.rows.reduce((t, r) => t + suggestStallCount(n(r.expectedCrowd), divisor), 0)}</div>
              {STALL_CATEGORIES.map((c) => (
                <div key={c} style={right}>
                  {colTotal(c)}
                </div>
              ))}
              <div style={right} data-testid='grand-total'>
                {grand}
              </div>
              <div style={right}>{data.rows.reduce((t, r) => t + r.stallsExisting, 0)}</div>
              <div style={right}>{data.rows.reduce((t, r) => t + r.stallsAllocated, 0)}</div>
            </div>
          </div>
        </div>
      </Card>

      {confirmApply && (
        <Dialog
          title='Apply this plan?'
          note='Stall numbers are generated to match the counts above. Stalls holding a live allocation are never removed.'
          onClose={() => setConfirmApply(false)}
          footer={
            <>
              <Btn onClick={() => setConfirmApply(false)}>Back</Btn>
              <Btn kind='primary' onClick={apply}>
                Apply
              </Btn>
            </>
          }
        >
          {shrinking && (
            <div style={{ padding: '10px 12px', borderRadius: 'var(--r2)', background: 'var(--warn-t)', color: 'var(--warn-fg)', fontSize: 13, border: '1px solid var(--warn-b)' }}>
              At least one zone now plans fewer stalls than exist. Surplus available stalls will be removed; allocated ones are kept and reported.
            </div>
          )}
          {dirty && <p style={{ fontSize: 13, color: 'var(--mfg)', margin: '10px 0 0' }}>Unsaved changes will be saved first.</p>}
        </Dialog>
      )}
    </div>
  );
}
