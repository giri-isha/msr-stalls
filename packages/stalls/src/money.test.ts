import { describe, expect, test } from 'vitest';
import { addGst, formatInr, paiseToRupees, rupeesToPaise } from './money';

describe('rupeesToPaise', () => {
  test('converts without float drift', () => {
    expect(rupeesToPaise(18000)).toBe(1_800_000);
    expect(rupeesToPaise(0.1)).toBe(10);
    // 19.99 * 100 is 1998.9999999999998 in IEEE754. Rounding is the whole point.
    expect(rupeesToPaise(19.99)).toBe(1999);
  });

  test('refuses a non-finite amount', () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrow(/finite/i);
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
  });
});

describe('formatInr', () => {
  test('groups in the Indian system and drops empty paise', () => {
    expect(formatInr(1_800_000)).toBe('₹18,000');
    expect(formatInr(15_000_000)).toBe('₹1,50,000');
    expect(formatInr(1999)).toBe('₹19.99');
  });
});

describe('addGst', () => {
  test('splits net, gst and gross at 18%', () => {
    expect(addGst(1_800_000, 18)).toEqual({
      net: 1_800_000,
      gst: 324_000,
      gross: 2_124_000,
    });
  });

  test('rounds gst to whole paise', () => {
    expect(addGst(101, 18)).toEqual({ net: 101, gst: 18, gross: 119 });
  });
});

describe('paiseToRupees', () => {
  test('is the inverse of rupeesToPaise', () => {
    expect(paiseToRupees(1_800_000)).toBe(18000);
    expect(paiseToRupees(1999)).toBe(19.99);
  });
});
