import {
  checkFieldValue,
  isBlankAnswer,
  type FieldRuleValues,
  type RuledField,
} from './field-rules';
import type { FieldOption, FieldType, FormField } from './forms';
import { needsOptions } from './form-builder';

/**
 * The form a caller fills while logging a reminder call.
 *
 * 🔴 `Log Call` used to be a button and nothing else — one row with a kind, a
 * timestamp and a `note` column no screen ever wrote to. So the list could say
 * a vendor had been rung four times and not one word about what came of it,
 * which is the only thing the next caller needs to know before ringing a fifth.
 *
 * ⚠️ The questions are ROWS, per edition and per kind, for the same reason the
 * letters and the request forms are: what to ask while chasing a bank form is
 * a stall-team decision that changes between editions, and it must not be a
 * redeploy. See `StallCallQuestion`.
 *
 * 🔴 The question types, the limits and the checker are the MODULE'S OWN —
 * `FieldType`, `FieldRuleValues`, `checkFieldValue` — not a second vocabulary
 * invented for calls. A "Promised date" on a call form and a "date of arrival"
 * on the vendor form are the same question with the same picker and the same
 * window, and two parallel type lists in one codebase is how the second one
 * ends up missing the rule the first one grew.
 */

/* ── Outcomes ───────────────────────────────────────────────────────────────*/

/**
 * The call status — how the call went.
 *
 * ⚠️ Deliberately about the CALL and not about the vendor: whether the bank
 * form has arrived is a fact the database already holds — it is what puts the
 * row on the list at all — and asking a caller to restate it is how the two
 * come to disagree. These six are only what happened on the phone.
 *
 * 🔴 The ORDER is the order of the dropdown, and it is the stall team's own,
 * not alphabetical and not "most likely first". `CALL_COMPLETED` leads because
 * it is the one that ends the chasing.
 */
export const CALL_OUTCOMES = [
  'CALL_COMPLETED',
  'NOT_ANSWERED',
  'NOT_REACHABLE',
  'CALLBACK',
  'WRONG_NUMBER',
  'NA',
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  CALL_COMPLETED: 'Call Completed',
  NOT_ANSWERED: 'Not Answered',
  NOT_REACHABLE: 'Not Reachable/Switched Off',
  CALLBACK: 'Callback Requested',
  WRONG_NUMBER: 'Wrong Number',
  NA: 'NA',
};

/** The one status that asks for a day. */
export const CALLBACK_OUTCOME: CallOutcome = 'CALLBACK';

/**
 * The statuses where somebody was actually spoken to.
 *
 * 🔴 The default for a question that names no statuses of its own. A scripted
 * question is something you ask a person, and asking the caller "what reason
 * did they give" after a phone that rang out is how a form teaches people to
 * type anything to get past it.
 *
 * ⚠️ `NA` is not here. It is the status for a call that should not have been
 * made — a row already settled, a duplicate — and a form that asked questions
 * about one would be asking about a conversation that did not happen.
 */
export const SPOKEN_OUTCOMES: readonly CallOutcome[] = ['CALL_COMPLETED', 'CALLBACK'];

export function isCallOutcome(v: string): v is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(v);
}

/* ── Question types ─────────────────────────────────────────────────────────*/

/**
 * What a call question may be.
 *
 * ⚠️ A subset of `AUTHORABLE_FIELD_TYPES`, and the omissions are the point.
 * `file`/`files` are gone because a caller with a phone at their ear has
 * nothing to upload; `display` is gone because the script box above the
 * questions is already where wording lives; `zone` and `appliances` resolve
 * against a request rather than a call.
 */
export const CALL_QUESTION_TYPES = [
  'text',
  'textarea',
  'number',
  'tel',
  'select',
  'radio',
  'checkbox',
  'date',
] as const;

export type CallQuestionType = (typeof CALL_QUESTION_TYPES)[number];

export function isCallQuestionType(t: string): t is CallQuestionType {
  return (CALL_QUESTION_TYPES as readonly string[]).includes(t);
}

export const CALL_QUESTION_TYPE_LABEL: Record<CallQuestionType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  tel: 'Phone number',
  select: 'Dropdown',
  radio: 'Choice list',
  checkbox: 'Tick box',
  date: 'Date',
};

/**
 * Whether a LATER question may be shown on the strength of this one's answer.
 *
 * ⚠️ Only a question with a fixed list of choices: a free-text answer has no
 * value a rule could name, and a tick box's two states are better said with
 * the box itself than with a branch nobody can see in the list.
 */
export function canBranchOn(type: FieldType): boolean {
  return needsOptions(type);
}

/* ── The shapes ─────────────────────────────────────────────────────────────*/

/** One question on a call form, as every reader sees it. */
export interface CallQuestion extends FieldRuleValues {
  id: string;
  ordinal: number;
  label: string;
  help: string | null;
  type: FieldType;
  isRequired: boolean;
  isActive: boolean;
  options: FieldOption[] | null;
  /** Shown only when `showIfQuestion` carries `showIfValue`. Both null is
   *  "always", subject to the outcome rule below. */
  showIfQuestionId: string | null;
  showIfValue: string | null;
  /** The outcomes this question is asked on. Empty means `SPOKEN_OUTCOMES`. */
  showOnOutcomes: CallOutcome[];
}

/** The whole form for one reminder kind: what the caller reads, then asks. */
export interface CallForm {
  kind: string;
  /** Read aloud at the top of the call. May be empty — an edition that has not
   *  written one gets no box rather than an empty quotation. */
  script: string;
  questions: CallQuestion[];
}

/** What has been answered so far, by question id. */
export type CallAnswers = Record<string, unknown>;

/* ── Which questions are asked ──────────────────────────────────────────────*/

/**
 * Whether this question is asked, given the outcome and the answers above it.
 *
 * 🔴 Read by the dialog (which draws nothing for a hidden question) and by the
 * API (which stores no answer to one and demands no answer to one). A screen
 * that merely hid the control would leave the server insisting on an answer to
 * a question that was never on the page — and the message would name a field
 * the caller cannot see.
 *
 * ⚠️ A branch collapses from the TOP: a question whose parent is itself hidden
 * is hidden, however the parent's stale answer reads. `seen` both memoises and
 * breaks a cycle — a pair of questions pointing at each other would otherwise
 * recurse until the stack gave out, and no validation on the write can promise
 * that never happens once ids are edited over years.
 */
export function visibleCallQuestions(
  questions: readonly CallQuestion[],
  answers: CallAnswers,
  outcome: CallOutcome | null,
): CallQuestion[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Map<string, boolean>();

  const asked = (q: CallQuestion): boolean => {
    const memo = seen.get(q.id);
    if (memo !== undefined) return memo;
    seen.set(q.id, false);

    const onOutcome =
      outcome !== null &&
      (q.showOnOutcomes.length
        ? q.showOnOutcomes.includes(outcome)
        : SPOKEN_OUTCOMES.includes(outcome));

    const parent = q.showIfQuestionId ? byId.get(q.showIfQuestionId) : undefined;
    const onBranch =
      !q.showIfQuestionId ||
      (parent !== undefined && asked(parent) && answerMatches(answers[parent.id], q.showIfValue));

    const shown = q.isActive && onOutcome && onBranch;
    seen.set(q.id, shown);
    return shown;
  };

  return questions.filter(asked);
}

/** Whether an answer is the value a branch names. Answers arrive as strings
 *  from the dialog and as whatever the body held from the API, so both are
 *  compared as the option value they would have been written as. */
function answerMatches(answer: unknown, wanted: string | null): boolean {
  if (wanted === null) return false;
  if (answer === undefined || answer === null) return false;
  return String(answer) === wanted;
}

/* ── Checking the answers ───────────────────────────────────────────────────*/

/** One question as its own limits describe it. */
const ruled = (q: CallQuestion): RuledField => ({
  label: q.label,
  type: q.type,
  required: q.isRequired,
  min: q.min,
  max: q.max,
  minLen: q.minLen,
  maxLen: q.maxLen,
  decimals: q.decimals,
  pattern: q.pattern,
  patternHint: q.patternHint,
  window: q.window,
});

/**
 * What is wrong with the answers to a call form, by question id.
 *
 * ⚠️ Runs identically in the browser before the round trip and on the server
 * as the thing that actually enforces — the same arrangement `checkFieldValue`
 * already has, and for the same reason.
 *
 * ⚠️ Only VISIBLE questions are checked. A required question on a branch
 * nobody went down is not unanswered, it was never asked.
 */
export function checkCallAnswers(
  questions: readonly CallQuestion[],
  answers: CallAnswers,
  outcome: CallOutcome | null,
  today?: string,
): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const q of visibleCallQuestions(questions, answers, outcome)) {
    const raw = answers[q.id];
    if (q.isRequired && isBlankAnswer(raw, q.type)) {
      problems[q.id] = `${q.label} is needed.`;
      continue;
    }
    const wrong = checkFieldValue(ruled(q), raw, today);
    if (wrong) problems[q.id] = wrong;
  }
  return problems;
}

/** The answers worth storing: the visible ones that were actually given.
 *
 *  🔴 A blank is dropped rather than stored as an empty string, so "asked and
 *  left blank" and "never asked" do not both read as a row with nothing in it.
 *  Between them, only the second is a fact about the call. */
export function callAnswersToStore(
  questions: readonly CallQuestion[],
  answers: CallAnswers,
  outcome: CallOutcome | null,
): Array<{ questionId: string; value: string }> {
  return visibleCallQuestions(questions, answers, outcome)
    .filter((q) => !isBlankAnswer(answers[q.id], q.type))
    .map((q) => ({ questionId: q.id, value: writeAnswer(answers[q.id]) }));
}

/** One answer as the column holds it. Every type stores text; a tick box
 *  stores the two words a person reading the call history expects to see. */
export function writeAnswer(raw: unknown): string {
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  return String(raw);
}

/* ── Drawing a question ─────────────────────────────────────────────────────*/

/**
 * One call question as the shared field renderer takes it.
 *
 * 🔴 So the Log Call dialog draws its questions with `FieldControl` — the same
 * component the vendor's own forms use. A dropdown on a call form and a
 * dropdown on the bank form are then the same control with the same error
 * styling and the same rule hint, because they are literally the same code.
 *
 * ⚠️ `name` is the question's ROW ID, not a column name. A call answer lands
 * in `stall_call_answer` keyed by question, so there is no built-in name to
 * carry and the id is what every answer is filed under.
 */
export function callQuestionAsField(q: CallQuestion): FormField {
  return {
    name: q.id,
    label: q.label,
    labelTa: null,
    help: q.help ?? undefined,
    helpTa: null,
    type: q.type,
    required: q.isRequired,
    options: q.options ?? undefined,
    min: q.min ?? undefined,
    max: q.max ?? undefined,
    minLen: q.minLen ?? undefined,
    maxLen: q.maxLen ?? undefined,
    decimals: q.decimals ?? undefined,
    pattern: q.pattern ?? undefined,
    patternHint: q.patternHint ?? undefined,
    window: q.window ?? undefined,
  };
}

/* ── Branches, as the builder offers and refuses them ───────────────────────*/

/** One thing a question may be branched on: an earlier choice and one of its
 *  own options. */
export interface CallBranchChoice {
  questionId: string;
  value: string;
  /** "“Did they pick up?” = Yes" — what the picker shows. */
  label: string;
}

/**
 * What the question being edited may depend on.
 *
 * ⚠️ Earlier questions only. Pointing forward makes a form nobody can answer:
 * the question that decides whether this one appears has not been asked yet.
 */
export function callBranchChoices(
  questions: readonly CallQuestion[],
  editing: { id?: string; ordinal: number },
): CallBranchChoice[] {
  const out: CallBranchChoice[] = [];
  for (const q of questions) {
    if (q.id === editing.id || q.ordinal >= editing.ordinal || !canBranchOn(q.type)) continue;
    for (const o of q.options ?? []) {
      out.push({ questionId: q.id, value: o.value, label: `“${q.label}” = ${o.label}` });
    }
  }
  return out;
}

/**
 * Why this branch may not be saved, or null when it may.
 *
 * 🔴 Read by the builder before it saves and by the API before it writes, so
 * the screen's greyed-out option and the server's refusal cannot drift apart.
 */
export function callBranchProblem(
  questions: readonly CallQuestion[],
  editing: { id?: string; ordinal: number },
  showIfQuestionId: string | null,
  showIfValue: string | null,
): string | null {
  if (showIfQuestionId === null) {
    return showIfValue === null ? null : 'A branch value needs a question to match it against.';
  }
  const target = questions.find((q) => q.id === showIfQuestionId);
  if (!target || target.id === editing.id) return 'That question is not on this form.';
  if (target.ordinal >= editing.ordinal) {
    return 'A question can only depend on one asked before it.';
  }
  if (!canBranchOn(target.type)) {
    return 'Only a dropdown or a choice list can be branched on.';
  }
  if (!showIfValue || !(target.options ?? []).some((o) => o.value === showIfValue)) {
    return `Pick one of “${target.label}”’s own options.`;
  }
  return null;
}

/**
 * Whether a question may be deleted outright rather than switched off.
 *
 * 🔴 An answered question is switched off, never removed. Somebody's answer
 * from February is evidence of what a vendor said, and deleting the question
 * would either take the answer with it or leave a row nothing can label. This
 * is the rule `canDeleteField` already applies to the request forms, for a
 * reason that is more pointed here: a call answer has no other record.
 */
export function canDeleteCallQuestion(q: { answerCount: number }): boolean {
  return q.answerCount === 0;
}
