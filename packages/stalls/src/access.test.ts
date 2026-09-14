import { describe, expect, test } from 'vitest';
import { SELF_SERVE_STEPS, isSelfServe, parseContact } from './access';

describe('parseContact', () => {
  test('normalises an email the way the account table stores it', () => {
    expect(parseContact('  Priya@Example.COM ')).toEqual({
      kind: 'EMAIL',
      value: 'priya@example.com',
    });
  });

  test('normalises a mobile the way the request form stores it', () => {
    for (const typed of ['9876543210', '+91 98765 43210', '91-9876543210', ' 98765-43210 ']) {
      expect(parseContact(typed)).toEqual({ kind: 'MOBILE', value: '9876543210' });
    }
  });

  test('is null for anything that is neither, so the response cannot tell them apart', () => {
    for (const junk of ['', '   ', 'not an address', '12345', '0123456789', 'a@b']) {
      expect(parseContact(junk)).toBeNull();
    }
  });
});

describe('isSelfServe', () => {
  test('covers the two steps a vendor can open alone', () => {
    expect(SELF_SERVE_STEPS).toEqual(['BANK_FORM', 'FSSAI']);
    expect(isSelfServe('BANK_FORM')).toBe(true);
    expect(isSelfServe('FSSAI')).toBe(true);
  });

  test('excludes the steps somebody else has to move', () => {
    // Payment is confirmed by Finance; staff register on a forwarded coupon.
    expect(isSelfServe('PAYMENT')).toBe(false);
    expect(isSelfServe('STAFF_REGISTRATION')).toBe(false);
  });
});
