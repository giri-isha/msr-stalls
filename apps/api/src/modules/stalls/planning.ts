import type { PrismaClient } from '@prisma/client';
import {
  type ApplyPlanResult,
  type ZoneCode,
  type ZonePlanInput,
  type ZonePlanView,
  formatStallNumber,
  parseStallNumber,
  planTotals,
  suggestStallCount,
} from '@stalls/core';
import { actorFrom, audit } from './audit';
import { chargesFor, listZones, planCategoriesFor } from './config';
import type { Db } from './editions';
import { UnknownCategoryError, UnknownZoneError } from './errors';

/** ⚠️ Built from the EDITION's categories, not a constant. A column an admin
 *  added has to appear on every row at zero, or the grid renders ragged and the
 *  bay totals silently omit it. */
function zeroCounts(keys: string[]): Record<string, number> {
  return Object.fromEntries(keys.map((c) => [c, 0]));
}

export async function readPlan(db: Db, editionId: string): Promise<ZonePlanView> {
  const [zones, charges, categories] = await Promise.all([
    listZones(db, editionId),
    chargesFor(db, editionId),
    planCategoriesFor(db, editionId),
  ]);
  const byId = new Map(categories.map((c) => [c.id, c.key]));
  const keys = categories.map((c) => c.key);
  const zoneIds = zones.map((z) => z.id);
  const [plans, stalls] = await Promise.all([
    db.stallZonePlan.findMany({ where: { zoneId: { in: zoneIds } } }),
    db.stall.groupBy({
      by: ['zoneId', 'status'],
      where: { zoneId: { in: zoneIds } },
      _count: { _all: true },
    }),
  ]);

  const rows = zones.map((z) => {
    const counts = zeroCounts(keys);
    for (const p of plans) {
      if (p.zoneId !== z.id) continue;
      const key = byId.get(p.categoryId);
      if (key) counts[key] = p.plannedCount;
    }
    const existing = stalls.filter((s) => s.zoneId === z.id).reduce((n, s) => n + s._count._all, 0);
    const allocated = stalls
      .filter((s) => s.zoneId === z.id && s.status === 'ALLOCATED')
      .reduce((n, s) => n + s._count._all, 0);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      zoneCode: z.code,
      zoneName: z.name,
      isClosedToVendors: z.isClosedToVendors,
      expectedCrowd: z.expectedCrowd,
      suggested: suggestStallCount(z.expectedCrowd, charges.crowdPerStall),
      counts,
      total,
      stallsExisting: existing,
      stallsAllocated: allocated,
    };
  });

  const totals = planTotals(
    rows.map((r) => ({ zoneCode: r.zoneCode as ZoneCode, counts: r.counts })),
    keys,
  );
  return {
    crowdPerStall: charges.crowdPerStall,
    categories: categories.map((c) => ({ key: c.key, name: c.name, isFood: c.isFood })),
    rows,
    totals: { byCategory: totals.byCategory, grandTotal: totals.grandTotal },
  };
}

export async function writePlan(
  db: PrismaClient,
  editionId: string,
  input: ZonePlanInput,
  by: string,
): Promise<ZonePlanView> {
  const categories = await planCategoriesFor(db, editionId);
  const categoriesByKey = new Map(categories.map((c) => [c.key, c]));

  await db.$transaction(async (tx) => {
    if (input.crowdPerStall !== undefined) {
      await tx.stallChargeConfig.update({
        where: { editionId },
        data: { crowdPerStall: input.crowdPerStall },
      });
    }
    for (const row of input.rows) {
      const zone = await tx.stallZone.findUnique({
        where: { editionId_code: { editionId, code: row.zoneCode } },
      });
      if (!zone) throw new UnknownZoneError(row.zoneCode);
      if (row.expectedCrowd !== undefined) {
        await tx.stallZone.update({
          where: { id: zone.id },
          data: { expectedCrowd: row.expectedCrowd },
        });
      }
      // Only the columns this edition actually defines. A key the grid does not
      // know is the caller's mistake, not a column to invent — inventing it
      // would let a typo become a permanent column nobody can explain.
      for (const [key, count] of Object.entries(row.counts)) {
        const category = categoriesByKey.get(key);
        if (!category) throw new UnknownCategoryError(key);
        await tx.stallZonePlan.upsert({
          where: { zoneId_categoryId: { zoneId: zone.id, categoryId: category.id } },
          create: { zoneId: zone.id, categoryId: category.id, plannedCount: count },
          update: { plannedCount: count },
        });
      }
    }
    await audit(tx, {
      actor: actorFrom(by),
      action: 'stall_plan.written',
      subject: { type: 'edition', ref: editionId },
      editionId: editionId,
      detail: { zones: input.rows.length, crowdPerStall: input.crowdPerStall },
    });
  });
  return readPlan(db, editionId);
}

/** Turn the plan into `Stall` rows.
 *
 *  The one rule that matters: a stall holding a live allocation is NEVER
 *  removed, whatever the plan now says. Shrinking A4 from 30 to 3 after
 *  `A4-5` is allocated leaves `A4-5` standing and reports it in `kept`.
 *
 *  Numbering is a single run per zone (`A4-1 … A4-N`); category is an
 *  attribute. On apply, the desired categories are expanded in the edition's
 *  own column order and walked against existing stalls by number:
 *  allocated or blocked stalls keep their category and consume a matching
 *  slot if one exists; available stalls are re-labelled to whatever the plan
 *  still needs; surplus available stalls are removed; any shortfall is
 *  created at the end of the run. */
export async function applyPlan(
  db: PrismaClient,
  editionId: string,
  by: string,
): Promise<ApplyPlanResult> {
  const result: ApplyPlanResult = { created: [], removed: [], kept: [] };

  await db.$transaction(async (tx) => {
    const zones = await listZones(tx, editionId);
    const categories = await planCategoriesFor(tx, editionId);
    for (const zone of zones) {
      const plan = await tx.stallZonePlan.findMany({ where: { zoneId: zone.id } });
      const desired: string[] = [];
      for (const category of categories) {
        const n = plan.find((p) => p.categoryId === category.id)?.plannedCount ?? 0;
        for (let i = 0; i < n; i++) desired.push(category.id);
      }

      const existing = await tx.stall.findMany({
        where: { zoneId: zone.id },
        include: { activeAllocation: { select: { id: true } } },
      });
      existing.sort(
        (a, b) => (parseStallNumber(a.number)?.n ?? 0) - (parseStallNumber(b.number)?.n ?? 0),
      );

      // Pinned stalls first: they keep their category and take a slot if the
      // plan still has one for it; otherwise they are kept anyway and reported.
      const remaining = [...desired];
      const take = (categoryId: string): boolean => {
        const i = remaining.indexOf(categoryId);
        if (i < 0) return false;
        remaining.splice(i, 1);
        return true;
      };
      const free: typeof existing = [];
      for (const s of existing) {
        const pinned = s.activeAllocation !== null || s.status === 'BLOCKED';
        if (pinned) {
          if (!take(s.categoryId)) result.kept.push(s.number);
        } else {
          free.push(s);
        }
      }
      // Free stalls are re-labelled to consume what is left, in number order;
      // the surplus is removed.
      for (const s of free) {
        const categoryId = remaining.shift();
        if (categoryId === undefined) {
          await tx.stall.delete({ where: { id: s.id } });
          result.removed.push(s.number);
        } else if (categoryId !== s.categoryId) {
          await tx.stall.update({ where: { id: s.id }, data: { categoryId } });
        }
      }
      // Whatever the plan still wants is created after the highest number.
      let next = existing.reduce((m, s) => Math.max(m, parseStallNumber(s.number)?.n ?? 0), 0) + 1;
      // …but a removed number is not reused within the same apply: it may be
      // on a printed sheet somewhere. Fresh numbers only.
      for (const categoryId of remaining) {
        const number = formatStallNumber(zone.code as ZoneCode, next++);
        await tx.stall.create({ data: { zoneId: zone.id, number, categoryId } });
        result.created.push(number);
      }
    }
    await audit(tx, {
      actor: actorFrom(by),
      action: 'stall_plan.applied',
      subject: { type: 'edition', ref: editionId },
      editionId: editionId,
      detail: {
        created: result.created.length,
        removed: result.removed.length,
        kept: result.kept.length,
      },
    });
  });

  return result;
}

/** Stalls a selection screen can offer: available ones, grouped by zone. */
export async function listAvailableStalls(db: Db, editionId: string, zoneCode?: string) {
  const rows = await db.stall.findMany({
    where: { zone: { editionId, ...(zoneCode ? { code: zoneCode } : {}) }, status: 'AVAILABLE' },
    include: {
      zone: { select: { code: true, sortOrder: true } },
      category: { select: { key: true } },
    },
  });
  rows.sort(
    (a, b) =>
      a.zone.sortOrder - b.zone.sortOrder ||
      (parseStallNumber(a.number)?.n ?? 0) - (parseStallNumber(b.number)?.n ?? 0),
  );
  return rows.map((s) => ({
    id: s.id,
    number: s.number,
    zoneCode: s.zone.code,
    category: s.category.key,
    status: s.status,
  }));
}
