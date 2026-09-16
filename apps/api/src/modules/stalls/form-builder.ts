// The form definitions: seeding them from the constants, reading them back, and
// the writes the Form Builder makes.
//
// ⚠️ Nothing here decides what a form LOOKS like — `renderForm` in `@msr/stalls`
// groups and orders, and the public page, the Admin preview and the submit
// validator all call it. This file moves rows.
import { Prisma } from '@prisma/client';
import type { PrismaClient, StallFormType } from '@prisma/client';
import {
  type BuilderForm,
  type BuiltForm,
  type BuiltFormField,
  type FieldOption,
  type FieldType,
  FORM_DEFINITIONS,
  isAuthorableFieldType,
  seedFieldFrom,
} from '@msr/stalls';
import {
  BuiltInFieldLockedError,
  CustomFieldInUseError,
  UnknownFormFieldError,
  UnknownFormError,
  UnauthorableFieldTypeError,
} from './errors';

type Db = PrismaClient | Prisma.TransactionClient;

/** The four forms an edition serves. `BANK` and the rest of `StallFormType`
 *  are not request forms and have no definition. */
const REQUEST_FORMS = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'] as const;
type RequestForm = (typeof REQUEST_FORMS)[number];

/**
 * The 2025 forms, as rows.
 *
 * 🔴 Read out of `FORM_DEFINITIONS` rather than retyped. Every Tamil label in
 * there was copied character-for-character from the printed 2025 Google Form —
 * the note at the top of `forms.ts` says none of it is machine-translated and
 * none of it is guessed — so this is the one and only place that text crosses
 * into the database, and it crosses by reference.
 *
 * ⚠️ Idempotent by DEFINITION, not by field. A form that already exists is left
 * entirely alone: re-running must not resurrect a field an admin deleted, nor
 * undo a reorder, which is exactly what upserting field-by-field would do.
 */
export async function seedFormDefinitions(db: Db, editionId: string): Promise<number> {
  let made = 0;
  for (const formType of REQUEST_FORMS) {
    const existing = await db.stallFormDefinition.findUnique({
      where: { editionId_formType: { editionId, formType } },
      select: { id: true },
    });
    if (existing) {
      // The definition is there; adopt any appended field that predates it.
      // Custom fields were written against (edition, formType) before forms had
      // definitions at all, and they have to hang off one to be ordered.
      await db.stallFormField.updateMany({
        where: { editionId, formType, definitionId: null },
        data: { definitionId: existing.id },
      });
      continue;
    }

    const source = FORM_DEFINITIONS[formType];
    const definition = await db.stallFormDefinition.create({
      data: { editionId, formType, title: source.title, titleTa: source.titleTa },
    });

    // ⚠️ The built-ins take sort orders 0..n and the fields an admin already
    // appended keep sitting after them — which is where they have always
    // rendered, so adopting them must not move them.
    //
    // 🔴 `agreed` is not a question any more. Its wording is a declaration row
    // and its tick is drawn beside that wording directly above Submit — a field
    // here too would be the same consent asked twice, once with real words and
    // once as a bare "I Agree". Existing editions were switched off by the
    // `declarations_per_form` migration; this is the same retirement for the
    // editions that do not exist yet.
    await Promise.all(
      source.fields
        .filter((field) => field.name !== 'agreed')
        .map((field, i) =>
          db.stallFormField.create({
            data: {
              editionId,
              definitionId: definition.id,
              formType,
              ...toRow(seedFieldFrom(field, i)),
            },
          }),
        ),
    );
    const appended = await db.stallFormField.findMany({
      where: { editionId, formType, definitionId: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    await Promise.all(
      appended.map((f, i) =>
        db.stallFormField.update({
          where: { id: f.id },
          data: { definitionId: definition.id, sortOrder: source.fields.length + i },
        }),
      ),
    );
    made += 1;
  }
  return made;
}

/** The shared seed shape, as columns. */
function toRow(f: Omit<BuiltFormField, 'id' | 'sectionId'>) {
  return {
    name: f.name,
    label: f.label,
    labelTa: f.labelTa,
    help: f.help,
    helpTa: f.helpTa,
    fieldType: f.type,
    isRequired: f.required,
    isBuiltIn: f.isBuiltIn,
    isActive: f.isActive,
    sortOrder: f.sortOrder,
    options: f.options === null ? Prisma.DbNull : (f.options as unknown as Prisma.InputJsonValue),
    min: f.min,
    max: f.max,
  };
}

/* ── Reads ──────────────────────────────────────────────────────────────────*/

const FIELD_SELECT = {
  id: true,
  name: true,
  label: true,
  labelTa: true,
  help: true,
  helpTa: true,
  fieldType: true,
  isRequired: true,
  isBuiltIn: true,
  isActive: true,
  sectionId: true,
  sortOrder: true,
  options: true,
  min: true,
  max: true,
} as const;

/** One form. Returns `null` for an edition seeded before forms were data — the
 *  caller then falls back to the constant, which is what every form did until
 *  this landed. */
export async function formFor(
  db: Db,
  editionId: string,
  formType: RequestForm,
): Promise<BuiltForm | null> {
  const row = await db.stallFormDefinition.findUnique({
    where: { editionId_formType: { editionId, formType } },
    select: {
      formType: true,
      title: true,
      titleTa: true,
      sections: {
        select: { id: true, heading: true, headingTa: true, help: true, sortOrder: true },
      },
      fields: { select: FIELD_SELECT },
    },
  });
  return row ? toBuiltForm(row) : null;
}

/** Every request form on the edition, for the public config and the builder. */
export async function formsFor(db: Db, editionId: string): Promise<BuilderForm[]> {
  const rows = await db.stallFormDefinition.findMany({
    where: { editionId, formType: { in: [...REQUEST_FORMS] } },
    select: {
      id: true,
      formType: true,
      title: true,
      titleTa: true,
      sections: {
        select: { id: true, heading: true, headingTa: true, help: true, sortOrder: true },
      },
      fields: { select: FIELD_SELECT },
    },
  });
  return rows.map((r) => ({ ...toBuiltForm(r), definitionId: r.id }));
}

/** The same forms, narrowed to what a requester's page needs.
 *
 *  ⚠️ `definitionId` is dropped rather than simply not asked for: it is the
 *  handle every write takes, and the public payload has no business carrying
 *  the address of something it cannot call. */
export async function publicFormsFor(db: Db, editionId: string): Promise<BuiltForm[]> {
  const forms = await formsFor(db, editionId);
  return forms.map(({ definitionId: _drop, ...form }) => form);
}

type DefinitionRow = {
  formType: StallFormType;
  title: string;
  titleTa: string | null;
  sections: Array<{
    id: string;
    heading: string;
    headingTa: string | null;
    help: string | null;
    sortOrder: number;
  }>;
  fields: Array<{
    id: string;
    name: string | null;
    label: string;
    labelTa: string | null;
    help: string | null;
    helpTa: string | null;
    fieldType: string;
    isRequired: boolean;
    isBuiltIn: boolean;
    isActive: boolean;
    sectionId: string | null;
    sortOrder: number;
    options: Prisma.JsonValue;
    min: number | null;
    max: number | null;
  }>;
};

function toBuiltForm(row: DefinitionRow): BuiltForm {
  return {
    formType: row.formType as RequestForm,
    title: row.title,
    titleTa: row.titleTa,
    sections: row.sections,
    fields: row.fields.map((f) => ({
      id: f.id,
      name: f.name,
      label: f.label,
      labelTa: f.labelTa,
      help: f.help,
      helpTa: f.helpTa,
      type: f.fieldType as FieldType,
      required: f.isRequired,
      isBuiltIn: f.isBuiltIn,
      isActive: f.isActive,
      sectionId: f.sectionId,
      sortOrder: f.sortOrder,
      options: (f.options as FieldOption[] | null) ?? null,
      min: f.min,
      max: f.max,
    })),
  };
}

/* ── Writes ─────────────────────────────────────────────────────────────────*/

export interface FieldPatch {
  label?: string;
  labelTa?: string | null;
  help?: string | null;
  helpTa?: string | null;
  fieldType?: string;
  isRequired?: boolean;
  isActive?: boolean;
  sectionId?: string | null;
  options?: FieldOption[] | null;
  min?: number | null;
  max?: number | null;
}

/**
 * Edits one field.
 *
 * 🔴 The built-in lock is enforced HERE, not only on the screen. A screen that
 * disables an input is a suggestion; this is what makes it a rule — and the two
 * agree because both read `LOCKED_ON_BUILT_IN` from `@msr/stalls`.
 *
 * The lock is exactly `fieldType`, and it is not a policy choice: a built-in
 * field's answer goes into a typed column on `stall_request`, so retyping one
 * would post a string into an integer. Everything else — the wording, the
 * Tamil, the help, the order, the section, required, active — is editable on a
 * built-in exactly as it is on an appended field.
 */
export async function updateFormField(
  db: PrismaClient,
  editionId: string,
  id: string,
  patch: FieldPatch,
): Promise<void> {
  const field = await db.stallFormField.findFirst({
    where: { id, editionId },
    select: { id: true, isBuiltIn: true, label: true, fieldType: true },
  });
  if (!field) throw new UnknownFormFieldError(id);

  if (patch.fieldType !== undefined && patch.fieldType !== field.fieldType) {
    if (field.isBuiltIn) throw new BuiltInFieldLockedError(field.label, 'type');
    if (!isAuthorableFieldType(patch.fieldType)) {
      throw new UnauthorableFieldTypeError(patch.fieldType);
    }
  }

  await db.stallFormField.update({
    where: { id },
    data: {
      label: patch.label,
      labelTa: patch.labelTa,
      help: patch.help,
      helpTa: patch.helpTa,
      fieldType: patch.fieldType,
      isRequired: patch.isRequired,
      isActive: patch.isActive,
      sectionId: patch.sectionId,
      min: patch.min,
      max: patch.max,
      options:
        patch.options === undefined
          ? undefined
          : patch.options === null
            ? Prisma.DbNull
            : (patch.options as unknown as Prisma.InputJsonValue),
    },
  });
}

/**
 * The order of a form's fields, written whole.
 *
 * ⚠️ One call for the LIST, not one per moved field. Dragging a field from the
 * bottom to the top changes every sort order between the two, and sending
 * those as separate writes means a reader loading the form mid-drag sees an
 * order that is neither the old one nor the new one. Sent whole, applied in a
 * transaction.
 *
 * A field left out of the list keeps its place at the end — the caller sends
 * what it drew, and a form being edited in one tab while another adds a field
 * must not silently drop the new one.
 */
export async function reorderFormFields(
  db: PrismaClient,
  editionId: string,
  definitionId: string,
  ordered: Array<{ id: string; sectionId: string | null }>,
): Promise<void> {
  const owned = await db.stallFormField.findMany({
    where: { editionId, definitionId },
    select: { id: true },
  });
  const mine = new Set(owned.map((f) => f.id));
  // A field from another form arriving in this list would be moved ONTO this
  // form by a sort-order write — silently, and only visible as a question
  // appearing on a form nobody put it on.
  const rows = ordered.filter((f) => mine.has(f.id));

  await db.$transaction(
    rows.map((f, i) =>
      db.stallFormField.update({
        where: { id: f.id },
        data: { sortOrder: i, sectionId: f.sectionId },
      }),
    ),
  );
}

export async function addFormField(
  db: PrismaClient,
  editionId: string,
  definitionId: string,
  input: {
    label: string;
    labelTa: string | null;
    help: string | null;
    fieldType: string;
    isRequired: boolean;
    sectionId: string | null;
    options: FieldOption[] | null;
    min: number | null;
    max: number | null;
  },
): Promise<{ id: string }> {
  if (!isAuthorableFieldType(input.fieldType)) {
    throw new UnauthorableFieldTypeError(input.fieldType);
  }
  const definition = await db.stallFormDefinition.findFirst({
    where: { id: definitionId, editionId },
    select: { formType: true },
  });
  if (!definition) throw new UnknownFormError(definitionId);

  const last = await db.stallFormField.aggregate({
    where: { definitionId },
    _max: { sortOrder: true },
  });

  return db.stallFormField.create({
    data: {
      editionId,
      definitionId,
      formType: definition.formType,
      // ⚠️ No `name`. An appended field's answer is keyed by its id in
      // `StallCustomFieldValue`; a name would imply a column that is not there.
      name: null,
      label: input.label,
      labelTa: input.labelTa,
      help: input.help,
      fieldType: input.fieldType,
      isRequired: input.isRequired,
      isBuiltIn: false,
      sectionId: input.sectionId,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
      options:
        input.options === null
          ? Prisma.DbNull
          : (input.options as unknown as Prisma.InputJsonValue),
      min: input.min,
      max: input.max,
    },
    select: { id: true },
  });
}

/** Renames the form itself. */
export async function updateFormDefinition(
  db: PrismaClient,
  editionId: string,
  formType: RequestForm,
  patch: { title?: string; titleTa?: string | null },
  by: string,
): Promise<void> {
  await db.stallFormDefinition.update({
    where: { editionId_formType: { editionId, formType } },
    data: { ...patch, updatedBy: by },
  });
}

/* ── Sections ───────────────────────────────────────────────────────────────*/

export async function addSection(
  db: PrismaClient,
  editionId: string,
  definitionId: string,
  input: { heading: string; headingTa: string | null; help: string | null },
): Promise<{ id: string }> {
  const definition = await db.stallFormDefinition.findFirst({
    where: { id: definitionId, editionId },
    select: { id: true },
  });
  if (!definition) throw new UnknownFormError(definitionId);
  const last = await db.stallFormSection.aggregate({
    where: { definitionId },
    _max: { sortOrder: true },
  });
  return db.stallFormSection.create({
    data: { definitionId, ...input, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    select: { id: true },
  });
}

/**
 * Removes a question, while nothing has been typed into it.
 *
 * 🔴 Two refusals, and they are different refusals. A BUILT-IN is never
 * removable whatever it has been answered: its answer lands in a typed column
 * on `stall_request` that the submit path writes regardless of whether the form
 * asked, so deleting the question leaves a required column with nothing to fill
 * it. Switch it off instead. An APPENDED field is removable right up until the
 * first answer, and after that deactivating is the only honest move — the
 * answers are on the record of everybody who gave them, and the question they
 * answered has to still be readable.
 *
 * ⚠️ Scoped to the edition like every other write here, so a field id from one
 * year cannot be deleted while looking at another.
 */
export async function deleteFormField(
  db: PrismaClient,
  editionId: string,
  id: string,
): Promise<void> {
  const field = await db.stallFormField.findFirst({
    where: { id, editionId },
    select: { id: true, isBuiltIn: true, label: true },
  });
  if (!field) throw new UnknownFormFieldError(id);
  if (field.isBuiltIn) throw new BuiltInFieldLockedError(field.label, 'existence');
  const answered = await db.stallCustomFieldValue.count({ where: { customFieldId: id } });
  if (answered > 0) throw new CustomFieldInUseError(id);
  await db.stallFormField.delete({ where: { id } });
}

/** Removes a heading. The fields under it are NOT removed — `section_id` is
 *  `ON DELETE SET NULL`, so they fall back into the form's own flow. Deleting a
 *  heading must never delete questions. */
export async function deleteSection(
  db: PrismaClient,
  editionId: string,
  id: string,
): Promise<void> {
  const section = await db.stallFormSection.findFirst({
    where: { id, definition: { editionId } },
    select: { id: true },
  });
  if (!section) throw new UnknownFormError(id);
  await db.stallFormSection.delete({ where: { id } });
}
