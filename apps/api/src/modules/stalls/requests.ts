import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  DashboardCounts,
  ListRequestsQuery,
  PatchRequestInput,
  RequestDetail,
  RequestPage,
  RequestSummary,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import type { Db } from './editions';
import { UnknownRequestError, UnknownZoneError } from './errors';
import { MODULE_KEY } from './roles';
import { type RequestScope, UNSCOPED, narrowType, scopeWhere } from './scope';

const summaryInclude = {
  allocations: {
    where: { releasedAt: null },
    include: {
      stall: {
        include: { zone: { select: { code: true } }, category: { select: { key: true } } },
      },
    },
  },
} satisfies Prisma.StallRequestInclude;

type SummaryRow = Prisma.StallRequestGetPayload<{ include: typeof summaryInclude }>;

export function toSummary(r: SummaryRow): RequestSummary {
  return {
    id: r.id,
    reference: r.reference,
    requestType: r.requestType,
    stallType: r.stallType,
    stallName: r.stallName,
    requesterName: r.requesterName,
    email: r.email,
    contactNumber: r.contactNumber,
    preferredZoneCode: r.preferredZoneCode,
    agreedZoneCode: r.agreedZoneCode,
    numStallsRequested: r.numStallsRequested,
    status: r.status,
    stage: r.stage,
    submittedAt: r.submittedAt.toISOString(),
    flagged: r.flaggedAt !== null,
    allocatedStalls: r.allocations.map((a) => a.stall.number),
  };
}

/** Cursor = `submittedAt|id`, base64url. The list is ordered by exactly those
 *  two columns, descending, so the cursor is a total order and pagination can
 *  neither repeat nor skip a row when new requests arrive mid-scroll. */
function encodeCursor(r: { submittedAt: Date; id: string }): string {
  return Buffer.from(`${r.submittedAt.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(c: string): { submittedAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(c, 'base64url').toString().split('|');
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || !id) return null;
    return { submittedAt: d, id };
  } catch {
    return null;
  }
}

export async function listRequests(
  db: Db,
  editionId: string,
  q: ListRequestsQuery,
  scope: RequestScope = UNSCOPED,
): Promise<RequestPage> {
  // A caller asking for a type their roles do not cover gets an empty page, not
  // an error: the filter matches nothing they may see, which is what "no
  // results" means.
  const typeWhere = narrowType(scope, q.requestType);
  if (!typeWhere) return { items: [], nextCursor: null };
  const where: Prisma.StallRequestWhereInput = { editionId, ...typeWhere };
  if (q.status) where.status = q.status;
  if (q.stage) where.stage = q.stage;
  if (q.zoneCode) where.preferredZoneCode = q.zoneCode;
  if (q.flagged === true) where.flaggedAt = { not: null };
  if (q.q) {
    const term = q.q.trim();
    where.OR = [
      // Reference matches exactly (case-insensitive so "ven-2026-0042" works);
      // the rest match anywhere, case-insensitively.
      { reference: { equals: term, mode: 'insensitive' } },
      { stallName: { contains: term, mode: 'insensitive' } },
      { requesterName: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { contactNumber: { contains: term.replace(/\D/g, '') || term } },
    ];
  }
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (cursor) {
    where.AND = [
      {
        OR: [
          { submittedAt: { lt: cursor.submittedAt } },
          { submittedAt: cursor.submittedAt, id: { lt: cursor.id } },
        ],
      },
    ];
  }

  const rows = await db.stallRequest.findMany({
    where,
    include: summaryInclude,
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
  };
}

export async function getRequest(db: Db, id: string): Promise<RequestDetail> {
  const r = await db.stallRequest.findUnique({
    where: { id },
    include: {
      ...summaryInclude,
      ashramDetail: true,
      appliances: { orderBy: { sortOrder: 'asc' } },
      customValues: { include: { field: { select: { label: true } } } },
    },
  });
  if (!r) throw new UnknownRequestError(id);
  return {
    ...toSummary(r),
    address: r.address,
    itemsSelling: r.itemsSelling,
    remarks: r.remarks,
    plugs5a: r.plugs5a,
    plugs15a: r.plugs15a,
    gasStoves: r.gasStoves,
    tablesNeeded: r.tablesNeeded,
    chairsNeeded: r.chairsNeeded,
    passes2w: r.passes2w,
    passes4w: r.passes4w,
    passesStaff: r.passesStaff,
    agreedAt: r.agreedAt.toISOString(),
    depositAcknowledgedAt: r.depositAcknowledgedAt?.toISOString() ?? null,
    flagReason: r.flagReason,
    rejectReason: r.rejectReason,
    ashram: r.ashramDetail
      ? {
          departmentHead: r.ashramDetail.departmentHead,
          departmentHeadContact: r.ashramDetail.departmentHeadContact,
          department: r.ashramDetail.department,
          requestedBy: r.ashramDetail.requestedBy,
          requesterContact: r.ashramDetail.requesterContact,
          creditCardNeeded: r.ashramDetail.creditCardNeeded,
          usage: r.ashramDetail.usage,
          usageOther: r.ashramDetail.usageOther,
          wantsThembu: r.ashramDetail.wantsThembu,
          fssaiExpected: r.ashramDetail.fssaiExpected,
        }
      : null,
    appliances: r.appliances.map((a) => ({ name: a.name, watts: a.watts })),
    customValues: r.customValues.map((v) => ({
      fieldId: v.customFieldId,
      label: v.field.label,
      value: v.value,
    })),
    allocations: r.allocations.map((a) => ({
      id: a.id,
      stallNumber: a.stall.number,
      zoneCode: a.stall.zone.code,
      category: a.stall.category.key,
      allocatedAt: a.allocatedAt.toISOString(),
    })),
  };
}

/** Correcting a request on the staff side.
 *
 *  🔴 Two jobs, one route. The first is ordinary: "in case there are any other
 *  changes, we anyway speak to them over call and make that" — a phone number
 *  typed wrong, a chair count that moved, an item list the vendor revised.
 *
 *  The second is the bay. A shortlisted vendor is routinely moved — "why don't
 *  you look at this side, that side is already filled up" — and the bay they
 *  settle on is what the rent is read from. `selectRequest` records it when the
 *  move happens at selection; this records it when it happens after, and is the
 *  only way to clear it back to null when the conversation falls through.
 *
 *  ⚠️ What is ABSENT is the point: status, stage, stall numbers, money and the
 *  agreement timestamps are not patchable here. Each has its own route and its
 *  own guard, and a general patch that could reach them would be a way around
 *  every one of those. See `PatchRequestInput`.
 *
 *  A patch after the payment letter has gone out does not change what the
 *  vendor was told: that figure is frozen in `StallPaymentPlan`. It changes
 *  what the NEXT letter and the electrical sheet will say, which is what a
 *  correction is for.
 */
export async function patchRequest(
  db: PrismaClient,
  id: string,
  input: PatchRequestInput,
  by: string,
): Promise<RequestDetail> {
  const r = await db.stallRequest.findUnique({
    where: { id },
    select: { id: true, editionId: true },
  });
  if (!r) throw new UnknownRequestError(id);

  // Both bays are checked against the edition's OWN zones. `ZoneCodeValue` only
  // says a string is shaped like a bay code; whether this season has that bay
  // is a row, and Admin adds and removes them.
  for (const code of [input.preferredZoneCode, input.agreedZoneCode]) {
    if (!code) continue;
    const zone = await db.stallZone.findFirst({
      where: { editionId: r.editionId, code },
      select: { id: true },
    });
    if (!zone) throw new UnknownZoneError(code);
  }

  const { appliances, ...scalars } = input;
  await db.$transaction(async (tx) => {
    if (Object.keys(scalars).length > 0) {
      await tx.stallRequest.update({ where: { id }, data: scalars });
    }
    // Appliances are child rows and arrive whole: the list sent IS the list,
    // so a patch that omits one is removing it, not leaving it alone.
    if (appliances) {
      await tx.stallRequestAppliance.deleteMany({ where: { requestId: id } });
      if (appliances.length > 0) {
        await tx.stallRequestAppliance.createMany({
          data: appliances.map((a, sortOrder) => ({
            requestId: id,
            name: a.name,
            watts: a.watts,
            sortOrder,
          })),
        });
      }
    }
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_request.amended',
      subjectRef: id,
      detail: { fields: Object.keys(input) },
    });
  });

  return getRequest(db, id);
}

export async function flagRequest(db: PrismaClient, id: string, reason: string, by: string) {
  const exists = await db.stallRequest.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new UnknownRequestError(id);
  await db.stallRequest.update({
    where: { id },
    data: { flaggedAt: new Date(), flagReason: reason },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_request.flagged',
    subjectRef: id,
    detail: { reason },
  });
}

export async function unflagRequest(db: PrismaClient, id: string, by: string) {
  const exists = await db.stallRequest.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new UnknownRequestError(id);
  await db.stallRequest.update({ where: { id }, data: { flaggedAt: null, flagReason: null } });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_request.unflagged',
    subjectRef: id,
  });
}

export async function dashboardCounts(
  db: Db,
  editionId: string,
  scope: RequestScope = UNSCOPED,
): Promise<DashboardCounts> {
  // The stall counts are the venue's, not any one requester's, so they are not
  // narrowed — a scoped caller sees how much ground exists, and whose it is
  // only for the requests they cover.
  const mine: Prisma.StallRequestWhereInput = { editionId, ...scopeWhere(scope) };
  const [total, byType, byStatus, flagged, planned, allocated] = await Promise.all([
    db.stallRequest.count({ where: mine }),
    db.stallRequest.groupBy({ by: ['requestType'], where: mine, _count: { _all: true } }),
    db.stallRequest.groupBy({ by: ['status'], where: mine, _count: { _all: true } }),
    db.stallRequest.count({ where: { ...mine, flaggedAt: { not: null } } }),
    db.stall.count({ where: { zone: { editionId } } }),
    db.stall.count({ where: { zone: { editionId }, status: 'ALLOCATED' } }),
  ]);
  return {
    total,
    byType: Object.fromEntries(byType.map((r) => [r.requestType, r._count._all])),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    flagged,
    stallsPlanned: planned,
    stallsAllocated: allocated,
  };
}
