import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AuditAction,
  AuditEventView,
  ChallanView,
  DeductionLine,
  EquipmentAction,
  EquipmentFound,
  EquipmentHandout,
  EquipmentItemRow,
  EquipmentPatch,
  EquipmentRow,
} from '@stalls/core';
import { changeSet, equipmentDeduction } from '@stalls/core';
import { ValidationFailedError } from '../../errors';
import { requestAudit } from './audit-read';
import { actorFrom, audit } from './audit';
import { activeChargeItems, chargesFor } from './config';
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
    equipment: { include: { items: true } };
    allocations: { include: { stall: { include: { category: { select: { key: true } } } } } };
  };
}>;

const rowInclude = {
  equipment: { include: { items: true } },
  allocations: {
    where: { releasedAt: null },
    include: { stall: { include: { category: { select: { key: true } } } } },
  },
} satisfies Prisma.StallRequestInclude;

type ChargeItem = Awaited<ReturnType<typeof activeChargeItems>>[number];
type Issue = Prisma.StallEquipmentIssueGetPayload<{ include: { items: true } }>;

interface Rates {
  chair: number;
  table: number;
  chairReplacementPaise: number;
  tableReplacementPaise: number;
  chairDamagePaise: number;
  tableDamagePaise: number;
  chairPerDay: boolean;
  tablePerDay: boolean;
  /** Every item this edition lends, with this requester type's column already
   *  picked. The counter is not the place to work out which of three rates
   *  applies. */
  items: Array<ChargeItem & { ratePaise: number }>;
}

/**
 * The rates that apply to THIS requester, across everything lent.
 *
 * 🔴 Three columns, chosen by requester type — not two. A vendor used to fall
 * through to the ashram rate here, which is the one requester type that is
 * never billed at all: the counter took ₹50 for a chair the payment letter had
 * quoted at ₹100. `quote.ts` has carried the vendor pair since the letter was
 * written and this file did not, so the paper and the till disagreed all day.
 */
async function ratesFor(db: Db, editionId: string, requestType: string): Promise<Rates> {
  const c = await chargesFor(db, editionId);
  const items = await activeChargeItems(db, editionId);
  const pick = <T>(vendor: T, lw: T, ashram: T): T =>
    requestType === 'VENDOR' ? vendor : requestType === 'LOCAL_WELFARE' ? lw : ashram;
  return {
    chair: pick(c.vendorChairRatePaise, c.lwChairRatePaise, c.chairRatePaise),
    table: pick(c.vendorTableRatePaise, c.lwTableRatePaise, c.tableRatePaise),
    chairReplacementPaise: c.chairReplacementPaise,
    tableReplacementPaise: c.tableReplacementPaise,
    chairDamagePaise: c.chairDamagePaise,
    tableDamagePaise: c.tableDamagePaise,
    chairPerDay: c.chairPerDay,
    tablePerDay: c.tablePerDay,
    items: items.map((i) => ({
      ...i,
      ratePaise: pick(i.vendorRatePaise, i.lwRatePaise, i.ashramRatePaise),
    })),
  };
}

/**
 * What the counter takes in cash when the furniture goes out.
 *
 * 🔴 ONE day for the per-day things, however long they are kept. The payment
 * letter already priced the ORDERED chairs and tables for the days they were
 * planned to be held; what the counter adds on top is settled a day at a time,
 * because on the morning it is handed over nobody knows how many days it will
 * be. The rest is charged at return, off the deposit — see `equipmentDeduction`.
 *
 * ⚠️ Flat items take their whole charge here and settle nothing later. Laying a
 * carpet costs what it costs whether it is walked on for one day or three.
 */
function extraCharge(issue: Issue, rates: Rates): number {
  const furniture = issue.extraChairs * rates.chair + issue.extraTables * rates.table;
  const items = issue.items.reduce((total, row) => {
    const item = rates.items.find((i) => i.id === row.itemId);
    return item ? total + row.count * item.ratePaise : total;
  }, 0);
  return furniture + items;
}

/**
 * Everything chargeable about this stall, in the one shape the deduction maths
 * reads — chairs and tables off the config columns, the rest off the catalogue.
 *
 * ⚠️ `extraCount` is what the counter handed out BEYOND the payment letter. For
 * chairs and tables that is the extra; for a fan, which no letter ever knew
 * about, it is the whole count.
 */
function deductionLines(issue: Issue, rates: Rates): DeductionLine[] {
  const lines: DeductionLine[] = [
    {
      label: 'Chair',
      extraCount: issue.extraChairs,
      ratePaise: rates.chair,
      perDay: rates.chairPerDay,
      missing: issue.missingChairs,
      missingPaise: rates.chairReplacementPaise,
      damaged: issue.damagedChairs,
      damagedPaise: rates.chairDamagePaise,
    },
    {
      label: 'Table',
      extraCount: issue.extraTables,
      ratePaise: rates.table,
      perDay: rates.tablePerDay,
      missing: issue.missingTables,
      missingPaise: rates.tableReplacementPaise,
      damaged: issue.damagedTables,
      damagedPaise: rates.tableDamagePaise,
    },
  ];
  for (const row of issue.items) {
    // Priced off the catalogue as it stands. An item retired since it was lent
    // is not in `rates.items`, so it is read from the row's own relation by the
    // caller that needs it — `listEquipment` passes only active items, and a
    // retired one contributes nothing rather than crashing the whole list.
    const item = rates.items.find((i) => i.id === row.itemId);
    if (!item) continue;
    lines.push({
      label: item.name,
      extraCount: row.count,
      ratePaise: item.ratePaise,
      perDay: item.perDay,
      missing: row.missing,
      missingPaise: item.missingPaise,
      damaged: row.damaged,
      damagedPaise: item.damagedPaise,
    });
  }
  return lines;
}

function itemRows(issue: Issue, rates: Rates): EquipmentItemRow[] {
  return rates.items.map((item) => {
    const row = issue.items.find((r) => r.itemId === item.id);
    return {
      itemId: item.id,
      name: item.name,
      perDay: item.perDay,
      ratePaise: item.ratePaise,
      missingPaise: item.missingPaise,
      damagedPaise: item.damagedPaise,
      count: row?.count ?? 0,
      missing: row?.missing ?? 0,
      damaged: row?.damaged ?? 0,
    };
  });
}

function toRow(r: Row, issue: Issue, rates: Rates): EquipmentRow {
  const deduction = equipmentDeduction(deductionLines(issue, rates), issue.daysHeld);
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
    chairRatePaise: rates.chair,
    tableRatePaise: rates.table,
    extraChargePaise: extraCharge(issue, rates),
    extraCollectedAt: issue.extraCollectedAt?.toISOString() ?? null,
    distributedAt: issue.distributedAt?.toISOString() ?? null,
    collectedAt: issue.collectedAt?.toISOString() ?? null,
    missingChairs: issue.missingChairs,
    missingTables: issue.missingTables,
    damagedChairs: issue.damagedChairs,
    damagedTables: issue.damagedTables,
    daysHeld: issue.daysHeld,
    items: itemRows(issue, rates),
    deductionPaise: deduction.totalPaise,
    deductionLines: deduction.lines,
    note: issue.note,
    flagged: issue.flagged,
  };
}

/** Creates the counter row on first sight, snapshotting the order. */
async function ensureIssue(db: PrismaClient, r: Row): Promise<Issue> {
  if (r.equipment) return r.equipment;
  return db.stallEquipmentIssue.upsert({
    where: { requestId: r.id },
    create: {
      requestId: r.id,
      chairsRequested: r.chairsNeeded,
      tablesRequested: r.tablesNeeded,
    },
    update: {},
    include: { items: true },
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
    include: { items: true },
  });
  // The cash figure is derived from the counts and rewritten on every change,
  // so it can never drift from what the counter is looking at.
  const withCharge = await db.stallEquipmentIssue.update({
    where: { requestId },
    data: { extraChargePaise: extraCharge(updated, rates) },
    include: { items: true },
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

/** Writes one row per item touched, leaving the rest alone.
 *
 *  ⚠️ Rows are kept at zero rather than deleted. "Handed out none" and "never
 *  asked" look the same to a reader of the table, and at the return counter the
 *  difference is whether somebody has already been down this list. */
async function writeItems(
  tx: Prisma.TransactionClient,
  requestId: string,
  rows: Array<{ itemId: string; count?: number; missing?: number; damaged?: number }>,
): Promise<void> {
  for (const row of rows) {
    const { itemId, ...data } = row;
    await tx.stallEquipmentIssueItem.upsert({
      where: { requestId_itemId: { requestId, itemId } },
      create: { requestId, itemId, ...data },
      update: data,
    });
  }
}

/** 🔴 Cash already taken freezes the chargeable counts. The counter hands the
 *  stack over, takes the money, and the figure on the signed challan is now the
 *  figure. Undo-and-redistribute would otherwise rewrite it silently, and the
 *  till and the paper would part company with nobody the wiser. Correcting a
 *  genuine mistake means voiding the collection first, which is logged. */
function assertExtrasUnlocked(issue: Issue, changing: boolean): void {
  if (!changing || !issue.extraCollectedAt) return;
  throw new ValidationFailedError([
    {
      row: 0,
      fieldKey: 'handout',
      message: 'Cash has already been taken for the extras, so the counts are fixed.',
    },
  ]);
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
  handout?: EquipmentHandout,
): Promise<EquipmentRow> {
  const r = await load(db, requestId);
  const before = await ensureIssue(db, r);
  const rates = await ratesFor(db, r.editionId, r.requestType);
  const now = new Date();

  // What the counter counted, turned into what the letter did not already pay
  // for. The dialog asks for TOTALS — "how many chairs are you handing over" —
  // because a volunteer asked for "the extra" does the subtraction in their
  // head while somebody waits, and gets it wrong.
  const extras = handout
    ? {
        extraChairs: Math.max(0, handout.chairs - before.chairsRequested),
        extraTables: Math.max(0, handout.tables - before.tablesRequested),
      }
    : null;

  const data: Prisma.StallEquipmentIssueUpdateInput = {
    DISTRIBUTE: { distributedAt: now, distributedBy: by, ...(extras ?? {}) },
    UNDISTRIBUTE: { distributedAt: null, distributedBy: null },
    COLLECT_EXTRA_PAYMENT: { extraCollectedAt: now },
    COLLECT: {
      collectedAt: now,
      collectedBy: by,
      ...(found
        ? {
            missingChairs: found.missingChairs,
            missingTables: found.missingTables,
            damagedChairs: found.damagedChairs,
            damagedTables: found.damagedTables,
            daysHeld: found.daysHeld,
            note: found.note || null,
          }
        : {}),
    },
    UNCOLLECT: { collectedAt: null, collectedBy: null },
  }[action];

  if (action === 'DISTRIBUTE') assertExtrasUnlocked(before, handout !== undefined);

  // 🔴 ONE transaction. The counts, the item rows and the cash figure are one
  // act at the counter: a half-landed save over the marquee's wifi leaves a
  // stall marked distributed with nobody's figures against it, or a cash total
  // that does not match the rows it was added up from.
  const updated = await db.$transaction(async (tx) => {
    await tx.stallEquipmentIssue.update({ where: { requestId }, data });
    if (action === 'DISTRIBUTE' && handout) await writeItems(tx, requestId, handout.items);
    if (action === 'COLLECT' && found) await writeItems(tx, requestId, found.items);
    const withItems = await tx.stallEquipmentIssue.findUniqueOrThrow({
      where: { requestId },
      include: { items: true },
    });
    if (action !== 'DISTRIBUTE') return withItems;
    // Rewritten from the counts rather than sent by the client, so the cash
    // figure can never drift from what the counter is looking at — the same
    // rule `patchEquipment` follows.
    return tx.stallEquipmentIssue.update({
      where: { requestId },
      data: { extraChargePaise: extraCharge(withItems, rates) },
      include: { items: true },
    });
  });

  await audit(db, {
    actor: actorFrom(by),
    action: `stall_equipment.${action.toLowerCase()}` as AuditAction,
    requestId: requestId,
    changes: found
      ? changeSet(before, updated, [
          'missingChairs',
          'missingTables',
          'damagedChairs',
          'damagedTables',
          'daysHeld',
          'note',
        ])
      : handout
        ? changeSet(before, updated, ['extraChairs', 'extraTables', 'extraChargePaise'])
        : undefined,
  });
  return toRow(await load(db, requestId), updated, rates);
}

/**
 * What the refund screen should suggest withholding, priced the same way the
 * counter prices it.
 *
 * 🔴 Exported so Finance reads THIS and not its own copy of the arithmetic. The
 * counter shows the vendor a figure at the table and the refund screen shows
 * the team a figure a week later; two implementations of "what do they owe for
 * the fan" is two different answers to the same question, and the vendor is
 * standing in front of only one of them.
 */
export async function deductionFor(
  db: Db,
  editionId: string,
  requestType: string,
  issue: Issue,
): Promise<{ totalPaise: number; lines: Array<{ label: string; amountPaise: number }> }> {
  const rates = await ratesFor(db, editionId, requestType);
  return equipmentDeduction(deductionLines(issue, rates), issue.daysHeld);
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
    // Only what actually left the store. The screen draws every item so the
    // counter can type into it; the PAPER lists what the vendor is signing for,
    // and a challan padded with zero rows is one nobody reads to the bottom of.
    items: issue.items
      .filter((row) => row.count > 0)
      .flatMap((row) => {
        const item = rates.items.find((i) => i.id === row.itemId);
        return item
          ? [{ name: item.name, count: row.count, amountPaise: row.count * item.ratePaise }]
          : [];
      }),
    extraChargePaise: extraCharge(issue, rates),
    daysHeld: issue.daysHeld,
    editionName: edition.name,
    printedAt: new Date().toISOString(),
  };
}
