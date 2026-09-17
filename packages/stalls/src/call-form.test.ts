import { describe, expect, test } from 'vitest';
import {
  type CallQuestion,
  callAnswersToStore,
  callBranchChoices,
  callBranchProblem,
  canBranchOn,
  canDeleteCallQuestion,
  checkCallAnswers,
  callQuestionAsField,
  SPOKEN_OUTCOMES,
  visibleCallQuestions,
  writeAnswer,
} from './call-form';
import { NO_RULES } from './field-rules';

const q = (over: Partial<CallQuestion> = {}): CallQuestion => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  ordinal: 1,
  label: 'A question',
  help: null,
  type: 'text',
  isRequired: false,
  isActive: true,
  options: null,
  showIfQuestionId: null,
  showIfValue: null,
  showOnOutcomes: [],
  ...NO_RULES,
  ...over,
});

const choice = (over: Partial<CallQuestion> = {}): CallQuestion =>
  q({
    type: 'select',
    options: [
      { value: 'YES', label: 'Yes', labelTa: null },
      { value: 'NO', label: 'No', labelTa: null },
    ],
    ...over,
  });

describe('which questions are asked', () => {
  test('nothing is asked until an outcome is picked', () => {
    expect(visibleCallQuestions([q()], {}, null)).toEqual([]);
  });

  // 🔴 The default that stops a form teaching people to type anything to get
  // past it: a scripted question is something you ask a PERSON.
  test('a question naming no outcomes is asked only where somebody was spoken to', () => {
    const only = q({ id: 'a' });
    for (const outcome of SPOKEN_OUTCOMES) {
      expect(visibleCallQuestions([only], {}, outcome).map((x) => x.id)).toEqual(['a']);
    }
    expect(visibleCallQuestions([only], {}, 'NOT_ANSWERED')).toEqual([]);
    expect(visibleCallQuestions([only], {}, 'WRONG_NUMBER')).toEqual([]);
  });

  test('a question naming outcomes is asked on exactly those', () => {
    const only = q({ id: 'a', showOnOutcomes: ['NOT_ANSWERED'] });
    expect(visibleCallQuestions([only], {}, 'NOT_ANSWERED').map((x) => x.id)).toEqual(['a']);
    expect(visibleCallQuestions([only], {}, 'DONE')).toEqual([]);
  });

  test('a switched-off question is never asked', () => {
    expect(visibleCallQuestions([q({ isActive: false })], {}, 'DONE')).toEqual([]);
  });

  test('a branch appears only once its parent carries the matching answer', () => {
    const parent = choice({ id: 'p', ordinal: 1 });
    const child = q({ id: 'c', ordinal: 2, showIfQuestionId: 'p', showIfValue: 'YES' });
    const form = [parent, child];

    expect(visibleCallQuestions(form, {}, 'DONE').map((x) => x.id)).toEqual(['p']);
    expect(visibleCallQuestions(form, { p: 'NO' }, 'DONE').map((x) => x.id)).toEqual(['p']);
    expect(visibleCallQuestions(form, { p: 'YES' }, 'DONE').map((x) => x.id)).toEqual(['p', 'c']);
  });

  // ⚠️ The collapse-from-the-top rule. The grandchild's own condition is met,
  // and it is still not asked, because the question above it is not on screen.
  test('a branch off a hidden question is hidden, whatever its own answer says', () => {
    const form = [
      choice({ id: 'p', ordinal: 1, showOnOutcomes: ['DONE'] }),
      choice({ id: 'c', ordinal: 2, showIfQuestionId: 'p', showIfValue: 'YES' }),
      q({ id: 'g', ordinal: 3, showIfQuestionId: 'c', showIfValue: 'YES' }),
    ];
    const answers = { p: 'YES', c: 'YES' };
    expect(visibleCallQuestions(form, answers, 'DONE').map((x) => x.id)).toEqual(['p', 'c', 'g']);
    // The parent's outcome rule now fails, and the whole chain goes with it.
    expect(visibleCallQuestions(form, answers, 'PROMISED')).toEqual([]);
  });

  test('two questions pointing at each other do not recurse forever', () => {
    const form = [
      choice({ id: 'a', ordinal: 1, showIfQuestionId: 'b', showIfValue: 'YES' }),
      choice({ id: 'b', ordinal: 2, showIfQuestionId: 'a', showIfValue: 'YES' }),
    ];
    expect(visibleCallQuestions(form, { a: 'YES', b: 'YES' }, 'DONE')).toEqual([]);
  });
});

describe('checking the answers', () => {
  test('a required question that was asked and left blank is a problem', () => {
    const only = q({ id: 'a', isRequired: true, label: 'Reason' });
    expect(checkCallAnswers([only], {}, 'DONE')).toEqual({ a: 'Reason is needed.' });
    expect(checkCallAnswers([only], { a: 'because' }, 'DONE')).toEqual({});
  });

  // 🔴 A required question on a branch nobody went down is not unanswered — it
  // was never asked, and refusing the call over it would be refusing it over a
  // question that was not on the screen.
  test('a required question on a hidden branch asks nothing', () => {
    const form = [
      choice({ id: 'p', ordinal: 1 }),
      q({ id: 'c', ordinal: 2, isRequired: true, showIfQuestionId: 'p', showIfValue: 'YES' }),
    ];
    expect(checkCallAnswers(form, { p: 'NO' }, 'DONE')).toEqual({});
    expect(checkCallAnswers(form, { p: 'YES' }, 'DONE')).toHaveProperty('c');
  });

  test('a limit is enforced by the module’s own checker', () => {
    const only = q({ id: 'a', label: 'Helpers', type: 'number', min: 1, max: 10 });
    expect(checkCallAnswers([only], { a: '40' }, 'DONE').a).toContain('Helpers');
    expect(checkCallAnswers([only], { a: '4' }, 'DONE')).toEqual({});
  });
});

describe('what is stored', () => {
  test('only the visible answers, and blanks are dropped', () => {
    const form = [
      choice({ id: 'p', ordinal: 1 }),
      q({ id: 'c', ordinal: 2, showIfQuestionId: 'p', showIfValue: 'YES' }),
      q({ id: 'blank', ordinal: 3 }),
    ];
    // `c` is answered and then abandoned by changing the answer above it.
    const stored = callAnswersToStore(form, { p: 'NO', c: 'stale', blank: '' }, 'DONE');
    expect(stored).toEqual([{ questionId: 'p', value: 'NO' }]);
  });

  test('a tick box stores the words a person reading the history expects', () => {
    expect(writeAnswer(true)).toBe('Yes');
    expect(writeAnswer(false)).toBe('No');
  });
});

describe('branches, as the builder offers and refuses them', () => {
  test('only a choice question can be branched on', () => {
    expect(canBranchOn('select')).toBe(true);
    expect(canBranchOn('radio')).toBe(true);
    expect(canBranchOn('text')).toBe(false);
    expect(canBranchOn('checkbox')).toBe(false);
  });

  test('the picker offers each earlier choice question’s own options', () => {
    const form = [choice({ id: 'p', ordinal: 1, label: 'Picked up?' }), q({ id: 't', ordinal: 2 })];
    expect(callBranchChoices(form, { id: 't', ordinal: 2 })).toEqual([
      { questionId: 'p', value: 'YES', label: '“Picked up?” = Yes' },
      { questionId: 'p', value: 'NO', label: '“Picked up?” = No' },
    ]);
  });

  test('a question cannot depend on one asked after it, or on itself', () => {
    const form = [q({ id: 'a', ordinal: 1 }), choice({ id: 'b', ordinal: 2 })];
    expect(callBranchProblem(form, { id: 'a', ordinal: 1 }, 'b', 'YES')).toMatch(/before it/);
    expect(callBranchProblem(form, { id: 'a', ordinal: 1 }, 'a', 'YES')).toMatch(/not on this/);
  });

  test('a branch on a free-text answer, or on a value that is not offered, is refused', () => {
    const form = [q({ id: 'a', ordinal: 1 }), choice({ id: 'b', ordinal: 2 })];
    expect(callBranchProblem(form, { ordinal: 3 }, 'a', 'anything')).toMatch(/dropdown/);
    expect(callBranchProblem(form, { ordinal: 3 }, 'b', 'MAYBE')).toMatch(/own options/);
    expect(callBranchProblem(form, { ordinal: 3 }, 'b', 'YES')).toBeNull();
    expect(callBranchProblem(form, { ordinal: 3 }, null, null)).toBeNull();
  });
});

describe('drawing and removing', () => {
  test('a question becomes the field shape the shared renderer takes', () => {
    const field = callQuestionAsField(q({ id: 'a', label: 'Reason', maxLen: 40 }));
    // 🔴 The id is the name: a call answer is filed by question, not by column.
    expect(field.name).toBe('a');
    expect(field.label).toBe('Reason');
    expect(field.maxLen).toBe(40);
  });

  test('an answered question can only be switched off', () => {
    expect(canDeleteCallQuestion({ answerCount: 0 })).toBe(true);
    expect(canDeleteCallQuestion({ answerCount: 1 })).toBe(false);
  });
});
