import type { Prisma } from '@prisma/client';
import { type FlowConfig, type OnboardingFacts, deriveStage, pendingSteps } from '@msr/stalls';
import type { Db } from './editions';
import { flowFor } from './config';

/** One shape, one query, one answer to "where has this request got to".
 *
 *  Six screens ask it — Onboarding, Communication, Finance, Check-in, the
 *  vendor's own portal, and the request drawer. They read the same include and
 *  call the same two functions from `@msr/stalls/onboarding.ts`, so a vendor
 *  cannot be "all set" on one screen and "payment pending" on another.
 */
export const factsInclude = {
  allocations: {
    where: { releasedAt: null },
    include: { stall: { include: { zone: true, category: { select: { key: true } } } } },
  },
  bankDetail: true,
  payments: true,
  fssai: { include: { files: true } },
  coupon: true,
  staff: true,
  messages: true,
  paymentPlan: true,
  checkIn: true,
} satisfies Prisma.StallRequestInclude;

export type RequestWithFacts = Prisma.StallRequestGetPayload<{ include: typeof factsInclude }>;

/** How many staff a stall may register: its COUPON's capacity.
 *
 *  🔴 Not `passesStaff`, which is what the requester asked for on a form months
 *  earlier. The cap the gate enforces is what the stall team has agreed to let
 *  through, and the team sets it: eight by default — their own figure — raised
 *  case by case.
 *
 *  Reading the request's own number had two failures at once. It was zero for
 *  every local welfare stall, whose form never asks, and zero was treated as
 *  "no limit" — so the stalls with the least oversight had none at all. And a
 *  vendor who typed 8 could not be raised to 12 without editing what they had
 *  asked for, which is a different fact.
 *
 *  Zero before a coupon exists, which is correct: nobody can register against a
 *  coupon that has not been issued, and `pendingSteps` does not chase a step
 *  that cannot be started. */
export function staffExpected(r: { coupon: { capacity: number } | null }): number {
  return r.coupon?.capacity ?? 0;
}

export function paymentConfirmed(r: RequestWithFacts): boolean {
  // Confirmed when the rent is settled. The deposit arriving separately is
  // normal and is tracked, but it is not what unblocks FSSAI and staff
  // registration — the 2025 flow chases the rent.
  const rent = r.payments
    .filter((p) => p.purpose === 'RENT')
    .reduce((sum, p) => sum + p.amountPaise, 0);
  if (rent <= 0) return false;
  const due = r.paymentPlan?.feeTotalPaise;
  return due === undefined || rent >= due;
}

export function factsOf(r: RequestWithFacts): OnboardingFacts {
  return {
    requestType: r.requestType,
    isFood: r.stallType === 'FOOD',
    bankDetailsReceived: r.bankDetail !== null,
    paymentConfirmed: paymentConfirmed(r),
    fssaiOnFile: (r.fssai?.files.length ?? 0) > 0,
    staffRegistered: r.staff.length,
    staffExpected: staffExpected(r),
  };
}

export function sentTemplate(r: RequestWithFacts, key: string): boolean {
  return r.messages.some((e) => e.templateKey === key);
}

export function selectionEmailSent(r: RequestWithFacts): boolean {
  return sentTemplate(r, 'SELECTION_VENDOR') || sentTemplate(r, 'SELECTION_ASHRAM');
}

export function pendingFor(r: RequestWithFacts, flow: FlowConfig) {
  return pendingSteps(factsOf(r), flow);
}

/** Recomputes `stage` from the facts and writes it if it moved.
 *
 *  Called after every fact-changing write — a bank form arriving, a payment
 *  confirmed, a certificate uploaded, a staff member registered. The column is
 *  a CACHE of `deriveStage`, kept so the request list can filter and sort by
 *  it in the database; it is never the source of truth, and recomputing it is
 *  always safe.
 *
 *  `CHECKED_IN` is the one stage that is not derived — it records an event at a
 *  counter — so it is never overwritten here. */
export async function refreshStage(db: Db, requestId: string): Promise<void> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: factsInclude,
  });
  if (!r) return;
  if (r.status !== 'SELECTED' || r.stage === 'CHECKED_IN') return;
  const flow = await flowFor(db, r.editionId);
  const stage = deriveStage(
    {
      ...factsOf(r),
      selectionEmailSent: selectionEmailSent(r),
      paymentEmailSent: sentTemplate(r, 'PAYMENT_DETAILS'),
    },
    flow,
  );
  if (stage !== r.stage) {
    await db.stallRequest.update({ where: { id: requestId }, data: { stage } });
  }
}

export function allocatedNumbers(r: {
  allocations: Array<{ stall: { number: string } }>;
}): string[] {
  return r.allocations.map((a) => a.stall.number);
}

export function allocatedZone(r: {
  allocations: Array<{ stall: { zone: { code: string } } }>;
}): string | null {
  return r.allocations[0]?.stall.zone.code ?? null;
}
