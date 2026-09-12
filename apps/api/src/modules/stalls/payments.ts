import type { Prisma, PrismaClient, StallPayment } from '@prisma/client';
import {
  type ConfirmPaymentInput,
  type FinanceRow,
  type OnboardingRow,
  type PaymentView,
  type ZoneCode,
  computeBill,
  lookupRate,
  zoneGroupOf,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import { chargesFor, rateCardFor } from './config';
import type { Db } from './editions';
import {
  AlreadyConfirmedError,
  NoPaymentError,
  NotSelectedError,
  UnknownRequestError,
} from './errors';
import { MODULE_KEY } from './roles';
import { advanceStage } from './stage';

const forQuote = {
  allocations: { where: { releasedAt: null }, include: { stall: { include: { zone: true } } } },
} satisfies Prisma.StallRequestInclude;

/** The rent this request is charged: by the zone it was ALLOCATED, falling
 *  back to the zone it asked for. Null for a closed zone or a type that pays
 *  no rent. */
export async function rentFor(
  db: Db,
  r: Prisma.StallRequestGetPayload<{ include: typeof forQuote }>,
): Promise<number | null> {
  if (r.requestType !== 'VENDOR') return null;
  const card = await rateCardFor(db, r.editionId);
  const zoneCode = (r.allocations[0]?.stall.zone.code ?? r.preferredZoneCode) as ZoneCode;
  return lookupRate(card, zoneGroupOf(zoneCode), r.stallType === 'FOOD');
}

/** Compute (or recompute) the bill. Idempotent, and it never touches a
 *  payment that finance has already confirmed. */
export async function ensureQuote(
  db: PrismaClient,
  requestId: string,
  by: string,
): Promise<StallPayment> {
  const r = await db.stallRequest.findUnique({ where: { id: requestId }, include: forQuote });
  if (!r) throw new UnknownRequestError(requestId);
  if (r.status !== 'SELECTED') throw new NotSelectedError(requestId);
  const existing = await db.stallPayment.findUnique({ where: { requestId } });
  if (existing?.confirmedAt) return existing;

  const charges = await chargesFor(db, r.editionId);
  const bill = computeBill(r, charges, await rentFor(db, r));
  const data = {
    stallFeePaise: bill.stallFeePaise,
    plugPointsFeePaise: bill.plugPointsFeePaise,
    furnitureFeePaise: bill.furnitureFeePaise,
    netPaise: bill.netPaise,
    gstPercent: bill.gstPercent,
    gstPaise: bill.gstPaise,
    grossPaise: bill.grossPaise,
    stallDepositPaise: bill.stallDepositPaise,
    furnitureDepositPaise: bill.furnitureDepositPaise,
    depositTotalPaise: bill.depositTotalPaise,
    totalPayablePaise: bill.totalPayablePaise,
  };
  return db.stallPayment.upsert({
    where: { requestId },
    create: { requestId, ...data, quotedBy: by },
    update: { ...data, quotedAt: new Date(), quotedBy: by },
  });
}

export async function paymentView(
  db: PrismaClient,
  requestId: string,
  by: string,
): Promise<PaymentView> {
  const p = await ensureQuote(db, requestId, by);
  const r = await db.stallRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: forQuote,
  });
  const charges = await chargesFor(db, r.editionId);
  const bill = computeBill(r, charges, await rentFor(db, r));
  return {
    ...bill,
    // The stored figures win over a live recomputation once confirmed.
    stallFeePaise: p.stallFeePaise,
    plugPointsFeePaise: p.plugPointsFeePaise,
    furnitureFeePaise: p.furnitureFeePaise,
    netPaise: p.netPaise,
    gstPercent: p.gstPercent,
    gstPaise: p.gstPaise,
    grossPaise: p.grossPaise,
    stallDepositPaise: p.stallDepositPaise,
    furnitureDepositPaise: p.furnitureDepositPaise,
    depositTotalPaise: p.depositTotalPaise,
    totalPayablePaise: p.totalPayablePaise,
    quotedAt: p.quotedAt.toISOString(),
    quotedBy: p.quotedBy,
    emailSentAt: p.emailSentAt?.toISOString() ?? null,
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    confirmedBy: p.confirmedBy,
    creditDate: p.creditDate?.toISOString().slice(0, 10) ?? null,
    referenceNo: p.referenceNo,
    ecollectCode: p.ecollectCode,
    remitterName: p.remitterName,
    mode: p.mode,
    amountReceivedPaise: p.amountReceivedPaise,
    notes: p.notes,
  };
}

/** Finance records a payment that arrived outside the system. */
export async function confirmPayment(
  db: PrismaClient,
  requestId: string,
  input: ConfirmPaymentInput,
  by: string,
): Promise<StallPayment> {
  const p = await db.stallPayment.findUnique({ where: { requestId } });
  if (!p) throw new NoPaymentError(requestId);
  if (p.confirmedAt) throw new AlreadyConfirmedError(requestId);
  const updated = await db.stallPayment.update({
    where: { requestId },
    data: {
      confirmedAt: new Date(),
      confirmedBy: by,
      creditDate: new Date(`${input.creditDate}T00:00:00Z`),
      referenceNo: input.referenceNo,
      ecollectCode: input.ecollectCode ?? null,
      remitterName: input.remitterName ?? null,
      mode: input.mode,
      amountReceivedPaise: input.amountReceivedPaise,
      notes: input.notes ?? null,
    },
  });
  await advanceStage(db, requestId, 'PAYMENT_CONFIRMED');
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_payment.confirmed',
    subjectRef: requestId,
    detail: { referenceNo: input.referenceNo, amountReceivedPaise: input.amountReceivedPaise },
  });
  return updated;
}

export async function financeRows(
  db: Db,
  editionId: string,
  pendingOnly: boolean,
): Promise<FinanceRow[]> {
  const rows = await db.stallRequest.findMany({
    where: {
      editionId,
      status: 'SELECTED',
      payment: pendingOnly ? { is: { confirmedAt: null } } : { isNot: null },
    },
    include: { payment: true, bankDetails: { select: { invoiceName: true, gstNumber: true } } },
    orderBy: [{ stage: 'asc' }, { stallName: 'asc' }],
  });
  return rows
    .filter((r) => r.payment)
    .map((r) => {
      const p = r.payment!;
      return {
        id: r.id,
        reference: r.reference,
        stallName: r.stallName,
        requesterName: r.requesterName,
        invoiceName: r.bankDetails?.invoiceName ?? null,
        gstNumber: r.bankDetails?.gstNumber ?? null,
        totalPayablePaise: p.totalPayablePaise,
        emailSentAt: p.emailSentAt?.toISOString() ?? null,
        confirmedAt: p.confirmedAt?.toISOString() ?? null,
        amountReceivedPaise: p.amountReceivedPaise,
        differencePaise:
          p.amountReceivedPaise === null ? null : p.amountReceivedPaise - p.totalPayablePaise,
      };
    });
}

/** Every selected request with where it stands — the Onboarding screen. */
export async function onboardingRows(db: Db, editionId: string): Promise<OnboardingRow[]> {
  const rows = await db.stallRequest.findMany({
    where: { editionId, status: 'SELECTED' },
    include: {
      allocations: { where: { releasedAt: null }, include: { stall: true } },
      bankDetails: { select: { submittedAt: true } },
      payment: { select: { totalPayablePaise: true, emailSentAt: true, confirmedAt: true } },
      fssai: { select: { uploadedAt: true, verifiedAt: true } },
      staffCoupon: { select: { code: true, maxStaff: true, registeredCount: true } },
      emailLogs: { where: { status: 'SENT' }, orderBy: { sentAt: 'desc' } },
    },
    orderBy: [{ stage: 'asc' }, { stallName: 'asc' }],
  });
  return rows.map((r) => {
    const lastSent: Record<string, string> = {};
    for (const l of r.emailLogs)
      if (!lastSent[l.templateKey]) lastSent[l.templateKey] = l.sentAt.toISOString();
    return {
      id: r.id,
      reference: r.reference,
      requestType: r.requestType,
      stallName: r.stallName,
      requesterName: r.requesterName,
      email: r.email,
      contactNumber: r.contactNumber,
      stage: r.stage,
      allocatedStalls: r.allocations.map((a) => a.stall.number),
      bankSubmittedAt: r.bankDetails?.submittedAt.toISOString() ?? null,
      payment: r.payment
        ? {
            totalPayablePaise: r.payment.totalPayablePaise,
            emailSentAt: r.payment.emailSentAt?.toISOString() ?? null,
            confirmedAt: r.payment.confirmedAt?.toISOString() ?? null,
          }
        : null,
      fssai: r.fssai
        ? {
            uploadedAt: r.fssai.uploadedAt.toISOString(),
            verifiedAt: r.fssai.verifiedAt?.toISOString() ?? null,
          }
        : null,
      coupon: r.staffCoupon,
      lastSent,
    };
  });
}
