import type { PrismaClient, StallCategory } from '@prisma/client';
import {
  type ApplyPlanResult,
  STALL_CATEGORIES,
  type ZoneCode,
  type ZonePlanInput,
  type ZonePlanView,
  formatStallNumber,
  parseStallNumber,
  planTotals,
  suggestStallCount,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import { chargesFor, listZones } from './config';
import type { Db } from './editions';
import { UnknownZoneError } from './errors';
import { MODULE_KEY } from './roles';

function zeroCounts(): Record<StallCategory, number> {
  return Object.fromEntries(STALL_CATEGORIES.map((c) => [c, 0])) as Record<StallCategory, number>;
}

export async function readPlan(db: Db, editionId: string): Promise<ZonePlanView> {
  const [zones, charges] = await Promise.all([listZones(db, editionId), chargesFor(db, editionId)]);
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
    const counts = zeroCounts();
    for (const p of plans) if (p.zoneId === z.id) counts[p.category] = p.plannedCount;
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
  );
  return {
    crowdPerStall: charges.crowdPerStall,
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
      for (const category of STALL_CATEGORIES) {
        await tx.stallZonePlan.upsert({
          where: { zoneId_category: { zoneId: zone.id, category } },
          create: { zoneId: zone.id, category, plannedCount: row.counts[category] },
          update: { plannedCount: row.counts[category] },
        });
      }
    }
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_plan.written',
      subjectRef: editionId,
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
 *  attribute. On apply, the desired categories are expanded in
 *  `STALL_CATEGORIES` order and walked against existing stalls by number:
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
    for (const zone of zones) {
      const plan = await tx.stallZonePlan.findMany({ where: { zoneId: zone.id } });
      const desired: StallCategory[] = [];
      for (const category of STALL_CATEGORIES) {
        const n = plan.find((p) => p.category === category)?.plannedCount ?? 0;
        for (let i = 0; i < n; i++) desired.push(category);
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
      const take = (category: StallCategory): boolean => {
        const i = remaining.indexOf(category);
        if (i < 0) return false;
        remaining.splice(i, 1);
        return true;
      };
      const free: typeof existing = [];
      for (const s of existing) {
        const pinned = s.activeAllocation !== null || s.status === 'BLOCKED';
        if (pinned) {
          if (!take(s.category)) result.kept.push(s.number);
        } else {
          free.push(s);
        }
      }
      // Free stalls are re-labelled to consume what is left, in number order;
      // the surplus is removed.
      for (const s of free) {
        const category = remaining.shift();
        if (category === undefined) {
          await tx.stall.delete({ where: { id: s.id } });
          result.removed.push(s.number);
        } else if (category !== s.category) {
          await tx.stall.update({ where: { id: s.id }, data: { category } });
        }
      }
      // Whatever the plan still wants is created after the highest number.
      let next = existing.reduce((m, s) => Math.max(m, parseStallNumber(s.number)?.n ?? 0), 0) + 1;
      // …but a removed number is not reused within the same apply: it may be
      // on a printed sheet somewhere. Fresh numbers only.
      for (const category of remaining) {
        const number = formatStallNumber(zone.code as ZoneCode, next++);
        await tx.stall.create({ data: { zoneId: zone.id, number, category } });
        result.created.push(number);
      }
    }
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_plan.applied',
      subjectRef: editionId,
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
    include: { zone: { select: { code: true, sortOrder: true } } },
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
    category: s.category,
    status: s.status,
  }));
}
