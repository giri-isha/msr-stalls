import { PUBLIC_FORM_TYPES, isLockedRequired } from '@msr/stalls';
import { beforeEach, describe, expect, test } from 'vitest';
import { formsFor, updateFormField } from '../src/modules/stalls/form-builder';
import { StructuralFieldLockedError } from '../src/modules/stalls/errors';
import { prisma, resetDatabase, seedEdition } from './helpers/db';

let editionId: string;

beforeEach(async () => {
  await resetDatabase();
  editionId = (await seedEdition()).id;
});

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
