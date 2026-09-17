import { describe, expect, it } from 'vitest';
import {
  NAV_CATEGORIES,
  NAV_ITEMS,
  NAV_ITEM_BY_KEY,
  canonicalNavItemKey,
  defaultNav,
  navCategories,
  navItemAllows,
  resolveNav,
  type RoleNavRow,
} from './nav';
import { can, type StallPrivilege } from './rbac';

/** `can`, bound to a privilege list — the same predicate the API and the web
 *  both build, so a write that implies a read is honoured here too. */
const canFrom =
  (held: string[]) =>
  (p: StallPrivilege): boolean =>
    can(held, p);

const ALL = canFrom(NAV_ITEMS.flatMap((i) => (i.requires ? [i.requires].flat() : [])));
const labels = (groups: ReturnType<typeof resolveNav>) =>
  groups.flatMap((g) => g.items.map((i) => i.label));

describe('the registry', () => {
  it('keys every item once, and names a category that exists', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.key)).size).toBe(NAV_ITEMS.length);
    const known = new Set(NAV_CATEGORIES.map((c) => c.key));
    for (const i of NAV_ITEMS) expect(known.has(i.category), i.key).toBe(true);
  });

  it('routes every item somewhere under the module, once', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.to)).size).toBe(NAV_ITEMS.length);
    for (const i of NAV_ITEMS) expect(i.to.startsWith('/m/stalls'), i.key).toBe(true);
  });

  /** The landing and the manual. Everything else is a screen the API can refuse,
   *  and an ungated link to one is a link that fails after the click. */
  it('gates every item but Home and Documentation', () => {
    const open = NAV_ITEMS.filter((i) => !i.requires).map((i) => i.key);
    expect(open).toEqual(['home', 'docs']);
  });

  it('reads a renamed key as the item that replaced it', () => {
    expect(canonicalNavItemKey('admin')).toBe('config');
    expect(canonicalNavItemKey('requests')).toBe('requests');
  });
});

describe('who sees what', () => {
  /** Reads an item out of the catalog, failing loudly rather than at the
   *  assertion if the key was renamed out from under the test. */
  const item = (key: string) => {
    const def = NAV_ITEM_BY_KEY.get(key);
    if (!def) throw new Error(`no nav item ${key}`);
    return def;
  };

  it('shows an either-or item to somebody holding just one of its privileges', () => {
    const planning = item('planning');
    expect(navItemAllows(planning, canFrom(['config.read']))).toBe(true);
    expect(navItemAllows(planning, canFrom(['planning.read']))).toBe(true);
    expect(navItemAllows(planning, canFrom(['finance.read']))).toBe(false);
  });

  /** 🔴 The bug that put this function in one place. A lead who was granted
   *  `planning.write` and never the read held the screen and lost the link. */
  it('shows an item to somebody who holds only the write that implies its read', () => {
    expect(navItemAllows(item('planning'), canFrom(['planning.write']))).toBe(true);
  });

  it('gives a caller with nothing the two ungated items', () => {
    expect(labels(defaultNav(canFrom([])))).toEqual(['Home', 'Documentation']);
  });

  it('groups the defaults under the registry headings, in catalog order', () => {
    const groups = defaultNav(ALL);
    expect(groups.map((g) => g.title)).toEqual(NAV_CATEGORIES.map((c) => c.label));
    expect(groups[0].items.map((i) => i.label)).toEqual(['Home', 'Reports & Dashboards']);
  });
});

describe('an arranged role', () => {
  const row = (o: Partial<RoleNavRow> & { itemKey: string; ordinal: number }): RoleNavRow => ({
    roleKey: 'r1',
    categoryKey: NAV_ITEM_BY_KEY.get(o.itemKey)?.category ?? 'c_overview',
    isShown: true,
    ...o,
  });

  it('is described by its rows alone — an item with no row stays hidden', () => {
    const groups = resolveNav(
      ['r1'],
      ALL,
      [row({ itemKey: 'requests', ordinal: 0 }), row({ itemKey: 'home', ordinal: 1 })],
      [],
    );
    expect(labels(groups)).toEqual(['All Requests', 'Home']);
  });

  it('honours the order and the heading the rows give, not the registry order', () => {
    const groups = resolveNav(
      ['r1'],
      ALL,
      [
        row({ itemKey: 'finance', ordinal: 0, categoryKey: 'c_overview' }),
        row({ itemKey: 'home', ordinal: 1, categoryKey: 'c_overview' }),
      ],
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Overview');
    expect(labels(groups)).toEqual(['Finance', 'Home']);
  });

  it('drops a row whose toggle is off', () => {
    const groups = resolveNav(
      ['r1'],
      ALL,
      [
        row({ itemKey: 'home', ordinal: 0 }),
        row({ itemKey: 'requests', ordinal: 1, isShown: false }),
      ],
      [],
    );
    expect(labels(groups)).toEqual(['Home']);
  });

  /** 🔴 The rule that makes configuration safe: it narrows, it never widens. */
  it('cannot show an item the caller has no privilege for, whatever the row says', () => {
    const groups = resolveNav(['r1'], canFrom([]), [row({ itemKey: 'finance', ordinal: 0 })], []);
    expect(labels(groups)).toEqual([]);
  });

  it('falls the heading back to the registry when the row names a deleted one', () => {
    const groups = resolveNav(
      ['r1'],
      ALL,
      [row({ itemKey: 'finance', ordinal: 0, categoryKey: 'c_gone' })],
      [],
    );
    expect(groups[0].title).toBe('Onboarding & Money');
  });

  it('reads a row written against a renamed key as the item that replaced it', () => {
    const groups = resolveNav(['r1'], ALL, [row({ itemKey: 'admin', ordinal: 0 })], []);
    expect(labels(groups)).toEqual(['Configs']);
  });
});

describe('two roles', () => {
  it('unions at the best position, so a second role never costs a link', () => {
    const rows: RoleNavRow[] = [
      { roleKey: 'a', itemKey: 'requests', categoryKey: 'c_requests', ordinal: 5, isShown: true },
      { roleKey: 'b', itemKey: 'requests', categoryKey: 'c_overview', ordinal: 1, isShown: true },
      { roleKey: 'b', itemKey: 'finance', categoryKey: 'c_overview', ordinal: 2, isShown: true },
    ];
    const groups = resolveNav(['a', 'b'], ALL, rows, []);
    // Placed by role b, which put it higher — heading and all.
    expect(groups.map((g) => g.title)).toEqual(['Overview']);
    expect(labels(groups)).toEqual(['All Requests', 'Finance']);
  });

  it('gives an unarranged role the defaults beside an arranged one', () => {
    const rows: RoleNavRow[] = [
      { roleKey: 'a', itemKey: 'finance', categoryKey: 'c_overview', ordinal: 0, isShown: true },
    ];
    const groups = resolveNav(['a', 'b'], ALL, rows, []);
    // Role b contributes the whole catalog; role a's one row still wins the
    // placement of Finance, which is why it reads under Overview and not under
    // the heading the registry gives it.
    expect(labels(groups)).toContain('All Requests');
    expect((groups.find((g) => g.title === 'Overview')?.items ?? []).map((i) => i.label)).toContain(
      'Finance',
    );
    expect(
      (groups.find((g) => g.title === 'Onboarding & Money')?.items ?? []).map((i) => i.label),
    ).not.toContain('Finance');
  });
});

describe('the headings', () => {
  it('applies a re-label and a re-order to a built-in, and keeps it built-in', () => {
    const cats = navCategories([{ key: 'c_help', label: 'Manual', ordinal: -1 }]);
    expect(cats[0]).toMatchObject({ key: 'c_help', label: 'Manual', builtIn: true });
  });

  it('appends one an admin added', () => {
    const cats = navCategories([{ key: 'c_mine', label: 'Mine', ordinal: 99 }]);
    expect(cats.at(-1)).toMatchObject({ key: 'c_mine', label: 'Mine', builtIn: false });
  });

  it('orders a tie by label, so two headings never swap between requests', () => {
    const cats = navCategories([
      { key: 'c_b', label: 'Beta', ordinal: 9 },
      { key: 'c_a', label: 'Alpha', ordinal: 9 },
    ]);
    expect(cats.slice(-2).map((c) => c.label)).toEqual(['Alpha', 'Beta']);
  });
});
