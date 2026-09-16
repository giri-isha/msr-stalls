import { describe, expect, test } from 'vitest';
import { type SubmittedRequest, submittedSections } from './submitted';

/** A vendor's food stall, answered the way the form asks it. */
function vendor(overrides: Partial<SubmittedRequest> = {}): SubmittedRequest {
  return {
    requestType: 'VENDOR',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    email: 'priya@greenleaf.example',
    contactNumber: '9840012345',
    address: '12 Mettupalayam Road',
    stallType: 'FOOD',
    preferredZoneCode: 'C1',
    itemsSelling: 'Spices, oils, honey',
    numStallsRequested: 2,
    remarks: null,
    plugs5a: 0,
    plugs15a: 0,
    gasStoves: 0,
    appliances: [],
    tablesNeeded: 0,
    chairsNeeded: 0,
    passes2w: 0,
    passes4w: 0,
    passesStaff: 0,
    depositAcknowledged: false,
    ashram: null,
    custom: [],
    ...overrides,
  };
}

const titles = (r: SubmittedRequest) => submittedSections(r).map((s) => s.title);
const section = (r: SubmittedRequest, title: string) =>
  submittedSections(r).find((s) => s.title === title);
const fact = (r: SubmittedRequest, title: string, label: string) =>
  section(r, title)?.facts.find((f) => f.label === label)?.value;

describe('submittedSections', () => {
  test('reads a request back in the order the form asked it', () => {
    expect(titles(vendor())).toEqual(['Your Request', 'Your Details']);
    expect(fact(vendor(), 'Your Request', 'Stall Name')).toBe('Green Leaf Organics');
    expect(fact(vendor(), 'Your Request', 'Stalls Requested')).toBe('2');
    expect(fact(vendor(), 'Your Details', 'Mobile')).toBe('9840012345');
  });

  test('names the location as the one that was ASKED for', () => {
    // The bay the team settled on is a different column and is deliberately
    // not in this block — see the note in `submittedSections`.
    expect(fact(vendor(), 'Your Request', 'Location Requested')).toBe('C1');
  });

  test('says Food or Non-Food rather than the stored value', () => {
    expect(fact(vendor(), 'Your Request', 'Stall Type')).toBe('Food');
    expect(fact(vendor({ stallType: 'NON_FOOD' }), 'Your Request', 'Stall Type')).toBe('Non-Food');
  });

  test('drops an unanswered question rather than printing a blank', () => {
    const labels = section(vendor({ address: null, remarks: null }), 'Your Details')?.facts.map(
      (f) => f.label,
    );
    expect(labels).not.toContain('Address');
  });

  test('drops a zero count, and the whole section when every count is zero', () => {
    expect(titles(vendor())).not.toContain('Electrical');
    expect(titles(vendor())).not.toContain('Logistics');

    const wired = vendor({ plugs15a: 3, chairsNeeded: 4 });
    expect(fact(wired, 'Electrical', '15 A Plug Points')).toBe('3');
    expect(section(wired, 'Electrical')?.facts.map((f) => f.label)).not.toContain('Gas Stoves');
    expect(fact(wired, 'Logistics', 'Chairs')).toBe('4');
  });

  test('lists each appliance with its wattage', () => {
    const r = vendor({ appliances: [{ name: 'Induction hob', watts: 2000 }] });
    expect(fact(r, 'Electrical', 'Induction hob')).toBe('2000 W');
  });

  test('puts the department block on an ashram request', () => {
    const r = vendor({
      requestType: 'ASHRAM',
      ashram: {
        department: 'Isha Life',
        departmentHead: 'Ma Shambhavi',
        departmentHeadContact: '9840011111',
        requestedBy: 'Swami Ananda',
        requesterContact: '9840022222',
        usage: 'DEPT_SALES',
        usageOther: null,
        creditCardNeeded: true,
        wantsThembu: false,
        fssaiExpected: true,
      },
    });
    expect(titles(r)).toContain('Department');
    expect(fact(r, 'Department', 'Usage')).toBe('Used by Department for Sales');
    expect(fact(r, 'Department', 'Credit Card Facility')).toBe('Yes');
    expect(fact(r, 'Department', 'Tamil Thembu (11 Days)')).toBe('No');
  });

  test('a question a non-food stall was never asked is absent, not answered No', () => {
    const base = {
      department: 'Isha Life',
      departmentHead: 'Ma Shambhavi',
      departmentHeadContact: '9840011111',
      requestedBy: 'Swami Ananda',
      requesterContact: '9840022222',
      usage: 'DEPT_DISPLAY',
      usageOther: null,
      creditCardNeeded: false,
      wantsThembu: false,
    };
    const nonFood = vendor({
      requestType: 'ASHRAM',
      stallType: 'NON_FOOD',
      ashram: { ...base, fssaiExpected: null },
    });
    expect(section(nonFood, 'Department')?.facts.map((f) => f.label)).not.toContain(
      'FSSAI Expected',
    );
    const food = vendor({ requestType: 'ASHRAM', ashram: { ...base, fssaiExpected: false } });
    expect(fact(food, 'Department', 'FSSAI Expected')).toBe('No');
  });

  test('carries the edition’s own appended questions, and skips the unanswered ones', () => {
    const r = vendor({
      custom: [
        { label: 'GST number', value: '33AAAAA0000A1Z5' },
        { label: 'Van registration', value: '' },
      ],
    });
    expect(section(r, 'Additional')?.facts).toEqual([
      { label: 'GST number', value: '33AAAAA0000A1Z5' },
    ]);
  });
});
