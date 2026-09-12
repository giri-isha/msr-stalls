import { describe, expect, test } from 'vitest';
import { type FlowCtx, nextStage, stageReached, stageSteps } from './stages';

const full: FlowCtx = {
  bankStepEnabled: true,
  paymentStepEnabled: true,
  fssaiStepEnabled: true,
  isFood: true,
  isAshram: false,
};

describe('stageSteps', () => {
  test('a food vendor with every step on walks the whole path', () => {
    expect(stageSteps(full)).toEqual([
      'NEW',
      'BANK_FORM_SENT',
      'BANK_FORM_FILLED',
      'PAYMENT_SENT',
      'PAYMENT_CONFIRMED',
      'FSSAI_PENDING',
      'READY',
      'CHECKED_IN',
    ]);
  });

  test('a non-food vendor skips FSSAI', () => {
    expect(stageSteps({ ...full, isFood: false })).not.toContain('FSSAI_PENDING');
  });

  test('an ashram request skips bank and payment entirely', () => {
    expect(stageSteps({ ...full, isAshram: true })).toEqual([
      'NEW',
      'FSSAI_PENDING',
      'READY',
      'CHECKED_IN',
    ]);
  });

  test('flow toggles remove their steps', () => {
    expect(stageSteps({ ...full, bankStepEnabled: false })).toEqual([
      'NEW',
      'PAYMENT_SENT',
      'PAYMENT_CONFIRMED',
      'FSSAI_PENDING',
      'READY',
      'CHECKED_IN',
    ]);
    expect(stageSteps({ ...full, paymentStepEnabled: false, fssaiStepEnabled: false })).toEqual([
      'NEW',
      'BANK_FORM_SENT',
      'BANK_FORM_FILLED',
      'READY',
      'CHECKED_IN',
    ]);
  });
});

describe('nextStage — the happy path', () => {
  test('walks a food vendor through every event in order', () => {
    let s = nextStage('NEW', 'SELECTED', full);
    expect(s).toBe('NEW');
    s = nextStage(s, 'CONFIRMATION_SENT', full);
    expect(s).toBe('BANK_FORM_SENT');
    s = nextStage(s, 'BANK_SUBMITTED', full);
    expect(s).toBe('BANK_FORM_FILLED');
    s = nextStage(s, 'PAYMENT_SENT', full);
    expect(s).toBe('PAYMENT_SENT');
    s = nextStage(s, 'PAYMENT_CONFIRMED', full);
    expect(s).toBe('FSSAI_PENDING');
    s = nextStage(s, 'FSSAI_VERIFIED', full);
    expect(s).toBe('READY');
    s = nextStage(s, 'CHECKED_IN', full);
    expect(s).toBe('CHECKED_IN');
  });

  test('payment confirmed for a non-food stall goes straight to READY', () => {
    expect(nextStage('PAYMENT_SENT', 'PAYMENT_CONFIRMED', { ...full, isFood: false })).toBe(
      'READY',
    );
  });

  test('an ashram request is READY (or FSSAI pending) on selection', () => {
    expect(nextStage('NEW', 'SELECTED', { ...full, isAshram: true, isFood: false })).toBe('READY');
    expect(nextStage('NEW', 'SELECTED', { ...full, isAshram: true, isFood: true })).toBe(
      'FSSAI_PENDING',
    );
  });

  test('with the bank step off, the confirmation puts the vendor straight into payment', () => {
    expect(nextStage('NEW', 'CONFIRMATION_SENT', { ...full, bankStepEnabled: false })).toBe(
      'PAYMENT_SENT',
    );
  });

  test('with payment off, submitting the bank form completes onboarding', () => {
    expect(
      nextStage('BANK_FORM_SENT', 'BANK_SUBMITTED', {
        ...full,
        paymentStepEnabled: false,
        isFood: false,
      }),
    ).toBe('READY');
  });
});

describe('nextStage — never backwards', () => {
  test('a late confirmation email does not undo a filled bank form', () => {
    expect(nextStage('BANK_FORM_FILLED', 'CONFIRMATION_SENT', full)).toBe('BANK_FORM_FILLED');
  });

  test('a reminder-style event on a READY request leaves it READY', () => {
    expect(nextStage('READY', 'PAYMENT_SENT', full)).toBe('READY');
  });
});

describe('stageReached', () => {
  test("answers along the request's own path", () => {
    expect(stageReached('PAYMENT_CONFIRMED', 'BANK_FORM_FILLED', full)).toBe(true);
    expect(stageReached('BANK_FORM_SENT', 'PAYMENT_SENT', full)).toBe(false);
    // Ashram has no bank step; READY is past it by construction.
    expect(stageReached('READY', 'NEW', { ...full, isAshram: true })).toBe(true);
  });
});
