import type { StallRequestType } from './reference';

/** The steps a SELECTED request walks between selection and the event, and the
 *  one function that decides which of them are still outstanding.
 *
 *  Three screens ask the same question in three voices — the vendor's portal
 *  ("what do I do next?"), the Onboarding table ("who is holding us up?") and
 *  Check-in ("is anything outstanding for this stall?"). They agree because
 *  they all call `pendingSteps`. When they each decided for themselves, a
 *  vendor could be told they were all set on one screen and blocked on
 *  another.
 */

export const ONBOARDING_STEPS = ['BANK_FORM', 'PAYMENT', 'FSSAI', 'STAFF_REGISTRATION'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The three switches on the Flow Builder. Staff registration is not
 *  toggleable — an unregistered person cannot be let onto the venue, so it is
 *  never skipped. */
export interface FlowConfig {
  bankStepEnabled: boolean;
  paymentStepEnabled: boolean;
  fssaiStepEnabled: boolean;
}

export interface OnboardingFacts {
  requestType: StallRequestType;
  /** FOOD stalls need FSSAI; non-food ones never do. */
  isFood: boolean;
  bankDetailsReceived: boolean;
  paymentConfirmed: boolean;
  fssaiOnFile: boolean;
  staffRegistered: number;
  /** 🔴 A CEILING, not a target — the coupon's capacity. Nothing is "expected"
   *  of a stall that registers three of the eight it is allowed; see
   *  `pendingSteps`. The name is older than that rule and reads as a quota,
   *  which is exactly the misreading to avoid. */
  staffExpected: number;
}

/** Only external vendors are asked for bank details, GST and a contract — the
 *  2025 bank form says "For selected Vendors only". Local welfare stalls pay a
 *  caution deposit but are not invoiced through the vendor flow, and ashram
 *  departments are billed internally. */
export function needsBankStep(requestType: StallRequestType): boolean {
  return requestType === 'VENDOR';
}

/** Money is collected from vendors and local welfare stalls. */
export function needsPaymentStep(requestType: StallRequestType): boolean {
  return requestType === 'VENDOR' || requestType === 'LOCAL_WELFARE';
}

export interface PendingStep {
  step: OnboardingStep;
  label: string;
}

const LABEL: Record<OnboardingStep, string> = {
  BANK_FORM: 'Bank details pending',
  PAYMENT: 'Payment pending',
  FSSAI: 'FSSAI certificate pending',
  STAFF_REGISTRATION: 'Backoffice not registered',
};

/** Ordered: the first entry is what the vendor's portal should open next, and
 *  the whole list is what Check-in shows as chips. A step that does not apply
 *  to this requester type, or that an admin has switched off, is absent —
 *  never present-but-satisfied, because "not applicable" and "done" read the
 *  same on a screen and must not be confused in a query. */
export function pendingSteps(facts: OnboardingFacts, flow: FlowConfig): PendingStep[] {
  const out: OnboardingStep[] = [];

  if (flow.bankStepEnabled && needsBankStep(facts.requestType) && !facts.bankDetailsReceived) {
    out.push('BANK_FORM');
  }
  if (flow.paymentStepEnabled && needsPaymentStep(facts.requestType) && !facts.paymentConfirmed) {
    out.push('PAYMENT');
  }
  if (flow.fssaiStepEnabled && facts.isFood && !facts.fssaiOnFile) {
    out.push('FSSAI');
  }
  // 🔴 Outstanding only when NOBODY has registered — not until the coupon is
  // filled. The capacity is a ceiling the gate enforces, never a quota the
  // stall owes: a vendor who needs three people registers three and is done,
  // and chasing them for the other five is chasing a number the stall team
  // picked as a default. Reading it as a quota left every such stall flagged
  // on Onboarding and held at the check-in counter for the whole edition.
  if (facts.staffExpected > 0 && facts.staffRegistered === 0) {
    out.push('STAFF_REGISTRATION');
  }

  return out.map((step) => ({ step, label: LABEL[step] }));
}

/** The stage a request has reached, derived from the same facts. Kept beside
 *  `pendingSteps` so the enum written to the database and the chips drawn on
 *  the screen cannot drift apart.
 *
 *  `CHECKED_IN` is not derived — it is an event that happened at a counter,
 *  not a state that can be recomputed — so the caller passes it through. */
export type DerivedStage =
  | 'NEW'
  | 'BANK_FORM_SENT'
  | 'BANK_FORM_FILLED'
  | 'PAYMENT_SENT'
  | 'PAYMENT_CONFIRMED'
  | 'FSSAI_PENDING'
  | 'READY';

export interface StageFacts extends OnboardingFacts {
  selectionEmailSent: boolean;
  paymentEmailSent: boolean;
}

export function deriveStage(facts: StageFacts, flow: FlowConfig): DerivedStage {
  const pending = pendingSteps(facts, flow);
  const has = (s: OnboardingStep) => pending.some((p) => p.step === s);

  if (has('BANK_FORM')) return facts.selectionEmailSent ? 'BANK_FORM_SENT' : 'NEW';
  if (has('PAYMENT')) return facts.paymentEmailSent ? 'PAYMENT_SENT' : 'BANK_FORM_FILLED';
  if (has('FSSAI')) return 'FSSAI_PENDING';
  // Money and certificates are settled; only the vendor's own staff are still trickling in.
  // That is `PAYMENT_CONFIRMED` rather than `READY` because the check-in
  // counter has to be able to tell the two apart at a glance.
  if (has('STAFF_REGISTRATION')) return 'PAYMENT_CONFIRMED';
  return 'READY';
}
