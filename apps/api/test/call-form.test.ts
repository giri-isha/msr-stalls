import type { StallEdition } from '@prisma/client';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  addCallQuestion,
  deleteCallQuestion,
  getCallForm,
  updateCallQuestion,
  updateCallScript,
} from '../src/modules/stalls/call-form';
import { listReminderCalls, listReminders, logReminder } from '../src/modules/stalls/comms';
import { ValidationFailedError } from '../src/errors';
import {
  BadCallBranchError,
  CallQuestionInUseError,
  CallbackDateWithoutCallbackError,
} from '../src/modules/stalls/errors';
import { SYSTEM, prisma, resetDatabase, seedEdition } from './helpers/db';
import { selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let edition: StallEdition;

beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
});

/** The two-question shape every branch test below builds on: a Yes/No, and a
 *  reason asked only when the answer is Yes. */
async function askedPair() {
  const picked = await addCallQuestion(
    prisma,
    edition.id,
    'BANK',
    {
      label: 'Did they pick up?',
      help: null,
      fieldType: 'select',
      isRequired: true,
      options: [
        { value: 'YES', label: 'Yes', labelTa: null },
        { value: 'NO', label: 'No', labelTa: null },
      ],
      min: null,
      max: null,
      minLen: null,
      maxLen: null,
      decimals: null,
      pattern: null,
      patternHint: null,
      window: null,
      showIfQuestionId: null,
      showIfValue: null,
      showOnOutcomes: [],
    },
    SYSTEM,
  );
  const reason = await addCallQuestion(
    prisma,
    edition.id,
    'BANK',
    {
      label: 'What reason did they give?',
      help: null,
      fieldType: 'text',
      isRequired: true,
      options: null,
      min: null,
      max: null,
      minLen: null,
      maxLen: null,
      decimals: null,
      pattern: null,
      patternHint: null,
      window: null,
      showIfQuestionId: picked.id,
      showIfValue: 'YES',
      showOnOutcomes: [],
    },
    SYSTEM,
  );
  return { picked: picked.id, reason: reason.id };
}

describe('the form itself', () => {
  // 🔴 Seeded on READ, like the letters. No migration invented a script.
  test('an edition that has never had a call form gets an empty one on first read', async () => {
    const form = await getCallForm(prisma, edition.id, 'BANK');
    expect(form.script).toBe('');
    expect(form.questions).toEqual([]);
    expect(form.scriptUpdatedAt).toBeNull();
  });

  test('the two kinds are separate forms', async () => {
    await updateCallScript(prisma, edition.id, 'BANK', 'Namaskaram, about your bank form…', SYSTEM);
    expect((await getCallForm(prisma, edition.id, 'BANK')).script).toContain('bank form');
    expect((await getCallForm(prisma, edition.id, 'PAYMENT')).script).toBe('');
  });

  test('questions come back in the order they were added, and move one step', async () => {
    const { picked, reason } = await askedPair();
    expect((await getCallForm(prisma, edition.id, 'BANK')).questions.map((q) => q.id)).toEqual([
      picked,
      reason,
    ]);

    await updateCallQuestion(prisma, edition.id, reason, { ordinal: 1 }, SYSTEM);
    const after = await getCallForm(prisma, edition.id, 'BANK');
    expect(after.questions.map((q) => q.id)).toEqual([reason, picked]);
    // ⚠️ A swap, so nothing is left sharing a position.
    expect(after.questions.map((q) => q.ordinal)).toEqual([1, 2]);
  });
});

describe('branches, refused on the write', () => {
  test('a branch may not point at a question asked after it', async () => {
    const { picked, reason } = await askedPair();
    await expect(
      updateCallQuestion(
        prisma,
        edition.id,
        picked,
        { showIfQuestionId: reason, showIfValue: 'YES' },
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(BadCallBranchError);
  });

  test('a branch may not name a value the question it depends on does not offer', async () => {
    const { picked, reason } = await askedPair();
    await expect(
      updateCallQuestion(
        prisma,
        edition.id,
        reason,
        { showIfQuestionId: picked, showIfValue: 'MAYBE' },
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(BadCallBranchError);
  });

  // ⚠️ An edit that does not touch the branch must not be refused over one set
  // months ago — that is a different edit.
  test('renaming a question does not re-litigate its branch', async () => {
    const { reason } = await askedPair();
    await updateCallQuestion(prisma, edition.id, reason, { label: 'Why not?' }, SYSTEM);
    const form = await getCallForm(prisma, edition.id, 'BANK');
    expect(form.questions.find((q) => q.id === reason)?.label).toBe('Why not?');
  });
});

describe('logging a call', () => {
  test('the outcome, the remarks and the answers are all on the row', async () => {
    const { requestId } = await selected(['C1-1']);
    const { picked, reason } = await askedPair();

    await logReminder(
      prisma,
      requestId,
      {
        kind: 'BANK',
        outcome: 'CALL_COMPLETED',
        note: 'sending it tonight',
        answers: { [picked]: 'YES', [reason]: 'was travelling' },
      },
      SYSTEM,
    );

    const [call] = await listReminderCalls(prisma, requestId, 'BANK');
    expect(call.outcome).toBe('CALL_COMPLETED');
    expect(call.note).toBe('sending it tonight');
    expect(call.answers).toEqual([
      { questionId: picked, label: 'Did they pick up?', value: 'YES' },
      { questionId: reason, label: 'What reason did they give?', value: 'was travelling' },
    ]);
  });

  // 🔴 The reason the check runs on the server as well as in the dialog: a
  // stale browser holding yesterday's answers must not file one against a
  // question nobody was shown.
  test('an answer to a question the caller was never shown is not stored', async () => {
    const { requestId } = await selected(['C1-1']);
    const { picked, reason } = await askedPair();

    await logReminder(
      prisma,
      requestId,
      { kind: 'BANK', outcome: 'CALL_COMPLETED', answers: { [picked]: 'NO', [reason]: 'stale' } },
      SYSTEM,
    );

    const [call] = await listReminderCalls(prisma, requestId, 'BANK');
    expect(call.answers.map((a) => a.questionId)).toEqual([picked]);
  });

  test('a required question that WAS shown and left blank refuses the call', async () => {
    const { requestId } = await selected(['C1-1']);
    await askedPair();
    await expect(
      logReminder(prisma, requestId, { kind: 'BANK', outcome: 'CALL_COMPLETED' }, SYSTEM),
    ).rejects.toBeInstanceOf(ValidationFailedError);
  });

  // ⚠️ Nothing is asked on an outcome where nobody was spoken to, so a call
  // that rang out saves with no answers and no complaint.
  test('a call that was not answered needs none of the scripted questions', async () => {
    const { requestId } = await selected(['C1-1']);
    await askedPair();
    await logReminder(
      prisma,
      requestId,
      { kind: 'BANK', outcome: 'NOT_ANSWERED', note: 'rang out' },
      SYSTEM,
    );
    const [call] = await listReminderCalls(prisma, requestId, 'BANK');
    expect(call.answers).toEqual([]);
  });

  test('a callback day belongs only to a callback', async () => {
    const { requestId } = await selected(['C1-1']);
    await expect(
      logReminder(
        prisma,
        requestId,
        { kind: 'BANK', outcome: 'NOT_ANSWERED', callbackDate: '2026-10-01' },
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(CallbackDateWithoutCallbackError);

    await logReminder(
      prisma,
      requestId,
      { kind: 'BANK', outcome: 'CALLBACK', callbackDate: '2026-10-01' },
      SYSTEM,
    );
    expect((await listReminderCalls(prisma, requestId, 'BANK'))[0].callbackDate).toBe('2026-10-01');
  });

  // 🔴 Every call is its own row: the count is what the team chases by.
  test('the list carries the count, the last outcome and the day agreed', async () => {
    const { requestId } = await selected(['C1-1']);
    await logReminder(prisma, requestId, { kind: 'BANK', outcome: 'NOT_ANSWERED' }, SYSTEM);
    await logReminder(
      prisma,
      requestId,
      { kind: 'BANK', outcome: 'CALLBACK', callbackDate: '2026-10-02' },
      SYSTEM,
    );

    const [row] = await listReminders(prisma, edition.id, 'BANK');
    expect(row.callCount).toBe(2);
    expect(row.lastOutcome).toBe('CALLBACK');
    expect(row.callbackDate).toBe('2026-10-02');
  });

  // ⚠️ The rows logged before any of this existed. Nothing was back-filled.
  test('a call logged with no outcome reads as one, not as an error', async () => {
    const { requestId } = await selected(['C1-1']);
    await logReminder(prisma, requestId, { kind: 'BANK', note: 'no answer' }, SYSTEM);
    const [row] = await listReminders(prisma, edition.id, 'BANK');
    expect(row.callCount).toBe(1);
    expect(row.lastOutcome).toBeNull();
  });
});

describe('removing a question', () => {
  test('one nobody has answered goes', async () => {
    const { reason } = await askedPair();
    await deleteCallQuestion(prisma, edition.id, reason, SYSTEM);
    expect((await getCallForm(prisma, edition.id, 'BANK')).questions).toHaveLength(1);
  });

  // 🔴 A call answer exists nowhere else. Deleting the question would take the
  // record of what the vendor said with it.
  test('one a call has answered can only be switched off', async () => {
    const { requestId } = await selected(['C1-1']);
    const { picked, reason } = await askedPair();
    await logReminder(
      prisma,
      requestId,
      {
        kind: 'BANK',
        outcome: 'CALL_COMPLETED',
        answers: { [picked]: 'YES', [reason]: 'posted it' },
      },
      SYSTEM,
    );

    await expect(deleteCallQuestion(prisma, edition.id, picked, SYSTEM)).rejects.toBeInstanceOf(
      CallQuestionInUseError,
    );

    await updateCallQuestion(prisma, edition.id, picked, { isActive: false }, SYSTEM);
    const form = await getCallForm(prisma, edition.id, 'BANK');
    expect(form.questions.find((q) => q.id === picked)?.isActive).toBe(false);
    // The answer, and the question that produced it, are both still readable.
    const [call] = await listReminderCalls(prisma, requestId, 'BANK');
    expect(call.answers[0]).toMatchObject({ label: 'Did they pick up?', value: 'YES' });
  });
});
