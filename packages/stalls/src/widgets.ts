// Home, as data.
//
// The landing used to be `Dashboard.tsx`: one fixed shape, four groups of tiles,
// the same for a finance officer and for the volunteer who does nothing but
// count chairs. Adding a card meant editing that file, and what a person saw was
// decided by nothing at all.
//
// A card is declared here once — label, size, and the privilege it reads on. The
// API holds a loader per key, the web a component per key, and an admin decides
// the rest on Configs › Home Page.
//
// ⚠️ **A widget declares no roles**, for the same reason a nav item declares
// none: a card is offered to whoever holds the privilege that opens the data
// behind it, and to nobody else. A `defaultRoles` list beside the privileges is
// a second opinion about who a role is, and the two disagree silently — always
// by withholding.
import type { StallPrivilege } from './rbac';

/**
 * How much of its ROW a card occupies, in sixths.
 *
 * Cards pack into rows of six columns, and each row then shares its full width
 * in proportion to the spans on it — so a `half` beside a `third` reads 3:2
 * rather than leaving the sixth column empty. A card alone on a row takes the
 * whole row, whatever it declared.
 */
export type WidgetSpan = 'full' | 'half' | 'third';

export const SPAN_COLUMNS: Record<WidgetSpan, number> = { full: 6, half: 3, third: 2 };

export interface WidgetDef {
  key: string;
  label: string;
  /** Written for the admin choosing cards, not for the developer adding one. */
  description: string;
  glyph: string;
  span: WidgetSpan;
  /**
   * Privilege the card reads on. A LIST means any-of, exactly as a nav item's.
   *
   * Absent means there is nothing to gate — the card reads only what the caller
   * may already see, or nothing at all.
   */
  privilege?: StallPrivilege | StallPrivilege[];
  /** Where the card's header link goes. */
  to?: string;
}

/**
 * The catalog, in the order the config screen lists it and the order a role
 * nobody has arranged receives it: what came in, what was decided, where it
 * sits, what is owed, and then the day itself.
 */
export const WIDGETS: readonly WidgetDef[] = [
  {
    key: 'requests_summary',
    label: 'Request Pipeline',
    description: 'Total requests filed this edition, and how many sit at each status.',
    glyph: 'clipboard-list',
    span: 'full',
    privilege: 'requests.read',
    to: '/m/stalls/requests',
  },
  {
    key: 'requests_by_type',
    label: 'Requests by Type',
    description: 'Vendor, local welfare and ashram counts, each linking to its filtered list.',
    glyph: 'ticket',
    span: 'half',
    privilege: 'requests.read',
    to: '/m/stalls/requests',
  },
  {
    key: 'follow_ups',
    label: 'Flagged for Follow-Up',
    description: 'Requests somebody marked for a call back, with the count outstanding.',
    glyph: 'alert-triangle',
    span: 'third',
    privilege: 'requests.read',
    to: '/m/stalls/requests?flagged=true',
  },
  {
    key: 'stalls_allocation',
    label: 'Bays & Allocation',
    description: 'Stalls planned against stalls allocated, for the active edition.',
    glyph: 'layers',
    span: 'third',
    // Either reader: a coordinator planning the grid, or an admin who set the
    // bays. Both are looking at the same two numbers.
    privilege: ['planning.read', 'config.read'],
    to: '/m/stalls/planning',
  },
  {
    key: 'onboarding_progress',
    label: 'Onboarding Progress',
    description: 'How many selected stalls still owe bank details, payment, FSSAI or staff.',
    glyph: 'arrow-left-right',
    span: 'half',
    privilege: 'onboarding.read',
    to: '/m/stalls/onboarding',
  },
  {
    key: 'finance_summary',
    label: 'Collections',
    description: 'Quoted, collected and outstanding for the active edition.',
    glyph: 'rupee',
    span: 'half',
    privilege: 'finance.read',
    to: '/m/stalls/finance',
  },
  {
    key: 'checkin_status',
    label: 'Check-In',
    description: 'Checked in against still expected, on the day.',
    glyph: 'circle-check',
    span: 'third',
    privilege: 'checkin.read',
    to: '/m/stalls/checkin',
  },
  {
    key: 'equipment_counts',
    label: 'Chairs & Tables',
    description: 'Issued, returned and damaged counts across both items.',
    glyph: 'layout-grid',
    span: 'third',
    privilege: 'equipment.read',
    to: '/m/stalls/equipment',
  },
  {
    key: 'quick_links',
    label: 'Quick Links',
    description: 'The screens this person can open, as tiles. Never empty, never gated.',
    glyph: 'list-view',
    span: 'full',
    // No privilege: the tiles are the caller's OWN nav, already filtered. A card
    // that can show nothing more than the sidebar beside it can show is the one
    // card that never needs gating.
  },
];

export const WIDGET_BY_KEY = new Map(WIDGETS.map((w) => [w.key, w]));

/** Where a card sits in the catalog — the tie-break for two equal ordinals. */
const REGISTRY_INDEX = new Map(WIDGETS.map((w, n) => [w.key, n]));

export const widgetIndex = (key: string): number => REGISTRY_INDEX.get(key) ?? WIDGETS.length;

/** True when the caller holds any privilege the card accepts. Takes `can`, not a
 *  list, for the reason `navItemAllows` does: a write implies its read. */
export function widgetAllows(w: WidgetDef, can: (p: StallPrivilege) => boolean): boolean {
  if (!w.privilege) return true;
  return Array.isArray(w.privilege) ? w.privilege.some(can) : can(w.privilege);
}

/** Every card these privileges reach — the home page before anyone arranges it,
 *  and the list the config screen offers. */
export const defaultWidgetsFor = (can: (p: StallPrivilege) => boolean): WidgetDef[] =>
  WIDGETS.filter((w) => widgetAllows(w, can));

export const configurableWidgets = defaultWidgetsFor;

/** One row of `stall_role_home_widget`, as the resolver takes it. */
export interface RoleWidgetRow {
  roleKey: string;
  widgetKey: string;
  ordinal: number;
  isShown: boolean;
}

/**
 * The cards this caller's home page shows, in order.
 *
 * Pure, for the same reason `resolveNav` is, and with the same three rules: an
 * unarranged role takes the registry defaults; two roles union at each card's
 * best position, so a second role never costs a card the first one showed; and
 * 🔴 the privilege filter runs LAST, so configuration can narrow what a role
 * sees and never widen it.
 */
export function resolveWidgets(
  roleKeys: string[],
  can: (p: StallPrivilege) => boolean,
  rows: RoleWidgetRow[],
): WidgetDef[] {
  const byRole = new Map<string, RoleWidgetRow[]>();
  for (const r of rows) {
    const list = byRole.get(r.roleKey);
    if (list) list.push(r);
    else byRole.set(r.roleKey, [r]);
  }

  const best = new Map<string, number>();
  const place = (key: string, ordinal: number) => {
    const seen = best.get(key);
    if (seen === undefined || ordinal < seen) best.set(key, ordinal);
  };

  for (const roleKey of roleKeys) {
    const configured = byRole.get(roleKey);
    if (configured?.length) {
      for (const r of configured) {
        if (r.isShown && WIDGET_BY_KEY.has(r.widgetKey)) place(r.widgetKey, r.ordinal);
      }
    } else {
      for (const w of defaultWidgetsFor(can)) place(w.key, widgetIndex(w.key));
    }
  }

  return [...best.entries()]
    .sort((a, b) => a[1] - b[1] || widgetIndex(a[0]) - widgetIndex(b[0]))
    .flatMap(([key]) => {
      const def = WIDGET_BY_KEY.get(key);
      return def && widgetAllows(def, can) ? [def] : [];
    });
}

/**
 * Cards packed into rows of six columns.
 *
 * ⚠️ A row is closed when the next card would overflow it, NOT when it is
 * exactly full — a `third` after two `half`s starts a new row rather than being
 * squeezed into a column that is not there. Each row then shares the full width
 * in proportion to the spans actually on it, which is why the caller gets the
 * row back rather than a column count.
 */
export function packWidgetRows<T extends { span: WidgetSpan }>(widgets: T[]): T[][] {
  const rows: T[][] = [];
  let row: T[] = [];
  let used = 0;

  for (const w of widgets) {
    const span = SPAN_COLUMNS[w.span];
    if (used + span > SPAN_COLUMNS.full && row.length > 0) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(w);
    used += span;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}
