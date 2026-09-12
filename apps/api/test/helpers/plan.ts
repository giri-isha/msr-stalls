import { STALL_CATEGORIES, type ZoneCode } from '@msr/stalls';
import type { StallCategory } from '@prisma/client';
import { applyPlan, writePlan } from '../../src/modules/stalls/planning';
import { SYSTEM, prisma } from './db';

/** A full counts row with zeros everywhere except what the test names. */
export function counts(partial: Partial<Record<StallCategory, number>> = {}) {
  return Object.fromEntries(STALL_CATEGORIES.map((c) => [c, partial[c] ?? 0])) as Record<
    StallCategory,
    number
  >;
}

/** Plan a zone and apply it, so the test has real Stall rows to allocate. */
export async function makeStalls(
  editionId: string,
  zoneCode: ZoneCode,
  partial: Partial<Record<StallCategory, number>>,
) {
  await writePlan(prisma, editionId, { rows: [{ zoneCode, counts: counts(partial) }] }, SYSTEM);
  return applyPlan(prisma, editionId, SYSTEM);
}
