import { describe, expect, test } from 'vitest';
import { FileRequestInput, FileStaffInput, FilingRequester, RequesterLookupQuery } from './filing';

describe('FilingRequester', () => {
  test('needs a name and at least one contact', () => {
    expect(FilingRequester.safeParse({ displayName: 'Kumar' }).success).toBe(false);
    expect(FilingRequester.safeParse({ displayName: 'Kumar', phone: '9840012345' }).success).toBe(
      true,
    );
    expect(
      FilingRequester.safeParse({ displayName: 'Kumar', email: 'k@example.org' }).success,
    ).toBe(true);
  });

  test('normalises the phone to ten digits and the email to lower case', () => {
    const p = FilingRequester.parse({
      displayName: 'K',
      phone: '+91 98400 12345',
      email: 'K@Example.org',
    });
    expect(p.phone).toBe('9840012345');
    expect(p.email).toBe('k@example.org');
  });

  test('an empty string is an absent contact, not a bad one', () => {
    const p = FilingRequester.parse({ displayName: 'K', phone: '9840012345', email: '' });
    expect(p.email).toBeUndefined();
    expect(FilingRequester.safeParse({ displayName: 'K', phone: '', email: '' }).success).toBe(
      false,
    );
  });
});

describe('FileRequestInput', () => {
  test('requires the attestation', () => {
    const body = { requester: { displayName: 'K', phone: '9840012345' }, request: {} };
    expect(FileRequestInput.safeParse(body).success).toBe(false);
    expect(FileRequestInput.safeParse({ ...body, attestation: false }).success).toBe(false);
  });
});

describe('FileStaffInput', () => {
  test('drops any coupon code sent — the request in the path names the stall', () => {
    // 🔴 A code in the body would let a filing against one request register
    // somebody against another. Zod strips an unknown key rather than
    // refusing it, so what this asserts is that the code never reaches the
    // route: it is not in the parsed value, whatever was posted.
    const parsed = FileStaffInput.parse({
      couponCode: 'GRE-2026-ABCD1234',
      mobile: '9840012345',
      declarationIds: [],
      attestation: true,
    });
    expect(parsed).not.toHaveProperty('couponCode');
    expect(
      FileStaffInput.safeParse({ mobile: '9840012345', declarationIds: [], attestation: true })
        .success,
    ).toBe(true);
  });
});

describe('RequesterLookupQuery', () => {
  test('trims and bounds the contact', () => {
    expect(RequesterLookupQuery.parse({ contact: '  k@example.org ' }).contact).toBe(
      'k@example.org',
    );
    expect(RequesterLookupQuery.safeParse({ contact: '' }).success).toBe(false);
  });
});
