import type { Prisma } from '@prisma/client';
import {
  type FlowConfig,
  type OnboardingFacts,
  deriveStage,
  payableFeePaise,
  pendingSteps,
} from '@msr/stalls';
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
  // ⚠️ LIVE coupons only. A retired code must not keep contributing capacity —
  // that is the whole point of retiring it — while the people who registered on
  // it stay on the roster, which is why `staff` is not filtered the same way.
  coupons: { where: { revokedAt: null }, orderBy: { issuedAt: 'asc' } },
  staff: true,
  messages: true,
  paymentPlan: true,
  checkIn: true,
} satisfies Prisma.StallRequestInclude;

export type RequestWithFacts = Prisma.StallRequestGetPayload<{ include: typeof factsInclude }>;

/** How many staff a stall may register: the capacity of its LIVE COUPONS, added
 *  up.
 *
 *  🔴 A ceiling the gate enforces, never a quota the stall owes. A vendor who
 *  needs three people registers three and is done — see `pendingSteps`, which
 *  stops chasing as soon as anybody is registered.
 *
 *  🔴 Not `passesStaff`, which is what the requester asked for on a form months
 *  earlier. The cap is what the stall team has agreed to let through, and the
 *  team sets it: eight by default — their own figure — raised case by case, or
 *  topped up by issuing a second coupon.
 *
 *  Reading the request's own number had two failures at once. It was zero for
 *  every local welfare stall, whose form never asks, and zero was treated as
 *  "no limit" — so the stalls with the least oversight had none at all. And a
 *  vendor who typed 8 could not be raised to 12 without editing what they had
 *  asked for, which is a different fact.
 *
 *  Zero before any coupon exists, which is correct: nobody can register against
 *  a coupon that has not been issued, and `pendingSteps` does not chase a step
 *  that cannot be started. */
export function staffExpected(r: { coupons: Array<{ capacity: number }> }): number {
  return r.coupons.reduce((total, c) => total + c.capacity, 0);
}

/** How many people came in on ONE coupon.
 *
 *  ⚠️ Counted off `couponId`, not off the stall's whole roster. A stall holding
 *  a code for its kitchen team and another for a caterer has to be able to see
 *  each one's remaining room, and the registration form has to enforce each cap
 *  separately — otherwise the first code to be used up blocks the second.
 *
 *  ⚠️ Registrations made before a stall could hold more than one coupon carry a
 *  null `couponId`. They are backfilled by the migration, so a null here means
 *  the coupon they came in on was retired, not that they are unaccounted for —
 *  they still count towards the stall's total. */
export function registeredOn(couponId: string, staff: Array<{ couponId: string | null }>): number {
  return staff.filter((s) => s.couponId === couponId).length;
}

/** What this request actually has to pay, or undefined before Finance quotes.
 *
 *  🔴 `payableFeePaise`, NOT `feeTotalPaise`. A local welfare trader quoted
 *  ₹10,000 and agreed down to ₹5,000 pays ₹5,000; against the quoted figure
 *  they never settle, and they sit in "payment pending" for the rest of the
 *  edition. `quote.ts` has held this function for exactly that reason — this
 *  was the one caller that did not ask it.
 *
 *  ⚠️ It is also the figure the requester's own portal shows them. A page that
 *  asks for one amount while the check wants another is how a vendor pays what
 *  they were told and watches the chip stay put. */
export function feeDuePaise(r: RequestWithFacts): number | undefined {
  return r.paymentPlan ? payableFeePaise(r.paymentPlan) : undefined;
}

export function paymentConfirmed(r: RequestWithFacts): boolean {
  // Confirmed when the rent is settled. The deposit arriving separately is
  // normal and is tracked, but it is not what unblocks FSSAI and staff
  // registration — the 2025 flow chases the rent.
  const rent = r.payments
    .filter((p) => p.purpose === 'RENT')
    .reduce((sum, p) => sum + p.amountPaise, 0);
  if (rent <= 0) return false;
  const due = feeDuePaise(r);
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
