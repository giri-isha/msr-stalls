import type { RequestStage } from './contracts';

/** What decides the path a selected request walks. */
export interface FlowCtx {
  bankStepEnabled: boolean;
  paymentStepEnabled: boolean;
  fssaiStepEnabled: boolean;
  isFood: boolean;
  /** Ashram departments pay no rent and give no bank details: they skip both
   *  money steps and are READY on selection. */
  isAshram: boolean;
}

/** Something that happened to a request, which may move its stage. */
export type StageEvent =
  | 'SELECTED'
  | 'CONFIRMATION_SENT'
  | 'BANK_SUBMITTED'
  | 'PAYMENT_SENT'
  | 'PAYMENT_CONFIRMED'
  | 'FSSAI_VERIFIED'
  | 'CHECKED_IN';

export const STAGE_LABEL: Record<RequestStage, string> = {
  NEW: 'New',
  BANK_FORM_SENT: 'Bank Form Sent',
  BANK_FORM_FILLED: 'Bank Form Filled',
  PAYMENT_SENT: 'Payment Sent',
  PAYMENT_CONFIRMED: 'Payment Confirmed',
  FSSAI_PENDING: 'FSSAI Pending',
  READY: 'Ready',
  CHECKED_IN: 'Checked In',
};

/** The ordered stages this request will pass through, given the flow. */
export function stageSteps(ctx: FlowCtx): RequestStage[] {
  const steps: RequestStage[] = ['NEW'];
  if (!ctx.isAshram) {
    if (ctx.bankStepEnabled) steps.push('BANK_FORM_SENT', 'BANK_FORM_FILLED');
    if (ctx.paymentStepEnabled) steps.push('PAYMENT_SENT', 'PAYMENT_CONFIRMED');
  }
  if (ctx.fssaiStepEnabled && ctx.isFood) steps.push('FSSAI_PENDING');
  steps.push('READY', 'CHECKED_IN');
  return steps;
}

/** The stage an event lands a request in, ignoring the flow for a moment. */
const TARGET: Record<StageEvent, RequestStage> = {
  SELECTED: 'NEW',
  CONFIRMATION_SENT: 'BANK_FORM_SENT',
  BANK_SUBMITTED: 'BANK_FORM_FILLED',
  PAYMENT_SENT: 'PAYMENT_SENT',
  PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
  FSSAI_VERIFIED: 'READY',
  CHECKED_IN: 'CHECKED_IN',
};

/**
 * Where a request goes after `event`.
 *
 * The rule: find the event's natural target; if the flow skips that stage,
 * advance to the next stage on the path that is *after* every skipped one;
 * never move backwards; and a stage that is already past the target stays.
 * So with bank off, CONFIRMATION_SENT lands on PAYMENT_SENT's predecessor —
 * i.e. the request is immediately awaiting payment — and PAYMENT_CONFIRMED
 * for a non-food stall lands on READY.
 */
export function nextStage(current: RequestStage, event: StageEvent, ctx: FlowCtx): RequestStage {
  const path = stageSteps(ctx);
  const at = Math.max(0, path.indexOf(current));
  const natural = TARGET[event];

  // The event completes a step. The stage AFTER completion is the next step on
  // the path once the natural target (and anything skipped) is behind us.
  const ALL: RequestStage[] = [
    'NEW',
    'BANK_FORM_SENT',
    'BANK_FORM_FILLED',
    'PAYMENT_SENT',
    'PAYMENT_CONFIRMED',
    'FSSAI_PENDING',
    'READY',
    'CHECKED_IN',
  ];
  const naturalIdx = ALL.indexOf(natural);

  // Completion events: the target IS the resulting stage when it is on the
  // path; otherwise the first path stage strictly later than the target.
  let resultIdx = path.indexOf(natural);
  if (resultIdx < 0) {
    resultIdx = path.findIndex((s) => ALL.indexOf(s) > naturalIdx);
    if (resultIdx < 0) resultIdx = path.length - 1;
  }

  // Some completions imply the following step is now open. Payment confirmed
  // with no FSSAI to do means READY; bank filled with payment off means READY.
  const after = (s: RequestStage): RequestStage => {
    const i = path.indexOf(s);
    return i >= 0 && i < path.length - 1 ? path[i + 1]! : s;
  };
  let result = path[resultIdx]!;
  if (event === 'PAYMENT_CONFIRMED' && !path.includes('FSSAI_PENDING')) result = 'READY';
  if (event === 'PAYMENT_CONFIRMED' && path.includes('FSSAI_PENDING')) result = 'FSSAI_PENDING';
  if (event === 'BANK_SUBMITTED' && !ctx.paymentStepEnabled) {
    result = path.includes('FSSAI_PENDING') ? 'FSSAI_PENDING' : 'READY';
  }
  if (event === 'SELECTED' && ctx.isAshram) {
    result = path.includes('FSSAI_PENDING') ? 'FSSAI_PENDING' : 'READY';
  }
  if (event === 'CONFIRMATION_SENT' && !ctx.bankStepEnabled && !ctx.isAshram) {
    result = ctx.paymentStepEnabled ? 'PAYMENT_SENT' : after('NEW');
  }

  const resultAt = path.indexOf(result);
  return resultAt > at ? result : current;
}

/** Is this stage at or past `target` on the request's path? */
export function stageReached(current: RequestStage, target: RequestStage, ctx: FlowCtx): boolean {
  const path = stageSteps(ctx);
  return path.indexOf(current) >= path.indexOf(target);
}
