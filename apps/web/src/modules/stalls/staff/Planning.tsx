import { STALL_CATEGORIES, type ZoneCode, type ZonePlanView, suggestStallCount } from '@msr/stalls';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Dialog } from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '../../../components/ui/table';
import { cn } from '../../../lib/cn';
import { applyPlan, getPlan, putPlan } from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';

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

/** The prototype's planning grid: a row per zone, a column per category, an
 *  expected crowd and a people-per-stall divisor that drive a suggestion, and
 *  live totals. Save writes the plan; Apply turns it into stalls. */
export function Planning() {
  const { can } = useMe();
  const { data, error, loading, reload } = useLoad(getPlan);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const writable = can('planning:write');

  useEffect(() => {
    if (data) setDraft(toDraft(data));
  }, [data]);

  if (loading || !draft) return <p className='text-sm text-ink-2'>Loading…</p>;
  if (error || !data) return <p className='text-sm text-bad'>{error?.message}</p>;

  const divisor = n(draft.crowdPerStall);
  const rowTotal = (r: Draft['rows'][number]) =>
    STALL_CATEGORIES.reduce((t, c) => t + n(r.counts[c]), 0);
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
    setDraft(
      (d) =>
        d && {
          ...d,
          rows: d.rows.map((r, j) => (j === i ? { ...r, counts: { ...r.counts, [c]: v } } : r)),
        },
    );

  const save = async () => {
    setSaving(true);
    try {
      await putPlan({
        crowdPerStall: divisor || undefined,
        rows: draft.rows.map((r) => ({
          zoneCode: r.zoneCode as ZoneCode,
          expectedCrowd: n(r.expectedCrowd),
          counts: Object.fromEntries(STALL_CATEGORIES.map((c) => [c, n(r.counts[c])])) as Record<
            (typeof STALL_CATEGORIES)[number],
            number
          >,
        })),
      });
      toast.success('Plan saved');
      reload();
    } catch (e) {
      toast.error((e as Error).message);
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
      toast.success(
        `Applied: ${r.created.length} created, ${r.removed.length} removed${
          r.kept.length ? `, ${r.kept.length} kept (allocated)` : ''
        }`,
      );
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold'>Planning &amp; Zones</h1>
          <p className='text-sm text-ink-2'>
            Stall count per zone is suggested from the expected crowd ÷ people per stall, then set
            by hand per category. Apply generates the stall numbers.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <label htmlFor='cps' className='text-sm text-ink-2'>
            People per stall
          </label>
          <Input
            id='cps'
            type='number'
            min={1}
            className='w-28'
            value={draft.crowdPerStall}
            disabled={!writable}
            onChange={(e) => setDraft({ ...draft, crowdPerStall: e.target.value })}
          />
          <Button variant='outline' disabled={!writable || !dirty || saving} onClick={save}>
            Save
          </Button>
          <Button disabled={!writable || saving} onClick={() => setConfirmApply(true)}>
            Apply plan
          </Button>
        </div>
      </div>

      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Zone</TH>
              <TH className='text-right'>Crowd</TH>
              <TH className='text-right' title='Crowd ÷ people per stall, rounded up'>
                Suggested
              </TH>
              {STALL_CATEGORIES.map((c) => (
                <TH key={c} className='text-right'>
                  {CAT_LABEL[c]}
                </TH>
              ))}
              <TH className='text-right'>Total</TH>
              <TH className='text-right'>Existing</TH>
              <TH className='text-right'>Allocated</TH>
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
                    <div className='font-semibold'>{r.zoneCode}</div>
                    <div className='text-xs text-ink-2'>
                      {live.isClosedToVendors ? 'closed to vendors' : 'open'}
                    </div>
                  </TD>
                  <TD className='text-right'>
                    <Input
                      aria-label={`${r.zoneCode} expected crowd`}
                      type='number'
                      min={0}
                      className='w-24 text-right'
                      value={r.expectedCrowd}
                      disabled={!writable}
                      onChange={(e) => setRow(i, { expectedCrowd: e.target.value })}
                    />
                  </TD>
                  <TD
                    className={cn(
                      'text-right tabular-nums',
                      total < suggested ? 'text-warn' : 'text-ink-2',
                    )}
                  >
                    {suggested}
                  </TD>
                  {STALL_CATEGORIES.map((c) => (
                    <TD key={c} className='text-right'>
                      <Input
                        aria-label={`${r.zoneCode} ${CAT_LABEL[c]}`}
                        type='number'
                        min={0}
                        className='w-16 text-right'
                        value={r.counts[c]}
                        disabled={!writable}
                        onChange={(e) => setCount(i, c, e.target.value)}
                      />
                    </TD>
                  ))}
                  <TD className='text-right font-semibold tabular-nums'>{total}</TD>
                  <TD
                    className={cn(
                      'text-right tabular-nums',
                      total < live.stallsExisting && 'text-warn',
                    )}
                  >
                    {live.stallsExisting}
                  </TD>
                  <TD className='text-right tabular-nums'>{live.stallsAllocated}</TD>
                </TR>
              );
            })}
            <TR className='bg-surface-2 font-semibold'>
              <TD>Total</TD>
              <TD className='text-right tabular-nums'>
                {draft.rows.reduce((t, r) => t + n(r.expectedCrowd), 0).toLocaleString('en-IN')}
              </TD>
              <TD className='text-right tabular-nums text-ink-2'>
                {draft.rows.reduce((t, r) => t + suggestStallCount(n(r.expectedCrowd), divisor), 0)}
              </TD>
              {STALL_CATEGORIES.map((c) => (
                <TD key={c} className='text-right tabular-nums'>
                  {colTotal(c)}
                </TD>
              ))}
              <TD className='text-right tabular-nums' data-testid='grand-total'>
                {grand}
              </TD>
              <TD className='text-right tabular-nums'>
                {data.rows.reduce((t, r) => t + r.stallsExisting, 0)}
              </TD>
              <TD className='text-right tabular-nums'>
                {data.rows.reduce((t, r) => t + r.stallsAllocated, 0)}
              </TD>
            </TR>
          </TBody>
        </Table>
      </Card>

      <Dialog
        open={confirmApply}
        onClose={() => setConfirmApply(false)}
        title='Apply this plan?'
        description='Stall numbers are generated to match the counts above. Stalls holding a live allocation are never removed.'
        footer={
          <>
            <Button variant='outline' onClick={() => setConfirmApply(false)}>
              Back
            </Button>
            <Button onClick={apply}>Apply</Button>
          </>
        }
      >
        {shrinking && (
          <p className='rounded-md bg-warn-soft px-3 py-2 text-sm text-warn'>
            At least one zone now plans fewer stalls than exist. Surplus available stalls will be
            removed; allocated ones are kept and reported.
          </p>
        )}
        {dirty && <p className='mt-2 text-sm text-ink-2'>Unsaved changes will be saved first.</p>}
      </Dialog>
    </div>
  );
}
