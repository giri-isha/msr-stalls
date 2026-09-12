import { describe, expect, test } from 'vitest';
import { isCouponCode, newCouponCode, normalizeCouponCode, randomCouponPart } from './coupon';

describe('newCouponCode', () => {
  test('carries the year and the stall, then a secret part', () => {
    let i = 0;
    const rand = () => [0.1, 0.5, 0.9, 0.3][i++ % 4]!;
    const code = newCouponCode(2026, 'C1-1', rand);
    expect(code).toMatch(/^MSR26-C1-1-[A-Z2-9]{4}$/);
    expect(isCouponCode(code)).toBe(true);
  });

  test('never uses the ambiguous glyphs 0, O, 1, I or L', () => {
    for (let n = 0; n < 200; n++) {
      expect(randomCouponPart(8)).not.toMatch(/[0O1IL]/);
    }
  });

  test('two codes for the same stall differ', () => {
    expect(newCouponCode(2026, 'A4-5')).not.toBe(newCouponCode(2026, 'A4-5'));
  });
});

describe('normalizeCouponCode / isCouponCode', () => {
  test('accepts what a person types, upper-cased and unspaced', () => {
    expect(normalizeCouponCode(' msr26-c1-1-k7q2 ')).toBe('MSR26-C1-1-K7Q2');
    expect(isCouponCode(' msr26-c1-1-k7q2 ')).toBe(true);
  });

  test('rejects junk', () => {
    expect(isCouponCode('')).toBe(false);
    expect(isCouponCode('MSR26-C1-1-K7Q0')).toBe(false);
    expect(isCouponCode('C1-1-K7Q2')).toBe(false);
  });
});
