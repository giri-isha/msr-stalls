import type { Prisma, PrismaClient, StallEquipmentIssue } from '@prisma/client';
import type { ChallanView, EquipmentAction, EquipmentPatch, EquipmentRow } from '@stalls/core';
import { equipmentDeduction } from '@stalls/core';
import { recordActivity } from '../../activity';
import { chargesFor } from './config';
import type { Db } from './editions';
import { UnknownRequestError } from './errors';
import { allocatedNumbers } from './facts';
import { MODULE_KEY } from './roles';
import { type RequestScope, UNSCOPED, scopeWhere } from './scope';

/** The chairs-and-tables counter, over two days.
 *
 *  Day one: hand out what was ordered online, take cash for anything extra,
 *  print a two-part challan. Day two: collect it back, note what is missing or
 *  broken, and flag the stall so the refund screen picks the deduction up.
 *
 *  The row is opened lazily, on first sight of the stall, and it COPIES what
 *  the request asked for rather than reading through to it. The vendor is
 *  standing at the counter holding a printed challan; if the request were
 *  edited that evening, the paper and the screen would disagree and the paper
 *  is what was signed.
 */

type Row = Prisma.StallRequestGetPayload<{
  include: {
    equipment: true;
    allocations: { include: { stall: { include: { category: { select: { key: true } } } } } };
  };
}>;

const rowInclude = {
  equipment: true,
  allocations: {
    where: { releasedAt: null },
    include: { stall: { include: { category: { select: { key: true } } } } },
  },
} satisfies Prisma.StallRequestInclude;

interface Rates {
  chair: number;
  table: number;
  chairReplacementPaise: number;
  tableReplacementPaise: number;
  damagePenaltyPaise: number;
}

async function ratesFor(db: Db, editionId: string, requestType: string): Promise<Rates> {
  const c = await chargesFor(db, editionId);
  const lw = requestType === 'LOCAL_WELFARE';
  return {
    chair: lw ? c.lwChairRatePaise : c.chairRatePaise,
    table: lw ? c.lwTableRatePaise : c.tableRatePaise,
    chairReplacementPaise: c.chairReplacementPaise,
    tableReplacementPaise: c.tableReplacementPaise,
    damagePenaltyPaise: c.damagePenaltyPaise,
  };
}

function extraCharge(issue: { extraChairs: number; extraTables: number }, rates: Rates): number {
  return issue.extraChairs * rates.chair + issue.extraTables * rates.table;
}

function toRow(r: Row, issue: StallEquipmentIssue, rates: Rates): EquipmentRow {
  return {
    requestId: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    contactNumber: r.contactNumber,
    requestType: r.requestType,
    category: r.allocations[0]?.stall.category.key ?? '—',
    stallNumbers: allocatedNumbers(r),
    chairsRequested: issue.chairsRequested,
    tablesRequested: issue.tablesRequested,
    extraChairs: issue.extraChairs,
    extraTables: issue.extraTables,
    extraChargePaise: extraCharge(issue, rates),
    extraCollectedAt: issue.extraCollectedAt?.toISOString() ?? null,
    distributedAt: issue.distributedAt?.toISOString() ?? null,
    collectedAt: issue.collectedAt?.toISOString() ?? null,
    missingChairs: issue.missingChairs,
    missingTables: issue.missingTables,
    damaged: issue.damaged,
    deductionPaise: equipmentDeduction(
      {
        missingChairs: issue.missingChairs,
        missingTables: issue.missingTables,
        damaged: issue.damaged,
      },
      rates,
    ),
    note: issue.note,
    flagged: issue.flagged,
  };
}

/** Creates the counter row on first sight, snapshotting the order. */
async function ensureIssue(db: PrismaClient, r: Row): Promise<StallEquipmentIssue> {
  if (r.equipment) return r.equipment;
  return db.stallEquipmentIssue.upsert({
    where: { requestId: r.id },
    create: {
      requestId: r.id,
      chairsRequested: r.chairsNeeded,
      tablesRequested: r.tablesNeeded,
    },
    update: {},
  });
}

/** Every selected stall that ordered furniture, plus any that has a counter row
 *  already — a stall that ordered nothing and then took two chairs at the
 *  counter must not vanish from the collection list the next morning. */
export async function listEquipment(
  db: PrismaClient,
  editionId: string,
  scope: RequestScope = UNSCOPED,
): Promise<EquipmentRow[]> {
  const rows = await db.stallRequest.findMany({
    where: {
      editionId,
      status: 'SELECTED',
      ...scopeWhere(scope),
      OR: [
        { chairsNeeded: { gt: 0 } },
        { tablesNeeded: { gt: 0 } },
        { equipment: { isNot: null } },
      ],
    },
    include: rowInclude,
    orderBy: { stallName: 'asc' },
  });
  const out: EquipmentRow[] = [];
  for (const r of rows) {
    const issue = await ensureIssue(db, r);
    out.push(toRow(r, issue, await ratesFor(db, editionId, r.requestType)));
  }
  return out;
}

async function load(db: PrismaClient, requestId: string): Promise<Row> {
  const r = await db.stallRequest.findUnique({ where: { id: requestId }, include: rowInclude });
  if (!r) throw new UnknownRequestError(requestId);
  return r;
}

export async function patchEquipment(
  db: PrismaClient,
  requestId: string,
  patch: EquipmentPatch,
  by: string,
): Promise<EquipmentRow> {
  const r = await load(db, requestId);
  await ensureIssue(db, r);
  const rates = await ratesFor(db, r.editionId, r.requestType);

  const updated = await db.stallEquipmentIssue.update({
    where: { requestId },
    data: {
      ...patch,
      note: patch.note === undefined ? undefined : patch.note || null,
    },
  });
  // The cash figure is derived from the counts and rewritten on every change,
  // so it can never drift from what the counter is looking at.
  const withCharge = await db.stallEquipmentIssue.update({
    where: { requestId },
    data: { extraChargePaise: extraCharge(updated, rates) },
  });

  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_equipment.updated',
    subjectRef: requestId,
    detail: patch as Record<string, unknown>,
  });
  return toRow(await load(db, requestId), withCharge, rates);
}

export async function actOnEquipment(
  db: PrismaClient,
  requestId: string,
  action: EquipmentAction,
  by: string,
): Promise<EquipmentRow> {
  const r = await load(db, requestId);
  await ensureIssue(db, r);
  const now = new Date();

  const data: Prisma.StallEquipmentIssueUpdateInput = {
    DISTRIBUTE: { distributedAt: now, distributedBy: by },
    UNDISTRIBUTE: { distributedAt: null, distributedBy: null },
    COLLECT_EXTRA_PAYMENT: { extraCollectedAt: now },
    COLLECT: { collectedAt: now, collectedBy: by },
    UNCOLLECT: { collectedAt: null, collectedBy: null },
  }[action];

  const updated = await db.stallEquipmentIssue.update({ where: { requestId }, data });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: `stall_equipment.${action.toLowerCase()}`,
    subjectRef: requestId,
  });
  return toRow(await load(db, requestId), updated, await ratesFor(db, r.editionId, r.requestType));
}

/** The paper slip, assembled server-side so the printout and the screen cannot
 *  disagree. Two copies — vendor and office — are drawn by the client from this
 *  one payload. */
export async function challan(db: PrismaClient, requestId: string): Promise<ChallanView> {
  const r = await load(db, requestId);
  const edition = await db.stallEdition.findUniqueOrThrow({ where: { id: r.editionId } });
  const issue = await ensureIssue(db, r);
  const rates = await ratesFor(db, r.editionId, r.requestType);
  return {
    stallNumber: allocatedNumbers(r).join(', ') || '—',
    stallName: r.stallName,
    ownerName: r.requesterName,
    contactNumber: r.contactNumber,
    category: r.allocations[0]?.stall.category.key ?? '—',
    chairsOnline: issue.chairsRequested,
    tablesOnline: issue.tablesRequested,
    extraChairs: issue.extraChairs,
    extraTables: issue.extraTables,
    extraChargePaise: extraCharge(issue, rates),
    editionName: edition.name,
    printedAt: new Date().toISOString(),
  };
}
