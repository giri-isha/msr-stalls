import type { Prisma, PrismaClient } from '@prisma/client';
import {
  type CheckInInput,
  type CheckInRow,
  type ElectricalRow,
  type FssaiUploadInput,
  type FurnitureIssueInput,
  type FurnitureReturnInput,
  type FurnitureRow,
  type PublicFssaiView,
  type PublicStaffView,
  type RefundRow,
  computeRefund,
  furnitureRates,
  newCouponCode,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import { resolveAccessLink } from './accounts';
import { chargesFor, linksFor } from './config';
import type { Db } from './editions';
import { NotIssuedError, NotSelectedError, UnknownRequestError } from './errors';
import { MODULE_KEY } from './roles';
import { advanceStage } from './stage';

const mask = (n: string) =>
  n.length <= 4 ? n : `${'•'.repeat(Math.max(0, n.length - 4))}${n.slice(-4)}`;

async function selectedRequest(db: Db, requestId: string) {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: {
      allocations: { where: { releasedAt: null }, include: { stall: { include: { zone: true } } } },
    },
  });
  if (!r) throw new UnknownRequestError(requestId);
  if (r.status !== 'SELECTED') throw new NotSelectedError(requestId);
  return r;
}

// ── Staff coupons ───────────────────────────────────────────────────────────

/** Issue (or re-issue) the coupon. Re-issuing revokes nothing — the code is
 *  stable once created, so a vendor who already shared it with staff is not
 *  cut off; only `maxStaff` may be raised. */
export async function issueCoupon(
  db: PrismaClient,
  requestId: string,
  by: string,
  maxStaff?: number,
) {
  const r = await selectedRequest(db, requestId);
  const existing = await db.stallStaffCoupon.findUnique({ where: { requestId } });
  const max = maxStaff ?? existing?.maxStaff ?? r.passesStaff;
  if (existing) {
    return db.stallStaffCoupon.update({ where: { requestId }, data: { maxStaff: max } });
  }
  const edition = await db.stallEdition.findUniqueOrThrow({ where: { id: r.editionId } });
  const stallNumber = r.allocations[0]?.stall.number ?? r.reference;
  // Unique by construction is not a guarantee: retry on the rare collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCouponCode(edition.year, stallNumber);
    const clash = await db.stallStaffCoupon.findUnique({ where: { code } });
    if (clash) continue;
    const row = await db.stallStaffCoupon.create({
      data: { requestId, code, maxStaff: max, issuedBy: by },
    });
    await recordActivity(db, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_coupon.issued',
      subjectRef: requestId,
      detail: { maxStaff: max },
    });
    return row;
  }
  throw new Error('could not mint a unique coupon code');
}

export async function setRegisteredCount(
  db: PrismaClient,
  requestId: string,
  registeredCount: number,
  by: string,
) {
  const row = await db.stallStaffCoupon.update({ where: { requestId }, data: { registeredCount } });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_coupon.registered_count',
    subjectRef: requestId,
    detail: { registeredCount },
  });
  return row;
}

export async function staffView(db: Db, token: string): Promise<PublicStaffView> {
  const link = await resolveAccessLink(db, token, 'STAFF_REGISTRATION');
  const r = await db.stallRequest.findUniqueOrThrow({
    where: { id: link.requestId ?? '' },
    include: {
      allocations: { where: { releasedAt: null }, include: { stall: true } },
      staffCoupon: true,
    },
  });
  const links = await linksFor(db, r.editionId);
  return {
    reference: r.reference,
    stallName: r.stallName,
    stallNumbers: r.allocations.map((a) => a.stall.number),
    couponCode: r.staffCoupon?.code ?? null,
    maxStaff: r.staffCoupon?.maxStaff ?? r.passesStaff,
    registeredCount: r.staffCoupon?.registeredCount ?? 0,
    staffRegistrationUrl: links.staffRegistrationUrl,
  };
}

// ── FSSAI ───────────────────────────────────────────────────────────────────

export async function fssaiView(db: Db, token: string): Promise<PublicFssaiView> {
  const link = await resolveAccessLink(db, token, 'FSSAI_UPLOAD');
  const r = await db.stallRequest.findUniqueOrThrow({
    where: { id: link.requestId ?? '' },
    include: { fssai: true },
  });
  const links = await linksFor(db, r.editionId);
  return {
    reference: r.reference,
    stallName: r.stallName,
    fssaiProcessUrl: links.fssaiProcessUrl,
    current: r.fssai
      ? {
          fileName: r.fssai.fileName,
          uploadedAt: r.fssai.uploadedAt.toISOString(),
          verifiedAt: r.fssai.verifiedAt?.toISOString() ?? null,
          rejectedReason: r.fssai.rejectedReason,
        }
      : null,
  };
}

/** A new upload replaces the old one and clears any rejection — the vendor is
 *  answering it. Verification is staff's, so it clears too. */
export async function submitFssai(db: PrismaClient, token: string, input: FssaiUploadInput) {
  const link = await resolveAccessLink(db, token, 'FSSAI_UPLOAD');
  const requestId = link.requestId ?? '';
  const data = {
    mediaKey: input.mediaKey,
    fileName: input.fileName,
    licenseNumber: input.licenseNumber || null,
    validTill: input.validTill ? new Date(`${input.validTill}T00:00:00Z`) : null,
    uploadedAt: new Date(),
    verifiedAt: null,
    verifiedBy: null,
    rejectedReason: null,
  };
  const row = await db.stallFssai.upsert({
    where: { requestId },
    create: { requestId, ...data },
    update: data,
  });
  await recordActivity(db, {
    actorRef: 'vendor',
    moduleKey: MODULE_KEY,
    action: 'stall_fssai.uploaded',
    subjectRef: requestId,
  });
  return row;
}

export async function reviewFssai(
  db: PrismaClient,
  requestId: string,
  verdict: 'VERIFY' | 'REJECT',
  reason: string | undefined,
  by: string,
) {
  const existing = await db.stallFssai.findUnique({ where: { requestId } });
  if (!existing) throw new UnknownRequestError(requestId);
  const row = await db.stallFssai.update({
    where: { requestId },
    data:
      verdict === 'VERIFY'
        ? { verifiedAt: new Date(), verifiedBy: by, rejectedReason: null }
        : { verifiedAt: null, verifiedBy: null, rejectedReason: reason ?? 'not accepted' },
  });
  if (verdict === 'VERIFY') await advanceStage(db, requestId, 'FSSAI_VERIFIED');
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: `stall_fssai.${verdict.toLowerCase()}`,
    subjectRef: requestId,
    detail: { reason },
  });
  return row;
}

// ── Electrical & venue ──────────────────────────────────────────────────────

/** One row per stall, occupied or not — the electrician needs the empties too. */
export async function electricalRows(
  db: Db,
  editionId: string,
  zoneCode?: string,
): Promise<ElectricalRow[]> {
  const stalls = await db.stall.findMany({
    where: { zone: { editionId, ...(zoneCode ? { code: zoneCode } : {}) } },
    include: {
      zone: true,
      activeAllocation: {
        include: { request: { include: { appliances: { orderBy: { sortOrder: 'asc' } } } } },
      },
    },
  });
  const num = (s: string) => Number(s.split('-')[1] ?? 0);
  stalls.sort((a, b) => a.zone.sortOrder - b.zone.sortOrder || num(a.number) - num(b.number));
  return stalls.map((s) => {
    const r = s.activeAllocation?.request ?? null;
    const appliances = r?.appliances.map((a) => ({ name: a.name, watts: a.watts })) ?? [];
    return {
      stallNumber: s.number,
      zoneCode: s.zone.code,
      cluster: s.cluster,
      category: s.category,
      reference: r?.reference ?? null,
      stallName: r?.stallName ?? null,
      requestType: r?.requestType ?? null,
      plugs5a: r?.plugs5a ?? 0,
      plugs15a: r?.plugs15a ?? 0,
      gasStoves: r?.gasStoves ?? 0,
      appliances,
      totalWatts: appliances.reduce((n, a) => n + a.watts, 0),
    };
  });
}

export async function setCluster(
  db: PrismaClient,
  editionId: string,
  stallNumber: string,
  cluster: string | null,
  by: string,
) {
  const stall = await db.stall.findFirst({ where: { number: stallNumber, zone: { editionId } } });
  if (!stall) throw new UnknownRequestError(stallNumber);
  const row = await db.stall.update({ where: { id: stall.id }, data: { cluster } });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall.cluster_set',
    subjectRef: stall.id,
    detail: { cluster },
  });
  return row;
}

// ── Check-in ────────────────────────────────────────────────────────────────

const checkInInclude = {
  allocations: { where: { releasedAt: null }, include: { stall: true } },
  bankDetails: { select: { submittedAt: true } },
  payment: { select: { confirmedAt: true } },
  fssai: { select: { verifiedAt: true } },
  staffCoupon: { select: { registeredCount: true, maxStaff: true } },
  checkIn: true,
  edition: { include: { flow: true } },
} satisfies Prisma.StallRequestInclude;

function pendingFor(
  r: Prisma.StallRequestGetPayload<{ include: typeof checkInInclude }>,
): string[] {
  const flow = r.edition.flow;
  const ashram = r.requestType === 'ASHRAM' || r.requestType === 'ASHRAM_FOOD';
  const out: string[] = [];
  if (!ashram && (flow?.bankStepEnabled ?? true) && !r.bankDetails) out.push('Bank details');
  if (!ashram && (flow?.paymentStepEnabled ?? true) && !r.payment?.confirmedAt) out.push('Payment');
  if (r.stallType === 'FOOD' && (flow?.fssaiStepEnabled ?? true) && !r.fssai?.verifiedAt)
    out.push('FSSAI certificate');
  if (r.passesStaff > 0 && (r.staffCoupon?.registeredCount ?? 0) < r.passesStaff) {
    out.push(`Staff registered ${r.staffCoupon?.registeredCount ?? 0}/${r.passesStaff}`);
  }
  return out;
}

export async function checkInRows(db: Db, editionId: string, q?: string): Promise<CheckInRow[]> {
  const term = q?.trim();
  const rows = await db.stallRequest.findMany({
    where: {
      editionId,
      status: 'SELECTED',
      ...(term
        ? {
            OR: [
              { stallName: { contains: term, mode: 'insensitive' } },
              { reference: { equals: term, mode: 'insensitive' } },
              { requesterName: { contains: term, mode: 'insensitive' } },
              {
                allocations: {
                  some: { releasedAt: null, stall: { number: { equals: term.toUpperCase() } } },
                },
              },
            ],
          }
        : {}),
    },
    include: checkInInclude,
    orderBy: { stallName: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    contactNumber: r.contactNumber,
    requestType: r.requestType,
    stage: r.stage,
    allocatedStalls: r.allocations.map((a) => a.stall.number),
    passes2w: r.passes2w,
    passes4w: r.passes4w,
    passesStaff: r.passesStaff,
    coupon: r.staffCoupon,
    pending: pendingFor(r),
    checkedInAt: r.checkIn?.checkedInAt.toISOString() ?? null,
  }));
}

export async function checkIn(
  db: PrismaClient,
  requestId: string,
  input: CheckInInput,
  by: string,
) {
  await selectedRequest(db, requestId);
  const row = await db.stallCheckIn.upsert({
    where: { requestId },
    create: { requestId, checkedInBy: by, ...input },
    update: { ...input },
  });
  await advanceStage(db, requestId, 'CHECKED_IN');
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_request.checked_in',
    subjectRef: requestId,
    detail: input,
  });
  return row;
}

// ── Chairs & tables ─────────────────────────────────────────────────────────

export async function furnitureRows(db: Db, editionId: string): Promise<FurnitureRow[]> {
  const rows = await db.stallRequest.findMany({
    where: { editionId, status: 'SELECTED' },
    include: {
      allocations: { where: { releasedAt: null }, include: { stall: true } },
      furniture: true,
    },
    orderBy: { stallName: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requestType: r.requestType,
    contactNumber: r.contactNumber,
    allocatedStalls: r.allocations.map((a) => a.stall.number),
    chairsOrdered: r.chairsNeeded,
    tablesOrdered: r.tablesNeeded,
    ledger: r.furniture
      ? {
          chairsIssued: r.furniture.chairsIssued,
          tablesIssued: r.furniture.tablesIssued,
          extraChairs: r.furniture.extraChairs,
          extraTables: r.furniture.extraTables,
          extraChargePaise: r.furniture.extraChargePaise,
          cashCollectedPaise: r.furniture.cashCollectedPaise,
          issuedAt: r.furniture.issuedAt?.toISOString() ?? null,
          chairsReturned: r.furniture.chairsReturned,
          tablesReturned: r.furniture.tablesReturned,
          chairsMissing: r.furniture.chairsMissing,
          tablesMissing: r.furniture.tablesMissing,
          chairsDamaged: r.furniture.chairsDamaged,
          tablesDamaged: r.furniture.tablesDamaged,
          returnedAt: r.furniture.returnedAt?.toISOString() ?? null,
          flagged: r.furniture.flagged,
          notes: r.furniture.notes,
        }
      : null,
  }));
}

/** At the counter: what went out. Extras are charged at the requester's own
 *  daily rate for the edition's days; cash collected is recorded as typed. */
export async function issueFurniture(
  db: PrismaClient,
  requestId: string,
  input: FurnitureIssueInput,
  by: string,
) {
  const r = await selectedRequest(db, requestId);
  const charges = await chargesFor(db, r.editionId);
  const { chairPaise, tablePaise } = furnitureRates(r.requestType, charges);
  const extraChargePaise =
    (input.extraChairs * chairPaise + input.extraTables * tablePaise) *
    Math.max(1, charges.eventDays);
  const row = await db.stallFurnitureLedger.upsert({
    where: { requestId },
    create: {
      requestId,
      chairsOrdered: r.chairsNeeded,
      tablesOrdered: r.tablesNeeded,
      chairsIssued: input.chairsIssued,
      tablesIssued: input.tablesIssued,
      extraChairs: input.extraChairs,
      extraTables: input.extraTables,
      extraChargePaise,
      cashCollectedPaise: input.cashCollectedPaise,
      issuedAt: new Date(),
      issuedBy: by,
      notes: input.notes ?? null,
    },
    update: {
      chairsIssued: input.chairsIssued,
      tablesIssued: input.tablesIssued,
      extraChairs: input.extraChairs,
      extraTables: input.extraTables,
      extraChargePaise,
      cashCollectedPaise: input.cashCollectedPaise,
      issuedAt: new Date(),
      issuedBy: by,
      notes: input.notes ?? undefined,
    },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_furniture.issued',
    subjectRef: requestId,
    detail: { ...input, extraChargePaise },
  });
  return row;
}

/** Next day: what came back. Missing = issued + extra − returned, never below
 *  zero. Anything missing or damaged flags the stall for the refund review. */
export async function returnFurniture(
  db: PrismaClient,
  requestId: string,
  input: FurnitureReturnInput,
  by: string,
) {
  const led = await db.stallFurnitureLedger.findUnique({ where: { requestId } });
  if (!led || !led.issuedAt) throw new NotIssuedError(requestId);
  const chairsMissing = Math.max(0, led.chairsIssued + led.extraChairs - input.chairsReturned);
  const tablesMissing = Math.max(0, led.tablesIssued + led.extraTables - input.tablesReturned);
  const flagged =
    input.flagged || chairsMissing + tablesMissing + input.chairsDamaged + input.tablesDamaged > 0;
  const row = await db.stallFurnitureLedger.update({
    where: { requestId },
    data: {
      chairsReturned: input.chairsReturned,
      tablesReturned: input.tablesReturned,
      chairsMissing,
      tablesMissing,
      chairsDamaged: input.chairsDamaged,
      tablesDamaged: input.tablesDamaged,
      returnedAt: new Date(),
      returnedBy: by,
      flagged,
      notes: input.notes ?? undefined,
    },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_furniture.returned',
    subjectRef: requestId,
    detail: { chairsMissing, tablesMissing, flagged },
  });
  return row;
}

// ── Fines ───────────────────────────────────────────────────────────────────

export async function listFines(db: Db, requestId: string) {
  return db.stallFine.findMany({ where: { requestId }, orderBy: { leviedAt: 'asc' } });
}

export async function addFine(
  db: PrismaClient,
  requestId: string,
  input: { fineTypeId?: string; reason: string; amountPaise: number },
  by: string,
) {
  await selectedRequest(db, requestId);
  const row = await db.stallFine.create({
    data: {
      requestId,
      fineTypeId: input.fineTypeId ?? null,
      reason: input.reason,
      amountPaise: input.amountPaise,
      leviedBy: by,
    },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_fine.levied',
    subjectRef: requestId,
    detail: input,
  });
  return row;
}

export async function waiveFine(db: PrismaClient, fineId: string, by: string) {
  const row = await db.stallFine.update({
    where: { id: fineId },
    data: { waivedAt: new Date(), waivedBy: by },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_fine.waived',
    subjectRef: row.requestId,
    detail: { fineId },
  });
  return row;
}

// ── Refunds ─────────────────────────────────────────────────────────────────

/** Work out the voucher from what the ledger and the fines say today. Kept as
 *  a row so finance sees the figure the team signed off, not a live one that
 *  moves when a fine is waived a week later. */
export async function prepareRefund(db: PrismaClient, requestId: string, by: string) {
  const r = await selectedRequest(db, requestId);
  const [charges, payment, led, fines] = await Promise.all([
    chargesFor(db, r.editionId),
    db.stallPayment.findUnique({ where: { requestId } }),
    db.stallFurnitureLedger.findUnique({ where: { requestId } }),
    db.stallFine.findMany({ where: { requestId, waivedAt: null } }),
  ]);
  const out = computeRefund({
    depositTotalPaise: payment?.depositTotalPaise ?? 0,
    chairsMissing: led?.chairsMissing ?? 0,
    chairsDamaged: led?.chairsDamaged ?? 0,
    tablesMissing: led?.tablesMissing ?? 0,
    tablesDamaged: led?.tablesDamaged ?? 0,
    chairReplacementPaise: charges.chairReplacementPaise,
    tableReplacementPaise: charges.tableReplacementPaise,
    finesPaise: fines.reduce((n, f) => n + f.amountPaise, 0),
  });
  const data = {
    depositTotalPaise: payment?.depositTotalPaise ?? 0,
    furnitureDeductionPaise: out.furnitureDeductionPaise,
    finesPaise: out.finesPaise,
    refundablePaise: out.refundablePaise,
    shortfallPaise: out.shortfallPaise,
    preparedAt: new Date(),
    preparedBy: by,
  };
  const row = await db.stallRefund.upsert({
    where: { requestId },
    create: { requestId, ...data },
    update: data,
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_refund.prepared',
    subjectRef: requestId,
    detail: { ...out },
  });
  return row;
}

export async function refundRows(db: Db, editionId: string): Promise<RefundRow[]> {
  const rows = await db.stallRequest.findMany({
    where: { editionId, status: 'SELECTED', requestType: { in: ['VENDOR', 'LOCAL_WELFARE'] } },
    include: {
      payment: { select: { depositTotalPaise: true, confirmedAt: true } },
      bankDetails: true,
      furniture: { select: { flagged: true } },
      fines: { orderBy: { leviedAt: 'asc' } },
      refund: true,
    },
    orderBy: { stallName: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requestType: r.requestType,
    invoiceName: r.bankDetails?.invoiceName ?? null,
    accountHolder: r.bankDetails?.accountHolder ?? null,
    bankName: r.bankDetails?.bankName ?? null,
    accountNumberMasked: r.bankDetails ? mask(r.bankDetails.accountNumber) : null,
    ifsc: r.bankDetails?.ifsc ?? null,
    depositTotalPaise: r.refund?.depositTotalPaise ?? r.payment?.depositTotalPaise ?? 0,
    furnitureDeductionPaise: r.refund?.furnitureDeductionPaise ?? 0,
    finesPaise:
      r.refund?.finesPaise ??
      r.fines.filter((f) => !f.waivedAt).reduce((n, f) => n + f.amountPaise, 0),
    refundablePaise: r.refund?.refundablePaise ?? 0,
    shortfallPaise: r.refund?.shortfallPaise ?? 0,
    fines: r.fines.map((f) => ({
      id: f.id,
      reason: f.reason,
      amountPaise: f.amountPaise,
      waivedAt: f.waivedAt?.toISOString() ?? null,
    })),
    ledgerFlagged: r.furniture?.flagged ?? false,
    preparedAt: r.refund?.preparedAt.toISOString() ?? null,
    sentToFinanceAt: r.refund?.sentToFinanceAt?.toISOString() ?? null,
    paidAt: r.refund?.paidAt?.toISOString() ?? null,
    referenceNo: r.refund?.referenceNo ?? null,
  }));
}

export async function sendRefundsToFinance(db: PrismaClient, requestIds: string[], by: string) {
  const res = await db.stallRefund.updateMany({
    where: { requestId: { in: requestIds }, sentToFinanceAt: null },
    data: { sentToFinanceAt: new Date() },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_refund.sent_to_finance',
    subjectRef: 'batch',
    detail: { count: res.count },
  });
  return res.count;
}

export async function markRefundPaid(
  db: PrismaClient,
  requestId: string,
  referenceNo: string,
  by: string,
) {
  const row = await db.stallRefund.update({
    where: { requestId },
    data: { paidAt: new Date(), paidBy: by, referenceNo },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_refund.paid',
    subjectRef: requestId,
    detail: { referenceNo },
  });
  return row;
}
