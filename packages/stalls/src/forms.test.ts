import { describe, expect, test } from 'vitest';
import { FORM_DEFINITIONS, fieldsFor, formDefinition, isFoodOnlyField } from './forms';
import { STALL_REQUEST_TYPES } from './reference';

describe('FORM_DEFINITIONS', () => {
  test('covers every request type', () => {
    expect(Object.keys(FORM_DEFINITIONS).sort()).toEqual(['ASHRAM', 'LOCAL_WELFARE', 'VENDOR']);
  });

  /** 🔴 The two ashram forms are one. A department used to declare whether its
   *  stall sells food by choosing a form, before being asked a single question;
   *  picking wrong meant a request of the wrong type and no way back but a
   *  fresh one. */
  test('has no separate ashram food form', () => {
    expect(Object.keys(FORM_DEFINITIONS)).not.toContain('ASHRAM_FOOD');
  });
});

describe('fieldsFor VENDOR', () => {
  const byName = new Map(fieldsFor('VENDOR').map((f) => [f.name, f]));

  test('carries the Tamil label printed on the 2025 form', () => {
    expect(byName.get('stallName')?.labelTa).toBe('ஸ்டால் பெயர்');
    expect(byName.get('address')?.labelTa).toBe('முகவரி');
    expect(byName.get('contactNumber')?.labelTa).toBe('தொடர்பு எண்');
  });

  /** 🔴 The disclaimer is no longer a FIELD. Its wording is a
   *  `stall_declaration` row and its tick is drawn beside that wording directly
   *  above Submit, so asking it here as well would be the same consent twice —
   *  once with real words and once as a bare "I Agree". */
  test('does not ask for the allocation disclaimer as a question', () => {
    expect(byName.has('agreed')).toBe(false);
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

  // The choices are the edition's own zones, resolved at render time — see
  // `zoneOptions`. The field carries none of its own, so that a bay added for a
  // future layout appears on the form without a code change.
  test('takes its locations from the configured zones, not a baked-in list', () => {
    expect(byName.get('preferredZoneCode')?.type).toBe('zone');
    expect(byName.get('preferredZoneCode')?.options).toBeUndefined();
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

  /** 🔴 The question that replaced the second ashram form. It lands in the same
   *  `stall_type` column the vendor and local welfare forms have always filled,
   *  which is what already decides FSSAI, the rate card's food column and the
   *  planning grid — so the merge cost the pipeline nothing. */
  test('asks whether the stall sells food, rather than being two forms', () => {
    expect(byName.get('stallType')?.type).toBe('select');
    expect(byName.get('stallType')?.required).toBe(true);
    expect(byName.get('stallType')?.options?.map((o) => o.value)).toEqual(['FOOD', 'NON_FOOD']);
  });

  /** ⚠️ Present on the one form, asked only of a food stall — `isFoodOnlyField`
   *  is what both the page and the submit validator read to skip it. */
  test('still asks about FSSAI, as a food-only question', () => {
    expect(byName.has('fssaiExpected')).toBe(true);
    expect(isFoodOnlyField('fssaiExpected')).toBe(true);
    expect(isFoodOnlyField('stallType')).toBe(false);
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

  /** ⚠️ On EVERY form, not just the vendor one. A single form left carrying the
   *  old checkbox would ask its requester to agree twice. */
  test('no form asks for the allocation disclaimer as a question', () => {
    for (const type of STALL_REQUEST_TYPES) {
      expect(fieldsFor(type).some((f) => f.name === 'agreed')).toBe(false);
    }
  });

  /** The disclaimer text itself stays on the definition: it is what
   *  `seedDeclarations` reads to write version 1 of each edition's wording. */
  test('but every form still carries the disclaimer the declarations seed from', () => {
    for (const type of STALL_REQUEST_TYPES) {
      expect(formDefinition(type).disclaimer.trim()).not.toBe('');
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
