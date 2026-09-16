import { DEFAULT_PLAN_CATEGORIES, type ZoneCode } from '@stalls/core';
import { applyPlan, writePlan } from '../../src/modules/stalls/planning';
import { SYSTEM, prisma } from './db';

/** The keys a freshly created edition is seeded with. Tests name one or two of
 *  them; the rest have to be present as zeros, because a plan row is a full
 *  row of columns and a missing column is not the same as a column set to none.
 *
 *  ⚠️ Read from the seed constant rather than a list written out here: the
 *  columns are the edition's own configuration now, and a helper with its own
 *  copy would keep passing after an admin added a column that the code under
 *  test has to cope with. */
const DEFAULT_KEYS = DEFAULT_PLAN_CATEGORIES.map((c) => c.key);

/** A full counts row with zeros everywhere except what the test names. */
export function counts(partial: Record<string, number> = {}): Record<string, number> {
  return Object.fromEntries(DEFAULT_KEYS.map((key) => [key, partial[key] ?? 0]));
}

/** Plan a zone and apply it, so the test has real Stall rows to allocate. */
export async function makeStalls(
  editionId: string,
  zoneCode: ZoneCode,
  partial: Record<string, number>,
) {
  await writePlan(prisma, editionId, { rows: [{ zoneCode, counts: counts(partial) }] }, SYSTEM);
  return applyPlan(prisma, editionId, SYSTEM);
}
