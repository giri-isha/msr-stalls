import { describe, expect, test } from 'vitest';
import {
  type BuiltForm,
  type BuiltFormField,
  canDeleteField,
  canEditFieldType,
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
  /** 🔴 Not a policy choice. A built-in's answer lands in a typed column on
   *  `stall_request`, so retyping one posts a string into an integer. */
  test('its type is locked; an appended field is not', () => {
    expect(canEditFieldType(field({ isBuiltIn: true }))).toBe(false);
    expect(canEditFieldType(field({ isBuiltIn: false }))).toBe(true);
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
});

describe('a files question', () => {
  const filesForm = (over: Partial<BuiltFormField> = {}): BuiltForm => ({
    formType: 'FSSAI',
    title: 'FSSAI',
    titleTa: null,
    sections: [],
    fields: [
      {
        id: 'f1',
        name: 'files',
        label: 'FSSAI Certificate',
        labelTa: null,
        help: null,
        helpTa: null,
        type: 'files',
        required: true,
        isBuiltIn: true,
        isActive: true,
        sectionId: null,
        sortOrder: 0,
        options: null,
        min: null,
        max: 5,
        ...over,
      },
    ],
  });

  /** ⚠️ A cap only the page applies is one a hand-built post ignores. */
  test('refuses more files than its max', () => {
    const tooMany = Array.from({ length: 6 }, (_, i) => `k${i}`);
    const out = validateAgainstForm(filesForm(), { builtIn: { files: tooMany }, custom: {} });
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('at most 5 files');
  });

  test('accepts exactly its max', () => {
    const exact = Array.from({ length: 5 }, (_, i) => `k${i}`);
    expect(validateAgainstForm(filesForm(), { builtIn: { files: exact }, custom: {} })).toEqual([]);
  });

  /** An empty list is an unanswered question, not a list of nothing. */
  test('an empty list is blank when required', () => {
    const out = validateAgainstForm(filesForm(), { builtIn: { files: [] }, custom: {} });
    expect(out.map((v) => v.fieldKey)).toEqual(['files']);
  });

  /** 🔴 The form that is nothing BUT an upload. Switching its one question off
   *  has to be possible, which is why the contract no longer carries a
   *  hardcoded minimum. */
  test('and nothing is required once the question is switched off', () => {
    const off = filesForm({ isActive: false });
    expect(validateAgainstForm(off, { builtIn: {}, custom: {} })).toEqual([]);
  });
});
