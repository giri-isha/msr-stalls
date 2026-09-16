import type { FieldOption, FieldType, FormField } from './forms';
import type { StallFormType } from './reference';

/**
 * A form, as rows rather than as a constant.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 * 🔴 `forms.ts` was the four 2025 forms AND the thing that rendered them AND
 * the thing the API validated against. The Form Builder could only APPEND, so
 * reordering a field or fixing a label was a code change and a redeploy — the
 * same problem the bay list had before zones became rows. Those constants are
 * the SEED now; these types are what a form is.
 *
 * ── The one thing that is not free ──────────────────────────────────────────
 * ⚠️ `isBuiltIn`. A built-in field's answer lands in a TYPED COLUMN on
 * `stall_request` — `stall_name`, `email`, `num_stalls_requested` — so its
 * `name` and `type` are fixed: renaming one posts an answer the submit path has
 * nowhere to put, retyping one posts a string into an integer column. That is a
 * property of there being a database underneath, not a limit anybody chose, and
 * it is the ONLY thing locked. Wording, Tamil, help text, order, section,
 * required, and whether the question is asked at all are editable on every
 * field.
 *
 * An appended field is the same row with `isBuiltIn` false and no `name`; its
 * answer goes to `StallCustomFieldValue` keyed by id. There is one kind of
 * field.
 */

export interface BuiltFormField {
  id: string;
  /** The contract key for a built-in; `null` on an appended field, whose id is
   *  its key. */
  name: string | null;
  label: string;
  labelTa: string | null;
  help: string | null;
  helpTa: string | null;
  type: FieldType;
  required: boolean;
  isBuiltIn: boolean;
  /** A question the edition no longer asks. Kept rather than deleted, because a
   *  field that has been answered still names those answers. */
  isActive: boolean;
  sectionId: string | null;
  sortOrder: number;
  options: FieldOption[] | null;
  min: number | null;
  max: number | null;
}

export interface BuiltFormSection {
  id: string;
  heading: string;
  headingTa: string | null;
  help: string | null;
  sortOrder: number;
}

export interface BuiltForm {
  /** ⚠️ A FORM type, not a request type. Four of the seven are applications;
   *  the bank details form, the FSSAI upload and staff registration are not,
   *  and all seven are definitions. */
  formType: StallFormType;
  title: string;
  titleTa: string | null;
  sections: BuiltFormSection[];
  fields: BuiltFormField[];
}

/**
 * The form as the BUILDER addresses it.
 *
 * ⚠️ `definitionId` is the one field the public payload does not carry. It is
 * the handle every write needs — add a question to this form, reorder it — and
 * the public page needs none of them, so `PublicConfig.forms` is the narrower
 * shape and this is its superset. Two types rather than one optional field, so
 * "can this be written to?" is a question the compiler answers.
 */
export interface BuilderForm extends BuiltForm {
  definitionId: string;
}

/** A section with its fields, in the order they are drawn. Fields with no
 *  section come first, under no heading — which is what the 2025 forms are. */
export interface RenderedGroup {
  section: BuiltFormSection | null;
  fields: BuiltFormField[];
}

/**
 * The form, grouped for rendering.
 *
 * ⚠️ Inactive fields are dropped HERE, once, rather than at each of the three
 * call sites that draw or validate a form. A field switched off is a question
 * the edition no longer asks; a field switched off that still validates is a
 * form nobody can submit.
 */
export function renderForm(form: BuiltForm): RenderedGroup[] {
  const live = form.fields.filter((f) => f.isActive);
  const byOrder = (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder;

  const loose = live.filter((f) => f.sectionId === null).sort(byOrder);
  const groups: RenderedGroup[] = loose.length > 0 ? [{ section: null, fields: loose }] : [];

  for (const section of [...form.sections].sort(byOrder)) {
    const fields = live.filter((f) => f.sectionId === section.id).sort(byOrder);
    // A heading with nothing under it is a heading for nothing — it happens
    // while a form is being built, and drawing it would look like a bug.
    if (fields.length > 0) groups.push({ section, fields });
  }
  return groups;
}

/** Every field the form draws, in order, flattened. */
export function formFields(form: BuiltForm): BuiltFormField[] {
  return renderForm(form).flatMap((g) => g.fields);
}

/**
 * What a built-in field may have changed.
 *
 * ⚠️ Used by BOTH the screen (to disable the inputs) and the API (to refuse the
 * write). A screen that merely hides a control is a suggestion; the refusal is
 * what makes it a rule, and they have to agree about which fields it covers.
 */
export const LOCKED_ON_BUILT_IN = ['name', 'type'] as const;

export function canEditFieldType(field: Pick<BuiltFormField, 'isBuiltIn'>): boolean {
  return !field.isBuiltIn;
}

/** Whether a field may be removed outright, as opposed to switched off.
 *
 *  ⚠️ A built-in NEVER can: the submit path reads its column whether or not the
 *  form asked for it, and a missing required column is a 500 rather than a
 *  validation message. Switching it off is the supported way to stop asking —
 *  and `isRequired` is what decides whether the answer may then be blank. */
export function canDeleteField(field: Pick<BuiltFormField, 'isBuiltIn'>): boolean {
  return !field.isBuiltIn;
}

/* ── Seeding ────────────────────────────────────────────────────────────────*/

/** One field as the seed writes it, from a `FormField` in `forms.ts`.
 *
 *  ⚠️ `appliances` and `zone` are types the builder cannot author — one is a
 *  repeating row editor and the other resolves its choices from the edition's
 *  bays at render time. They seed as built-ins and stay built-ins. */
export function seedFieldFrom(
  field: FormField,
  sortOrder: number,
): Omit<BuiltFormField, 'id' | 'sectionId'> {
  return {
    name: field.name,
    label: field.label,
    labelTa: field.labelTa,
    help: field.help ?? null,
    helpTa: field.helpTa ?? null,
    type: field.type,
    required: field.required,
    // Everything transcribed from a printed 2025 form is built in: each one
    // answers a column that already exists.
    isBuiltIn: true,
    isActive: true,
    sortOrder,
    options: field.options ?? null,
    min: field.min ?? null,
    max: field.max ?? null,
  };
}

/** The field types an admin may choose for a NEW question.
 *
 *  ⚠️ Narrower than `FieldType`. `appliances` and `zone` are structural — the
 *  first is a repeating editor wired to its own table, the second resolves its
 *  options from the edition's bays — so neither can be authored from a picker,
 *  and offering them would produce a field nothing knows how to render. */
export const AUTHORABLE_FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'tel',
  'number',
  'select',
  'radio',
  'checkbox',
  // ⚠️ Authorable, unlike `appliances` and `zone`, because a file field needs
  // nothing resolved at render time — its upload purpose is `FORM_FIELD` and
  // its own id scopes the key. See `isOurKey`.
  'file',
  'files',
] as const satisfies readonly FieldType[];

export type AuthorableFieldType = (typeof AUTHORABLE_FIELD_TYPES)[number];

export function isAuthorableFieldType(t: string): t is AuthorableFieldType {
  return (AUTHORABLE_FIELD_TYPES as readonly string[]).includes(t);
}

/** Whether this type needs a list of choices to mean anything.
 *
 *  ⚠️ Never true for `file` or `files`: a file question with a choice list is a
 *  question nobody can answer. */
export function needsOptions(type: string): boolean {
  return type === 'select' || type === 'radio';
}

/** Whether an answer to this question is a media-store key rather than text. */
export function isFileType(type: string): type is 'file' | 'files' {
  return type === 'file' || type === 'files';
}

/* ── Validation ─────────────────────────────────────────────────────────────*/

/** One thing wrong with a submission, keyed by the field the reader has to fix. */
export interface FormViolation {
  fieldKey: string;
  message: string;
}

/**
 * What the DEFINITION requires, checked against what arrived.
 *
 * 🔴 The second half of "the whole form is data". `SubmitRequestInput` is a
 * constant, so it can only say what a field's TYPE is — and it has to accept
 * everything any of the four forms might send, which means almost everything is
 * optional in it. Which questions must be answered is now a property of the
 * edition's rows, and only this function can see it.
 *
 * So the two run together and neither is redundant: the contract decides that
 * `numStallsRequested` is an integer, and this decides that the vendor form
 * insists on it this year.
 *
 * ⚠️ Takes plain values, so it runs identically in the browser before a
 * round-trip and on the server as the thing that actually enforces. A rule the
 * page applied and the API did not would be a form somebody could submit by
 * hand with half of it blank.
 */
export function validateAgainstForm(
  form: BuiltForm,
  values: {
    builtIn: Record<string, unknown>;
    /** Appended answers, keyed by field id. */
    custom: Record<string, string>;
  },
): FormViolation[] {
  const out: FormViolation[] = [];
  for (const field of formFields(form)) {
    // ⚠️ Checked BEFORE the required test, because a `files` answer can be too
    // long while being present. The page caps the picker, but a cap only the
    // page applies is one a hand-built post ignores.
    if (field.type === 'files' && field.max !== null) {
      const given = field.isBuiltIn
        ? field.name === null
          ? undefined
          : values.builtIn[field.name]
        : values.custom[field.id];
      if (Array.isArray(given) && given.length > field.max) {
        out.push({
          fieldKey: field.isBuiltIn ? (field.name ?? field.id) : `customFields.${field.id}`,
          message: `${field.label} takes at most ${field.max} file${field.max === 1 ? '' : 's'}`,
        });
        continue;
      }
    }
    if (!field.required) continue;
    // ⚠️ A built-in reads by NAME and an appended field by ID — they are
    // different key spaces, and the value arriving under the wrong one is not
    // an answer to this question.
    const given = field.isBuiltIn
      ? field.name === null
        ? undefined
        : values.builtIn[field.name]
      : values.custom[field.id];
    if (isBlank(given, field.type)) {
      out.push({
        fieldKey: field.isBuiltIn ? (field.name ?? field.id) : `customFields.${field.id}`,
        message:
          field.type === 'checkbox' ? 'Please tick to continue' : `${field.label} is required`,
      });
    }
  }
  return out;
}

/**
 * Whether a required question went unanswered.
 *
 * 🔴 `false` is blank ONLY on a checkbox. An unticked box is an unanswered
 * question — that is the whole of the consent gate on all four forms — but a
 * `select` can perfectly well be answered "No", and `wantsThembu` on the ashram
 * forms is exactly that: a YES/NO picker whose No arrives as `false`. Treating
 * every `false` as blank made answering No indistinguishable from not
 * answering, so an ashram department that did not want a thembu could not
 * submit at all.
 *
 * `0` is never blank. "How many stalls" answered zero is a wrong answer for the
 * contract to catch, not a missing one — and the local welfare form's plug and
 * pass counts are required fields whose honest answer is usually 0.
 */
function isBlank(v: unknown, type: FieldType): boolean {
  if (v === undefined || v === null) return true;
  // A `file` answer is a key; the empty string is "nothing uploaded", not a
  // file named "". `files` falls through to the array case below.
  if (typeof v === 'boolean') return type === 'checkbox' ? v === false : false;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
