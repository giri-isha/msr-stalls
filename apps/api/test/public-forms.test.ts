import {
  PUBLIC_FORM_TYPES,
  SubmitBankDetailsInput,
  formFields,
  isLockedRequired,
  validateAgainstForm,
} from '@msr/stalls';
import { beforeEach, describe, expect, test } from 'vitest';
import { replaceCustomValues } from '../src/modules/stalls/custom-values';
import { addFormField, formsFor, updateFormField } from '../src/modules/stalls/form-builder';
import { StructuralFieldLockedError } from '../src/modules/stalls/errors';
import { prisma, resetDatabase, seedEdition } from './helpers/db';
import { selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let editionId: string;

beforeEach(async () => {
  await resetDatabase();
  const edition = await seedEdition();
  editionId = edition.id;
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
});

const selectedVendorForStaff = () => selected(['C1-1']);

describe('every public form is seeded', () => {
  test('all seven forms have a definition, not just the four applications', async () => {
    const forms = await formsFor(prisma, editionId);
    expect(forms.map((f) => f.formType).sort()).toEqual(
      ['ASHRAM', 'ASHRAM_FOOD', 'BANK', 'FSSAI', 'LOCAL_WELFARE', 'STAFF', 'VENDOR'].sort(),
    );
  });

  test('the bank form carries its file questions as built-ins', async () => {
    const bank = (await formsFor(prisma, editionId)).find((f) => f.formType === 'BANK');
    const byName = new Map(bank?.fields.map((f) => [f.name, f]));
    expect(byName.get('chequeKey')?.type).toBe('file');
    expect(byName.get('chequeKey')?.isBuiltIn).toBe(true);
    expect(byName.get('gstKey')?.required).toBe(false);
  });

  /** ⚠️ `files`, plural, because a certificate is photographed a page at a
   *  time and a single-file question would have a vendor choosing which page. */
  test('the FSSAI form takes several files', async () => {
    const fssai = (await formsFor(prisma, editionId)).find((f) => f.formType === 'FSSAI');
    const files = fssai?.fields.find((f) => f.name === 'files');
    expect(files?.type).toBe('files');
    expect(files?.max).toBe(5);
  });

  /** Re-running must not resurrect a field an admin deleted, nor undo a
   *  reorder — the same guarantee the four request forms already had. */
  test('seeding twice changes nothing', async () => {
    const before = (await formsFor(prisma, editionId)).flatMap((f) => f.fields).length;
    const { seedFormDefinitions } = await import('../src/modules/stalls/form-builder');
    await seedFormDefinitions(prisma, editionId);
    const after = (await formsFor(prisma, editionId)).flatMap((f) => f.fields).length;
    expect(after).toBe(before);
  });
});

describe('a question that identifies the person', () => {
  const mobileOnStaff = async () => {
    const staff = (await formsFor(prisma, editionId)).find((f) => f.formType === 'STAFF');
    const field = staff?.fields.find((f) => f.name === 'mobile');
    if (!field) throw new Error('staff mobile field missing');
    return field;
  };

  test('the rule names it', () => {
    expect(isLockedRequired('STAFF', 'mobile')).toBe(true);
    expect(isLockedRequired('STAFF', 'name')).toBe(false);
    expect(isLockedRequired('BANK', 'mobile')).toBe(false);
  });

  /** 🔴 Refused by the API, not merely disabled on the screen. A nullable
   *  mobile makes `(request_id, mobile)` toothless — NULLs compare as DISTINCT
   *  — so somebody handed two coupon codes would register twice and be counted
   *  twice at the gate. */
  test('cannot be made optional', async () => {
    const field = await mobileOnStaff();
    await expect(
      updateFormField(prisma, editionId, field.id, { isRequired: false }),
    ).rejects.toThrow(StructuralFieldLockedError);
  });

  test('cannot be switched off', async () => {
    const field = await mobileOnStaff();
    await expect(updateFormField(prisma, editionId, field.id, { isActive: false })).rejects.toThrow(
      StructuralFieldLockedError,
    );
  });

  /** ⚠️ Everything else about it is still editable — this is a lock on two
   *  attributes, not a frozen field. */
  test('but can still be reworded', async () => {
    const field = await mobileOnStaff();
    await updateFormField(prisma, editionId, field.id, { label: 'Phone number' });
    const after = await mobileOnStaff();
    expect(after.label).toBe('Phone number');
  });

  test('and every other question on these forms can be switched off', async () => {
    for (const formType of PUBLIC_FORM_TYPES) {
      const form = (await formsFor(prisma, editionId)).find((f) => f.formType === formType);
      const switchable = form?.fields.find((f) => !isLockedRequired(formType, f.name));
      if (!switchable) continue;
      await updateFormField(prisma, editionId, switchable.id, { isActive: false });
      const after = (await formsFor(prisma, editionId)).find((f) => f.formType === formType);
      expect(after?.fields.find((f) => f.id === switchable.id)?.isActive).toBe(false);
    }
  });
});

describe('switching a question off reaches the API, not just the page', () => {
  /** 🔴 The whole point of these forms becoming rows, and it was broken: the
   *  columns were nullable and the screen was configurable, but
   *  `SubmitBankDetailsInput` still hard-required every answer. So an admin who
   *  switched off a question got a page that stopped asking it, a payload that
   *  omitted it, and a 400 — nobody could submit at all. */
  test('a bank question switched off is no longer required by the API', async () => {
    const bank = (await formsFor(prisma, editionId)).find((f) => f.formType === 'BANK');
    const micr = bank?.fields.find((f) => f.name === 'micr');
    const email = bank?.fields.find((f) => f.name === 'email');
    if (!micr || !email) throw new Error('bank fields missing');

    // `email` is required by the seed, so the definition refuses a blank one…
    const withEmailOff = SubmitBankDetailsInput.safeParse({
      invoiceName: 'X',
      mobile: '9840012345',
    });
    expect(withEmailOff.success).toBe(true); // …the CONTRACT no longer does.

    await updateFormField(prisma, editionId, email.id, { isActive: false });
    const after = (await formsFor(prisma, editionId)).find((f) => f.formType === 'BANK');
    expect(after?.fields.find((f) => f.name === 'email')?.isActive).toBe(false);

    // ⚠️ `formFields` drops it, so `validateAgainstForm` no longer asks for it.
    expect(formFields(after as never).some((f) => f.name === 'email')).toBe(false);
  });

  /** ⚠️ Making one optional is the softer half of the same rule. */
  test('a bank question made optional is no longer required by the definition', async () => {
    const bank = (await formsFor(prisma, editionId)).find((f) => f.formType === 'BANK');
    const ifsc = bank?.fields.find((f) => f.name === 'ifsc');
    if (!ifsc) throw new Error('ifsc missing');
    expect(ifsc.required).toBe(true);

    await updateFormField(prisma, editionId, ifsc.id, { isRequired: false });
    const after = (await formsFor(prisma, editionId)).find((f) => f.formType === 'BANK');
    expect(after?.fields.find((f) => f.name === 'ifsc')?.required).toBe(false);

    const violations = validateAgainstForm(after as never, { builtIn: {}, custom: {} });
    expect(violations.some((v) => v.fieldKey === 'ifsc')).toBe(false);
  });

  /** And the definition still enforces what it DOES ask for — the other half,
   *  without which moving required-ness out of the contract would lose it. */
  test('a question still asked is still enforced', async () => {
    const bank = (await formsFor(prisma, editionId)).find((f) => f.formType === 'BANK');
    const violations = validateAgainstForm(bank as never, { builtIn: {}, custom: {} });
    expect(violations.some((v) => v.fieldKey === 'ifsc')).toBe(true);
    // ⚠️ A `file` question with no key is unanswered, not answered with "".
    expect(violations.some((v) => v.fieldKey === 'chequeKey')).toBe(true);
    // `micr` is optional in the seed and must not appear.
    expect(violations.some((v) => v.fieldKey === 'micr')).toBe(false);
  });
});

describe('an appended answer belongs to the person who gave it', () => {
  /** 🔴 The case the old unique index on `stall_custom_field_value` swallowed.
   *  Eight people register against one coupon and share a request id. */
  test('two staff members answering one appended question get their own rows', async () => {
    const staffForm = (await formsFor(prisma, editionId)).find((f) => f.formType === 'STAFF');
    if (!staffForm) throw new Error('staff form missing');
    const field = await addFormField(prisma, editionId, staffForm.definitionId, {
      label: 'Shift',
      labelTa: null,
      help: null,
      fieldType: 'text',
      isRequired: false,
      sectionId: null,
      options: null,
      min: null,
      max: null,
    });

    const { requestId } = await selectedVendorForStaff();
    const a = await prisma.stallVendorStaff.create({
      data: { requestId, name: 'A', mobile: '9000000001' },
    });
    const b = await prisma.stallVendorStaff.create({
      data: { requestId, name: 'B', mobile: '9000000002' },
    });

    await replaceCustomValues(prisma, { requestId, staffId: a.id }, [
      { customFieldId: field.id, value: 'Morning' },
    ]);
    await replaceCustomValues(prisma, { requestId, staffId: b.id }, [
      { customFieldId: field.id, value: 'Night' },
    ]);

    const rows = await prisma.stallCustomFieldValue.findMany({
      where: { customFieldId: field.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.value).sort()).toEqual(['Morning', 'Night']);
  });
});
