import { describe, expect, it } from 'vitest';
import {
  ALL_TYPES_AT_ONCE,
  type FlowConfig,
  type FlowStages,
  type OnboardingFacts,
  type StepStages,
  blockingSteps,
  deriveStage,
  gatedSteps,
  isStepLocked,
  isStepOpen,
  needsBankStep,
  openSteps,
  pendingSteps,
} from './onboarding';

const ALL_ON: FlowConfig = {
  bankStepEnabled: true,
  paymentStepEnabled: true,
  fssaiStepEnabled: true,
  stages: ALL_TYPES_AT_ONCE,
};

const vendor: OnboardingFacts = {
  requestType: 'VENDOR',
  isFood: true,
  bankDetailsReceived: false,
  paymentConfirmed: false,
  fssaiOnFile: false,
  staffRegistered: 0,
  staffExpected: 3,
};

const steps = (f: Partial<OnboardingFacts>, flow: FlowConfig = ALL_ON) =>
  pendingSteps({ ...vendor, ...f }, flow).map((p) => p.step);

describe('pendingSteps', () => {
  it('lists a fresh vendor’s four steps in the order they are worked', () => {
    expect(steps({})).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI', 'STAFF_REGISTRATION']);
  });

  it('drops a step as it is satisfied', () => {
    expect(steps({ bankDetailsReceived: true })).toEqual([
      'PAYMENT',
      'FSSAI',
      'STAFF_REGISTRATION',
    ]);
    expect(steps({ bankDetailsReceived: true, paymentConfirmed: true, fssaiOnFile: true })).toEqual(
      ['STAFF_REGISTRATION'],
    );
  });

  it('never asks a non-food stall for FSSAI', () => {
    expect(steps({ isFood: false })).not.toContain('FSSAI');
  });

  it('never asks an ashram department for bank details or payment', () => {
    expect(needsBankStep('ASHRAM')).toBe(false);
    // ⚠️ Food-ness is the `isFood` FACT, not the request type. It was
    // `ASHRAM_FOOD` when the ashram forms were two; the one form asks it.
    expect(steps({ requestType: 'ASHRAM', isFood: true })).toEqual(['FSSAI', 'STAFF_REGISTRATION']);
    expect(steps({ requestType: 'ASHRAM', isFood: false })).toEqual(['STAFF_REGISTRATION']);
  });

  it('asks local welfare for payment but not for bank details', () => {
    // The 2025 bank form says "for selected Vendors only"; local welfare pays a
    // caution deposit without being invoiced through the vendor flow.
    expect(steps({ requestType: 'LOCAL_WELFARE' })).toEqual([
      'PAYMENT',
      'FSSAI',
      'STAFF_REGISTRATION',
    ]);
  });

  it('honours the Flow Builder switches', () => {
    expect(steps({}, { ...ALL_ON, bankStepEnabled: false, fssaiStepEnabled: false })).toEqual([
      'PAYMENT',
      'STAFF_REGISTRATION',
    ]);
  });

  it('does not chase staff registration when no coupon has been issued', () => {
    expect(steps({ staffExpected: 0 })).not.toContain('STAFF_REGISTRATION');
  });

  it('stops chasing the backoffice as soon as anybody is registered', () => {
    // 🔴 The capacity is a CEILING the gate enforces, not a quota the stall
    // owes. Eight is the stall team's own default; a vendor who needs three
    // people registers three and is done. Reading it as a quota left that stall
    // flagged on Onboarding and held at the counter for the whole edition.
    expect(steps({ staffRegistered: 0 })).toContain('STAFF_REGISTRATION');
    expect(steps({ staffRegistered: 1 })).not.toContain('STAFF_REGISTRATION');
    expect(steps({ staffRegistered: 1, staffExpected: 8 })).not.toContain('STAFF_REGISTRATION');
  });
});

describe('deriveStage', () => {
  const stage = (
    f: Partial<OnboardingFacts & { selectionEmailSent: boolean; paymentEmailSent: boolean }>,
  ) => deriveStage({ ...vendor, selectionEmailSent: false, paymentEmailSent: false, ...f }, ALL_ON);

  it('stays NEW until the selection letter goes out', () => {
    expect(stage({})).toBe('NEW');
    expect(stage({ selectionEmailSent: true })).toBe('BANK_FORM_SENT');
  });

  it('moves through the bank and payment steps', () => {
    expect(stage({ selectionEmailSent: true, bankDetailsReceived: true })).toBe('BANK_FORM_FILLED');
    expect(
      stage({ selectionEmailSent: true, bankDetailsReceived: true, paymentEmailSent: true }),
    ).toBe('PAYMENT_SENT');
  });

  it('reaches FSSAI_PENDING once the money is in', () => {
    expect(
      stage({
        selectionEmailSent: true,
        bankDetailsReceived: true,
        paymentEmailSent: true,
        paymentConfirmed: true,
      }),
    ).toBe('FSSAI_PENDING');
  });

  it('distinguishes "only backoffice outstanding" from READY', () => {
    const cleared = {
      selectionEmailSent: true,
      paymentEmailSent: true,
      bankDetailsReceived: true,
      paymentConfirmed: true,
      fssaiOnFile: true,
    };
    expect(stage(cleared)).toBe('PAYMENT_CONFIRMED');
    expect(stage({ ...cleared, staffRegistered: 3 })).toBe('READY');
    // One person is enough to be READY — the coupon does not have to be filled.
    expect(stage({ ...cleared, staffRegistered: 1 })).toBe('READY');
  });
});

// ── The gate ────────────────────────────────────────────────────────────────

/** One numbering, applied to every requester type. The tests that care about
 *  the difference between types set the row they mean. */
const everyType = (stages: StepStages): FlowStages => ({
  VENDOR: stages,
  LOCAL_WELFARE: stages,
  ASHRAM: stages,
});

const ONE_AT_A_TIME = everyType({
  BANK_FORM: 1,
  PAYMENT: 2,
  FSSAI: 3,
  STAFF_REGISTRATION: 4,
});

const TWO_THEN_TWO = everyType({
  BANK_FORM: 1,
  PAYMENT: 1,
  FSSAI: 2,
  STAFF_REGISTRATION: 2,
});

const flowWith = (stages: FlowStages, over: Partial<FlowConfig> = {}): FlowConfig => ({
  ...ALL_ON,
  ...over,
  stages,
});

const open = (f: Partial<OnboardingFacts>, flow: FlowConfig) =>
  openSteps({ ...vendor, ...f }, flow);

describe('gatedSteps', () => {
  it('opens everything when every step sits at stage 1', () => {
    expect(open({}, ALL_ON)).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI', 'STAFF_REGISTRATION']);
  });

  it('opens one step at a time, and advances as each is satisfied', () => {
    const flow = flowWith(ONE_AT_A_TIME);
    expect(open({}, flow)).toEqual(['BANK_FORM']);
    expect(open({ bankDetailsReceived: true }, flow)).toEqual(['PAYMENT']);
    expect(open({ bankDetailsReceived: true, paymentConfirmed: true }, flow)).toEqual(['FSSAI']);
    expect(
      open({ bankDetailsReceived: true, paymentConfirmed: true, fssaiOnFile: true }, flow),
    ).toEqual(['STAFF_REGISTRATION']);
  });

  it('opens two together, then the remaining two', () => {
    const flow = flowWith(TWO_THEN_TWO);
    expect(open({}, flow)).toEqual(['BANK_FORM', 'PAYMENT']);
    // One of the pair done is not the stage done.
    expect(open({ bankDetailsReceived: true }, flow)).toEqual(['PAYMENT']);
    expect(open({ bankDetailsReceived: true, paymentConfirmed: true }, flow)).toEqual([
      'FSSAI',
      'STAFF_REGISTRATION',
    ]);
  });

  it('says what a locked step is waiting on', () => {
    const [bank, payment] = gatedSteps(vendor, flowWith(ONE_AT_A_TIME));
    expect(bank).toMatchObject({ step: 'BANK_FORM', stage: 1, open: true, blockedBy: [] });
    expect(payment).toMatchObject({
      step: 'PAYMENT',
      stage: 2,
      open: false,
      blockedBy: ['BANK_FORM'],
    });
  });

  it('names EVERY step of the open stage as what a locked one waits on', () => {
    const locked = gatedSteps(vendor, flowWith(TWO_THEN_TWO)).find((g) => g.step === 'FSSAI');
    expect(locked?.blockedBy).toEqual(['BANK_FORM', 'PAYMENT']);
  });

  it('does not let a step that does not apply block the next one', () => {
    // 🔴 Local welfare has no bank step, so stage 1 is EMPTY and payment — the
    // first step that actually applies — opens straight away.
    expect(open({ requestType: 'LOCAL_WELFARE' }, flowWith(ONE_AT_A_TIME))).toEqual(['PAYMENT']);
  });

  it('does not let a step an admin switched off block the next one', () => {
    expect(open({}, flowWith(ONE_AT_A_TIME, { bankStepEnabled: false }))).toEqual(['PAYMENT']);
  });

  it('does not let staff block while no coupon has been issued', () => {
    // ⚠️ `staffExpected: 0` is "no coupon exists", not "nobody is expected".
    // Nothing can be registered against a code that was never minted, so a
    // stage-1 staff step must not wedge the flow shut.
    const staffFirst = everyType({
      STAFF_REGISTRATION: 1,
      BANK_FORM: 2,
      PAYMENT: 3,
      FSSAI: 4,
    });
    expect(open({ staffExpected: 0 }, flowWith(staffFirst))).toEqual(['BANK_FORM']);
  });

  it('treats a gap in the numbering as ordinary order', () => {
    const gappy = everyType({
      BANK_FORM: 1,
      PAYMENT: 3,
      FSSAI: 3,
      STAFF_REGISTRATION: 7,
    });
    const flow = flowWith(gappy);
    expect(open({}, flow)).toEqual(['BANK_FORM']);
    expect(open({ bankDetailsReceived: true }, flow)).toEqual(['PAYMENT', 'FSSAI']);
  });

  it('reads a missing numbering as all-at-once', () => {
    // An edition whose rows predate sequencing gates nothing.
    const flow = flowWith({ ...ALL_TYPES_AT_ONCE, VENDOR: undefined as never });
    expect(open({}, flow)).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI', 'STAFF_REGISTRATION']);
  });

  it('is empty when nothing is outstanding', () => {
    const done = { bankDetailsReceived: true, paymentConfirmed: true, fssaiOnFile: true };
    expect(gatedSteps({ ...vendor, ...done, staffRegistered: 1 }, flowWith(ONE_AT_A_TIME))).toEqual(
      [],
    );
  });

  it('numbers each requester type on its own', () => {
    const flow = flowWith({
      VENDOR: { BANK_FORM: 1, PAYMENT: 2, FSSAI: 3, STAFF_REGISTRATION: 4 },
      LOCAL_WELFARE: ALL_TYPES_AT_ONCE.LOCAL_WELFARE,
      ASHRAM: ALL_TYPES_AT_ONCE.ASHRAM,
    });
    expect(open({}, flow)).toEqual(['BANK_FORM']);
    expect(open({ requestType: 'LOCAL_WELFARE' }, flow)).toEqual([
      'PAYMENT',
      'FSSAI',
      'STAFF_REGISTRATION',
    ]);
  });
});

describe('isStepOpen', () => {
  it('is false for a locked step and true for the open one', () => {
    const flow = flowWith(ONE_AT_A_TIME);
    expect(isStepOpen(vendor, flow, 'BANK_FORM')).toBe(true);
    expect(isStepOpen(vendor, flow, 'FSSAI')).toBe(false);
  });

  it('is false for a step that is already satisfied', () => {
    expect(isStepOpen({ ...vendor, bankDetailsReceived: true }, ALL_ON, 'BANK_FORM')).toBe(false);
  });

  it('is false for a step that does not apply to this requester type', () => {
    expect(isStepOpen({ ...vendor, requestType: 'LOCAL_WELFARE' }, ALL_ON, 'BANK_FORM')).toBe(
      false,
    );
  });
});

describe('isStepLocked', () => {
  const flow = flowWith(ONE_AT_A_TIME);

  it('is true for a step the ordering has not reached', () => {
    expect(isStepLocked(vendor, flow, 'FSSAI')).toBe(true);
  });

  it('is false for the step that is open', () => {
    expect(isStepLocked(vendor, flow, 'BANK_FORM')).toBe(false);
  });

  it('locks a step that is not yet STARTABLE, which the pending list cannot', () => {
    // 🔴 The coupon case. `staffExpected: 0` means no coupon has been issued,
    // so STAFF_REGISTRATION is absent from `pendingSteps` — and a check that
    // looked for it there would answer "not locked" for exactly the request
    // that is about to mint the coupon. This is why the question is about the
    // step's STAGE and not about its presence in the list.
    const noCoupon = { ...vendor, staffExpected: 0 };
    expect(gatedSteps(noCoupon, flow).some((g) => g.step === 'STAFF_REGISTRATION')).toBe(false);
    expect(isStepLocked(noCoupon, flow, 'STAFF_REGISTRATION')).toBe(true);
  });

  it('is false once nothing at all is outstanding', () => {
    const done = {
      ...vendor,
      bankDetailsReceived: true,
      paymentConfirmed: true,
      fssaiOnFile: true,
      staffRegistered: 1,
    };
    expect(isStepLocked(done, flow, 'STAFF_REGISTRATION')).toBe(false);
  });

  it('locks nothing when every step sits at stage 1', () => {
    for (const step of ['BANK_FORM', 'PAYMENT', 'FSSAI', 'STAFF_REGISTRATION'] as const) {
      expect(isStepLocked(vendor, ALL_ON, step)).toBe(false);
    }
  });
});

describe('blockingSteps', () => {
  it('names the outstanding steps of the open stage', () => {
    expect(blockingSteps(vendor, flowWith(TWO_THEN_TWO))).toEqual(['BANK_FORM', 'PAYMENT']);
  });

  it('is empty when nothing is outstanding', () => {
    const done = {
      ...vendor,
      bankDetailsReceived: true,
      paymentConfirmed: true,
      fssaiOnFile: true,
      staffRegistered: 1,
    };
    expect(blockingSteps(done, ALL_ON)).toEqual([]);
  });
});
