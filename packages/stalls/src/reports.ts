// The report catalog — what Reports & Dashboards offers, and who may open each.
//
// A report is a TABLE with a title, not a screen: the API turns a key into
// columns and rows, the hub lists whatever the caller may open, and one viewer
// renders any of them. That is the whole reason this is a registry — adding a
// report is a loader and an entry, never a route and a component.
//
// ⚠️ Export is gated on the same privileges as the view, deliberately. The
// vocabulary has an `export` KIND and no export CODE, and inventing one here
// would be a privilege no route enforces until somebody wires it — the failure
// `rbac.ts` spends a paragraph on. Whoever may read the numbers may take them
// away with them; if that ever stops being true, it becomes a code with a guard,
// not a flag on a row.
import type { StallPrivilege } from './rbac';

export const REPORT_GROUPS = ['Requests & Selection', 'Onboarding & Money', 'Event Day'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];

export interface ReportDef {
  key: string;
  title: string;
  /** One line, for the hub tile and the viewer's subheading. */
  note: string;
  group: ReportGroup;
  glyph: string;
  /** Any-of. Holding one of these opens the report. */
  viewPrivileges: readonly StallPrivilege[];
}

export const REPORT_CATALOG: readonly ReportDef[] = [
  {
    key: 'requests_by_status',
    title: 'Requests by Status',
    note: 'Every status against every requester type, with the row and column totals.',
    group: 'Requests & Selection',
    glyph: 'clipboard-list',
    viewPrivileges: ['requests.read'],
  },
  {
    key: 'requests_by_zone',
    title: 'Requests by Bay',
    note: 'What each bay was asked for, what it was agreed for, and how many stalls it holds.',
    group: 'Requests & Selection',
    glyph: 'map-pin',
    viewPrivileges: ['requests.read', 'planning.read'],
  },
  {
    key: 'selection_funnel',
    title: 'Selection Funnel',
    note: 'Submitted, shortlisted, selected and backup, by requester type.',
    group: 'Requests & Selection',
    glyph: 'target',
    viewPrivileges: ['requests.read', 'selection.read'],
  },
  {
    key: 'onboarding_progress',
    title: 'Onboarding Progress',
    note: 'Selected stalls against each phase-2 and phase-3 step they still owe.',
    group: 'Onboarding & Money',
    glyph: 'arrow-left-right',
    viewPrivileges: ['onboarding.read'],
  },
  {
    key: 'collections',
    title: 'Collections & Dues',
    note: 'Quoted, confirmed and outstanding by requester type, in rupees.',
    group: 'Onboarding & Money',
    glyph: 'rupee',
    viewPrivileges: ['finance.read'],
  },
  {
    key: 'call_outcomes',
    title: 'Call Outcomes',
    note: 'How the reminder calls went, counted by what the caller recorded.',
    group: 'Onboarding & Money',
    glyph: 'phone-call',
    viewPrivileges: ['comms.read'],
  },
  {
    key: 'checkin_status',
    title: 'Check-In Status',
    note: 'Checked in against expected, by bay, for the active edition.',
    group: 'Event Day',
    glyph: 'circle-check',
    viewPrivileges: ['checkin.read'],
  },
  {
    key: 'equipment_ledger',
    title: 'Chairs & Tables Ledger',
    note: 'Issued, returned and damaged for each item, by bay.',
    group: 'Event Day',
    glyph: 'layout-grid',
    viewPrivileges: ['equipment.read'],
  },
];

export const REPORT_BY_KEY = new Map(REPORT_CATALOG.map((r) => [r.key, r]));

export const reportAllows = (r: ReportDef, can: (p: StallPrivilege) => boolean): boolean =>
  r.viewPrivileges.some(can);

/** The reports this caller may open, in catalog order. */
export const reportsFor = (can: (p: StallPrivilege) => boolean): ReportDef[] =>
  REPORT_CATALOG.filter((r) => reportAllows(r, can));

/** The catalog as the hub draws it: groups in registry order, empty ones gone. */
export function reportGroupsFor(
  can: (p: StallPrivilege) => boolean,
): Array<{ group: ReportGroup; reports: ReportDef[] }> {
  return REPORT_GROUPS.map((group) => ({
    group,
    reports: reportsFor(can).filter((r) => r.group === group),
  })).filter((g) => g.reports.length > 0);
}

/** How a column is drawn and totalled. `money` is paise on the wire and rupees
 *  on the screen — the module holds every amount in paise and converts once. */
export type ReportColumnKind = 'text' | 'number' | 'money';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
}

/** One report, rendered. Rows are keyed by column key; a missing key is an empty
 *  cell rather than a zero, because "no rows" and "zero" are different answers. */
export interface ReportView {
  key: string;
  title: string;
  note: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** The edition these numbers are for, so a stale tab says which year it shows. */
  editionLabel: string;
  /** Totals row, when the report has one. Same keys as a row. */
  total?: Record<string, string | number | null>;
}

/** A report as a CSV body — the same table, for a spreadsheet.
 *
 *  ⚠️ Money is written in RUPEES, not paise: a column headed "Collected" whose
 *  cells are a hundred times the figure on the screen is a spreadsheet somebody
 *  will circulate. */
export function reportCsv(view: ReportView): string {
  const cell = (v: string | number | null | undefined, kind: ReportColumnKind): string => {
    if (v === null || v === undefined) return '';
    const text = kind === 'money' && typeof v === 'number' ? (v / 100).toFixed(2) : String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [view.columns.map((c) => cell(c.label, 'text')).join(',')];
  for (const row of view.rows) {
    lines.push(view.columns.map((c) => cell(row[c.key], c.kind)).join(','));
  }
  const total = view.total;
  if (total) {
    lines.push(view.columns.map((c) => cell(total[c.key], c.kind)).join(','));
  }
  return `${lines.join('\n')}\n`;
}
