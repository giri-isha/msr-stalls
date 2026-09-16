import { describe, expect, it } from 'vitest';
import {
  type FlowConfig,
  type OnboardingFacts,
  deriveStage,
  needsBankStep,
  pendingSteps,
} from './onboarding';

const ALL_ON: FlowConfig = {
  bankStepEnabled: true,
  paymentStepEnabled: true,
  fssaiStepEnabled: true,
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
