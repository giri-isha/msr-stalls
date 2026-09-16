import { type PrivilegeCatalogEntry, privilegeCategoryName } from '@msr/stalls';
import { type Tone, titleCase } from '../../ui';

/**
 * The privilege vocabulary, shaped for the two screens that read it.
 *
 * ⚠️ Fetched, not imported. `PRIVILEGE_CATEGORIES` ships in this bundle and is
 * the right source for what a privilege MEANS, but not for which ones are live:
 * a privilege is retired by clearing `isActive` on the row, and a compiled-in
 * list cannot know it happened. The catalogue route is the one that can.
 */

/** One category, with its privileges, in the order the table sent them. */
export interface PrivilegeGroup {
  key: string;
  name: string;
  items: PrivilegeCatalogEntry[];
}

/**
 * Group the flat catalogue by category.
 *
 * The rows arrive ordered by category and then by the vocabulary's own sort
 * order, so first-seen order is the order the code declares — which is the
 * order a reader of `rbac.ts` already knows.
 */
export function groupByCategory(privileges: readonly PrivilegeCatalogEntry[]): PrivilegeGroup[] {
  const groups = new Map<string, PrivilegeGroup>();
  for (const p of privileges) {
    const group = groups.get(p.category) ?? {
      key: p.category,
      name: privilegeCategoryName(p.category),
      items: [],
    };
    group.items.push(p);
    groups.set(p.category, group);
  }
  return [...groups.values()];
}

/** Which tone a privilege's `kind` wears. Presentation only — nothing branches
 *  on `kind` at runtime, and the colour is the only thing that ever reads it. */
export const KIND_TONE: Record<string, Tone> = {
  view: 'neutral',
  action: 'ok',
  config: 'warn',
  sensitive: 'des',
  export: 'info',
};

/**
 * A requester type as a reader says it: `LOCAL_WELFARE` → `Local Welfare`.
 *
 * Derived rather than mapped. A type added to the enum should appear on the
 * badge the day it is added, not the day somebody remembers a lookup table.
 */
export const requestTypeLabel = (type: string): string => titleCase(type);

/**
 * What a role's requester-type scope says on its card.
 *
 * ⚠️ Empty means EVERY type, which is the opposite of how a filter reads — so
 * the badge says it in words rather than being blank and leaving the reader to
 * guess which way round it is.
 */
export const scopeLabel = (requestTypeScope: readonly string[]): string =>
  requestTypeScope.length === 0
    ? 'All Requester Types'
    : requestTypeScope.map(requestTypeLabel).join(', ');
