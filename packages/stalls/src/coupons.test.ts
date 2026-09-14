import { describe, expect, it } from 'vitest';
import {
  COUPON_RANDOM_LENGTH,
  couponPrefix,
  formatCouponCode,
  normalizeCouponCode,
} from './coupons';

const bytes = (...n: number[]) => Uint8Array.from(n);
const eight = bytes(0, 1, 2, 3, 4, 5, 6, 7);

describe('couponPrefix', () => {
  it('takes three letters of the stall name', () => {
    expect(couponPrefix('Green Leaf Organics')).toBe('GRE');
  });

  it('drops punctuation rather than carrying it into the code', () => {
    expect(couponPrefix('R.B. Foods')).toBe('RBF');
  });

  it('pads a short name and falls back when there are no letters at all', () => {
    expect(couponPrefix('Jo')).toBe('JOX');
    expect(couponPrefix('123')).toBe('STL');
  });
});

describe('formatCouponCode', () => {
  it('is deterministic given the same randomness', () => {
    expect(formatCouponCode('Coastal Spice', 2026, eight)).toBe(
      formatCouponCode('Coastal Spice', 2026, eight),
    );
    expect(formatCouponCode('Coastal Spice', 2026, eight)).toMatch(/^COA-2026-[0-9A-Z]{8}$/);
  });

  it('avoids the characters a person misreads', () => {
    const code = formatCouponCode(
      'Test',
      2026,
      Uint8Array.from({ length: 32 }, (_, i) => i),
    );
    expect(code.split('-')[2]).not.toMatch(/[ILOU]/);
  });

  it('refuses to build a coupon from too little randomness', () => {
    expect(() => formatCouponCode('Test', 2026, bytes(1, 2, 3))).toThrow(RangeError);
  });

  it('uses at least eight random characters', () => {
    expect(formatCouponCode('Test', 2026, eight).split('-')[2]).toHaveLength(COUPON_RANDOM_LENGTH);
  });
});

describe('normalizeCouponCode', () => {
  const code = formatCouponCode('Green Leaf', 2026, eight);

  it('accepts what was issued', () => {
    expect(normalizeCouponCode(code)).toBe(code);
  });

  it('forgives case and stray spaces', () => {
    expect(normalizeCouponCode(`  ${code.toLowerCase()} `)).toBe(code);
    expect(normalizeCouponCode(code.replace(/-/g, ' '))).toBe(code);
  });

  it('rebuilds the hyphens when someone types the code without them', () => {
    expect(normalizeCouponCode(code.replace(/-/g, ''))).toBe(code);
  });

  it('returns null for junk instead of reaching the database', () => {
    expect(normalizeCouponCode('hello')).toBeNull();
    expect(normalizeCouponCode('')).toBeNull();
    expect(normalizeCouponCode('GRE-2026-IIIIIIII')).toBeNull();
  });
});
