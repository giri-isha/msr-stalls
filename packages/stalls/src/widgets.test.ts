import { describe, expect, it } from 'vitest';
import { can, type StallPrivilege } from './rbac';
import type { WidgetSpan } from './widgets';
import {
  SPAN_COLUMNS,
  WIDGETS,
  WIDGET_BY_KEY,
  defaultWidgetsFor,
  packWidgetRows,
  resolveWidgets,
  widgetAllows,
  type RoleWidgetRow,
} from './widgets';

const canFrom =
  (held: string[]) =>
  (p: StallPrivilege): boolean =>
    can(held, p);

const ALL = canFrom(WIDGETS.flatMap((w) => (w.privilege ? [w.privilege].flat() : [])));
const keys = (ws: ReturnType<typeof resolveWidgets>) => ws.map((w) => w.key);

describe('the catalog', () => {
  it('keys every card once', () => {
    expect(new Set(WIDGETS.map((w) => w.key)).size).toBe(WIDGETS.length);
  });

  /** A card that reads nothing needs no privilege; every card that reads
   *  somebody's figures declares the one that opens them. */
  it('leaves only Quick Links ungated', () => {
    expect(WIDGETS.filter((w) => !w.privilege).map((w) => w.key)).toEqual(['quick_links']);
  });

  /** Reads a card out of the catalog, failing loudly rather than at the
   *  assertion if the key was renamed out from under the test. */
  const card = (key: string) => {
    const def = WIDGET_BY_KEY.get(key);
    if (!def) throw new Error(`no widget ${key}`);
    return def;
  };

  it('shows an either-or card to somebody holding just one of its privileges', () => {
    const bays = card('stalls_allocation');
    expect(widgetAllows(bays, canFrom(['config.read']))).toBe(true);
    expect(widgetAllows(bays, canFrom(['planning.read']))).toBe(true);
    expect(widgetAllows(bays, canFrom(['comms.read']))).toBe(false);
  });

  it('honours a write that implies its read', () => {
    expect(widgetAllows(card('finance_summary'), canFrom(['finance.write']))).toBe(true);
  });

  it('gives a caller with nothing the one card that gates on nothing', () => {
    expect(defaultWidgetsFor(canFrom([])).map((w) => w.key)).toEqual(['quick_links']);
  });
});

describe('an arranged role', () => {
  const row = (
    o: Partial<RoleWidgetRow> & { widgetKey: string; ordinal: number },
  ): RoleWidgetRow => ({ roleKey: 'r1', isShown: true, ...o });

  it('is described by its rows alone — a card with no row stays hidden', () => {
    const got = resolveWidgets(['r1'], ALL, [
      row({ widgetKey: 'finance_summary', ordinal: 0 }),
      row({ widgetKey: 'quick_links', ordinal: 1 }),
    ]);
    expect(keys(got)).toEqual(['finance_summary', 'quick_links']);
  });

  it('honours the order the rows give, not the catalog order', () => {
    const got = resolveWidgets(['r1'], ALL, [
      row({ widgetKey: 'quick_links', ordinal: 0 }),
      row({ widgetKey: 'requests_summary', ordinal: 1 }),
    ]);
    expect(keys(got)).toEqual(['quick_links', 'requests_summary']);
  });

  it('drops a row whose toggle is off', () => {
    const got = resolveWidgets(['r1'], ALL, [
      row({ widgetKey: 'requests_summary', ordinal: 0 }),
      row({ widgetKey: 'finance_summary', ordinal: 1, isShown: false }),
    ]);
    expect(keys(got)).toEqual(['requests_summary']);
  });

  it('ignores a row naming a card the registry no longer has', () => {
    const got = resolveWidgets(['r1'], ALL, [row({ widgetKey: 'gone', ordinal: 0 })]);
    expect(keys(got)).toEqual([]);
  });

  /** 🔴 Configuration narrows; it never widens. */
  it('cannot show a card the caller has no privilege for', () => {
    const got = resolveWidgets(['r1'], canFrom([]), [
      row({ widgetKey: 'finance_summary', ordinal: 0 }),
    ]);
    expect(keys(got)).toEqual([]);
  });

  it('unions two roles at the best position', () => {
    const rows: RoleWidgetRow[] = [
      { roleKey: 'a', widgetKey: 'quick_links', ordinal: 9, isShown: true },
      { roleKey: 'b', widgetKey: 'quick_links', ordinal: 0, isShown: true },
      { roleKey: 'b', widgetKey: 'finance_summary', ordinal: 1, isShown: true },
    ];
    expect(keys(resolveWidgets(['a', 'b'], ALL, rows))).toEqual(['quick_links', 'finance_summary']);
  });
});

describe('packing cards into rows', () => {
  // ⚠️ Just a `span`, not a whole `WidgetDef`. `packWidgetRows` is generic over
  // anything carrying one, because the CLIENT packs the wire shape — the
  // registry's card plus this edition's figures — and a signature naming the
  // registry type would have made every caller cast.
  let n = 0;
  const w = (span: WidgetSpan) => ({ key: `${span}-${n++}`, span });

  it('fills a row and starts a new one', () => {
    const rows = packWidgetRows([w('half'), w('half'), w('third')]);
    expect(rows.map((r) => r.length)).toEqual([2, 1]);
  });

  /** ⚠️ A row closes when the NEXT card would overflow it, not when it is exactly
   *  full — a third after two halves starts a row rather than being squeezed
   *  into a column that is not there. */
  it('never puts more than six columns on one row', () => {
    for (const row of packWidgetRows([w('third'), w('third'), w('third'), w('half'), w('full')])) {
      const used = row.reduce((n, c) => n + SPAN_COLUMNS[c.span], 0);
      expect(used).toBeLessThanOrEqual(SPAN_COLUMNS.full);
    }
  });

  it('keeps every card, in order', () => {
    const given = [w('full'), w('third'), w('half'), w('half')];
    expect(packWidgetRows(given).flat()).toEqual(given);
  });

  it('returns nothing for nothing', () => {
    expect(packWidgetRows([])).toEqual([]);
  });
});
