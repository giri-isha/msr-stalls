// The sidebar, as data.
//
// 🔴 **The nav used to be a `STALLS_NAV` array inside the web module.** That was
// fine while the only question was "does this caller hold the privilege" — the
// browser knows that from `/me`. It stopped being fine the moment an admin could
// arrange the sidebar per role: the arrangement lives in a table, the table is
// read by the API, and an API that has to answer "what does this person see"
// cannot import a React module to find out.
//
// So the registry is here, beside the privilege vocabulary it gates on, and both
// readers go through the same two functions. What survives in the web module is
// the RENDERING.
//
// ⚠️ An item declares no roles. It declares the privileges that open the screen
// behind it, and who may see the link is exactly who may open the screen — the
// same rule the reference module arrived at after a `defaultRoles` list spent a
// release disagreeing with the privileges a role actually held.
import { CONFIG_TABS_ANY } from './config-tabs';
import type { StallPrivilege } from './rbac';

/** A heading in the sidebar, and the unit a whole block of items moves by. */
export interface NavCategoryDef {
  key: string;
  label: string;
  /** Where the block sits before an admin moves it. */
  ordinal: number;
  /** Shipped with the module: it may be re-labelled and re-ordered, never deleted. */
  builtIn: boolean;
}

/**
 * The headings, in the order the event runs: what you look at, then the
 * requests, then the money, then the day itself, then the machinery.
 */
export const NAV_CATEGORIES: readonly NavCategoryDef[] = [
  { key: 'c_overview', label: 'Overview', ordinal: 0, builtIn: true },
  { key: 'c_requests', label: 'Requests & Selection', ordinal: 1, builtIn: true },
  { key: 'c_onboarding', label: 'Onboarding & Money', ordinal: 2, builtIn: true },
  { key: 'c_ops', label: 'Event Operations', ordinal: 3, builtIn: true },
  { key: 'c_config', label: 'Configuration', ordinal: 4, builtIn: true },
  { key: 'c_access', label: 'Access', ordinal: 5, builtIn: true },
  { key: 'c_help', label: 'Help', ordinal: 6, builtIn: true },
];

export interface NavItemDef {
  /** Stable id, and what a config row stores. Never the label, which is editable. */
  key: string;
  /** The path the host mounts this module under, plus the item's own segment. */
  to: string;
  label: string;
  /**
   * A NAME from the web's icon registry, never a component.
   *
   * ⚠️ The nav is data the API now SERVES, and a glyph imported here would put a
   * React element on the wire. An unknown name draws a generic dot rather than
   * throwing, so a typo is visible without being fatal.
   */
  glyph: string;
  /** Sub-caption, on the hub tiles and in the config screen's list. */
  meta: string;
  /** The heading this item lands under until an admin moves it. */
  category: string;
  /** Matches only the exact path — the landing, which every other path extends. */
  end?: boolean;
  /**
   * Hidden unless the caller holds this privilege — or, given several, ANY of
   * them.
   *
   * ⚠️ A list, because a screen can be reached by two people for two reasons:
   * a coordinator opens Planning & Zones to plan stalls (`planning.read`) and an
   * admin opens it to set the bays and the rate card (`config.read`). One entry
   * gated on either is the honest description; the screen gates its own tabs.
   *
   * Absent means everybody, and exactly two items are: Home, which is where a
   * caller lands and whose cards gate themselves, and Documentation.
   */
  requires?: StallPrivilege | StallPrivilege[];
}

/**
 * The catalog — the order the config screen lists it in, and the order a role
 * nobody has arranged receives it.
 */
export const NAV_ITEMS: readonly NavItemDef[] = [
  {
    key: 'home',
    to: '/m/stalls',
    label: 'Home',
    glyph: 'home',
    meta: 'Your cards, for this edition',
    category: 'c_overview',
    end: true,
    // ⚠️ No `requires`, where the Dashboard this replaced carried
    // `requests.read`. Home is where every signed-in member lands, and its cards
    // each gate themselves — a landing the shell refuses is indistinguishable
    // from an app that is broken. A caller whose privileges reach no card gets a
    // sentence saying so, which is the true answer.
  },
  {
    key: 'dashboards',
    to: '/m/stalls/dashboards',
    label: 'Reports & Dashboards',
    glyph: 'bar-chart',
    meta: 'KPIs, reports and exports',
    category: 'c_overview',
    // Any of the five readers whose numbers the hub carries. The hub itself
    // shows each of them only the reports they hold.
    requires: ['requests.read', 'planning.read', 'finance.read', 'checkin.read', 'equipment.read'],
  },
  {
    key: 'requests',
    to: '/m/stalls/requests',
    label: 'All Requests',
    glyph: 'list-view',
    meta: 'The whole pipeline',
    category: 'c_requests',
    requires: 'requests.read',
  },
  {
    key: 'planning',
    to: '/m/stalls/planning',
    label: 'Planning & Zones',
    glyph: 'layers',
    meta: 'Bays · Grid · Rates · Charges',
    category: 'c_requests',
    requires: ['planning.read', 'config.read'],
  },
  {
    key: 'communication',
    to: '/m/stalls/communication',
    label: 'Communication',
    glyph: 'megaphone',
    meta: 'Letters · Calls · Templates',
    category: 'c_onboarding',
    requires: 'comms.read',
  },
  {
    key: 'onboarding',
    to: '/m/stalls/onboarding',
    label: 'Vendor Onboarding',
    glyph: 'clipboard-list',
    meta: 'Bank · Payment · FSSAI · Staff',
    category: 'c_onboarding',
    requires: 'onboarding.read',
  },
  {
    key: 'finance',
    to: '/m/stalls/finance',
    label: 'Finance',
    glyph: 'rupee',
    meta: 'Claims · Collections · Refunds',
    category: 'c_onboarding',
    requires: 'finance.read',
  },
  {
    key: 'electrical',
    to: '/m/stalls/electrical',
    label: 'Electrical & Venue',
    glyph: 'sliders',
    meta: 'Load sheet and venue prep',
    category: 'c_ops',
    requires: 'electrical.read',
  },
  {
    key: 'checkin',
    to: '/m/stalls/checkin',
    label: 'Check-In',
    glyph: 'circle-check',
    meta: 'Arrivals on the day',
    category: 'c_ops',
    requires: 'checkin.read',
  },
  {
    key: 'equipment',
    to: '/m/stalls/equipment',
    label: 'Chairs & Tables',
    glyph: 'layout-grid',
    meta: 'Issued · Returned · Damaged',
    category: 'c_ops',
    requires: 'equipment.read',
  },
  {
    key: 'config',
    to: '/m/stalls/config',
    label: 'Configs',
    glyph: 'settings',
    meta: 'Home · Sidebar · Forms · Flow · Editions',
    category: 'c_config',
    // The union its tabs accept, so the link and the screen can never disagree
    // about who may open it — see `CONFIG_TABS_ANY`.
    requires: [...CONFIG_TABS_ANY],
  },
  // ⚠️ Gated on `config.read`, not on `roles.write` or `users.write`. Both
  // screens are readable before they are writable — the catalogue is reference
  // material and the directory names who holds what — and each hides its own
  // writes behind the privilege that authorises them.
  {
    key: 'access_roles',
    to: '/m/stalls/access/roles',
    label: 'Roles & Privileges',
    glyph: 'shield',
    meta: 'What each role may do',
    category: 'c_access',
    requires: 'config.read',
  },
  {
    key: 'access_users',
    to: '/m/stalls/access/users',
    label: 'Users',
    glyph: 'users',
    meta: 'Who holds which role',
    category: 'c_access',
    requires: 'config.read',
  },
  {
    key: 'audit',
    to: '/m/stalls/audit',
    label: 'Audit Logs',
    glyph: 'scroll',
    meta: 'Every privileged action',
    category: 'c_access',
    // ⚠️ Its own `sensitive` privilege, not the `config.read` the two screens
    // above take: the log shows change sets, including what a bank form said
    // before it was corrected.
    requires: 'audit.read',
  },
  {
    key: 'docs',
    to: '/m/stalls/docs',
    label: 'Documentation',
    glyph: 'file-text',
    meta: 'How the module works',
    category: 'c_help',
    // No `requires`. The manual is the one screen everybody gets: a volunteer
    // who holds only `checkin.write` is exactly the reader who has never seen
    // the rest of the pipeline and most needs to know where their counter sits.
  },
];

export const NAV_ITEM_BY_KEY = new Map(NAV_ITEMS.map((i) => [i.key, i]));

/** Where an item sits in the catalog — the tie-break for two equal ordinals. */
const REGISTRY_INDEX = new Map(NAV_ITEMS.map((i, n) => [i.key, n]));

export const navItemIndex = (key: string): number => REGISTRY_INDEX.get(key) ?? NAV_ITEMS.length;

/**
 * Stored keys written before an item was renamed or merged away.
 *
 * ⚠️ Not tidiness — the migration. A role with ANY rows is fully described by
 * them, which is the rule that stops a newly added screen appearing unannounced
 * in a sidebar an admin arranged. Read under that rule, a renamed key would take
 * the link AWAY from every role that had arranged it. Old keys read as the new
 * one instead, and the next save writes the new one.
 *
 * `admin` is the whole of it today: the Admin screen's five tabs are five tabs
 * of Configs now, and a role that had arranged Admin means Configs.
 */
export const LEGACY_NAV_ITEM_KEYS: Readonly<Record<string, string>> = { admin: 'config' };

export const canonicalNavItemKey = (key: string): string => LEGACY_NAV_ITEM_KEYS[key] ?? key;

/** True when the caller holds any privilege the item accepts.
 *
 *  🔴 Takes a `can` predicate rather than a privilege LIST. A write implies its
 *  read (`IMPLIED_READ` in `rbac.ts`), so a plain `privileges.includes(...)`
 *  hides a screen from the one person it is for — the sidebar did exactly that
 *  until the two readers were made to share this function. */
export function navItemAllows(item: NavItemDef, can: (p: StallPrivilege) => boolean): boolean {
  if (!item.requires) return true;
  return Array.isArray(item.requires) ? item.requires.some(can) : can(item.requires);
}

/** Every item these privileges reach — the sidebar before anyone arranges it,
 *  and the list the config screen offers. One function, because a config screen
 *  offering a row that could never show is a toggle that lies. */
export const defaultNavItemsFor = (can: (p: StallPrivilege) => boolean): NavItemDef[] =>
  NAV_ITEMS.filter((i) => navItemAllows(i, can));

export const configurableNavItems = defaultNavItemsFor;

/** One row of `stall_role_nav_item`, as the resolver takes it. */
export interface RoleNavRow {
  roleKey: string;
  itemKey: string;
  categoryKey: string;
  ordinal: number;
  isShown: boolean;
}

/** One row of `stall_nav_category` — a built-in re-labelled, or one an admin added. */
export interface NavCategoryRow {
  key: string;
  label: string;
  ordinal: number;
}

/** What the shell renders. `to` and `end` rather than a route key: this module's
 *  nav has always carried paths, and the host mounts it at a path it knows. */
export interface ResolvedNavItem {
  key: string;
  to: string;
  label: string;
  glyph: string;
  meta: string;
  end?: boolean;
}

export interface ResolvedNavGroup {
  /** The heading. Rendered as a rule rather than a word when the sidebar is a rail. */
  title: string;
  items: ResolvedNavItem[];
}

/**
 * The category catalog: the built-ins with any re-label applied, plus whatever
 * an admin added. Sorted by ordinal then label, so the order is total and two
 * categories that share an ordinal do not swap places between requests.
 */
export function navCategories(rows: NavCategoryRow[]): NavCategoryDef[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const seen = new Set<string>();
  const out: NavCategoryDef[] = [];

  for (const c of NAV_CATEGORIES) {
    seen.add(c.key);
    const row = byKey.get(c.key);
    out.push(row ? { ...c, label: row.label, ordinal: row.ordinal } : c);
  }
  for (const r of rows) {
    if (seen.has(r.key)) continue;
    out.push({ key: r.key, label: r.label, ordinal: r.ordinal, builtIn: false });
  }

  return out.sort((a, b) => a.ordinal - b.ordinal || a.label.localeCompare(b.label));
}

/** One placed item, before the placements are chunked into headings. */
interface Placement {
  itemKey: string;
  categoryKey: string;
  ordinal: number;
}

/**
 * The sidebar this caller sees, in order.
 *
 * Pure, so the rule that decides what a person sees is testable without a
 * database. Four things are load-bearing:
 *
 * - A role with NO rows takes the registry defaults, which is what lets an item
 *   added in a later release reach every role nobody has arranged. A role WITH
 *   rows is fully described by them, so a new item arrives HIDDEN there rather
 *   than appearing unannounced in a sidebar somebody chose.
 * - Roles are unioned at each item's best position, so holding a second role
 *   never costs a link the first one showed. The heading comes from whichever
 *   role placed the item best, so an item and its heading stay together.
 * - Heading order is the order headings FIRST APPEAR, never a stored second
 *   opinion that could contradict the item order.
 * - 🔴 The privilege filter runs LAST. Configuration narrows what a role sees;
 *   it can never widen it, whatever is written in the table.
 */
export function resolveNav(
  roleKeys: string[],
  can: (p: StallPrivilege) => boolean,
  rows: RoleNavRow[],
  categories: NavCategoryRow[],
): ResolvedNavGroup[] {
  const byRole = new Map<string, RoleNavRow[]>();
  for (const r of rows) {
    const list = byRole.get(r.roleKey);
    if (list) list.push(r);
    else byRole.set(r.roleKey, [r]);
  }

  const catalog = navCategories(categories);
  const catOrder = new Map(catalog.map((c, n) => [c.key, n]));
  const labelOf = new Map(catalog.map((c) => [c.key, c.label]));

  const best = new Map<string, Placement>();
  const place = (itemKey: string, categoryKey: string, ordinal: number) => {
    if (!NAV_ITEM_BY_KEY.has(itemKey)) return;
    const seen = best.get(itemKey);
    if (!seen || ordinal < seen.ordinal) best.set(itemKey, { itemKey, categoryKey, ordinal });
  };

  for (const roleKey of roleKeys) {
    const configured = byRole
      .get(roleKey)
      ?.map((r) => ({ ...r, itemKey: canonicalNavItemKey(r.itemKey) }))
      .filter((r) => NAV_ITEM_BY_KEY.has(r.itemKey));
    if (configured?.length) {
      for (const r of configured) if (r.isShown) place(r.itemKey, r.categoryKey, r.ordinal);
    } else {
      // An unarranged role is ordered by the CATALOG, not by the registry alone,
      // so moving a heading also moves it for every role nobody has touched.
      for (const def of defaultNavItemsFor(can)) {
        const block = (catOrder.get(def.category) ?? catalog.length) * NAV_ITEMS.length;
        place(def.key, def.category, block + navItemIndex(def.key));
      }
    }
  }

  // Paired with its definition once, here, rather than looked up again at every
  // step below — `place` has already refused a key the registry does not have,
  // so this is the last point at which the pairing can be lost.
  const placed = [...best.values()]
    .flatMap((p) => {
      const def = NAV_ITEM_BY_KEY.get(p.itemKey);
      return def && navItemAllows(def, can) ? [{ ...p, def }] : [];
    })
    .sort((a, b) => a.ordinal - b.ordinal || navItemIndex(a.itemKey) - navItemIndex(b.itemKey));

  // Order of first appearance, so moving a heading means moving its items. A
  // placement naming a heading that has since been deleted would otherwise
  // vanish in silence, so it falls back to the item's registry category.
  const groups = new Map<string, ResolvedNavItem[]>();
  for (const { def, ...p } of placed) {
    const key = labelOf.has(p.categoryKey) ? p.categoryKey : def.category;
    const entry: ResolvedNavItem = {
      key: def.key,
      to: def.to,
      label: def.label,
      glyph: def.glyph,
      meta: def.meta,
      ...(def.end ? { end: true } : {}),
    };
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  return [...groups.entries()].map(([key, items]) => ({ title: labelOf.get(key) ?? key, items }));
}

/** The sidebar as it reads with nothing configured. The shell's fallback when
 *  it is mounted somewhere that does not serve a resolved nav. */
export const defaultNav = (can: (p: StallPrivilege) => boolean): ResolvedNavGroup[] =>
  resolveNav(['*'], can, [], []);
