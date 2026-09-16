// The forms, as rows: what gets seeded, what an admin may change, and the one
// thing having a database underneath makes impossible.
import type { FastifyInstance } from 'fastify';
import { NO_RULES, SubmitRequestInput } from '@msr/stalls';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import {
  addFormField,
  addSection,
  deleteFormField,
  deleteSection,
  formFor,
  formsFor,
  reorderFormFields,
  seedFormDefinitions,
  updateFormField,
} from '../src/modules/stalls/form-builder';
import {
  BadFieldMediaError,
  BadFieldRuleError,
  BuiltInDecimalsError,
  BuiltInFieldLockedError,
  FieldShapeChangeError,
  CustomFieldInUseError,
  UnauthorableFieldTypeError,
  UnknownFormFieldError,
} from '../src/modules/stalls/errors';
import { createEdition } from '../src/modules/stalls/config';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  accountFor,
  LogMailer,
  prisma,
  resetDatabase,
  seedBackoffice,
  seedEdition,
  SYSTEM,
  type Backoffice,
  vendorBody,
} from './helpers/db';

let app: FastifyInstance;
let editionId: string;
let admin: Backoffice;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  editionId = (await seedEdition()).id;
  admin = await seedBackoffice(['stalls_admin']);
});

const vendorForm = async () => {
  const form = await formFor(prisma, editionId, 'VENDOR');
  if (!form) throw new Error('no vendor form');
  return form;
};

const definitionId = async () =>
  (await formsFor(prisma, editionId)).find((f) => f.formType === 'VENDOR')?.definitionId ?? '';

const submit = async (body: Record<string, unknown> = {}) =>
  submitRequest(
    prisma,
    SubmitRequestInput.parse(vendorBody(body)),
    { mail: new LogMailer(), statusUrl: (t) => t },
    await accountFor(body),
  );

describe('seeded from the printed forms', () => {
  /** 🔴 SIX, not three. The bank details form, the FSSAI upload and staff
   *  registration used to be JSX — rewording a label or ceasing to ask one of
   *  their questions was a redeploy. They are definitions like the rest now. */
  test('all six exist, with their own titles', async () => {
    const forms = await formsFor(prisma, editionId);
    expect(forms.map((f) => f.formType).sort()).toEqual([
      'ASHRAM',
      'BANK',
      'FSSAI',
      'LOCAL_WELFARE',
      'STAFF',
      'VENDOR',
    ]);
    expect(forms.find((f) => f.formType === 'VENDOR')?.title).toBe('Vendor Stall Request Form');
    expect(forms.find((f) => f.formType === 'BANK')?.title).toBe(
      'MSR Stalls Bank Details and Requirements',
    );
  });

  /** 🔴 Read out of `FORM_DEFINITIONS` rather than retyped. Every Tamil label
   *  there was copied character-for-character from the printed 2025 form, and
   *  retyping them into a migration is the one place that claim would stop
   *  being true. */
  test('the Tamil came across with the questions', async () => {
    const form = await vendorForm();
    const tamil = form.fields.filter((f) => f.labelTa !== null);
    expect(tamil.length).toBeGreaterThan(3);
  });

  test('every seeded question is built in', async () => {
    const form = await vendorForm();
    expect(form.fields.every((f) => f.isBuiltIn)).toBe(true);
  });

  /** ⚠️ Idempotent by DEFINITION, not by field: re-running must not resurrect a
   *  question an admin switched off, nor undo a reorder. */
  test('re-seeding leaves an edited form alone', async () => {
    const form = await vendorForm();
    const first = form.fields[0];
    if (!first) throw new Error('no fields');
    await updateFormField(prisma, editionId, first.id, { label: 'Renamed by hand' });

    await seedFormDefinitions(prisma, editionId);

    const again = await vendorForm();
    expect(again.fields.find((f) => f.id === first.id)?.label).toBe('Renamed by hand');
    expect(again.fields).toHaveLength(form.fields.length);
  });
});

describe('what an admin may change', () => {
  const stallName = async () => {
    const form = await vendorForm();
    const f = form.fields.find((x) => x.name === 'stallName');
    if (!f) throw new Error('no stallName field');
    return f;
  };

  /** A question of the admin's own, for the cases about limits — an appended
   *  field has no column, so it is where every knob is reachable. */
  const appended = async (label: string, fieldType = 'text') =>
    addFormField(prisma, editionId, await definitionId(), {
      label,
      labelTa: null,
      help: null,
      fieldType,
      isRequired: false,
      sectionId: null,
      options: null,
      ...NO_RULES,
    });

  test('the wording, the Tamil and the help on a built-in question', async () => {
    const f = await stallName();
    await updateFormField(prisma, editionId, f.id, {
      label: 'Name of the stall',
      labelTa: 'கடையின் பெயர்',
      help: 'As it should appear on the board',
    });
    const after = (await vendorForm()).fields.find((x) => x.id === f.id);
    expect(after?.label).toBe('Name of the stall');
    expect(after?.labelTa).toBe('கடையின் பெயர்');
    expect(after?.help).toBe('As it should appear on the board');
  });

  /** 🔴 And its TYPE, within the kind of answer its column holds.
   *  `stall_request.stall_name` is a text column, and it does not care whether
   *  the requester typed into a box, picked from a dropdown or pressed one of a
   *  set of buttons — all three post a string. */
  test('and the answer type of a built-in, within its own kind', async () => {
    const f = await stallName();
    await updateFormField(prisma, editionId, f.id, { fieldType: 'textarea' });
    expect((await vendorForm()).fields.find((x) => x.id === f.id)?.type).toBe('textarea');
  });

  /** ⚠️ What it may NOT do is change the kind. A number posts an integer, a
   *  file posts a media-store key, a display block posts nothing — and
   *  `stall_name` has nowhere to put any of them. */
  test('but never into a different kind of answer', async () => {
    const f = await stallName();
    await expect(
      updateFormField(prisma, editionId, f.id, { fieldType: 'number' }),
    ).rejects.toBeInstanceOf(FieldShapeChangeError);
    await expect(
      updateFormField(prisma, editionId, f.id, { fieldType: 'display' }),
    ).rejects.toBeInstanceOf(FieldShapeChangeError);
  });

  /** ⚠️ Every numeric column on `stall_request` is an integer, so a built-in
   *  that accepted 2.5 plug points would be rounded on its way in. */
  test('and a built-in number never takes decimals', async () => {
    const f = (await vendorForm()).fields.find((x) => x.name === 'numStallsRequested');
    await expect(
      updateFormField(prisma, editionId, f?.id ?? '', { decimals: 2 }),
    ).rejects.toBeInstanceOf(BuiltInDecimalsError);
  });

  /* ── The limits a question carries ─────────────────────────────────────── */

  /** 🔴 A limit that cannot be met is refused where it is SET. A vendor meeting
   *  it three submissions later, on a form that refuses every value, is the
   *  outcome this prevents. */
  test('a maximum below its minimum is refused on the way in', async () => {
    const f = (await vendorForm()).fields.find((x) => x.name === 'numStallsRequested');
    await expect(
      updateFormField(prisma, editionId, f?.id ?? '', { min: 10, max: 5 }),
    ).rejects.toBeInstanceOf(BadFieldRuleError);
  });

  test('a pattern with nothing said about it is refused', async () => {
    const added = await appended('GST Number');
    await expect(
      updateFormField(prisma, editionId, added.id, { pattern: '^[0-9A-Z]{15}$' }),
    ).rejects.toBeInstanceOf(BadFieldRuleError);
    await updateFormField(prisma, editionId, added.id, {
      pattern: '^[0-9A-Z]{15}$',
      patternHint: 'fifteen characters',
    });
    const after = (await vendorForm()).fields.find((x) => x.id === added.id);
    expect(after?.pattern).toBe('^[0-9A-Z]{15}$');
  });

  /** ⚠️ Set one knob at a time. A PATCH sends what it changed, so a second save
   *  that only touches the maximum must not clear the minimum set by the
   *  first — which is what reading the omitted knobs off the row is for. */
  test('one limit at a time does not clear the last one', async () => {
    const added = await appended('Helpers', 'number');
    await updateFormField(prisma, editionId, added.id, { min: 1 });
    await updateFormField(prisma, editionId, added.id, { max: 20 });
    const after = (await vendorForm()).fields.find((x) => x.id === added.id);
    expect(after?.min).toBe(1);
    expect(after?.max).toBe(20);
  });

  /** 🔴 A cap of 20 helpers would silently become "at most twenty characters"
   *  on a text question. A limit whose meaning changed under it is not a limit
   *  anybody set. */
  test('a limit the new type has no meaning for is dropped by the retype', async () => {
    const added = await appended('Helpers', 'number');
    await updateFormField(prisma, editionId, added.id, { min: 1, max: 20 });
    await updateFormField(prisma, editionId, added.id, { fieldType: 'text' });
    const after = (await vendorForm()).fields.find((x) => x.id === added.id);
    expect(after?.min).toBeNull();
    expect(after?.max).toBeNull();
  });

  /** ⚠️ Stored as JSON, and it survives the round trip as the union it is. */
  test('a date question keeps the window it was given', async () => {
    const added = await appended('Arrival day', 'date');
    await updateFormField(prisma, editionId, added.id, {
      window: { mode: 'rolling', minDays: 0, maxDays: 30 },
    });
    const after = (await vendorForm()).fields.find((x) => x.id === added.id);
    expect(after?.window).toEqual({ mode: 'rolling', minDays: 0, maxDays: 30 });
  });

  test('and never its existence — it is switched off instead', async () => {
    const f = await stallName();
    await expect(deleteFormField(prisma, editionId, f.id)).rejects.toBeInstanceOf(
      BuiltInFieldLockedError,
    );

    await updateFormField(prisma, editionId, f.id, { isActive: false });
    const after = await vendorForm();
    expect(after.fields.find((x) => x.id === f.id)?.isActive).toBe(false);
  });

  test('a question added by hand can be retyped freely', async () => {
    const added = await addFormField(prisma, editionId, await definitionId(), {
      label: 'Instagram handle',
      labelTa: null,
      help: null,
      fieldType: 'text',
      isRequired: false,
      sectionId: null,
      options: null,
      ...NO_RULES,
    });
    await updateFormField(prisma, editionId, added.id, { fieldType: 'textarea' });
    const after = (await vendorForm()).fields.find((x) => x.id === added.id);
    expect(after?.type).toBe('textarea');
    expect(after?.isBuiltIn).toBe(false);
    // ⚠️ No `name`: its answer is keyed by id in `stall_custom_field_value`,
    // and a name would imply a column that is not there.
    expect(after?.name).toBeNull();
  });

  /** ⚠️ Structural types: one is a repeating row editor wired to its own table,
   *  the other resolves its choices from the edition's bays at render time. */
  test('a structural type cannot be authored', async () => {
    await expect(
      addFormField(prisma, editionId, await definitionId(), {
        label: 'Appliances',
        labelTa: null,
        help: null,
        fieldType: 'appliances',
        isRequired: false,
        sectionId: null,
        options: null,
        ...NO_RULES,
      }),
    ).rejects.toBeInstanceOf(UnauthorableFieldTypeError);
  });
});

/** Removing a question, and the two different reasons it is refused. */
describe('deleteFormField', () => {
  const appended = async (label: string) =>
    addFormField(prisma, editionId, await definitionId(), {
      label,
      labelTa: null,
      help: null,
      fieldType: 'text',
      isRequired: false,
      sectionId: null,
      options: null,
      ...NO_RULES,
    });

  test('removes a question nobody has answered', async () => {
    const f = await appended('Website');
    await deleteFormField(prisma, editionId, f.id);
    expect(await prisma.stallFormField.findUnique({ where: { id: f.id } })).toBeNull();
  });

  /** 🔴 The answers are on the record of everybody who gave them, and the
   *  question they answered has to stay readable beside them. Switch it off. */
  test('refuses once somebody has answered it', async () => {
    const f = await appended('Website');
    await submit({ customFields: { [f.id]: 'greenleaf.example' } });
    await expect(deleteFormField(prisma, editionId, f.id)).rejects.toBeInstanceOf(
      CustomFieldInUseError,
    );
  });

  /** ⚠️ Scoped to the edition: a field id from another year is not found here
   *  rather than deleted from under it. */
  test('refuses a field belonging to another edition', async () => {
    const f = await appended('Website');
    const other = await createEdition(
      prisma,
      { year: 2031, name: 'MSR 2031', activate: false },
      SYSTEM,
    );
    await expect(deleteFormField(prisma, other.id, f.id)).rejects.toBeInstanceOf(
      UnknownFormFieldError,
    );
  });
});

describe('order and headings', () => {
  test('reordering writes the whole list', async () => {
    const form = await vendorForm();
    const reversed = [...form.fields].reverse().map((f) => ({ id: f.id, sectionId: null }));
    await reorderFormFields(prisma, editionId, await definitionId(), reversed);

    const after = await vendorForm();
    const byOrder = [...after.fields].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(byOrder[0]?.id).toBe(reversed[0]?.id);
  });

  /** ⚠️ A field from another form arriving in the list would be MOVED onto this
   *  one by a sort-order write — silently, and visible only as a question
   *  appearing on a form nobody put it on. */
  test('and ignores a field belonging to another form', async () => {
    const ashram = await formFor(prisma, editionId, 'ASHRAM');
    const stranger = ashram?.fields[0];
    if (!stranger) throw new Error('no ashram fields');

    await reorderFormFields(prisma, editionId, await definitionId(), [
      { id: stranger.id, sectionId: null },
    ]);

    const after = await formFor(prisma, editionId, 'ASHRAM');
    expect(after?.fields.some((f) => f.id === stranger.id)).toBe(true);
    const vendor = await vendorForm();
    expect(vendor.fields.some((f) => f.id === stranger.id)).toBe(false);
  });

  /** 🔴 Deleting a heading must never delete questions. */
  test('removing a heading leaves its questions on the form', async () => {
    const id = await definitionId();
    const section = await addSection(prisma, editionId, id, {
      heading: 'Electrical',
      headingTa: null,
      help: null,
    });
    const form = await vendorForm();
    const moved = form.fields[0];
    if (!moved) throw new Error('no fields');
    await updateFormField(prisma, editionId, moved.id, { sectionId: section.id });

    await deleteSection(prisma, editionId, section.id);

    const after = await vendorForm();
    expect(after.fields.some((f) => f.id === moved.id)).toBe(true);
    expect(after.fields.find((f) => f.id === moved.id)?.sectionId).toBeNull();
  });
});

describe('what the form insists on', () => {
  /** 🔴 The second half of "the whole form is data". `SubmitRequestInput` is a
   *  constant and can only say what a field's TYPE is; which questions must be
   *  answered is now a property of the edition's rows. */
  test('a question marked required is enforced by the API', async () => {
    const form = await vendorForm();
    const remarks = form.fields.find((f) => f.name === 'remarks');
    if (!remarks) throw new Error('no remarks field');

    await expect(submit({ remarks: undefined })).resolves.toBeDefined();

    await updateFormField(prisma, editionId, remarks.id, { isRequired: true });
    await expect(submit({ email: 'other@x.example', remarks: undefined })).rejects.toThrow();
  });

  test('and switching a required question off stops it being enforced', async () => {
    const form = await vendorForm();
    const remarks = form.fields.find((f) => f.name === 'remarks');
    if (!remarks) throw new Error('no remarks field');
    await updateFormField(prisma, editionId, remarks.id, { isRequired: true, isActive: false });
    await expect(submit({ remarks: undefined })).resolves.toBeDefined();
  });
});

describe('over HTTP', () => {
  test('an admin reads the forms and renames one', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config/forms',
      headers: admin.headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().forms).toHaveLength(6);

    const patched = await app.inject({
      method: 'PATCH',
      url: '/api/m/stalls/config/forms/VENDOR',
      headers: admin.headers,
      payload: { title: 'Trade Stall Request' },
    });
    expect(patched.statusCode).toBe(204);
    expect((await vendorForm()).title).toBe('Trade Stall Request');
  });

  /** ⚠️ A 400 rather than a 409: nothing on the server collides with it, the
   *  change simply does not describe an answer the column could hold. */
  test('retyping a built-in across kinds is a 400 that says which one', async () => {
    const form = await vendorForm();
    const f = form.fields.find((x) => x.name === 'stallName');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/config/form-fields/${f?.id}`,
      headers: admin.headers,
      payload: { fieldType: 'number' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Stall Name');
  });

  /** 🔴 And the same request within the kind is a 204. The picker is filled
   *  from `fieldTypeChoices`, so a coordinator only ever sends this one. */
  test('and within its kind it simply saves', async () => {
    const form = await vendorForm();
    const f = form.fields.find((x) => x.name === 'stallName');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/config/form-fields/${f?.id}`,
      headers: admin.headers,
      payload: { fieldType: 'textarea' },
    });
    expect(res.statusCode).toBe(204);
  });

  test('a volunteer may not read the forms at all', async () => {
    const volunteer = await seedBackoffice(['stalls_volunteer']);
    const res = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config/forms',
      headers: volunteer.headers,
    });
    expect(res.statusCode).toBe(403);
  });
});

/**
 * A display block: a row that says something rather than asking it.
 *
 * 🔴 Everything here is enforced on the API and not only on the screen. The
 * builder hides the Required tick and offers a picture on nothing else, but a
 * screen that hides a control is a suggestion — these are the refusals that
 * make it a rule.
 */
describe('a display block', () => {
  const NOTE_KEY = 'stalls/form-note/33333333-3333-4333-8333-333333333333.png';

  const block = async (over: Record<string, unknown> = {}) =>
    addFormField(prisma, editionId, await definitionId(), {
      label: 'The venue layout',
      labelTa: null,
      help: 'Bays A1 to C4, as they stand this year.',
      fieldType: 'display',
      isRequired: false,
      sectionId: null,
      options: null,
      ...NO_RULES,
      ...over,
    });

  const read = async (id: string) => (await vendorForm()).fields.find((x) => x.id === id);

  test('carries its picture', async () => {
    const added = await block({ mediaKey: NOTE_KEY });
    expect((await read(added.id))?.mediaKey).toBe(NOTE_KEY);
  });

  /** 🔴 A required block is a form nobody can submit: the validator skips it,
   *  so the refusal would come from nothing the reader can see or fix. Forced
   *  false however it arrives. */
  test('is never required, whatever the write asks for', async () => {
    const added = await block({ isRequired: true });
    expect((await read(added.id))?.required).toBe(false);

    await updateFormField(prisma, editionId, added.id, { isRequired: true });
    expect((await read(added.id))?.required).toBe(false);
  });

  /** ⚠️ And a block asking nothing cannot hold a submission up. */
  test('does not stop a request being submitted', async () => {
    await block({ isRequired: true, mediaKey: NOTE_KEY });
    await expect(submit()).resolves.toBeTruthy();
  });

  /** 🔴 `/public/form-image` serves whatever a field row points at,
   *  unauthenticated. A key minted for a vendor's cheque reaching this column
   *  would be that vendor's document served to the world. */
  test('refuses a key that was not minted for one', async () => {
    await expect(block({ mediaKey: 'stalls/bank/cheque/whatever.jpg' })).rejects.toBeInstanceOf(
      BadFieldMediaError,
    );
  });

  test('and no question may carry a picture at all', async () => {
    await expect(
      block({ fieldType: 'text', label: 'Instagram handle', mediaKey: NOTE_KEY }),
    ).rejects.toBeInstanceOf(BadFieldMediaError);
  });

  /** ⚠️ Retyped back into a question, the picture goes with it. A row pointing
   *  at an image nothing draws would come back the moment somebody retyped it
   *  to `display` again. */
  test('loses its picture when it stops being one', async () => {
    const added = await block({ mediaKey: NOTE_KEY });
    await updateFormField(prisma, editionId, added.id, { fieldType: 'text' });
    expect((await read(added.id))?.mediaKey).toBeNull();
  });

  test('over HTTP, a picture on a question is a 400 that says why', async () => {
    const added = await block();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/config/form-fields/${added.id}`,
      headers: admin.headers,
      payload: { fieldType: 'text', mediaKey: NOTE_KEY },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('display block');
  });
});
