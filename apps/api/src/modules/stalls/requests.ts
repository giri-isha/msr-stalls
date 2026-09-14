import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  DashboardCounts,
  ListRequestsQuery,
  RequestDetail,
  RequestPage,
  RequestSummary,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import type { Db } from './editions';
import { UnknownRequestError } from './errors';
import { MODULE_KEY } from './roles';

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
): Promise<RequestPage> {
  const where: Prisma.StallRequestWhereInput = { editionId };
  if (q.requestType) where.requestType = q.requestType;
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

export async function dashboardCounts(db: Db, editionId: string): Promise<DashboardCounts> {
  const [total, byType, byStatus, flagged, planned, allocated] = await Promise.all([
    db.stallRequest.count({ where: { editionId } }),
    db.stallRequest.groupBy({ by: ['requestType'], where: { editionId }, _count: { _all: true } }),
    db.stallRequest.groupBy({ by: ['status'], where: { editionId }, _count: { _all: true } }),
    db.stallRequest.count({ where: { editionId, flaggedAt: { not: null } } }),
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
