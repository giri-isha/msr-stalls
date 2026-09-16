import { describe, expect, test } from 'vitest';
import {
  DeclarationInput,
  Gstin,
  Ifsc,
  IndianMobile,
  Pan,
  RegisterStaffInput,
  SelectRequestInput,
  SubmitBankDetailsInput,
  SubmitFssaiInput,
  SubmitRequestInput,
} from './contracts';

const valid = {
  requestType: 'VENDOR' as const,
  stallName: 'Green Leaf Organics',
  requesterName: 'Priya Venkat',
  email: 'priya@greenleaf.example',
  contactNumber: '9840012345',
  address: '12 Mettupalayam Road, Coimbatore',
  stallType: 'FOOD' as const,
  preferredZoneCode: 'C1' as const,
  itemsSelling: 'Organic spices, cold-pressed oils, honey',
  numStallsRequested: 1,
  agreed: true as const,
};

describe('IndianMobile', () => {
  test('normalises +91 and spacing to ten bare digits', () => {
    expect(IndianMobile.parse('+91 98400 12345')).toBe('9840012345');
    expect(IndianMobile.parse('91-98400-12345')).toBe('9840012345');
    expect(IndianMobile.parse(' 9840012345 ')).toBe('9840012345');
  });

  test('refuses anything that is not a mobile', () => {
    expect(IndianMobile.safeParse('12345').success).toBe(false);
    expect(IndianMobile.safeParse('0840012345').success).toBe(false);
    expect(IndianMobile.safeParse('98400123456').success).toBe(false);
  });
});

describe('SubmitRequestInput', () => {
  test('accepts a well-formed vendor submission', () => {
    const r = SubmitRequestInput.safeParse(valid);
    expect(r.success).toBe(true);
  });

  test('refuses a submission that has not agreed to the disclaimer', () => {
    expect(SubmitRequestInput.safeParse({ ...valid, agreed: false }).success).toBe(false);
  });

  test('caps the number of stalls a single request may ask for', () => {
    expect(SubmitRequestInput.safeParse({ ...valid, numStallsRequested: 0 }).success).toBe(false);
    expect(SubmitRequestInput.safeParse({ ...valid, numStallsRequested: 99 }).success).toBe(false);
  });

  test('strips any attempt to set status, stage or a stall from the public form', () => {
    const r = SubmitRequestInput.safeParse({
      ...valid,
      status: 'SELECTED',
      stage: 'READY',
      stallNumber: 'A4-1',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('status' in r.data).toBe(false);
      expect('stage' in r.data).toBe(false);
      expect('stallNumber' in r.data).toBe(false);
    }
  });

  test('requires the deposit acknowledgement for a local welfare request', () => {
    const lw = { ...valid, requestType: 'LOCAL_WELFARE' as const };
    expect(SubmitRequestInput.safeParse({ ...lw, depositAcknowledged: false }).success).toBe(false);
    expect(SubmitRequestInput.safeParse({ ...lw, depositAcknowledged: true }).success).toBe(true);
  });

  test('requires the department block for an ashram request', () => {
    const ashram = { ...valid, requestType: 'ASHRAM' as const };
    expect(SubmitRequestInput.safeParse(ashram).success).toBe(false);
    const withBlock = {
      ...ashram,
      ashram: {
        departmentHead: 'Ravi Shankar',
        departmentHeadContact: '9840012345',
        department: 'Publications',
        requestedBy: 'Meera Iyer',
        requesterContact: '9840023456',
        creditCardNeeded: false,
        usage: 'DEPT_SALES',
        wantsThembu: false,
      },
    };
    expect(SubmitRequestInput.safeParse(withBlock).success).toBe(true);
  });

  test('defaults customFields to an empty object', () => {
    const r = SubmitRequestInput.safeParse(valid);
    if (r.success) expect(r.data.customFields).toEqual({});
  });
});

describe('SelectRequestInput', () => {
  test('accepts real stall numbers and refuses junk', () => {
    expect(SelectRequestInput.safeParse({ stallNumbers: ['A4-17', 'C2-1'] }).success).toBe(true);
    expect(SelectRequestInput.safeParse({ stallNumbers: ['A4-0'] }).success).toBe(false);
  });

  // The team's sequence is: agree the bay, send the payment letter, allocate a
  // number later. Requiring a number here would force the two decisions into
  // one moment and pin a vendor to a pitch nobody has walked yet.
  test('accepts a selection that settles the bay and leaves the number open', () => {
    const r = SelectRequestInput.safeParse({ agreedZoneCode: 'B3' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.stallNumbers).toEqual([]);
  });
});

/** The bank-details form is filled on a phone, and what a vendor types is
 *  whatever their keyboard gave them. Normalising at the contract rather than
 *  at each caller is what keeps `hdfc0001234` and `HDFC0001234` from becoming
 *  two different banks in Finance's export. */
describe('bank identifiers normalise what a vendor actually types', () => {
  test('an IFSC is upper-cased and trimmed before it is checked', () => {
    const r = Ifsc.safeParse('  hdfc0001234 ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('HDFC0001234');
  });

  test('a PAN is upper-cased and trimmed before it is checked', () => {
    const r = Pan.safeParse(' abcde1234f ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('ABCDE1234F');
  });

  test('a GSTIN is upper-cased, and "none" is accepted because the form says so', () => {
    const r = Gstin.safeParse(' 33abcde1234f1z5 ');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('33ABCDE1234F1Z5');
    expect(Gstin.safeParse('none').success).toBe(true);
  });

  test('the message names the shape rather than saying "invalid"', () => {
    const r = Ifsc.safeParse('HDFC1234');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain('11-character IFSC');
  });
});

describe('consent travels with every public form submission', () => {
  const bank = {
    email: 'a@b.com',
    invoiceName: 'Green Leaf',
    accountHolder: 'Green Leaf',
    mobile: '9876543210',
    address: '1 Main Street',
    pincode: '641114',
    bankName: 'HDFC',
    branch: 'Kanjurmarg',
    accountNumber: '12345678',
    ifsc: 'HDFC0004989',
    panNumber: 'ABCDE1234F',
    gstNumber: 'NONE',
    chequeKey: 'k/cheque.pdf',
    panKey: 'k/pan.pdf',
    plugs5a: 1,
    plugs15a: 0,
    gasStoves: 0,
    tablesNeeded: 0,
    chairsNeeded: 0,
    passes2w: 0,
    passes4w: 0,
    passesStaff: 0,
  };

  /** 🔴 The bank form's two consents were `z.literal(true)` with their wording
   *  in JSX. A tick that carries no version records THAT somebody agreed and
   *  never WHAT — the failure the declarations table exists to end. */
  test('the bank form posts declaration ids, not bare agreement flags', () => {
    const parsed = SubmitBankDetailsInput.parse({ ...bank, declarationIds: ['d1', 'd2'] });
    expect(parsed.declarationIds).toEqual(['d1', 'd2']);
    expect('agreeNeft' in parsed).toBe(false);
    expect('agreeTerms' in parsed).toBe(false);
  });

  /** ⚠️ Undefined is not a claim and must pass — a server-side caller has not
   *  said what it displayed. See `sameDeclarations`. */
  test('omitting the list is allowed; an empty list is a claim', () => {
    expect(SubmitBankDetailsInput.parse(bank).declarationIds).toBeUndefined();
    expect(SubmitBankDetailsInput.parse({ ...bank, declarationIds: [] }).declarationIds).toEqual([]);
  });

  test('staff registration and the FSSAI upload carry consent too', () => {
    const staff = RegisterStaffInput.parse({
      couponCode: 'ABCD1234',
      name: 'R Kumar',
      mobile: '9876543210',
      idType: 'AADHAAR',
      idNumber: '1234',
      declarationIds: ['d1'],
    });
    expect(staff.declarationIds).toEqual(['d1']);

    const fssai = SubmitFssaiInput.parse({
      stallName: 'Green Leaf',
      files: [{ key: 'k/cert.pdf', name: 'cert.pdf' }],
      declarationIds: [],
    });
    expect(fssai.declarationIds).toEqual([]);
  });

  test('a declaration is authored against any form, including the bank form', () => {
    expect(DeclarationInput.parse({ key: 'neft_transfer', formType: 'BANK', title: 'NEFT', body: 'x' }).formType).toBe('BANK');
    expect(DeclarationInput.parse({ key: 'terms', title: 'T', body: 'x' }).formType).toBeNull();
  });
});
