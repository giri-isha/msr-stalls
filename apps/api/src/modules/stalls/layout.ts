// Resolving the two layouts for the person asking.
//
// The rules are in `@stalls/core` (`resolveNav`, `resolveWidgets`) and take
// rows, so they stay testable without a database. This file is the half that
// reads: it fetches the caller's roles' rows and hands them over. Nothing here
// decides anything.
//
// 🔴 Both resolvers take the caller's `can`, and both apply it LAST. That is
// what makes an arrangement safe to hand to an admin: a row can hide a link or
// a card, and it can never show one the caller's privileges do not already
// reach.
import {
  type ResolvedNavGroup,
  type RoleNavRow,
  type RoleWidgetRow,
  type StallPrivilege,
  type WidgetDef,
  can,
  resolveNav,
  resolveWidgets,
} from '@stalls/core';
import type { Db } from './editions';
import type { BackofficeCaller } from './roles';

/** The caller's privileges as a predicate, with a write implying its read.
 *
 *  ⚠️ Built here rather than passing the raw list, because `can` is the only
 *  reader that knows `planning.write` entitles somebody to `planning.read` — and
 *  a registry filtered on a bare `includes` hides a screen from exactly the
 *  person it was granted to. */
export const canOf =
  (caller: BackofficeCaller) =>
  (p: StallPrivilege): boolean =>
    can(caller.privileges, p);

/**
 * The caller's sidebar.
 *
 * Two queries, on every `/me`. Both tables are empty until an admin arranges
 * something, and an empty read is what tells the resolver to use the registry
 * defaults — so the common install pays for two index scans that return nothing
 * and gets the sidebar it always had.
 */
export async function navFor(db: Db, caller: BackofficeCaller): Promise<ResolvedNavGroup[]> {
  const [rows, categories] = await Promise.all([
    db.stallRoleNavItem.findMany({
      where: { roleKey: { in: caller.roleKeys } },
      orderBy: { ordinal: 'asc' },
    }),
    db.stallNavCategory.findMany({ orderBy: { ordinal: 'asc' } }),
  ]);

  const navRows: RoleNavRow[] = rows.map(
    (r): RoleNavRow => ({
      roleKey: r.roleKey,
      itemKey: r.itemKey,
      categoryKey: r.categoryKey,
      ordinal: r.ordinal,
      isShown: r.isShown,
    }),
  );

  return resolveNav(
    caller.roleKeys,
    canOf(caller),
    navRows,
    categories.map((c: { key: string; label: string; ordinal: number }) => ({
      key: c.key,
      label: c.label,
      ordinal: c.ordinal,
    })),
  );
}

/** The cards on the caller's home page, in order. */
export async function widgetsFor(db: Db, caller: BackofficeCaller): Promise<WidgetDef[]> {
  const rows = await db.stallRoleHomeWidget.findMany({
    where: { roleKey: { in: caller.roleKeys } },
    orderBy: { ordinal: 'asc' },
  });

  const widgetRows: RoleWidgetRow[] = rows.map(
    (r): RoleWidgetRow => ({
      roleKey: r.roleKey,
      widgetKey: r.widgetKey,
      ordinal: r.ordinal,
      isShown: r.isShown,
    }),
  );

  return resolveWidgets(caller.roleKeys, canOf(caller), widgetRows);
}
