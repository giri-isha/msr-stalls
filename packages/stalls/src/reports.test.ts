import { describe, expect, it } from 'vitest';
import { can, type StallPrivilege } from './rbac';
import {
  REPORT_CATALOG,
  REPORT_GROUPS,
  reportCsv,
  reportGroupsFor,
  reportsFor,
  type ReportView,
} from './reports';
import { CONFIG_TABS, CONFIG_TABS_ANY, configTabsFor } from './config-tabs';

const canFrom =
  (held: string[]) =>
  (p: StallPrivilege): boolean =>
    can(held, p);

describe('the report catalog', () => {
  it('keys every report once and names a group that exists', () => {
    expect(new Set(REPORT_CATALOG.map((r) => r.key)).size).toBe(REPORT_CATALOG.length);
    for (const r of REPORT_CATALOG) expect(REPORT_GROUPS).toContain(r.group);
  });

  it('gates every report on at least one privilege', () => {
    for (const r of REPORT_CATALOG) expect(r.viewPrivileges.length, r.key).toBeGreaterThan(0);
  });

  it('offers a finance officer their report and nobody else’s', () => {
    expect(reportsFor(canFrom(['finance.read'])).map((r) => r.key)).toEqual(['collections']);
  });

  it('offers nothing to a caller who holds nothing, rather than an empty hub of headings', () => {
    expect(reportGroupsFor(canFrom([]))).toEqual([]);
  });

  it('drops a group whose reports the caller cannot open', () => {
    const groups = reportGroupsFor(canFrom(['checkin.read']));
    expect(groups.map((g) => g.group)).toEqual(['Event Day']);
    expect(groups[0].reports.map((r) => r.key)).toEqual(['checkin_status']);
  });
});

describe('the CSV', () => {
  const view: ReportView = {
    key: 'k',
    title: 'T',
    note: 'n',
    editionLabel: 'Mahashivarathri 2026',
    columns: [
      { key: 'name', label: 'Bay', kind: 'text' },
      { key: 'n', label: 'Stalls', kind: 'number' },
      { key: 'amt', label: 'Collected', kind: 'money' },
    ],
    rows: [
      { name: 'A1', n: 4, amt: 250000 },
      { name: 'Food, north', n: 2, amt: null },
    ],
    total: { name: 'Total', n: 6, amt: 250000 },
  };

  /** ⚠️ Rupees, not paise. A column headed "Collected" whose cells are a hundred
   *  times the figure on the screen is a spreadsheet somebody will circulate. */
  it('writes money in rupees and leaves a missing cell empty', () => {
    expect(reportCsv(view).split('\n')).toEqual([
      'Bay,Stalls,Collected',
      'A1,4,2500.00',
      '"Food, north",2,',
      'Total,6,2500.00',
      '',
    ]);
  });

  it('quotes a cell holding a quote, a comma or a newline', () => {
    const csv = reportCsv({
      ...view,
      rows: [{ name: 'He said "hi"', n: 1, amt: 0 }],
      total: undefined,
    });
    expect(csv.split('\n')[1]).toBe('"He said ""hi""",1,0.00');
  });

  it('writes the header alone when the report found no rows', () => {
    expect(reportCsv({ ...view, rows: [], total: undefined })).toBe('Bay,Stalls,Collected\n');
  });
});

describe('the Configs strip', () => {
  it('names the tabs in the order the strip reads', () => {
    expect(CONFIG_TABS.map((t) => t.label)).toEqual([
      'Home Page',
      'Sidebar Layout',
      'Form Builder',
      'Call Log Form',
      'Declarations',
      'Flow',
      'Editions',
    ]);
  });

  /**
   * 🔴 The shell accepts exactly the union of its tabs. Narrower and somebody
   * holds a tab but is refused the screen carrying it; wider and the sidebar
   * offers a screen with nothing on it.
   */
  it('opens for exactly the people who hold a tab', () => {
    const union = [...new Set(CONFIG_TABS.flatMap((t) => t.privileges))].sort();
    expect([...CONFIG_TABS_ANY].sort()).toEqual(union);
    expect(configTabsFor(canFrom([]))).toEqual([]);
    expect(configTabsFor(canFrom(['config.read']))).toHaveLength(CONFIG_TABS.length);
  });

  it('lets the write alone in — config.write implies config.read', () => {
    expect(configTabsFor(canFrom(['config.write']))).toHaveLength(CONFIG_TABS.length);
  });
});
