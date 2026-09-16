// A requester's own account of a transfer, and finance settling it.
//
// 🔴 A CLAIM is not a receipt. `StallPaymentRecord` is finance-entered —
// `confirmedBy` is required — so every row in it is money the Foundation has
// seen on its statement. This table holds what somebody SAYS they sent. Keeping
// them apart is the whole design: merged, every query that reads a payment as
// settled would need a `WHERE confirmed_by IS NOT NULL`, and the one that
// forgot would count unverified money silently.
//
// The 2025 letter filled this gap with "please send transfer details on E-mail
// IDs finance.support@… once you make the payment" — a mailbox, matched by hand.
import { Prisma } from '@prisma/client';
import type { PrismaClient, StallPaymentPurpose } from '@prisma/client';
import {
  type PaymentClaimRow,
  type PaymentClaimView,
  type ReviewPaymentClaimInput,
  type SubmitPaymentClaimInput,
  payableFeePaise,
} from '@stalls/core';
import { recordActivity } from '../../activity';
import type { Db } from './editions';
import {
  ClaimAlreadyReviewedError,
  DuplicatePaymentError,
  MissingRejectReasonError,
  StepNotOpenError,
  UnknownRequestError,
} from './errors';
import { confirmPayment } from './finance';
import { MODULE_KEY } from './roles';

/** 🔴 Vendors AND local welfare. Both are charged — `CHARGEABLE` in `quote.ts`
 *  is those two — so both have money to report. An ashram department is billed
 *  internally and owes nothing here, so a claim from one is a claim about
 *  nothing. */
const MAY_CLAIM = new Set(['VENDOR', 'LOCAL_WELFARE']);

const SELECT = {
  id: true,
  purpose: true,
  status: true,
  referenceNo: true,
  amountPaise: true,
  paidOn: true,
  remitterName: true,
  note: true,
  receiptKey: true,
  submittedAt: true,
  reviewedAt: true,
  rejectReason: true,
} as const;

type ClaimRow = {
  id: string;
  purpose: StallPaymentPurpose;
  status: string;
  referenceNo: string;
  amountPaise: number;
  paidOn: Date;
  remitterName: string | null;
  note: string | null;
  receiptKey: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  rejectReason: string | null;
};

/** ⚠️ `hasReceipt`, not the key itself. The key is a handle on a private file;
 *  the requester only needs to know their upload arrived, and the backoffice
 *  fetches it through the media store with its own authorisation. */
function toView(c: ClaimRow): PaymentClaimView {
  return {
    id: c.id,
    purpose: c.purpose,
    status: c.status as PaymentClaimView['status'],
    referenceNo: c.referenceNo,
    amountPaise: c.amountPaise,
    // A banking date. `toISOString().slice(0, 10)` rather than the whole
    // instant: there is no time-of-day on a statement line.
    paidOn: c.paidOn.toISOString().slice(0, 10),
    remitterName: c.remitterName,
    note: c.note,
    submittedAt: c.submittedAt.toISOString(),
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
    rejectReason: c.rejectReason,
    hasReceipt: c.receiptKey !== null,
  };
}

/**
 * Records what a requester says they transferred.
 *
 * ⚠️ Does NOT move the onboarding stage. A claim is an assertion, not money
 * received — the stage advances when finance verifies it and the payment record
 * is written. A stage that moved on submission would tell the backoffice list
 * that a stall had paid because the stall said so.
 */
export async function submitPaymentClaim(
  db: PrismaClient,
  requestId: string,
  input: SubmitPaymentClaimInput,
): Promise<PaymentClaimView> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requestType: true, status: true },
  });
  if (!r) throw new UnknownRequestError(requestId);
  if (!MAY_CLAIM.has(r.requestType)) throw new StepNotOpenError('payment details');
  if (r.status !== 'SELECTED') throw new StepNotOpenError('payment details');

  try {
    const claim = await db.stallPaymentClaim.create({
      data: {
        requestId,
        purpose: input.purpose,
        referenceNo: input.referenceNo,
        amountPaise: input.amountPaise,
        paidOn: new Date(`${input.paidOn}T00:00:00.000Z`),
        remitterName: input.remitterName || null,
        receiptKey: input.receiptKey || null,
        note: input.note || null,
      },
      select: SELECT,
    });
    return toView(claim);
  } catch (err) {
    // 🔴 The partial unique index, surfacing as a duplicate. One reference is
    // one credit per request, so a refreshed form or an impatient second
    // attempt does not create two claims finance has to reconcile against one
    // transfer. A REJECTED claim is outside the index, so a corrected
    // resubmission carrying the same UTR still goes through.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicatePaymentError(input.referenceNo);
    }
    throw err;
  }
}

/** What this requester has claimed, newest first. For their own status page. */
export async function claimsFor(db: Db, requestId: string): Promise<PaymentClaimView[]> {
  const rows = await db.stallPaymentClaim.findMany({
    where: { requestId },
    orderBy: { submittedAt: 'desc' },
    select: SELECT,
  });
  return rows.map(toView);
}

/**
 * The finance queue.
 *
 * ⚠️ `expectedPaise` is what the frozen plan says is owed for this purpose, so
 * a reviewer can see at a glance whether the claimed figure matches without
 * opening the request. `payableFeePaise` for the rent, because a local welfare
 * trader owes the concession the team agreed and not the card rate.
 */
export async function pendingClaims(db: Db, editionId: string): Promise<PaymentClaimRow[]> {
  const rows = await db.stallPaymentClaim.findMany({
    where: { status: 'PENDING', request: { editionId } },
    orderBy: { submittedAt: 'asc' },
    select: {
      ...SELECT,
      request: {
        select: {
          id: true,
          reference: true,
          stallName: true,
          requesterName: true,
          paymentPlan: true,
        },
      },
    },
  });

  return rows.map((c) => {
    const plan = c.request.paymentPlan;
    const expectedPaise = plan
      ? c.purpose === 'RENT'
        ? payableFeePaise(plan)
        : plan.depositTotalPaise
      : null;
    return {
      ...toView(c),
      requestId: c.request.id,
      reference: c.request.reference,
      stallName: c.request.stallName,
      requesterName: c.request.requesterName,
      expectedPaise,
    };
  });
}

/**
 * Finance settles a claim.
 *
 * 🔴 VERIFY writes the `StallPaymentRecord`, and that write is what makes the
 * money real — it is the row `paymentConfirmed` settles against and the one
 * that advances the stage. The claim is linked to it so the two can be read
 * from either end: "what did the vendor tell us" and "what did we bank".
 *
 * ⚠️ REJECT writes no record and does not touch the stage. It carries a reason
 * the requester is shown, because a rejection they cannot act on just returns
 * them to the mailbox this replaced.
 */
export async function reviewPaymentClaim(
  db: PrismaClient,
  editionId: string,
  claimId: string,
  input: ReviewPaymentClaimInput,
  by: string,
): Promise<void> {
  const claim = await db.stallPaymentClaim.findFirst({
    where: { id: claimId, request: { editionId } },
    select: { ...SELECT, requestId: true },
  });
  if (!claim) throw new UnknownRequestError(claimId);
  // A settled claim is a record, not a draft. Re-verifying would write a second
  // payment record for one transfer and shrink the vendor's refund.
  if (claim.status !== 'PENDING') throw new ClaimAlreadyReviewedError(claimId);

  if (input.verdict === 'REJECT') {
    const reason = input.rejectReason?.trim();
    if (!reason) throw new MissingRejectReasonError();
    await db.stallPaymentClaim.update({
      where: { id: claimId },
      data: { status: 'REJECTED', rejectReason: reason, reviewedAt: new Date(), reviewedBy: by },
    });
    await recordActivity(db, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      subjectRef: claim.requestId,
      action: 'stall_payment_claim.rejected',
      detail: { purpose: claim.purpose, referenceNo: claim.referenceNo, reason },
    });
    return;
  }

  // ⚠️ `confirmPayment` is reused rather than reimplemented. It owns the
  // duplicate-reference rule, the stage refresh and the activity trail, and a
  // second way of writing a receipt is a second set of rules to keep in step.
  await confirmPayment(
    db,
    claim.requestId,
    {
      purpose: claim.purpose,
      referenceNo: claim.referenceNo,
      eCollectCode: input.eCollectCode,
      // Finance's figure where they read a different one off the statement; the
      // claim keeps what the requester said, so the gap stays visible.
      amountPaise: input.amountPaise ?? claim.amountPaise,
      receivedOn: claim.paidOn.toISOString().slice(0, 10),
      remitterName: claim.remitterName ?? undefined,
      mode: 'NEFT',
      note: claim.note ?? undefined,
    },
    by,
  );

  const record = await db.stallPaymentRecord.findFirst({
    where: { requestId: claim.requestId, referenceNo: claim.referenceNo },
    select: { id: true },
  });

  await db.stallPaymentClaim.update({
    where: { id: claimId },
    data: {
      status: 'VERIFIED',
      reviewedAt: new Date(),
      reviewedBy: by,
      paymentRecordId: record?.id ?? null,
    },
  });
}
