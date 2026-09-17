import type { Prisma, PrismaClient, StallEquipmentIssue } from '@prisma/client';
import type {
  AuditAction,
  AuditEventView,
  ChallanView,
  EquipmentAction,
  EquipmentFound,
  EquipmentPatch,
  EquipmentRow,
} from '@stalls/core';
import { changeSet, equipmentDeduction } from '@stalls/core';
import { requestAudit } from './audit-read';
import { actorFrom, audit } from './audit';
import { chargesFor } from './config';
import type { Db } from './editions';
import { UnknownRequestError } from './errors';
import { allocatedNumbers } from './facts';
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
    damagedChairs: issue.damagedChairs,
    damagedTables: issue.damagedTables,
    deductionPaise: equipmentDeduction(
      {
        missingChairs: issue.missingChairs,
        missingTables: issue.missingTables,
        damagedChairs: issue.damagedChairs,
        damagedTables: issue.damagedTables,
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
  const before = await ensureIssue(db, r);
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

  // 🔴 What CHANGED, not what was sent. The dialog posts every field it holds
  // on every save, so a log of the payload said a counter had touched six
  // figures when they had corrected one — and the row that matters, the chair
  // count somebody argued about, was buried among five that never moved.
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_equipment.updated',
    requestId: requestId,
    changes: changeSet(before, updated, Object.keys(patch)),
  });
  return toRow(await load(db, requestId), withCharge, rates);
}

/**
 * A step of the counter, taken.
 *
 * 🔴 `found` travels WITH the collection, in one write. Counting the stack and
 * marking it collected are one act at the counter and must be one act here:
 * saved-then-collected was two requests over the marquee's wifi, and the half
 * that landed alone left either a row collected with nobody's figures on it or
 * figures against a row still reading as out — the second of which the refund
 * screen would price anyway, for furniture nobody had confirmed was back.
 *
 * ⚠️ Read on COLLECT only. UNCOLLECT does not wipe the figures: what was found
 * is still what was found, and the log carries both events.
 */
export async function actOnEquipment(
  db: PrismaClient,
  requestId: string,
  action: EquipmentAction,
  by: string,
  found?: EquipmentFound,
): Promise<EquipmentRow> {
  const r = await load(db, requestId);
  const before = await ensureIssue(db, r);
  const now = new Date();

  const data: Prisma.StallEquipmentIssueUpdateInput = {
    DISTRIBUTE: { distributedAt: now, distributedBy: by },
    UNDISTRIBUTE: { distributedAt: null, distributedBy: null },
    COLLECT_EXTRA_PAYMENT: { extraCollectedAt: now },
    COLLECT: {
      collectedAt: now,
      collectedBy: by,
      ...(found ? { ...found, note: found.note || null } : {}),
    },
    UNCOLLECT: { collectedAt: null, collectedBy: null },
  }[action];

  const updated = await db.stallEquipmentIssue.update({ where: { requestId }, data });
  await audit(db, {
    actor: actorFrom(by),
    action: `stall_equipment.${action.toLowerCase()}` as AuditAction,
    requestId: requestId,
    changes: found ? changeSet(before, updated, Object.keys(found)) : undefined,
  });
  return toRow(await load(db, requestId), updated, await ratesFor(db, r.editionId, r.requestType));
}

/** This stall's chairs-and-tables trail, newest first.
 *
 *  🔴 Narrowed to `stall_equipment.*` and read with `equipment.read`, NOT with
 *  `audit.read`. The counter volunteer holding the tablet has neither the
 *  privilege nor any business with the rest of the request's log — their bank
 *  details, their fee, who overrode what — but they are exactly the person who
 *  needs to know that somebody already collected this stall an hour ago, and
 *  who. A trail nobody at the counter can read settles no argument at the
 *  counter. */
export async function equipmentHistory(
  db: PrismaClient,
  requestId: string,
): Promise<AuditEventView[]> {
  return requestAudit(db, requestId, 'stall_equipment.');
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
