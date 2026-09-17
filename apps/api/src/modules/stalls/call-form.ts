// The call log form: the script and the questions an admin writes, and the
// answers a caller gives while logging a reminder call.
//
// ⚠️ Nothing here decides what a question LOOKS like or what it ACCEPTS —
// `callQuestionAsField`, `checkCallAnswers` and `visibleCallQuestions` in
// `@stalls/core` do, and the dialog calls the same three before it posts. This
// file moves rows.
import { Prisma } from '@prisma/client';
import type { PrismaClient, StallReminderKind } from '@prisma/client';
import {
  type AddCallQuestionInput,
  type CallForm,
  type CallFormView,
  type CallOutcome,
  type CallQuestion,
  type CallQuestionPatch,
  type CallQuestionView,
  type FieldOption,
  type FieldRuleValues,
  type FieldType,
  callBranchProblem,
  canDeleteCallQuestion,
  checkRuleShape,
  isCallOutcome,
  isCallQuestionType,
  NO_RULES,
  ruleKnobsFor,
  rulesAfterRetype,
} from '@stalls/core';
import { actorFrom, audit } from './audit';
import type { Db } from './editions';
import {
  BadCallBranchError,
  BadFieldRuleError,
  CallQuestionInUseError,
  UnauthorableFieldTypeError,
  UnknownCallQuestionError,
} from './errors';

/* ── Reading ────────────────────────────────────────────────────────────────*/

/**
 * The form for one kind, created if this edition has never had one.
 *
 * 🔴 Seeded on READ, exactly as `ensureTemplates` seeds the letters. An edition
 * created before the call form existed has no row, and there is no sensible
 * script to have back-filled in a migration — so the row appears the first time
 * somebody opens the tab, empty, and the Admin screen is where it is written.
 *
 * ⚠️ `upsert` rather than find-then-create: two callers opening the tab at the
 * same moment would otherwise both find nothing and both insert, and the unique
 * on (edition, kind) would fail one of them with a constraint error on a READ.
 */
async function ensureForm(db: Db, editionId: string, kind: StallReminderKind) {
  return db.stallCallForm.upsert({
    where: { editionId_kind: { editionId, kind } },
    create: { editionId, kind },
    update: {},
    select: { id: true, kind: true, script: true, updatedAt: true },
  });
}

/** Both kinds' forms, for the Admin tab. */
export async function listCallForms(db: Db, editionId: string): Promise<CallFormView[]> {
  const kinds: StallReminderKind[] = ['BANK', 'PAYMENT'];
  return Promise.all(kinds.map((kind) => getCallForm(db, editionId, kind)));
}

/** One kind's form, as the builder and the Log Call dialog both read it. */
export async function getCallForm(
  db: Db,
  editionId: string,
  kind: StallReminderKind,
): Promise<CallFormView> {
  const form = await ensureForm(db, editionId, kind);
  const questions = await db.stallCallQuestion.findMany({
    where: { formId: form.id },
    orderBy: { ordinal: 'asc' },
    include: { _count: { select: { answers: true } } },
  });
  return {
    kind: form.kind,
    script: form.script,
    scriptUpdatedAt: form.updatedAt?.toISOString() ?? null,
    questions: questions.map(toView),
  };
}

function toView(q: {
  id: string;
  ordinal: number;
  label: string;
  help: string | null;
  fieldType: string;
  isRequired: boolean;
  isActive: boolean;
  options: Prisma.JsonValue;
  min: number | null;
  max: number | null;
  minLen: number | null;
  maxLen: number | null;
  decimals: number | null;
  pattern: string | null;
  patternHint: string | null;
  dateWindow: Prisma.JsonValue;
  showIfQuestionId: string | null;
  showIfValue: string | null;
  showOnOutcomes: Prisma.JsonValue;
  _count: { answers: number };
}): CallQuestionView {
  return {
    id: q.id,
    ordinal: q.ordinal,
    label: q.label,
    help: q.help,
    fieldType: q.fieldType,
    isRequired: q.isRequired,
    isActive: q.isActive,
    options: (q.options as FieldOption[] | null) ?? null,
    min: q.min,
    max: q.max,
    minLen: q.minLen,
    maxLen: q.maxLen,
    decimals: q.decimals,
    pattern: q.pattern,
    patternHint: q.patternHint,
    window: (q.dateWindow as CallQuestionView['window']) ?? null,
    showIfQuestionId: q.showIfQuestionId,
    showIfValue: q.showIfValue,
    showOnOutcomes: readOutcomes(q.showOnOutcomes),
    answerCount: q._count.answers,
  };
}

/**
 * The outcomes column, read back.
 *
 * ⚠️ Defensive about its own JSON, and deliberately so: the column is
 * `StallCallOutcome` NAMES rather than a Postgres array, so nothing in the
 * database refuses a value the enum has since dropped. An unrecognised name is
 * skipped rather than passed on to a comparison that would silently never
 * match.
 */
function readOutcomes(raw: Prisma.JsonValue): CallOutcome[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is CallOutcome => typeof v === 'string' && isCallOutcome(v));
}

/** The form as `@stalls/core` wants it — what the visibility and the checker
 *  read. The view carries a `fieldType` string from a column; this is where it
 *  becomes a `FieldType`, once, rather than at every call site. */
export function asCallForm(view: CallFormView): CallForm {
  return {
    kind: view.kind,
    script: view.script,
    questions: view.questions.map(
      (q): CallQuestion => ({
        id: q.id,
        ordinal: q.ordinal,
        label: q.label,
        help: q.help,
        type: q.fieldType as FieldType,
        isRequired: q.isRequired,
        isActive: q.isActive,
        options: q.options,
        min: q.min,
        max: q.max,
        minLen: q.minLen,
        maxLen: q.maxLen,
        decimals: q.decimals,
        pattern: q.pattern,
        patternHint: q.patternHint,
        window: q.window,
        showIfQuestionId: q.showIfQuestionId,
        showIfValue: q.showIfValue,
        showOnOutcomes: q.showOnOutcomes,
      }),
    ),
  };
}

/* ── The script ─────────────────────────────────────────────────────────────*/

export async function updateCallScript(
  db: PrismaClient,
  editionId: string,
  kind: StallReminderKind,
  script: string,
  by: string,
): Promise<void> {
  const form = await ensureForm(db, editionId, kind);
  await db.stallCallForm.update({
    where: { id: form.id },
    data: { script, updatedAt: new Date(), updatedBy: by },
  });
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_call_form.script_updated',
    subject: { type: 'call_form', ref: `${editionId}:${kind}` },
    detail: { kind },
  });
}

/* ── The questions ──────────────────────────────────────────────────────────*/

/**
 * The limits as columns, settled against the type being asked for.
 *
 * 🔴 The same arrangement `form-builder.ts` uses, and the same three refusals:
 * a limit the type has no meaning for is DROPPED (retyping a capped number to
 * text is a normal thing to do, and losing the cap is the point), a limit that
 * contradicts itself is REFUSED, and everything else is written. A call
 * question has no column under it so there is no built-in case, which is the
 * whole of the difference.
 */
function settledRules(was: FieldType, now: FieldType, wanted: FieldRuleValues): FieldRuleValues {
  const rules = was === now ? wanted : rulesAfterRetype(was, now, wanted);
  const knobs = ruleKnobsFor(now);
  const on = (...wantedKnobs: string[]) => wantedKnobs.some((k) => knobs.includes(k as never));
  const kept: FieldRuleValues = {
    ...NO_RULES,
    min: on('bounds', 'digits', 'count') ? rules.min : null,
    max: on('bounds', 'digits', 'count') ? rules.max : null,
    minLen: on('length') ? rules.minLen : null,
    maxLen: on('length') ? rules.maxLen : null,
    decimals: on('decimals') ? rules.decimals : null,
    pattern: on('pattern') ? rules.pattern : null,
    patternHint: on('pattern') ? rules.patternHint : null,
    window: on('window') ? rules.window : null,
  };
  const wrong = checkRuleShape(now, kept);
  if (wrong) throw new BadFieldRuleError(wrong);
  return kept;
}

function ruleColumns(rules: FieldRuleValues) {
  return {
    min: rules.min,
    max: rules.max,
    minLen: rules.minLen,
    maxLen: rules.maxLen,
    decimals: rules.decimals,
    pattern: rules.pattern,
    patternHint: rules.patternHint,
    dateWindow:
      rules.window === null ? Prisma.DbNull : (rules.window as unknown as Prisma.InputJsonValue),
  };
}

/** A question the builder is about to write, as the branch check reads it. */
function branchCheck(
  form: CallForm,
  editing: { id?: string; ordinal: number },
  showIfQuestionId: string | null,
  showIfValue: string | null,
): void {
  const wrong = callBranchProblem(form.questions, editing, showIfQuestionId, showIfValue);
  if (wrong) throw new BadCallBranchError(wrong);
}

export async function addCallQuestion(
  db: PrismaClient,
  editionId: string,
  kind: StallReminderKind,
  input: AddCallQuestionInput,
  by: string,
): Promise<{ id: string }> {
  if (!isCallQuestionType(input.fieldType)) {
    throw new UnauthorableFieldTypeError(input.fieldType);
  }
  const form = await ensureForm(db, editionId, kind);
  const view = await getCallForm(db, editionId, kind);
  const last = await db.stallCallQuestion.aggregate({
    where: { formId: form.id },
    _max: { ordinal: true },
  });
  const ordinal = (last._max.ordinal ?? 0) + 1;

  branchCheck(asCallForm(view), { ordinal }, input.showIfQuestionId, input.showIfValue);
  const type = input.fieldType as FieldType;
  const rules = settledRules(type, type, input);

  const created = await db.stallCallQuestion.create({
    data: {
      formId: form.id,
      ordinal,
      label: input.label,
      help: input.help,
      fieldType: input.fieldType,
      isRequired: input.isRequired,
      options:
        input.options === null
          ? Prisma.DbNull
          : (input.options as unknown as Prisma.InputJsonValue),
      ...ruleColumns(rules),
      showIfQuestionId: input.showIfQuestionId,
      showIfValue: input.showIfValue,
      showOnOutcomes: input.showOnOutcomes as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_call_question.added',
    subject: { type: 'call_question', ref: created.id },
    detail: { kind, label: input.label },
  });
  return created;
}

/**
 * Edits one question.
 *
 * ⚠️ A reorder arrives here too — the builder's up and down arrows send an
 * `ordinal` and nothing else. It is a SWAP rather than a write: setting one
 * question's ordinal to another's would leave two questions claiming the same
 * position, and the order between them would then be whatever the index
 * happened to return.
 */
export async function updateCallQuestion(
  db: PrismaClient,
  editionId: string,
  id: string,
  patch: CallQuestionPatch,
  by: string,
): Promise<void> {
  const question = await db.stallCallQuestion.findFirst({
    where: { id, form: { editionId } },
    select: {
      id: true,
      formId: true,
      ordinal: true,
      fieldType: true,
      label: true,
      form: { select: { kind: true } },
    },
  });
  if (!question) throw new UnknownCallQuestionError(id);

  if (patch.ordinal !== undefined && patch.ordinal !== question.ordinal) {
    await swapOrdinal(db, question.formId, question.id, question.ordinal, patch.ordinal);
  }

  const view = await getCallForm(db, editionId, question.form.kind);
  const now = (patch.fieldType ?? question.fieldType) as FieldType;
  const ordinal = patch.ordinal ?? question.ordinal;

  // ⚠️ Only when the body TOUCHES the branch. A patch that renames a question
  // must not be refused because a branch somebody set last month is no longer
  // legal — that is a different edit, and refusing it here would leave the
  // question unrenameable with no way from this screen to say why.
  if ('showIfQuestionId' in patch || 'showIfValue' in patch) {
    branchCheck(
      asCallForm(view),
      { id: question.id, ordinal },
      patch.showIfQuestionId ?? null,
      patch.showIfValue ?? null,
    );
  }

  const before = view.questions.find((q) => q.id === id);
  const rules = settledRules(question.fieldType as FieldType, now, {
    min: patch.min ?? before?.min ?? null,
    max: patch.max ?? before?.max ?? null,
    minLen: patch.minLen ?? before?.minLen ?? null,
    maxLen: patch.maxLen ?? before?.maxLen ?? null,
    decimals: patch.decimals ?? before?.decimals ?? null,
    pattern: patch.pattern ?? before?.pattern ?? null,
    patternHint: patch.patternHint ?? before?.patternHint ?? null,
    window: patch.window ?? before?.window ?? null,
  });

  await db.stallCallQuestion.update({
    where: { id },
    data: {
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.help !== undefined ? { help: patch.help } : {}),
      ...(patch.fieldType !== undefined ? { fieldType: patch.fieldType } : {}),
      ...(patch.isRequired !== undefined ? { isRequired: patch.isRequired } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.options !== undefined
        ? {
            options:
              patch.options === null
                ? Prisma.DbNull
                : (patch.options as unknown as Prisma.InputJsonValue),
          }
        : {}),
      ...ruleColumns(rules),
      ...('showIfQuestionId' in patch || 'showIfValue' in patch
        ? {
            showIfQuestionId: patch.showIfQuestionId ?? null,
            showIfValue: patch.showIfValue ?? null,
          }
        : {}),
      ...(patch.showOnOutcomes !== undefined
        ? { showOnOutcomes: patch.showOnOutcomes as unknown as Prisma.InputJsonValue }
        : {}),
    },
  });
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_call_question.updated',
    subject: { type: 'call_question', ref: id },
    detail: { kind: question.form.kind, label: patch.label ?? question.label },
  });
}

/** Moves a question to a position, by exchanging places with whatever is there.
 *
 *  ⚠️ A swap, and not a shuffle of everything between. The builder only ever
 *  moves a question one step, so the neighbour is the only other row that
 *  changes — and a swap is the one shape that cannot leave a gap or a
 *  duplicate whichever way the arrows are pressed. */
async function swapOrdinal(
  db: PrismaClient,
  formId: string,
  id: string,
  from: number,
  to: number,
): Promise<void> {
  const neighbour = await db.stallCallQuestion.findFirst({
    where: { formId, ordinal: to },
    select: { id: true },
  });
  await db.$transaction(async (tx) => {
    if (neighbour) {
      // Parked out of the way first: `(form_id, ordinal)` is not unique, but
      // two rows briefly sharing a position is an order nothing can reproduce.
      await tx.stallCallQuestion.update({ where: { id }, data: { ordinal: -1 } });
      await tx.stallCallQuestion.update({ where: { id: neighbour.id }, data: { ordinal: from } });
    }
    await tx.stallCallQuestion.update({ where: { id }, data: { ordinal: to } });
  });
}

/**
 * Removes a question, while no call has answered it.
 *
 * 🔴 After the first answer, switching it off is the only honest move. A call
 * answer exists nowhere else — unlike a request's custom field, there is no
 * second record of what the vendor said — so deleting the question would either
 * take the answer with it or leave a row nothing can label.
 */
export async function deleteCallQuestion(
  db: PrismaClient,
  editionId: string,
  id: string,
  by: string,
): Promise<void> {
  const question = await db.stallCallQuestion.findFirst({
    where: { id, form: { editionId } },
    select: { id: true, label: true, _count: { select: { answers: true } } },
  });
  if (!question) throw new UnknownCallQuestionError(id);
  if (!canDeleteCallQuestion({ answerCount: question._count.answers })) {
    throw new CallQuestionInUseError(id);
  }
  await db.stallCallQuestion.delete({ where: { id } });
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_call_question.deleted',
    subject: { type: 'call_question', ref: id },
    detail: { label: question.label },
  });
}
