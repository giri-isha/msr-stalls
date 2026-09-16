import { describe, expect, test } from 'vitest';
import {
  AUTHORABLE_FIELD_TYPES,
  type BuiltForm,
  type BuiltFormField,
  canCarryMedia,
  canDeleteField,
  canRetypeBuiltInTo,
  fieldTypeChoices,
  formFields,
  isAuthorableFieldType,
  needsOptions,
  renderForm,
  validateAgainstForm,
} from './form-builder';

const field = (over: Partial<BuiltFormField> = {}): BuiltFormField => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  name: null,
  label: 'A question',
  labelTa: null,
  help: null,
  helpTa: null,
  type: 'text',
  required: false,
  isBuiltIn: false,
  isActive: true,
  sectionId: null,
  sortOrder: 0,
  options: null,
  min: null,
  max: null,
  minLen: null,
  maxLen: null,
  decimals: null,
  pattern: null,
  patternHint: null,
  window: null,
  mediaKey: null,
  ...over,
});

const form = (fields: BuiltFormField[], sections: BuiltForm['sections'] = []): BuiltForm => ({
  formType: 'VENDOR',
  title: 'Vendor Stall Request Form',
  titleTa: null,
  sections,
  fields,
});

describe('rendering a form', () => {
  test('orders by sortOrder, not by the order the rows arrived', () => {
    const f = form([
      field({ id: 'b', label: 'Second', sortOrder: 1 }),
      field({ id: 'a', label: 'First', sortOrder: 0 }),
    ]);
    expect(formFields(f).map((x) => x.label)).toEqual(['First', 'Second']);
  });

  /** ⚠️ Dropped HERE, once, rather than at each of the three call sites that
   *  draw or validate a form. A field switched off that still validates is a
   *  form nobody can submit. */
  test('a switched-off field is drawn by nothing', () => {
    const f = form([field({ id: 'a' }), field({ id: 'b', isActive: false })]);
    expect(formFields(f)).toHaveLength(1);
  });

  test('fields with no section come first, under no heading', () => {
    const f = form(
      [
        field({ id: 'loose', sortOrder: 5 }),
        field({ id: 'inside', sectionId: 's1', sortOrder: 0 }),
      ],
      [{ id: 's1', heading: 'Electrical', headingTa: null, help: null, sortOrder: 0 }],
    );
    const groups = renderForm(f);
    expect(groups[0]?.section).toBeNull();
    expect(groups[1]?.section?.heading).toBe('Electrical');
  });

  /** It happens while a form is being built, and drawing it would look like a
   *  bug rather than like an empty section. */
  test('a heading with nothing under it is not drawn', () => {
    const f = form(
      [field({ id: 'loose' })],
      [{ id: 'empty', heading: 'Nothing here', headingTa: null, help: null, sortOrder: 0 }],
    );
    expect(renderForm(f).map((g) => g.section?.heading ?? null)).toEqual([null]);
  });

  test('and a heading whose only field was switched off is not drawn either', () => {
    const f = form(
      [field({ id: 'off', sectionId: 's1', isActive: false })],
      [{ id: 's1', heading: 'Electrical', headingTa: null, help: null, sortOrder: 0 }],
    );
    expect(renderForm(f)).toEqual([]);
  });
});

describe('what a built-in field may not change', () => {
  /** 🔴 The rule is the value SHAPE, not the type. A built-in's answer lands in
   *  a typed column on `stall_request`, and the column cares what ARRIVES
   *  rather than which control produced it — so any type that posts a string
   *  may replace any other on a field whose column holds one. */
  test('it may be retyped within the kind of answer its column holds', () => {
    expect(canRetypeBuiltInTo('text', 'textarea')).toBe(true);
    expect(canRetypeBuiltInTo('text', 'select')).toBe(true);
    expect(canRetypeBuiltInTo('text', 'date')).toBe(true);
    expect(canRetypeBuiltInTo('select', 'radio')).toBe(true);
  });

  /** ⚠️ The refusals, and each one is a different column. A number is an
   *  integer column, a file is a media-store key `isOurKey` then checks, a
   *  display block posts nothing at all, and a `zone` resolves its choices from
   *  the edition's bays at render time. */
  test('and never into a different kind of answer', () => {
    expect(canRetypeBuiltInTo('text', 'number')).toBe(false);
    expect(canRetypeBuiltInTo('number', 'text')).toBe(false);
    expect(canRetypeBuiltInTo('text', 'file')).toBe(false);
    expect(canRetypeBuiltInTo('text', 'display')).toBe(false);
    expect(canRetypeBuiltInTo('checkbox', 'text')).toBe(false);
    expect(canRetypeBuiltInTo('zone', 'select')).toBe(false);
  });

  /** ⚠️ The picker is filled from the same rule the API refuses on, so a
   *  coordinator is never offered a change that would come back as an error —
   *  and an appended field, which has no column, is offered everything. */
  test('the picker offers exactly what would be accepted', () => {
    const builtIn = fieldTypeChoices(field({ isBuiltIn: true, type: 'text' }));
    expect(builtIn).toContain('textarea');
    expect(builtIn).not.toContain('number');
    expect(builtIn).not.toContain('display');

    const appended = fieldTypeChoices(field({ isBuiltIn: false, type: 'text' }));
    expect(appended).toEqual([...AUTHORABLE_FIELD_TYPES]);
  });

  /** 🔴 `zone` and `appliances` cannot be authored, so a field that IS one
   *  would otherwise get an empty picker — and a picker showing nothing selects
   *  the wrong type the moment it is touched. */
  test('a structural field is offered itself and nothing else', () => {
    expect(fieldTypeChoices(field({ isBuiltIn: true, type: 'zone' }))).toEqual(['zone']);
  });

  /** ⚠️ The submit path reads its column whether or not the form asked, so a
   *  deleted built-in leaves a required column with nothing to fill it.
   *  Switching it off is the supported way to stop asking. */
  test('it can be switched off but never deleted', () => {
    expect(canDeleteField(field({ isBuiltIn: true }))).toBe(false);
    expect(canDeleteField(field({ isBuiltIn: false }))).toBe(true);
  });
});

describe('the types a form can be given', () => {
  test('the ordinary ones are authorable', () => {
    for (const t of ['text', 'textarea', 'email', 'tel', 'number', 'select', 'radio', 'checkbox']) {
      expect(isAuthorableFieldType(t)).toBe(true);
    }
  });

  /** ⚠️ Structural: one is a repeating row editor wired to its own table, the
   *  other resolves its choices from the edition's bays at render time.
   *  Offering either from a picker makes a field nothing knows how to draw. */
  test('the structural ones are not', () => {
    expect(isAuthorableFieldType('appliances')).toBe(false);
    expect(isAuthorableFieldType('zone')).toBe(false);
    expect(isAuthorableFieldType('whatever')).toBe(false);
  });

  test('a picker is meaningless without choices', () => {
    expect(needsOptions('select')).toBe(true);
    expect(needsOptions('radio')).toBe(true);
    expect(needsOptions('text')).toBe(false);
  });
});

describe('validating against the definition', () => {
  const required = (over: Partial<BuiltFormField>) => field({ required: true, ...over });

  test('a built-in reads by name, an appended one by id', () => {
    const f = form([
      required({ id: 'f1', name: 'stallName', isBuiltIn: true }),
      required({ id: 'f2' }),
    ]);
    expect(
      validateAgainstForm(f, { builtIn: { stallName: 'Green Leaf' }, custom: { f2: 'yes' } }),
    ).toEqual([]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: {} }).map((v) => v.fieldKey)).toEqual([
      'stallName',
      'customFields.f2',
    ]);
  });

  test('an optional question left blank is fine', () => {
    const f = form([field({ id: 'f1', name: 'remarks', isBuiltIn: true })]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: {} })).toEqual([]);
  });

  test('a switched-off required question is not enforced', () => {
    const f = form([required({ id: 'f1', name: 'stallName', isBuiltIn: true, isActive: false })]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: {} })).toEqual([]);
  });

  /** An unticked box is an unanswered question — the whole of the consent gate
   *  on all four forms. */
  test('an unticked required checkbox is a violation', () => {
    const f = form([required({ id: 'f1', name: 'agreed', isBuiltIn: true, type: 'checkbox' })]);
    expect(validateAgainstForm(f, { builtIn: { agreed: false }, custom: {} })).toHaveLength(1);
    expect(validateAgainstForm(f, { builtIn: { agreed: true }, custom: {} })).toEqual([]);
  });

  /** 🔴 A `select` can be answered "No", and `wantsThembu` on the ashram forms
   *  is exactly that. Treating every `false` as blank made answering No
   *  indistinguishable from not answering, so a department that did not want a
   *  thembu could not submit at all. */
  test('a select answered No is answered', () => {
    const f = form([required({ id: 'f1', name: 'wantsThembu', isBuiltIn: true, type: 'select' })]);
    expect(validateAgainstForm(f, { builtIn: { wantsThembu: false }, custom: {} })).toEqual([]);
  });

  /** ⚠️ The local welfare form marks every plug and pass count required, and
   *  their honest answer is usually 0. */
  test('a number answered zero is answered', () => {
    const f = form([required({ id: 'f1', name: 'gasStoves', isBuiltIn: true, type: 'number' })]);
    expect(validateAgainstForm(f, { builtIn: { gasStoves: 0 }, custom: {} })).toEqual([]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: {} })).toHaveLength(1);
  });

  test('whitespace is not an answer', () => {
    const f = form([required({ id: 'f1', name: 'stallName', isBuiltIn: true })]);
    expect(validateAgainstForm(f, { builtIn: { stallName: '   ' }, custom: {} })).toHaveLength(1);
  });

  test('the message names the question, so a reader knows which one to go back to', () => {
    const f = form([required({ id: 'f1', label: 'Instagram handle' })]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: {} })[0]?.message).toContain(
      'Instagram handle',
    );
  });

  /* ── The limits, as opposed to presence ───────────────────────────────── */

  /** 🔴 The half this function grew. Required-ness was all a row could say;
   *  it now also says what the answer may BE, and one function applies both —
   *  on the reader's page before the round-trip and here as the enforcement. */
  test('an answer that breaks the question\u2019s own limit is a violation', () => {
    const f = form([
      field({
        id: 'f1',
        name: 'plugs5a',
        isBuiltIn: true,
        type: 'number',
        label: 'Plug points',
        max: 50,
      }),
    ]);
    expect(validateAgainstForm(f, { builtIn: { plugs5a: 60 }, custom: {} })).toEqual([
      { fieldKey: 'plugs5a', message: 'Plug points must be at most 50.' },
    ]);
    expect(validateAgainstForm(f, { builtIn: { plugs5a: 12 }, custom: {} })).toEqual([]);
  });

  test('an appended answer is checked by the same rules, keyed by id', () => {
    const f = form([field({ id: 'f1', label: 'GST Number', maxLen: 15 })]);
    const out = validateAgainstForm(f, { builtIn: {}, custom: { f1: 'x'.repeat(20) } });
    expect(out[0]?.fieldKey).toBe('customFields.f1');
    expect(out[0]?.message).toContain('15 characters or fewer');
  });

  /** ⚠️ Once, as missing. "Pincode is required" and "Pincode must be 6
   *  characters" on the same empty box is the form telling somebody off twice
   *  for one omission. */
  test('a blank required answer reports as missing and not also as too short', () => {
    const f = form([required({ id: 'f1', label: 'Pincode', minLen: 6 })]);
    const out = validateAgainstForm(f, { builtIn: {}, custom: {} });
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe('Pincode is required');
  });

  /** ⚠️ An optional question left blank passes; the same question answered
   *  badly does not. A limit is about the answer, not about whether there is
   *  one. */
  test('an optional question is still checked once it has been answered', () => {
    const f = form([field({ id: 'f1', label: 'Contact', type: 'tel', min: 10, max: 10 })]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: {} })).toEqual([]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: { f1: '12345' } })).toHaveLength(1);
  });

  /** ⚠️ The same skip the required check makes — a limit must not report on a
   *  question the reader was never shown. */
  test('a limit on a question this submission was not asked is not applied', () => {
    const f = form([
      field({ id: 'f1', name: 'fssaiExpected', isBuiltIn: true, type: 'select', required: true }),
    ]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: {} }, { isFood: false })).toEqual([]);
  });

  /** ⚠️ Injected rather than read, so the check is testable and a page and the
   *  API straddling midnight can be told to agree on the day. */
  test('a rolling date window is resolved against the day it is given', () => {
    const f = form([
      field({
        id: 'f1',
        label: 'Arrival',
        type: 'date',
        window: { mode: 'rolling', minDays: 0, maxDays: 30 },
      }),
    ]);
    const ctx = { today: '2026-03-10' };
    expect(validateAgainstForm(f, { builtIn: {}, custom: { f1: '2026-03-20' } }, ctx)).toEqual([]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: { f1: '2026-05-20' } }, ctx)).toHaveLength(
      1,
    );
  });
});

/**
 * A field that says something rather than asking it.
 *
 * 🔴 The whole of what makes a display block safe is that every path dealing in
 * ANSWERS skips it. These are the two that would take a form down: a required
 * block refusing a submission nobody can fix, and a picture accepted onto a
 * question that draws none.
 */
describe('a display block', () => {
  test('is a type the builder may author', () => {
    expect(isAuthorableFieldType('display')).toBe(true);
  });

  /** ⚠️ Even when the row says required. The row can say it — an older edition,
   *  a write that got past the guard — and the refusal would point at a
   *  paragraph of text with nothing to click. */
  test('is never asked for, however the row is stored', () => {
    const f = form([
      field({ id: 'd1', type: 'display', required: true, label: 'The venue layout' }),
    ]);
    expect(validateAgainstForm(f, { builtIn: {}, custom: {} })).toEqual([]);
  });

  test('does not stop the questions around it from being checked', () => {
    const f = form([
      field({ id: 'd1', type: 'display', required: true, sortOrder: 0 }),
      field({ id: 'f1', label: 'Items selling', required: true, sortOrder: 1 }),
    ]);
    const out = validateAgainstForm(f, { builtIn: {}, custom: {} });
    expect(out).toHaveLength(1);
    expect(out[0]?.fieldKey).toBe('customFields.f1');
  });

  /** 🔴 Only a display block carries a picture. A `file` question's picture is
   *  the READER's answer and lives on their record — the API refuses the write
   *  on this same rule. */
  test('is the only field that may carry a picture', () => {
    expect(canCarryMedia('display')).toBe(true);
    expect(canCarryMedia('file')).toBe(false);
    expect(canCarryMedia('text')).toBe(false);
  });

  test('is drawn in its place, like any other field', () => {
    const f = form([
      field({ id: 'f1', sortOrder: 0 }),
      field({ id: 'd1', type: 'display', sortOrder: 1 }),
      field({ id: 'f2', sortOrder: 2 }),
    ]);
    expect(formFields(f).map((x) => x.id)).toEqual(['f1', 'd1', 'f2']);
  });

  /** A block switched off is a block the edition no longer shows — the same
   *  switch every question has. */
  test('is dropped when it is switched off', () => {
    const f = form([field({ id: 'd1', type: 'display', isActive: false })]);
    expect(formFields(f)).toEqual([]);
  });
});
