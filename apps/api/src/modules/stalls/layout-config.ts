// Configs › Home Page and Configs › Sidebar Layout — the two screens that
// arrange what a role sees.
//
// 🔴 **Arranging is not granting.** Nothing in this file can widen anybody's
// reach: both resolvers apply the privilege filter after the rows, so the worst
// a bad arrangement can do is hide a link from the people who hold it. That is
// why the write is gated on `config.write` and not on `roles.write` — this is
// the shape of the app, not who may do what.
//
// ⚠️ It IS gated on the role hierarchy, though, and for a smaller reason: an
// admin who cannot edit a role has no business deciding what its holders open
// on every morning. The same `editableRolesFor` the Users and Roles screens use.
import {
  type HomeConfigResponse,
  type HomeConfigWidget,
  type NavConfigItem,
  type NavConfigResponse,
  NAV_ITEM_BY_KEY,
  type SaveHomeLayoutInput,
  type SaveNavLayoutInput,
  WIDGET_BY_KEY,
  can,
  cannotAssign,
  canonicalNavItemKey,
  configurableNavItems,
  configurableWidgets,
  navCategories,
  navItemAllows,
  widgetAllows,
  type StallPrivilege,
} from '@stalls/core';
import type { PrismaClient } from '@prisma/client';
import { audit } from './audit';
import {
  BuiltInCategoryError,
  RoleAboveYouError,
  UnknownNavCategoryError,
  UnknownNavItemError,
  UnknownRoleError,
  UnknownWidgetError,
} from './errors';
import { type BackofficeCaller, editableRolesFor } from './roles';

/** Unarranged items sort after every arranged one, in catalog order. */
const UNARRANGED_BASE = 100_000;

/** One role, with the privileges it grants resolved the same way a caller's are.
 *
 *  ⚠️ `allPrivileges` is expanded against the LIVE list. A role holding the flag
 *  reaches every privilege added in a later release, so a config screen that
 *  read only its join rows would offer an admin a shorter list than the role
 *  actually has — and every item missing from that list would be saved as
 *  hidden. */
interface RoleWithPrivileges {
  roleKey: string;
  name: string;
  level: number;
  privileges: string[];
}

async function rolesWithPrivileges(
  db: PrismaClient,
  caller: BackofficeCaller,
): Promise<RoleWithPrivileges[]> {
  const [roles, editable, activeCodes] = await Promise.all([
    db.stallRole.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        roleKey: true,
        name: true,
        level: true,
        allPrivileges: true,
        privileges: {
          where: { privilege: { isActive: true } },
          select: { privilege: { select: { code: true } } },
        },
      },
    }),
    editableRolesFor(db, caller),
    db.stallPrivilege.findMany({ where: { isActive: true }, select: { code: true } }),
  ]);
  const all = activeCodes.map((p) => p.code);

  return roles
    .filter((r) => editable.has(r.roleKey))
    .map((r) => ({
      roleKey: r.roleKey,
      name: r.name,
      level: r.level,
      privileges: r.allPrivileges ? all : r.privileges.map((rp) => rp.privilege.code),
    }));
}

/** The `can` a ROLE grants — the same predicate a caller gets, built from the
 *  role's own privileges, so the config screen and the resolver agree about what
 *  that role reaches. */
const canOfRole =
  (privileges: string[]) =>
  (p: StallPrivilege): boolean =>
    can(privileges, p);

/** A role the caller may not edit is refused by NAME, not silently skipped: an
 *  admin who can see a role in one screen and gets nothing from another needs
 *  the sentence that says why. */
async function requireEditableRole(
  db: PrismaClient,
  caller: BackofficeCaller,
  roleKey: string,
): Promise<RoleWithPrivileges> {
  const role = (await rolesWithPrivileges(db, caller)).find((r) => r.roleKey === roleKey);
  if (role) return role;

  const exists = await db.stallRole.findUnique({ where: { roleKey }, select: { name: true } });
  if (!exists) throw new UnknownRoleError(roleKey);
  // The same sentence the Roles and Users screens give, for the same refusal.
  throw new RoleAboveYouError(roleKey, cannotAssign(exists.name));
}

/* ── Sidebar Layout ─────────────────────────────────────────────────────────*/

/**
 * One role's sidebar, as the editor shows it.
 *
 * Items the role has no privilege for are OMITTED, not disabled — the list is
 * what this role can actually use, and a toggle that could never take effect is
 * a control that lies.
 *
 * A role with no rows opens with everything ON, because the default IS
 * everything its privileges reach and that is what its holders are seeing right
 * now. Opening on an empty list would invite an admin to "fix" a sidebar that
 * was never broken.
 *
 * Items come back with each heading's block CONTIGUOUS: heading order is the
 * order headings first appear, so the screen reorders a heading by moving its
 * block and must be given one.
 */
export function roleNavList(
  privileges: string[],
  rows: Array<{ itemKey: string; categoryKey: string; ordinal: number; isShown: boolean }>,
  categories: Array<{ key: string; label: string; ordinal: number }>,
): NavConfigItem[] {
  const canRole = canOfRole(privileges);

  // ⚠️ Keys are canonicalised FIRST. A row written against a key the registry
  // has since renamed would otherwise show an admin their own link switched
  // off. Several old rows can now mean one item, so the survivor keeps the best
  // position any of them held and is shown if any of them was shown.
  const rowFor = new Map<string, { categoryKey: string; ordinal: number; isShown: boolean }>();
  for (const raw of rows) {
    const key = canonicalNavItemKey(raw.itemKey);
    if (!NAV_ITEM_BY_KEY.has(key)) continue;
    const seen = rowFor.get(key);
    if (!seen) rowFor.set(key, raw);
    else {
      rowFor.set(key, {
        ordinal: Math.min(seen.ordinal, raw.ordinal),
        categoryKey: raw.ordinal < seen.ordinal ? raw.categoryKey : seen.categoryKey,
        isShown: seen.isShown || raw.isShown,
      });
    }
  }

  const catalog = navCategories(categories);
  const known = new Set(catalog.map((c) => c.key));
  const catOrder = new Map(catalog.map((c, n) => [c.key, n]));

  const placed = configurableNavItems(canRole).map((def, n) => {
    const row = rowFor.get(def.key);
    // A row naming a heading that has since been deleted falls back to the
    // registry's, the same way `resolveNav` does — otherwise the item would be
    // invisible here while still being served.
    const category = row && known.has(row.categoryKey) ? row.categoryKey : def.category;
    return {
      item: {
        key: def.key,
        label: def.label,
        glyph: def.glyph,
        meta: def.meta,
        to: def.to,
        category,
        // Unarranged: on. `configurableNavItems` has already dropped everything
        // this role's privileges refuse, so what is left IS the default — there
        // is no second list to consult.
        shown: rowFor.size > 0 ? (row?.isShown ?? false) : true,
      },
      ordinal: row ? row.ordinal : UNARRANGED_BASE + n,
    };
  });

  // Headings in the order this role reaches them, then items inside each.
  const first = new Map<string, number>();
  for (const p of placed) {
    const seen = first.get(p.item.category);
    if (seen === undefined || p.ordinal < seen) first.set(p.item.category, p.ordinal);
  }
  const rank = (category: string) =>
    first.get(category) ?? UNARRANGED_BASE + (catOrder.get(category) ?? catalog.length);

  return placed
    .sort(
      (a, b) =>
        rank(a.item.category) - rank(b.item.category) ||
        a.ordinal - b.ordinal ||
        a.item.label.localeCompare(b.item.label),
    )
    .map((p) => p.item);
}

export async function navConfig(
  db: PrismaClient,
  caller: BackofficeCaller,
): Promise<NavConfigResponse> {
  const [roles, rows, categories] = await Promise.all([
    rolesWithPrivileges(db, caller),
    db.stallRoleNavItem.findMany({ orderBy: { ordinal: 'asc' } }),
    db.stallNavCategory.findMany({ orderBy: { ordinal: 'asc' } }),
  ]);

  const byRole = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byRole.get(r.roleKey);
    if (list) list.push(r);
    else byRole.set(r.roleKey, [r]);
  }

  const cats = categories.map((c) => ({ key: c.key, label: c.label, ordinal: c.ordinal }));

  return {
    categories: navCategories(cats),
    roles: roles.map((role) => {
      const configured = byRole.get(role.roleKey) ?? [];
      const items = roleNavList(role.privileges, configured, cats);
      return {
        roleKey: role.roleKey,
        name: role.name,
        level: role.level,
        configured: configured.length > 0,
        shownCount: items.filter((i) => i.shown).length,
        total: items.length,
        items,
      };
    }),
  };
}

/**
 * Replaces one role's sidebar.
 *
 * 🔴 Written as a SET, never upserted row by row: "this role has rows" is what
 * tells the resolver to stop applying registry defaults, so a partial write
 * leaves a role reading from both sources at once.
 *
 * ⚠️ An item the role has no privilege for is REFUSED rather than dropped. The
 * screen never offers one, so a request carrying one is a client out of step
 * with the server, and saving the rest of that list would write an arrangement
 * nobody chose.
 */
export async function saveNavLayout(
  db: PrismaClient,
  caller: BackofficeCaller,
  roleKey: string,
  input: SaveNavLayoutInput,
): Promise<{ shown: number }> {
  const role = await requireEditableRole(db, caller, roleKey);
  const canRole = canOfRole(role.privileges);
  const categories = await db.stallNavCategory.findMany({ select: { key: true } });
  const known = new Set(
    navCategories(categories.map((c) => ({ ...c, label: '', ordinal: 0 }))).map((c) => c.key),
  );

  const seen = new Set<string>();
  const items = input.items.map((raw) => {
    const key = canonicalNavItemKey(raw.key);
    const def = NAV_ITEM_BY_KEY.get(key);
    if (!def || !navItemAllows(def, canRole)) throw new UnknownNavItemError(raw.key);
    if (seen.has(key)) throw new UnknownNavItemError(`${raw.key} (twice)`);
    seen.add(key);
    // A heading that does not exist falls back to the item's own rather than
    // being refused: the resolver already does exactly this, and refusing here
    // would lose an admin's whole arrangement over one stale key.
    return {
      key,
      category: known.has(raw.category) ? raw.category : def.category,
      shown: raw.shown,
    };
  });

  const before = await db.stallRoleNavItem.findMany({
    where: { roleKey },
    orderBy: { ordinal: 'asc' },
  });

  await db.$transaction([
    db.stallRoleNavItem.deleteMany({ where: { roleKey } }),
    db.stallRoleNavItem.createMany({
      data: items.map((i, n) => ({
        roleKey,
        itemKey: i.key,
        categoryKey: i.category,
        ordinal: n,
        isShown: i.shown,
      })),
    }),
  ]);

  await audit(db, {
    actor: { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName },
    action: 'stall_nav_layout.updated',
    subject: { type: 'role', ref: roleKey },
    // The whole list as ONE change, not one change per item. A sidebar is an
    // ordered list — moving one link rewrites every ordinal after it — so a
    // per-row diff would report twelve changes for one drag and say nothing
    // about what an admin actually did.
    changes: [
      {
        field: 'items',
        before: before.map((r) => ({ key: r.itemKey, category: r.categoryKey, shown: r.isShown })),
        after: items.map((i) => ({ key: i.key, category: i.category, shown: i.shown })),
      },
    ],
    detail: { roleKey, roleName: role.name },
  });

  return { shown: items.filter((i) => i.shown).length };
}

/* ── Home Page ──────────────────────────────────────────────────────────────*/

/** One role's home page, as the editor shows it. Same two rules as the sidebar:
 *  cards the role cannot reach are omitted, and a role with no rows opens with
 *  everything on. */
export function roleWidgetList(
  privileges: string[],
  rows: Array<{ widgetKey: string; ordinal: number; isShown: boolean }>,
): HomeConfigWidget[] {
  const canRole = canOfRole(privileges);
  const rowFor = new Map(
    rows.filter((r) => WIDGET_BY_KEY.has(r.widgetKey)).map((r) => [r.widgetKey, r]),
  );

  return configurableWidgets(canRole)
    .map((def, n) => ({
      widget: {
        key: def.key,
        label: def.label,
        description: def.description,
        glyph: def.glyph,
        span: def.span,
        shown: rowFor.size > 0 ? (rowFor.get(def.key)?.isShown ?? false) : true,
      },
      ordinal: rowFor.get(def.key)?.ordinal ?? UNARRANGED_BASE + n,
    }))
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((p) => p.widget);
}

export async function homeConfig(
  db: PrismaClient,
  caller: BackofficeCaller,
): Promise<HomeConfigResponse> {
  const [roles, rows] = await Promise.all([
    rolesWithPrivileges(db, caller),
    db.stallRoleHomeWidget.findMany({ orderBy: { ordinal: 'asc' } }),
  ]);

  const byRole = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byRole.get(r.roleKey);
    if (list) list.push(r);
    else byRole.set(r.roleKey, [r]);
  }

  return {
    roles: roles.map((role) => {
      const configured = byRole.get(role.roleKey) ?? [];
      const items = roleWidgetList(role.privileges, configured);
      return {
        roleKey: role.roleKey,
        name: role.name,
        level: role.level,
        configured: configured.length > 0,
        shownCount: items.filter((i) => i.shown).length,
        total: items.length,
        items,
      };
    }),
  };
}

/** Replaces one role's home page. A set, for the same reason the sidebar is. */
export async function saveHomeLayout(
  db: PrismaClient,
  caller: BackofficeCaller,
  roleKey: string,
  input: SaveHomeLayoutInput,
): Promise<{ shown: number }> {
  const role = await requireEditableRole(db, caller, roleKey);
  const canRole = canOfRole(role.privileges);

  const seen = new Set<string>();
  const widgets = input.widgets.map((raw) => {
    const def = WIDGET_BY_KEY.get(raw.key);
    if (!def || !widgetAllows(def, canRole)) throw new UnknownWidgetError(raw.key);
    if (seen.has(raw.key)) throw new UnknownWidgetError(`${raw.key} (twice)`);
    seen.add(raw.key);
    return raw;
  });

  const before = await db.stallRoleHomeWidget.findMany({
    where: { roleKey },
    orderBy: { ordinal: 'asc' },
  });

  await db.$transaction([
    db.stallRoleHomeWidget.deleteMany({ where: { roleKey } }),
    db.stallRoleHomeWidget.createMany({
      data: widgets.map((w, n) => ({ roleKey, widgetKey: w.key, ordinal: n, isShown: w.shown })),
    }),
  ]);

  await audit(db, {
    actor: { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName },
    action: 'stall_home_layout.updated',
    subject: { type: 'role', ref: roleKey },
    changes: [
      {
        field: 'widgets',
        before: before.map((r) => ({ key: r.widgetKey, shown: r.isShown })),
        after: widgets.map((w) => ({ key: w.key, shown: w.shown })),
      },
    ],
    detail: { roleKey, roleName: role.name },
  });

  return { shown: widgets.filter((w) => w.shown).length };
}

/* ── The headings ───────────────────────────────────────────────────────────*/

/** A key for a heading an admin adds. Slugged from the label, suffixed when
 *  taken — the key is what every role's rows point at, so it is generated once
 *  and never changes when the label is re-worded. */
function categoryKeyFor(label: string, taken: Set<string>): string {
  const base = `c_${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`.slice(0, 40);
  let key = base === 'c_' ? 'c_group' : base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

export async function addNavCategory(
  db: PrismaClient,
  caller: BackofficeCaller,
  label: string,
): Promise<{ key: string }> {
  const rows = await db.stallNavCategory.findMany({ select: { key: true, ordinal: true } });
  const taken = new Set(navCategories(rows.map((r) => ({ ...r, label: '' }))).map((c) => c.key));
  const key = categoryKeyFor(label, taken);
  const ordinal =
    Math.max(0, ...navCategories([]).map((c) => c.ordinal), ...rows.map((r) => r.ordinal)) + 1;

  await db.stallNavCategory.create({ data: { key, label, ordinal } });
  await audit(db, {
    actor: { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName },
    action: 'stall_nav_category.updated',
    subject: { type: 'nav_category', ref: key },
    changes: [{ field: 'label', before: null, after: label }],
  });
  return { key };
}

/**
 * Re-labels a heading.
 *
 * ⚠️ A BUILT-IN is re-labelled by WRITING a row, not by editing one: the seven
 * shipped headings have no rows until somebody renames one. That is what lets
 * `resetNavCategory` put the shipped word back by deleting rather than by
 * remembering what it used to be.
 */
export async function renameNavCategory(
  db: PrismaClient,
  caller: BackofficeCaller,
  key: string,
  label: string,
): Promise<void> {
  const rows = await db.stallNavCategory.findMany();
  const known = navCategories(
    rows.map((r) => ({ key: r.key, label: r.label, ordinal: r.ordinal })),
  );
  const current = known.find((c) => c.key === key);
  if (!current) throw new UnknownNavCategoryError(key);

  await db.stallNavCategory.upsert({
    where: { key },
    create: { key, label, ordinal: current.ordinal },
    update: { label },
  });
  await audit(db, {
    actor: { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName },
    action: 'stall_nav_category.updated',
    subject: { type: 'nav_category', ref: key },
    changes: [{ field: 'label', before: current.label, after: label }],
  });
}

/**
 * Deletes a heading an admin added.
 *
 * ⚠️ A built-in is REFUSED, not deleted — the registry would put it straight
 * back on the next read, so the delete would appear to work and change nothing.
 * Rows still pointing at a deleted heading are left alone: both resolvers fall
 * an orphaned placement back to the item's registry category, so the link keeps
 * working and simply reads under the heading it shipped with.
 */
export async function deleteNavCategory(
  db: PrismaClient,
  caller: BackofficeCaller,
  key: string,
): Promise<void> {
  const rows = await db.stallNavCategory.findMany();
  const known = navCategories(
    rows.map((r) => ({ key: r.key, label: r.label, ordinal: r.ordinal })),
  );
  const current = known.find((c) => c.key === key);
  if (!current) throw new UnknownNavCategoryError(key);
  if (current.builtIn) throw new BuiltInCategoryError(current.label);

  await db.stallNavCategory.delete({ where: { key } });
  await audit(db, {
    actor: { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName },
    action: 'stall_nav_category.updated',
    subject: { type: 'nav_category', ref: key },
    changes: [{ field: 'label', before: current.label, after: null }],
  });
}

/** Re-orders the headings. Takes the whole list, so a move is one write and two
 *  headings can never end up claiming the same place. */
export async function reorderNavCategories(
  db: PrismaClient,
  caller: BackofficeCaller,
  keys: string[],
): Promise<void> {
  const rows = await db.stallNavCategory.findMany();
  const known = new Map(
    navCategories(rows.map((r) => ({ key: r.key, label: r.label, ordinal: r.ordinal }))).map(
      (c) => [c.key, c],
    ),
  );
  for (const key of keys) if (!known.has(key)) throw new UnknownNavCategoryError(key);

  await db.$transaction(
    keys.map((key, ordinal) =>
      db.stallNavCategory.upsert({
        where: { key },
        // A built-in being moved has no row yet, so the upsert has to be able to
        // CREATE one — and it carries the shipped label, which the loop above
        // has already proved exists.
        create: { key, label: known.get(key)?.label ?? key, ordinal },
        update: { ordinal },
      }),
    ),
  );
  await audit(db, {
    actor: { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName },
    action: 'stall_nav_category.updated',
    subject: { type: 'nav_category', ref: 'order' },
    detail: { order: keys },
  });
}
