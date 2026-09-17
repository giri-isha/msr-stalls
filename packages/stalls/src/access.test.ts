import { describe, expect, test } from 'vitest';
import { canFileMore, SELF_SERVE_STEPS, isSelfServe, parseContact } from './access';

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

/** 🔴 One reading of the cap, for the header's button and for the apply page's
 *  tiles. Two would be a button that has gone beside a form still offered. */
describe('canFileMore', () => {
  test('there is room while fewer have been counted than the edition allows', () => {
    expect(canFileMore({ used: 0, max: 2, countedAs: 'still open' })).toBe(true);
    expect(canFileMore({ used: 1, max: 2, countedAs: 'still open' })).toBe(true);
  });

  test('and none once the count has reached it', () => {
    expect(canFileMore({ used: 2, max: 2, countedAs: 'still open' })).toBe(false);
    // Over, not just at: a cap lowered in Admin leaves accounts above it, and
    // those must read as spent rather than wrapping back round to allowed.
    expect(canFileMore({ used: 3, max: 2, countedAs: 'still open' })).toBe(false);
  });

  /** ⚠️ `null` is "not capped", which covers two cases that must both leave the
   *  form offered: no active edition, and a page served ahead of an API that
   *  does not send the allowance yet. The write is still what enforces. */
  test('no allowance at all leaves the form offered', () => {
    expect(canFileMore(null)).toBe(true);
  });
});
