import { describe, expect, test } from 'vitest';
import { IndianMobile, SelectRequestInput, SubmitRequestInput } from './contracts';

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
