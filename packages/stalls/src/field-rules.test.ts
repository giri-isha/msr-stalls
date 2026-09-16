import { describe, expect, test } from 'vitest';
import {
  checkFieldValue,
  checkRuleShape,
  clearedRulesFor,
  type FieldRuleValues,
  isoDay,
  NO_RULES,
  resolveWindow,
  ruleHintFor,
  ruleKindOf,
  ruleKnobsFor,
  type RuledField,
  shiftDays,
  valueShapeOf,
} from './field-rules';
import type { FieldType } from './forms';

const TODAY = '2026-03-10';

const q = (
  type: FieldType,
  rules: Partial<FieldRuleValues> = {},
  label = 'Answer',
): RuledField => ({
  label,
  type,
  required: false,
  ...NO_RULES,
  ...rules,
});

describe('which limits a type has any meaning for', () => {
  /** 🔴 `min`/`max` are one pair of columns read three ways, and the knob is
   *  what says which reading applies. */
  test('the same pair means value, digits and count on three types', () => {
    expect(ruleKnobsFor('number')).toContain('bounds');
    expect(ruleKnobsFor('tel')).toContain('digits');
    expect(ruleKnobsFor('files')).toContain('count');
  });

  test('a question that asks nothing carries no limit at all', () => {
    expect(ruleKnobsFor('display')).toEqual([]);
    expect(ruleKnobsFor('checkbox')).toEqual([]);
  });

  /** ⚠️ Decided by the type plus `decimals`, never stored beside it — two
   *  spellings of "this is a number" is how a field ends up typed `number` and
   *  checked as text. */
  test('a number reads as whole unless it has been given places', () => {
    expect(ruleKindOf('number', null)).toBe('int');
    expect(ruleKindOf('number', 0)).toBe('int');
    expect(ruleKindOf('number', 2)).toBe('decimal');
  });
});

describe('a limit that changed meaning is dropped', () => {
  /** 🔴 A cap of 50 on "Number of helpers" would silently become "at most fifty
   *  photographs" when retyped to a file list. */
  test('a numeric bound does not survive becoming a file list', () => {
    const kept = clearedRulesFor('number', 'files', { ...NO_RULES, min: 1, max: 50 });
    expect(kept.max).toBeNull();
  });

  test('nor a length limit becoming a number', () => {
    expect(clearedRulesFor('text', 'number', { ...NO_RULES, maxLen: 200 }).maxLen).toBeNull();
  });

  /** ⚠️ Kept where the knob is the same on both sides: one line of text
   *  becoming a paragraph is the same answer with more room. */
  test('but a length limit survives text becoming a paragraph', () => {
    expect(clearedRulesFor('text', 'textarea', { ...NO_RULES, maxLen: 200 }).maxLen).toBe(200);
  });
});

describe('what an answer may be', () => {
  /** ⚠️ Presence is not this function's business — a blank answer passes every
   *  limit, and `validateAgainstForm` is what reports a required one. */
  test('a blank answer fails no limit', () => {
    expect(checkFieldValue(q('text', { minLen: 5 }), '', TODAY)).toBeNull();
    expect(checkFieldValue(q('number', { min: 1 }), undefined, TODAY)).toBeNull();
  });

  test('a length limit says by how much somebody is over', () => {
    const msg = checkFieldValue(q('text', { maxLen: 5 }, 'Pincode'), '1234567', TODAY);
    expect(msg).toBe('Pincode must be 5 characters or fewer (currently 7).');
  });

  test('a number is read out of the string a form posts', () => {
    expect(checkFieldValue(q('number', { max: 50 }), '51', TODAY)).toBe(
      'Answer must be at most 50.',
    );
    expect(checkFieldValue(q('number', { max: 50 }), '50', TODAY)).toBeNull();
    expect(checkFieldValue(q('number'), 'abc', TODAY)).toBe('Answer must be a whole number.');
  });

  test('a decimal answer is refused unless places were allowed', () => {
    expect(checkFieldValue(q('number'), '2.5', TODAY)).toBe('Answer must be a whole number.');
    expect(checkFieldValue(q('number', { decimals: 2 }), '2.5', TODAY)).toBeNull();
    expect(checkFieldValue(q('number', { decimals: 1 }), '2.55', TODAY)).toBe(
      'Answer must have at most 1 decimal places.',
    );
  });

  /** 🔴 A digit count, not a numbering plan: an overseas vendor's number is
   *  longer than an Indian one and a landline is shorter. */
  test('a phone number is counted, with a default range when none is set', () => {
    expect(checkFieldValue(q('tel'), '+91 94430 12345', TODAY)).toBeNull();
    expect(checkFieldValue(q('tel'), '12345', TODAY)).toBe('Answer must be 8 to 15 digits.');
    expect(checkFieldValue(q('tel'), '94430-abcde', TODAY)).toContain('may only contain digits');
    expect(checkFieldValue(q('tel', { min: 10, max: 10 }), '+91 9443012345', TODAY)).toBe(
      'Answer must be 10 to 10 digits.',
    );
  });

  test('an email is checked for an @ and a domain', () => {
    expect(checkFieldValue(q('email'), 'someone@example.com', TODAY)).toBeNull();
    expect(checkFieldValue(q('email'), 'someone@example', TODAY)).toContain('email address');
  });

  test('a pattern reports in the words the admin wrote, never the expression', () => {
    const field = q('text', { pattern: '^[0-9]{6}$', patternHint: 'six digits' }, 'Pincode');
    expect(checkFieldValue(field, '641114', TODAY)).toBeNull();
    expect(checkFieldValue(field, '64111', TODAY)).toBe('Pincode must be six digits.');
  });

  /** ⚠️ An admin types the expression, and a throw inside the validator is a
   *  500 on a form submission rather than a message about a field. */
  test('an unreadable pattern asks nothing rather than taking the form down', () => {
    expect(checkFieldValue(q('text', { pattern: '([' }), 'anything', TODAY)).toBeNull();
  });

  test('a date is refused outside its window, and says the window', () => {
    const fixed = q('date', { window: { mode: 'fixed', min: '2026-03-01', max: '2026-03-31' } });
    expect(checkFieldValue(fixed, '2026-03-15', TODAY)).toBeNull();
    expect(checkFieldValue(fixed, '2026-04-01', TODAY)).toBe(
      'Answer must fall between 2026-03-01 and 2026-03-31.',
    );
    expect(checkFieldValue(q('date'), 'not a date', TODAY)).toBe('Answer must be a date.');
  });

  /** ⚠️ Resolved against the day passed in, never `new Date()`, so the check is
   *  testable and a page and the API straddling midnight can be made to agree. */
  test('a rolling window resolves against the day it is given', () => {
    const rolling = q('date', { window: { mode: 'rolling', minDays: 0, maxDays: 7 } });
    expect(checkFieldValue(rolling, '2026-03-12', TODAY)).toBeNull();
    // Both ends set, so the message names the window rather than one edge.
    expect(checkFieldValue(rolling, '2026-03-09', TODAY)).toBe(
      'Answer must fall between 2026-03-10 and 2026-03-17.',
    );
    expect(resolveWindow({ mode: 'rolling', minDays: -7 }, TODAY)).toEqual({ min: '2026-03-03' });
  });

  /** 🔴 A `files` answer is a list of upload keys, and "must be a single value"
   *  is the wrong thing to say about one. */
  test('a file list is counted rather than read', () => {
    expect(checkFieldValue(q('files', { max: 2 }), ['a', 'b', 'c'], TODAY)).toBe(
      'Answer takes at most 2.',
    );
    expect(checkFieldValue(q('files', { max: 2 }), ['a'], TODAY)).toBeNull();
  });

  /** ⚠️ `String({})` is "[object Object]", fifteen characters, which clears a
   *  `minLen` of 10 — so the shape is checked before any limit. */
  test('an object where a string belongs is named as the wrong shape', () => {
    expect(checkFieldValue(q('text', { minLen: 10 }), {}, TODAY)).toBe(
      'Answer must be a single value.',
    );
  });
});

describe('a limit nobody could satisfy is refused where it is set', () => {
  test('a maximum below its minimum', () => {
    expect(checkRuleShape('number', { ...NO_RULES, min: 10, max: 5 })).toContain('cannot be below');
    expect(checkRuleShape('text', { ...NO_RULES, minLen: 10, maxLen: 5 })).toContain('shorter');
  });

  test('an expression that does not compile', () => {
    expect(checkRuleShape('text', { ...NO_RULES, pattern: '([', patternHint: 'x' })).toContain(
      'not a valid expression',
    );
  });

  /** 🔴 Without the words, the message is "is not in the expected format",
   *  which tells a requester to guess. */
  test('a pattern with nothing said about it', () => {
    expect(checkRuleShape('text', { ...NO_RULES, pattern: '^x$', patternHint: null })).toContain(
      'Say what the pattern is asking for',
    );
  });

  test('a window that ends before it starts', () => {
    expect(
      checkRuleShape('date', {
        ...NO_RULES,
        window: { mode: 'fixed', min: '2026-04-01', max: '2026-03-01' },
      }),
    ).toContain('cannot fall before');
  });

  test('and a rule that is simply satisfiable passes', () => {
    expect(checkRuleShape('number', { ...NO_RULES, min: 0, max: 50 })).toBeNull();
  });
});

describe('what a question says it accepts, before it is answered', () => {
  test('bounds, lengths, digits and days each read as a phrase', () => {
    expect(ruleHintFor(q('number', { min: 0, max: 50 }), TODAY)).toBe('0–50');
    expect(ruleHintFor(q('text', { maxLen: 200 }), TODAY)).toBe('Up to 200 characters');
    expect(ruleHintFor(q('tel', { min: 10, max: 10 }), TODAY)).toBe('10–10 digits');
    expect(ruleHintFor(q('date', { window: { mode: 'rolling', maxDays: 7 } }), TODAY)).toBe(
      'Up to 2026-03-17',
    );
  });

  test('and a question with no limit says nothing', () => {
    expect(ruleHintFor(q('text'), TODAY)).toBeNull();
    expect(ruleHintFor(q('checkbox'), TODAY)).toBeNull();
  });
});

describe('calendar arithmetic', () => {
  /** ⚠️ The regex alone accepts 2026-02-31, which `Date` rolls forward to
   *  March 3rd — so the day is round-tripped rather than merely matched. */
  test('a day that does not exist is not a day', () => {
    expect(isoDay('2026-02-31')).toBeNull();
    expect(isoDay('2026-02-28')).toBe('2026-02-28');
    expect(isoDay('2026-03-10T09:00:00Z')).toBe('2026-03-10');
  });

  test('shifting crosses a month end', () => {
    expect(shiftDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('which types post the same kind of answer', () => {
  /** 🔴 What makes a built-in's Answer Type editable at all — the column cares
   *  what arrives, not which control produced it. */
  test('every one-line control posts a string', () => {
    for (const t of ['text', 'textarea', 'email', 'tel', 'select', 'radio', 'date'] as const) {
      expect(valueShapeOf(t)).toBe('text');
    }
  });

  /** ⚠️ Each of these is its own shape although two of them do produce strings:
   *  a `zone` resolves its choices from the edition's bays, and a `file` answer
   *  is a key minted for one upload purpose. */
  test('and the structural ones stand alone', () => {
    expect(valueShapeOf('zone')).toBe('zone');
    expect(valueShapeOf('file')).toBe('file');
    expect(valueShapeOf('files')).toBe('files');
    expect(valueShapeOf('appliances')).toBe('rows');
    expect(valueShapeOf('display')).toBe('none');
  });
});
