import { describe, expect, test } from 'vitest';
import { FORM_DEFINITIONS, fieldsFor } from './forms';
import { STALL_REQUEST_TYPES } from './reference';

describe('FORM_DEFINITIONS', () => {
  test('covers all four request types', () => {
    expect(Object.keys(FORM_DEFINITIONS).sort()).toEqual([
      'ASHRAM',
      'ASHRAM_FOOD',
      'LOCAL_WELFARE',
      'VENDOR',
    ]);
  });
});

describe('fieldsFor VENDOR', () => {
  const byName = new Map(fieldsFor('VENDOR').map((f) => [f.name, f]));

  test('carries the Tamil label printed on the 2025 form', () => {
    expect(byName.get('stallName')?.labelTa).toBe('ஸ்டால் பெயர்');
    expect(byName.get('address')?.labelTa).toBe('முகவரி');
    expect(byName.get('contactNumber')?.labelTa).toBe('தொடர்பு எண்');
  });

  test('requires the allocation disclaimer', () => {
    expect(byName.get('agreed')?.required).toBe(true);
  });

  test('does not ask a vendor for electrical details — the 2025 form did not', () => {
    expect(byName.has('plugs5a')).toBe(false);
    expect(byName.has('gasStoves')).toBe(false);
  });
});

describe('fieldsFor LOCAL_WELFARE', () => {
  const byName = new Map(fieldsFor('LOCAL_WELFARE').map((f) => [f.name, f]));

  test('asks for electrical and logistics up front', () => {
    expect(byName.has('plugs5a')).toBe(true);
    expect(byName.has('plugs15a')).toBe(true);
    expect(byName.has('gasStoves')).toBe(true);
    expect(byName.has('chairsNeeded')).toBe(true);
  });

  test('requires the refundable caution deposit acknowledgement', () => {
    expect(byName.get('depositAcknowledged')?.required).toBe(true);
    expect(byName.get('depositAcknowledged')?.labelTa).toBe('திரும்பப்பெறக்கூடிய எச்சரிக்கை வைப்பு');
  });

  test('asks for vehicle passes but not staff passes — the 2025 form did not', () => {
    expect(byName.has('passes2w')).toBe(true);
    expect(byName.has('passes4w')).toBe(true);
    expect(byName.has('passesStaff')).toBe(false);
  });

  test('offers A3 and B2, which are closed to vendors but open to local welfare', () => {
    const zones = byName.get('preferredZoneCode')?.options?.map((o) => o.value) ?? [];
    expect(zones).toContain('A3');
    expect(zones).toContain('B2');
  });
});

describe('fieldsFor ASHRAM', () => {
  const byName = new Map(fieldsFor('ASHRAM').map((f) => [f.name, f]));

  test('asks the department questions', () => {
    expect(byName.has('departmentHead')).toBe(true);
    expect(byName.has('department')).toBe(true);
    expect(byName.has('creditCardNeeded')).toBe(true);
    expect(byName.get('usage')?.options?.length).toBe(5);
  });

  test('asks about the 11 days of Tamil Thembu', () => {
    expect(byName.has('wantsThembu')).toBe(true);
  });

  test('asks for all three pass types', () => {
    expect(byName.has('passes2w')).toBe(true);
    expect(byName.has('passes4w')).toBe(true);
    expect(byName.has('passesStaff')).toBe(true);
  });

  test('is English-only, as the 2025 ashram form was', () => {
    for (const field of fieldsFor('ASHRAM')) expect(field.labelTa).toBeNull();
  });
});

describe('fieldsFor ASHRAM_FOOD', () => {
  test('asks the same department questions as the ashram form', () => {
    const byName = new Map(fieldsFor('ASHRAM_FOOD').map((f) => [f.name, f]));
    expect(byName.has('departmentHead')).toBe(true);
    expect(byName.has('gasStoves')).toBe(true);
  });
});

describe('every form', () => {
  test('has unique field names', () => {
    for (const type of STALL_REQUEST_TYPES) {
      const names = fieldsFor(type).map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test('every select or radio field offers options', () => {
    for (const type of STALL_REQUEST_TYPES) {
      for (const field of fieldsFor(type)) {
        if (field.type === 'select' || field.type === 'radio') {
          expect(field.options?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  test('every form requires the allocation disclaimer', () => {
    for (const type of STALL_REQUEST_TYPES) {
      const agreed = fieldsFor(type).find((f) => f.name === 'agreed');
      expect(agreed?.required).toBe(true);
    }
  });

  test('no field claims a Tamil label that is an empty string', () => {
    // A blank labelTa would render an empty second line. Absent is `null`.
    for (const type of STALL_REQUEST_TYPES) {
      for (const field of fieldsFor(type)) {
        expect(field.labelTa === null || field.labelTa.length > 0).toBe(true);
      }
    }
  });
});
