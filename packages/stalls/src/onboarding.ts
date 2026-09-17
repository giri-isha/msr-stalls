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

/** Which stage each step sits in, for one requester type. Lower opens first;
 *  steps sharing a number open together. */
export type StepStages = Record<OnboardingStep, number>;

/** The stage numbers for all three requester types.
 *
 *  ⚠️ Carried whole rather than resolved per request, because `FlowConfig` is
 *  loaded once per EDITION and the request type is a fact about the request.
 *  `gatedSteps` picks the row. */
export type FlowStages = Record<StallRequestType, StepStages>;

/** Every step at stage 1, so nothing is ever locked.
 *
 *  🔴 The default an edition starts with, and what a MISSING row reads as —
 *  which is what lets `stall_flow_step` be sparse and lets an edition created
 *  before sequencing existed behave exactly as it did. */
export const ALL_AT_ONCE: StepStages = {
  BANK_FORM: 1,
  PAYMENT: 1,
  FSSAI: 1,
  STAFF_REGISTRATION: 1,
};

export const ALL_TYPES_AT_ONCE: FlowStages = {
  VENDOR: ALL_AT_ONCE,
  LOCAL_WELFARE: ALL_AT_ONCE,
  ASHRAM: ALL_AT_ONCE,
};

/** The three switches on the Flow Builder, and the order the steps open in.
 *
 *  Staff registration is not toggleable — an unregistered person cannot be let
 *  onto the venue, so it is never skipped. It does take a STAGE, because "no
 *  coupon until the money is in" is the sequencing the team asked for most.
 *
 *  🔴 Whether a step happens and WHEN it happens are separate questions and
 *  they are stored separately — three booleans on `stall_flow_config`, twelve
 *  integers in `stall_flow_step`. Folded into one control, "off" and "last"
 *  become neighbours, which is how an admin switches a step off while meaning
 *  to defer it. */
export interface FlowConfig {
  bankStepEnabled: boolean;
  paymentStepEnabled: boolean;
  fssaiStepEnabled: boolean;
  stages: FlowStages;
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
  STAFF_REGISTRATION: 'Staff not registered',
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

/** A pending step, with whether the requester may act on it yet. */
export interface GatedStep extends PendingStep {
  stage: number;
  open: boolean;
  /** The steps being waited on, so a screen can say WHAT opens this one.
   *  Empty when `open`. */
  blockedBy: OnboardingStep[];
}

/** `pendingSteps`, with the edition's ordering applied.
 *
 *  ── The rule ───────────────────────────────────────────────────────────────
 *  The LOWEST stage still present in `pendingSteps` is open; every higher stage
 *  is locked. That is the whole mechanism, and everything else follows from it
 *  rather than being handled:
 *
 *  - A step that does not apply to this requester type never entered the
 *    pending list, so its stage is empty and cannot block. Local welfare has no
 *    bank step, so a bank stage of 1 lets payment open immediately — the
 *    difference in step sets is `needsBankStep`'s to decide and this function
 *    never repeats it.
 *  - A step an admin switched off is gone for the same reason.
 *  - A step already satisfied leaves the list, its stage empties, and the next
 *    one opens. That is how the flow advances.
 *  - ⚠️ STAFF_REGISTRATION before a coupon exists is silent in `pendingSteps`
 *    — nobody can register against a code that has not been issued — so a
 *    stage-1 staff step on a stall with no coupon does NOT wedge the flow shut.
 *    The gate only ever waits on something the requester can actually act on.
 *  - Stage numbers need not be contiguous. 1 and 3 with nothing at 2 behaves as
 *    1 then 3, so nothing has to validate contiguity.
 *
 *  ── Why this is not inside `pendingSteps` ──────────────────────────────────
 *  🔴 Onboarding, Check-in and `deriveStage` read `pendingSteps` and must keep
 *  seeing everything a stall still owes. A gate applied there would have a
 *  stall waiting behind an unpaid step read as "nothing else outstanding" on
 *  the Onboarding table and at the check-in counter, and `READY` would come to
 *  mean "done so far". This is the requester's door, not the team's view.
 */
export function gatedSteps(facts: OnboardingFacts, flow: FlowConfig): GatedStep[] {
  const stages = flow.stages[facts.requestType] ?? ALL_AT_ONCE;
  const pending = pendingSteps(facts, flow).map((p) => ({
    ...p,
    stage: stages[p.step] ?? 1,
  }));
  if (pending.length === 0) return [];

  const current = Math.min(...pending.map((p) => p.stage));
  const blockedBy = pending.filter((p) => p.stage === current).map((p) => p.step);

  return pending.map((p) => ({
    ...p,
    open: p.stage === current,
    blockedBy: p.stage === current ? [] : blockedBy,
  }));
}

/** The steps the requester may act on right now. */
export function openSteps(facts: OnboardingFacts, flow: FlowConfig): OnboardingStep[] {
  return gatedSteps(facts, flow)
    .filter((g) => g.open)
    .map((g) => g.step);
}

/** The stage the requester is on: the lowest one still outstanding, or null
 *  when nothing is.
 *
 *  ⚠️ Read off `pendingSteps`, so a stage holding only steps that are done,
 *  switched off, inapplicable or not yet startable is skipped over rather than
 *  waited on. */
export function openStage(facts: OnboardingFacts, flow: FlowConfig): number | null {
  const stages = flow.stages[facts.requestType] ?? ALL_AT_ONCE;
  const pending = pendingSteps(facts, flow).map((p) => stages[p.step] ?? 1);
  return pending.length > 0 ? Math.min(...pending) : null;
}

/** What a locked step is waiting for: the outstanding steps of the open stage.
 *  Empty when nothing is outstanding. */
export function blockingSteps(facts: OnboardingFacts, flow: FlowConfig): OnboardingStep[] {
  const stage = openStage(facts, flow);
  if (stage === null) return [];
  const stages = flow.stages[facts.requestType] ?? ALL_AT_ONCE;
  return pendingSteps(facts, flow)
    .filter((p) => (stages[p.step] ?? 1) === stage)
    .map((p) => p.step);
}

/** Whether the edition's ordering has not reached this step yet.
 *
 *  🔴 Asks about the STEP'S STAGE, not about its presence in the pending list,
 *  and that difference is the whole reason this exists rather than a filter
 *  over `gatedSteps`.
 *
 *  `STAFF_REGISTRATION` is not pending until a coupon has been issued — nobody
 *  can register against a code that does not exist — so a check that looked for
 *  it among the pending steps would answer "not locked" for exactly the request
 *  that is about to MINT that coupon, and the ordering would be walked past by
 *  the one button that starts the step. The same holds for any step whose
 *  starting move is what makes it outstanding.
 *
 *  ⚠️ False when nothing at all is outstanding. There is nothing left to wait
 *  for, so nothing can be waiting. */
export function isStepLocked(
  facts: OnboardingFacts,
  flow: FlowConfig,
  step: OnboardingStep,
): boolean {
  const stage = openStage(facts, flow);
  if (stage === null) return false;
  const stages = flow.stages[facts.requestType] ?? ALL_AT_ONCE;
  return (stages[step] ?? 1) > stage;
}

/** Whether one step is outstanding AND unlocked — "may this happen now".
 *
 *  ⚠️ False for a step that is already satisfied, switched off, or not asked of
 *  this requester type, which is what the form mint wants: those are not things
 *  to do again, and they are a DIFFERENT refusal from a step that is merely
 *  waiting its turn. `isStepLocked` tells the two apart. */
export function isStepOpen(
  facts: OnboardingFacts,
  flow: FlowConfig,
  step: OnboardingStep,
): boolean {
  return gatedSteps(facts, flow).some((g) => g.step === step && g.open);
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
