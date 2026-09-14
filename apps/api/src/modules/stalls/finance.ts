import { Prisma, type PrismaClient, type StallRequestType } from '@prisma/client';
import {
  type ConfirmPaymentInput,
  type PaymentRecordView,
  type PaymentRow,
  type RefundRow,
  type SetDiscretionaryFeeInput,
  type SubmitRefundInput,
  computeRefund,
  equipmentDeduction,
  needsPaymentStep,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import { ValidationFailedError } from '../../errors';
import { chargesFor } from './config';
import type { Db } from './editions';
import { DuplicatePaymentError, RefundAlreadySubmittedError, UnknownRequestError } from './errors';
import { allocatedNumbers, factsInclude, refreshStage, type RequestWithFacts } from './facts';
import { planToView, quoteContext, quoteFor, toQuoteView } from './quotes';
import { MODULE_KEY } from './roles';
import type { RequestScope } from './scope';

/** Finance: what is owed, what has come in, and what goes back.
 *
 *  Two rules run through the whole file:
 *
 *  1. **Reconcile against what the vendor was told.** Where a payment email has
 *     gone out there is a frozen `StallPaymentPlan`, and that is the figure
 *     Finance matches a bank credit to — not the live quote, which moves when
 *     an admin edits a rate.
 *  2. **No money is collected here.** The requirement is explicit: payment
 *     happens by NEFT to a virtual account. These routes record what has
 *     already happened in a bank statement.
 */

function recordView(p: {
  id: string;
  purpose: 'RENT' | 'DEPOSIT';
  referenceNo: string;
  eCollectCode: string | null;
  amountPaise: number;
  receivedOn: Date;
  remitterName: string | null;
  mode: string;
  note: string | null;
  confirmedAt: Date;
}): PaymentRecordView {
  return {
    id: p.id,
    purpose: p.purpose,
    referenceNo: p.referenceNo,
    eCollectCode: p.eCollectCode,
    amountPaise: p.amountPaise,
    receivedOn: p.receivedOn.toISOString().slice(0, 10),
    remitterName: p.remitterName,
    mode: p.mode,
    note: p.note,
    confirmedAt: p.confirmedAt.toISOString(),
  };
}

async function toPaymentRow(
  r: RequestWithFacts,
  ctx: Awaited<ReturnType<typeof quoteContext>>,
): Promise<PaymentRow> {
  const quote = r.paymentPlan ? planToView(r.paymentPlan) : toQuoteView(quoteFor(r, ctx));
  const sum = (purpose: 'RENT' | 'DEPOSIT') =>
    r.payments.filter((p) => p.purpose === purpose).reduce((t, p) => t + p.amountPaise, 0);
  const receivedRentPaise = sum('RENT');
  const receivedDepositPaise = sum('DEPOSIT');
  return {
    requestId: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    email: r.email,
    requestType: r.requestType,
    stallNumbers: allocatedNumbers(r),
    quote,
    bankDetailsReceivedAt: r.bankDetail?.submittedAt.toISOString() ?? null,
    paymentEmailSentAt:
      r.messages.find((e) => e.templateKey === 'PAYMENT_DETAILS')?.sentAt.toISOString() ?? null,
    records: r.payments
      .slice()
      .sort((a, b) => a.receivedOn.getTime() - b.receivedOn.getTime())
      .map(recordView),
    receivedRentPaise,
    receivedDepositPaise,
    // An UNPRICED stall is never "settled": A3 and B2 carry no rate, so nothing
    // is known about what is owed, and zero-versus-zero would otherwise read as
    // paid in full and drop the row off Finance's list.
    // ⚠️ Against `payableFeePaise`, not `feeTotalPaise`. Where the team agreed a
    // concession, the quoted figure is what the requester was TOLD and the
    // payable one is what they OWE — settling against the quote would leave a
    // stall that paid exactly what was agreed permanently outstanding.
    fullySettled:
      !quote.unpriced &&
      receivedRentPaise >= quote.payableFeePaise &&
      receivedDepositPaise >= quote.depositTotalPaise,
  };
}

/** The requester types that pay us, narrowed to what the caller may see.
 *  Ashram stalls never appear on either finance screen — they are not billed —
 *  so the intersection is taken here rather than adding a second clause. */
function payingTypes(scope: RequestScope): StallRequestType[] {
  const paying: StallRequestType[] = ['VENDOR', 'LOCAL_WELFARE'];
  return scope === null ? paying : paying.filter((t) => scope.includes(t));
}

/** Everyone who owes money: selected vendors and local welfare stalls. Ashram
 *  departments are not billed and are absent, rather than present with a row of
 *  zeros that Finance would have to learn to ignore. */
export async function listPayments(
  db: Db,
  editionId: string,
  scope: RequestScope = null,
): Promise<PaymentRow[]> {
  const rows = await db.stallRequest.findMany({
    where: {
      editionId,
      status: 'SELECTED',
      requestType: { in: payingTypes(scope) },
    },
    include: factsInclude,
    orderBy: [{ requestType: 'asc' }, { stallName: 'asc' }],
  });
  const ctx = await quoteContext(db, editionId);
  return Promise.all(rows.map((r) => toPaymentRow(r, ctx)));
}

/** The concession the local welfare team agreed on one stall.
 *
 *  🔴 "For A3 the cost is 10,000 — for the coconut wala, probably we will give
 *  that stall at 5,000." The judgement is theirs, per trader, and it is made
 *  after the card rate exists. Without somewhere to record it the quoted figure
 *  is the only figure the system knows, so a stall that paid exactly what was
 *  agreed never reads as settled and Finance reconciles against a number nobody
 *  ever asked for.
 *
 *  ⚠️ `feeTotalPaise` on the plan is NOT rewritten. That is what the requester
 *  was told; this is what is owed. The gap between them is the concession, and
 *  the team is entitled to see both.
 *
 *  ⚠️ The fee only. The deposit comes back in full, so conceding it would mean
 *  refunding money that was never taken.
 *
 *  The plan is created from the current quote if the payment letter has not
 *  gone out yet — a concession agreed in a phone call before any letter is
 *  agreed against the figure standing at that moment, and `quotedAt` records
 *  when that was.
 */
export async function setDiscretionaryFee(
  db: PrismaClient,
  requestId: string,
  input: SetDiscretionaryFeeInput,
  by: string,
): Promise<void> {
  const r = await db.stallRequest.findUnique({ where: { id: requestId }, include: factsInclude });
  if (!r) throw new UnknownRequestError(requestId);
  if (!needsPaymentStep(r.requestType)) throw new UnknownRequestError(requestId);

  // A figure below the card rate with nothing beside it is indistinguishable
  // from a typo six months later. Clearing it clears the reason with it.
  if (input.discretionaryFeePaise !== null && !input.reason) {
    throw new ValidationFailedError([
      { row: 0, fieldKey: 'reason', message: 'a concession has to say why it was given' },
    ]);
  }

  const q = quoteFor(r, await quoteContext(db, r.editionId));
  if (!q || q.exempt) throw new UnknownRequestError(requestId);

  await db.stallPaymentPlan.upsert({
    where: { requestId },
    create: {
      requestId,
      stallFeePaise: q.stallFeePaise,
      plugFeePaise: q.plugFeePaise,
      equipmentFeePaise: q.equipmentFeePaise,
      netPaise: q.netPaise,
      gstPaise: q.gstPaise,
      feeTotalPaise: q.feeTotalPaise,
      stallDepositPaise: q.stallDepositPaise,
      equipmentDepositPaise: q.equipmentDepositPaise,
      depositTotalPaise: q.depositTotalPaise,
      discretionaryFeePaise: input.discretionaryFeePaise,
      discretionaryReason: input.discretionaryFeePaise === null ? null : input.reason,
    },
    update: {
      discretionaryFeePaise: input.discretionaryFeePaise,
      discretionaryReason: input.discretionaryFeePaise === null ? null : input.reason,
    },
  });

  await refreshStage(db, requestId);
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action:
      input.discretionaryFeePaise === null
        ? 'stall_payment_plan.concession_cleared'
        : 'stall_payment_plan.concession_set',
    subjectRef: requestId,
    detail: {
      quotedPaise: q.feeTotalPaise,
      agreedPaise: input.discretionaryFeePaise,
      reason: input.reason,
    },
  });
}

export async function confirmPayment(
  db: PrismaClient,
  requestId: string,
  input: ConfirmPaymentInput,
  by: string,
): Promise<void> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    select: { id: true, requestType: true },
  });
  if (!r) throw new UnknownRequestError(requestId);
  if (!needsPaymentStep(r.requestType)) {
    throw new UnknownRequestError(requestId);
  }

  try {
    await db.stallPaymentRecord.create({
      data: {
        requestId,
        purpose: input.purpose,
        referenceNo: input.referenceNo,
        eCollectCode: input.eCollectCode || null,
        amountPaise: input.amountPaise,
        // A banking DATE, not an instant: `receivedOn` is a `@db.Date` and the
        // time-of-day of a credit is not on the statement.
        receivedOn: new Date(`${input.receivedOn}T00:00:00.000Z`),
        remitterName: input.remitterName || null,
        mode: input.mode,
        note: input.note || null,
        confirmedBy: by,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicatePaymentError(input.referenceNo);
    }
    throw err;
  }

  await refreshStage(db, requestId);
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_payment.confirmed',
    subjectRef: requestId,
    detail: {
      purpose: input.purpose,
      referenceNo: input.referenceNo,
      amountPaise: input.amountPaise,
    },
  });
}

export async function deletePayment(db: PrismaClient, id: string, by: string): Promise<void> {
  const row = await db.stallPaymentRecord.findUnique({ where: { id } });
  if (!row) throw new UnknownRequestError(id);
  await db.stallPaymentRecord.delete({ where: { id } });
  await refreshStage(db, row.requestId);
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_payment.removed',
    subjectRef: row.requestId,
    detail: { referenceNo: row.referenceNo, amountPaise: row.amountPaise },
  });
}

// ── Refunds ─────────────────────────────────────────────────────────────────

type RefundSource = Prisma.StallRequestGetPayload<{
  include: typeof factsInclude & { equipment: true; fines: true; refund: true };
}>;

const refundInclude = { ...factsInclude, equipment: true, fines: true, refund: true } as const;

async function toRefundRow(
  db: Db,
  r: RefundSource,
  ctx: Awaited<ReturnType<typeof quoteContext>>,
): Promise<RefundRow> {
  const charges = await chargesFor(db, r.editionId);
  const quote = r.paymentPlan ? planToView(r.paymentPlan) : toQuoteView(quoteFor(r, ctx));
  // What was actually taken, where Finance has confirmed it; the quoted deposit
  // otherwise. A vendor who paid a short deposit gets the short one back.
  //
  // 🔴 Held as TWO figures, because each deduction is charged to its own. The
  // quote knows the split; a confirmed credit arrives as one number, so a short
  // payment is apportioned in the quoted proportion — the least arbitrary rule
  // available, and the remainder lands on the stall deposit so the two always
  // sum back to exactly what was paid.
  const confirmedDeposit = r.payments
    .filter((p) => p.purpose === 'DEPOSIT')
    .reduce((t, p) => t + p.amountPaise, 0);
  const heldTotal = confirmedDeposit > 0 ? confirmedDeposit : quote.depositTotalPaise;
  const quotedTotal = quote.depositTotalPaise;
  const equipmentHeld =
    quotedTotal > 0 ? Math.round((heldTotal * quote.equipmentDepositPaise) / quotedTotal) : 0;
  const equipmentDepositPaise = Math.min(equipmentHeld, heldTotal);
  const stallDepositPaise = heldTotal - equipmentDepositPaise;

  const suggested = r.equipment
    ? equipmentDeduction(
        {
          missingChairs: r.equipment.missingChairs,
          missingTables: r.equipment.missingTables,
          damaged: r.equipment.damaged,
        },
        {
          chairReplacementPaise: charges.chairReplacementPaise,
          tableReplacementPaise: charges.tableReplacementPaise,
          damagePenaltyPaise: charges.damagePenaltyPaise,
        },
      )
    : 0;

  const fineDeductionPaise = r.fines.reduce((t, f) => t + f.amountPaise, 0);
  const equipmentDeductionPaise = r.refund?.equipmentDeductionPaise ?? suggested;
  // A frozen refund reports the figures it was frozen with; a live one recomputes.
  const computed = computeRefund({
    stallDepositPaise: r.refund?.stallDepositPaise ?? stallDepositPaise,
    equipmentDepositPaise: r.refund?.equipmentDepositPaise ?? equipmentDepositPaise,
    equipmentDeductionPaise,
    fineDeductionPaise: r.refund?.fineDeductionPaise ?? fineDeductionPaise,
  });

  return {
    requestId: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    depositHeldPaise: computed.depositHeldPaise,
    stallDepositPaise: computed.stallDepositPaise,
    equipmentDepositPaise: computed.equipmentDepositPaise,
    suggestedEquipmentDeductionPaise: suggested,
    equipmentDeductionPaise: computed.equipmentDeductionPaise,
    fineDeductionPaise: computed.fineDeductionPaise,
    fines: r.fines.map((f) => ({ reason: f.reason, amountPaise: f.amountPaise })),
    stallRefundPaise: computed.stallRefundPaise,
    equipmentRefundPaise: computed.equipmentRefundPaise,
    refundDuePaise: computed.refundDuePaise,
    stallShortfallPaise: computed.stallShortfallPaise,
    equipmentShortfallPaise: computed.equipmentShortfallPaise,
    shortfallPaise: computed.shortfallPaise,
    submittedAt: r.refund?.submittedAt.toISOString() ?? null,
    voucherRef: r.refund?.voucherRef ?? null,
  };
}

export async function listRefunds(
  db: Db,
  editionId: string,
  scope: RequestScope = null,
): Promise<RefundRow[]> {
  const rows = await db.stallRequest.findMany({
    where: {
      editionId,
      status: 'SELECTED',
      requestType: { in: payingTypes(scope) },
    },
    include: refundInclude,
    orderBy: [{ stallName: 'asc' }],
  });
  const ctx = await quoteContext(db, editionId);
  return Promise.all(rows.map((r) => toRefundRow(db, r, ctx)));
}

/** Writes the fines the team ticked, then freezes the refund.
 *
 *  Fines are rows, not a total, so the voucher can itemise what was withheld —
 *  a vendor disputing a deduction is owed the list. Ticking the same fine type
 *  twice replaces rather than adds: the screen is a checklist, and a double
 *  click on it must not double the penalty.
 */
export async function submitRefund(
  db: PrismaClient,
  requestId: string,
  input: SubmitRefundInput,
  by: string,
): Promise<RefundRow> {
  const existing = await db.stallRefund.findUnique({ where: { requestId } });
  if (existing) throw new RefundAlreadySubmittedError();

  await db.$transaction(async (tx) => {
    const r = await tx.stallRequest.findUnique({
      where: { id: requestId },
      select: { editionId: true },
    });
    if (!r) throw new UnknownRequestError(requestId);

    const types = input.fineTypeIds.length
      ? await tx.stallFineType.findMany({ where: { id: { in: input.fineTypeIds } } })
      : [];

    await tx.stallFine.deleteMany({ where: { requestId } });
    if (types.length > 0) {
      await tx.stallFine.createMany({
        data: types.map((t) => ({
          requestId,
          fineTypeId: t.id,
          reason: t.reason,
          amountPaise: t.defaultAmountPaise,
          createdBy: by,
        })),
      });
    }
    if (input.extraFinePaise > 0) {
      await tx.stallFine.create({
        data: {
          requestId,
          reason: input.extraFineReason?.trim() || 'Other',
          amountPaise: input.extraFinePaise,
          createdBy: by,
        },
      });
    }
  });

  const source = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: refundInclude,
  });
  if (!source) throw new UnknownRequestError(requestId);
  const ctx = await quoteContext(db, source.editionId);
  const live = await toRefundRow(db, source, ctx);

  const computed = computeRefund({
    stallDepositPaise: live.stallDepositPaise,
    equipmentDepositPaise: live.equipmentDepositPaise,
    equipmentDeductionPaise: input.equipmentDeductionPaise,
    fineDeductionPaise: live.fineDeductionPaise,
  });

  await db.stallRefund.create({
    data: {
      requestId,
      stallDepositPaise: computed.stallDepositPaise,
      equipmentDepositPaise: computed.equipmentDepositPaise,
      depositHeldPaise: computed.depositHeldPaise,
      equipmentDeductionPaise: computed.equipmentDeductionPaise,
      fineDeductionPaise: computed.fineDeductionPaise,
      refundDuePaise: computed.refundDuePaise,
      stallShortfallPaise: computed.stallShortfallPaise,
      equipmentShortfallPaise: computed.equipmentShortfallPaise,
      shortfallPaise: computed.shortfallPaise,
      note: input.note ?? null,
      submittedBy: by,
    },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_refund.submitted',
    subjectRef: requestId,
    detail: {
      refundDuePaise: computed.refundDuePaise,
      deductionPaise: computed.totalDeductionPaise,
    },
  });

  const after = await db.stallRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: refundInclude,
  });
  return toRefundRow(db, after, ctx);
}

/** Finance records the voucher number once the refund has actually been paid.
 *  Separate from submitting so the stalls team's hand-off and Finance's
 *  payment stay distinguishable on the trail. */
export async function setVoucherRef(
  db: PrismaClient,
  requestId: string,
  voucherRef: string,
  by: string,
): Promise<void> {
  const row = await db.stallRefund.findUnique({ where: { requestId } });
  if (!row) throw new UnknownRequestError(requestId);
  await db.stallRefund.update({ where: { requestId }, data: { voucherRef } });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_refund.paid',
    subjectRef: requestId,
    detail: { voucherRef },
  });
}
