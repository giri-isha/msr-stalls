import {
  checkFieldValue,
  clearedRulesFor,
  type FieldRuleValues,
  isBlankAnswer,
  type RuledField,
  sameValueShape,
  todayISO,
} from './field-rules';
import { type FieldOption, type FieldType, type FormField, isFoodOnlyField } from './forms';
import type { StallFormType } from './reference';

/**
 * A form, as rows rather than as a constant.
 *
 * ── What changed ────────────────────────────────────────────────────────────
 * 🔴 `forms.ts` was the 2025 forms AND the thing that rendered them AND
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

export interface BuiltFormField extends FieldRuleValues {
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
  /** The picture a `display` block draws, as a media-store key. `null` on every
   *  other type, and on a display block that is words only. */
  mediaKey: string | null;
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
 * What the reader has answered so far, where a LATER question depends on it.
 *
 * 🔴 One entry, and it earns its place: the ashram form asks whether the stall
 * sells food, and `fssaiExpected` is asked only when the answer is yes. That
 * used to be the difference between two forms, so nothing had to look at an
 * answer to know which questions existed.
 *
 * ⚠️ `undefined` means NOT YET ANSWERED, and it is not the same as false. A
 * form drawn before the reader has picked shows the food-only questions rather
 * than hiding them, because a question that appears when you tick a box above
 * it reads as a form that grew; one that was always there and is now required
 * reads as a form you have not finished.
 */
export interface FormAnswerContext {
  isFood?: boolean;
  /** Today, as a calendar day, for a date question whose window rolls with it.
   *  Injected rather than read so the check is testable, and so a page and the
   *  API straddling midnight can be told to agree on the day. */
  today?: string;
}

/**
 * Whether a question is asked at all, given what has been answered above it.
 *
 * ⚠️ Read by the page (which draws nothing for a hidden field) and by
 * `validateAgainstForm` (which asks nothing of one). A page that merely hid the
 * control would leave the API insisting on an answer to a question that was
 * never on screen — and the error would point at a field the reader cannot see.
 */
export function fieldIsAsked(
  field: Pick<BuiltFormField, 'name'>,
  ctx: FormAnswerContext = {},
): boolean {
  return !(isFoodOnlyField(field.name) && ctx.isFood === false);
}

/**
 * What a built-in field may NOT have changed.
 *
 * ⚠️ Used by BOTH the screen (to disable the inputs) and the API (to refuse the
 * write). A screen that merely hides a control is a suggestion; the refusal is
 * what makes it a rule, and they have to agree about which fields it covers.
 *
 * 🔴 `type` used to be on this list and is not any more. See
 * `canRetypeBuiltInTo`: the column under a built-in cares what ARRIVES, not
 * which control produced it, so the rule is now the value shape rather than a
 * flat refusal.
 */
export const LOCKED_ON_BUILT_IN = ['name'] as const;

/**
 * Whether a built-in may be given this type.
 *
 * 🔴 `canEditFieldType` is gone, and its absence is the change. It answered
 * "may this field's Answer Type be edited at all?" with `!isBuiltIn`, and the
 * answer is now yes for every field — so a boolean that is always true is a
 * question nobody should be asking. What a built-in cannot do is change the
 * SHAPE of what it posts, because its answer lands in a typed column on
 * `stall_request`: "Items Selling" may become a paragraph box, a dropdown or a
 * radio list, all of which post a string into a text column, and may not become
 * a number, a file or a display block, none of which post one.
 *
 * ⚠️ An appended field is not asked. It has no column and may become anything
 * authorable — its answers are strings in `StallCustomFieldValue` whatever the
 * control is — which is why `fieldTypeChoices` consults this only for a
 * built-in.
 */
export function canRetypeBuiltInTo(from: FieldType, to: FieldType): boolean {
  return sameValueShape(from, to);
}

/**
 * The types the builder offers for this field, in the order it draws them.
 *
 * ⚠️ The field's CURRENT type is always in the list, even when nothing can be
 * authored in its place — `zone` and `appliances` are structural, so a field
 * that is one has a picker of exactly one entry rather than a picker showing
 * the wrong answer.
 */
export function fieldTypeChoices(
  field: Pick<BuiltFormField, 'isBuiltIn' | 'type'> | null,
): FieldType[] {
  const authorable: FieldType[] = [...AUTHORABLE_FIELD_TYPES];
  if (field === null) return authorable;
  const allowed = field.isBuiltIn
    ? authorable.filter((t) => canRetypeBuiltInTo(field.type, t))
    : authorable;
  return allowed.includes(field.type) ? allowed : [field.type, ...allowed];
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
    minLen: field.minLen ?? null,
    maxLen: field.maxLen ?? null,
    decimals: field.decimals ?? null,
    pattern: field.pattern ?? null,
    patternHint: field.patternHint ?? null,
    window: field.window ?? null,
    mediaKey: field.mediaKey ?? null,
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
  // ⚠️ Authorable and new. The 2025 forms asked for no dates, so nothing seeds
  // as one; an edition that wants to ask when a vendor will arrive gets a
  // picker and an accepted window rather than a text box — see `DateWindow`.
  'date',
  // ⚠️ Authorable, unlike `appliances` and `zone`, because a file field needs
  // nothing resolved at render time — its upload purpose is `FORM_FIELD` and
  // its own id scopes the key. See `isOurKey`.
  'file',
  'files',
  // ⚠️ Authorable, and the only entry here that is not a question. A display
  // block is wording and an optional picture drawn in place; see the type's
  // note in `forms.ts` and `isDisplayField` for what every answer path has to
  // know about it.
  'display',
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

/**
 * Whether the field asks nothing at all.
 *
 * 🔴 Read by everything that deals in ANSWERS: the validator (which asks
 * nothing of one), the builder (which offers it no Required tick and no
 * choices), and the API writes (which refuse a required display block rather
 * than storing a form nobody can submit — a required question with no control
 * to answer it is a page that fails validation with nothing to click).
 *
 * ⚠️ One spelling, in the package both sides read, for the same reason
 * `LOCKED_ON_BUILT_IN` is: a screen that hides the tick and an API that stores
 * it anyway is a form that cannot be submitted and cannot be fixed.
 */
export function isDisplayField(type: string): type is 'display' {
  return type === 'display';
}

/** Whether this field may carry a picture. Only a display block may — a
 *  `file` question's picture is the READER's answer and lives on their record,
 *  not on the question. */
export function canCarryMedia(type: string): boolean {
  return isDisplayField(type);
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
 * everything any of the forms might send, which means almost everything is
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
    /**
     * Appended answers, keyed by field id.
     *
     * ⚠️ `unknown`, not `string`, although the wire carries strings. A `files`
     * question answers with a LIST of upload keys, and its limit is how many —
     * flattening the list to a string on the way in would make "at most five
     * photographs" a rule about commas.
     */
    custom: Record<string, unknown>;
  },
  ctx: FormAnswerContext = {},
): FormViolation[] {
  const out: FormViolation[] = [];
  const today = ctx.today ?? todayISO();
  for (const field of formFields(form)) {
    // ⚠️ Before `required`, not after. A display block stored as required —
    // by an older row, or by a write that got past the guard — would fail
    // every submission with an error pointing at a paragraph of text.
    if (isDisplayField(field.type)) continue;
    // A question this submission was never asked — see `fieldIsAsked`.
    if (!fieldIsAsked(field, ctx)) continue;
    // ⚠️ A built-in reads by NAME and an appended field by ID — they are
    // different key spaces, and the value arriving under the wrong one is not
    // an answer to this question.
    const given = field.isBuiltIn
      ? field.name === null
        ? undefined
        : values.builtIn[field.name]
      : values.custom[field.id];
    const key = field.isBuiltIn ? (field.name ?? field.id) : `customFields.${field.id}`;

    if (isBlankAnswer(given, field.type)) {
      // ⚠️ A blank answer is reported ONCE, as missing, and never also as
      // failing a limit. "Pincode is required" and "Pincode must be 6
      // characters" on the same empty box is the form telling somebody off
      // twice for one omission.
      if (field.required) {
        out.push({
          fieldKey: key,
          message:
            field.type === 'checkbox' ? 'Please tick to continue' : `${field.label} is required`,
        });
      }
      continue;
    }

    // 🔴 The second half, and the reason this function is not just a required
    // check any more. What a question ACCEPTS is a property of its row —
    // `minLen`, a digit count, an accepted date window — and one function
    // applies it on the page before a round-trip and here as the thing that
    // actually enforces. See `checkFieldValue`.
    const wrong = checkFieldValue(asRuled(field), given, today);
    if (wrong) out.push({ fieldKey: key, message: wrong });
  }
  return out;
}

/**
 * A built field in the shape `FieldControl` draws.
 *
 * 🔴 ONE adapter, where there were four. `FieldControl` predates the builder
 * and speaks `FormField`; all four public pages had their own copy of this
 * function, and they had already drifted — the request form keyed a field by
 * `cf:<id>` and the other three by its bare id, which is fine, but three of
 * them also forgot `helpTa` at one point or another. Adding a limit to a
 * question would have been four more chances to forget one, and a limit the
 * page does not pass is a limit nobody sees until the API refuses.
 *
 * ⚠️ `key` is the name the ANSWER travels under in that page's own state, not
 * the field's name. The request form prefixes an appended field so its two key
 * spaces cannot collide; the others have one space and use the id.
 */
export function asFormField(f: BuiltFormField, key: string = f.name ?? f.id): FormField {
  return {
    name: key,
    label: f.label,
    labelTa: f.labelTa,
    help: f.help ?? undefined,
    helpTa: f.helpTa ?? undefined,
    type: f.type,
    required: f.required,
    options: f.options ?? undefined,
    min: f.min ?? undefined,
    max: f.max ?? undefined,
    minLen: f.minLen ?? undefined,
    maxLen: f.maxLen ?? undefined,
    decimals: f.decimals ?? undefined,
    pattern: f.pattern ?? undefined,
    patternHint: f.patternHint ?? undefined,
    window: f.window ?? undefined,
    // What a `display` block draws. Null on every question — see `FieldControl`.
    mediaKey: f.mediaKey,
  };
}

/** A built field, as the checker addresses it. */
export function asRuled(field: BuiltFormField): RuledField {
  return { label: field.label, type: field.type, required: field.required, ...ruleValuesOf(field) };
}

/** Just the limits off a field, for a caller writing them somewhere else. */
export function ruleValuesOf(field: FieldRuleValues): FieldRuleValues {
  return {
    min: field.min,
    max: field.max,
    minLen: field.minLen,
    maxLen: field.maxLen,
    decimals: field.decimals,
    pattern: field.pattern,
    patternHint: field.patternHint,
    window: field.window,
  };
}

/** The limits a field keeps when its Answer Type changes — see
 *  `clearedRulesFor`, which is where the reasoning is. */
export function rulesAfterRetype(
  was: FieldType,
  now: FieldType,
  rules: FieldRuleValues,
): FieldRuleValues {
  return clearedRulesFor(was, now, rules);
}

/* 🔴 `isBlank` moved to `field-rules.ts` as `isBlankAnswer`. It decided what
 * counts as an unanswered question, and the limit checker needs exactly the
 * same answer: a limit applied to a blank field reports a second time on a
 * question somebody simply has not reached. Two spellings of "blank" is how a
 * form ends up required here and optional there. */
