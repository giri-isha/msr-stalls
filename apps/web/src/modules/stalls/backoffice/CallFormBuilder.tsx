import {
  type AddCallQuestionInput,
  CALL_OUTCOME_LABEL,
  CALL_OUTCOMES,
  CALL_QUESTION_TYPES,
  type CallFormView,
  type CallOutcome,
  type CallQuestion,
  type CallQuestionView,
  type FieldOption,
  type FieldRuleValues,
  type FieldType,
  type ReminderKind,
  SPOKEN_OUTCOMES,
  callBranchChoices,
  callBranchProblem,
  canDeleteCallQuestion,
  checkRuleShape,
  NO_RULES,
  needsOptions,
  rulesAfterRetype,
} from '@stalls/core';
import { useState } from 'react';
import * as api from '../api';
import { Panel } from '../components/Panel';
import { useLoad } from '../hooks';
import {
  AddBtn,
  Btn,
  Checkbox,
  Dialog,
  DialogButtons,
  EditBtn,
  Empty,
  ErrorBox,
  FormField,
  Icon,
  IconBtn,
  Input,
  Loading,
  Select,
  Tabs,
  Tag,
  Textarea,
  useToast,
} from '../ui';
import { RulesEditor, TypePicker } from './FormBuilder';

/**
 * The Call Log Form: what a caller is asked while logging a reminder call.
 *
 * 🔴 The Log Call button used to be a button and nothing else. It wrote a row
 * with a kind, a timestamp and a `note` column no screen ever filled — so the
 * Communication list could say a vendor had been rung four times and not one
 * word about what came of it, which is the only thing the next caller needs
 * before ringing a fifth.
 *
 * 🔴 One form per KIND. Chasing a bank form and chasing a payment are different
 * conversations: "have you got the cancelled cheque" belongs on one and reads
 * as noise on the other, and a shared question list is how a caller learns to
 * skip past the half that does not apply.
 *
 * ⚠️ The types, the limits and the controls are the module's OWN — the same
 * `TypePicker`, `RulesEditor` and `FieldControl` the request forms use. What
 * this builder has that the Form Builder does not is the two CONDITIONS: which
 * call statuses a question is asked on, and which earlier answer it hangs off. A
 * request form is filled once, in front of a screen; a call form is filled in
 * thirty seconds with a phone at an ear, so a question that does not apply must
 * not be on the page at all.
 */
export function CallFormBuilder({
  writable,
  editionId,
}: {
  writable: boolean;
  /** Which edition's forms to SHOW. Undefined is the active one. */
  editionId?: string;
}) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.listCallForms(editionId), [editionId]);
  const [kind, setKind] = useState<ReminderKind>('BANK');
  const [editing, setEditing] = useState<CallQuestionView | null>(null);
  const [adding, setAdding] = useState(false);

  const form = (data?.forms ?? []).find((f) => f.kind === kind) ?? null;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      toast.ok(label);
      reload();
      return true;
    } catch (e) {
      toast.fail(e);
      return false;
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Tabs
        label='Which call'
        tabs={[
          { key: 'BANK', label: 'Pending Bank Details' },
          { key: 'PAYMENT', label: 'Pending Payment' },
        ]}
        active={kind}
        onPick={(k) => setKind(k as ReminderKind)}
      />

      {!form ? (
        <Empty>This edition has no call form yet.</Empty>
      ) : (
        <>
          <ScriptCard
            form={form}
            writable={writable}
            onSave={(script) =>
              run('Script saved', () => api.putCallScript(kind, script)).then(() => undefined)
            }
          />

          <Panel
            title={`${kind === 'BANK' ? 'Bank details' : 'Payment'} — questions`}
            note='Asked in order, while the call is being logged. A question is only put to the caller when the call status and the condition below it both allow.'
            actions={<AddBtn what='question' writable={writable} onClick={() => setAdding(true)} />}
          >
            {form.questions.length === 0 ? (
              <Empty>
                No questions yet — a call records its status and remarks, and nothing more.
              </Empty>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {form.questions.map((q, i) => (
                  <QuestionRow
                    key={q.id}
                    q={q}
                    form={form}
                    writable={writable}
                    first={i === 0}
                    last={i === form.questions.length - 1}
                    onEdit={() => setEditing(q)}
                    onMove={(to) =>
                      run('Order saved', () => api.patchCallQuestion(q.id, { ordinal: to }))
                    }
                    onDelete={() => run(`"${q.label}" removed`, () => api.deleteCallQuestion(q.id))}
                    onToggle={() =>
                      run(
                        q.isActive ? `"${q.label}" switched off` : `"${q.label}" switched on`,
                        () => api.patchCallQuestion(q.id, { isActive: !q.isActive }),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </Panel>
        </>
      )}

      {adding && form && (
        <QuestionDialog
          form={form}
          onClose={() => setAdding(false)}
          onSave={async (input) => {
            const ok = await run('Question added', () => api.addCallQuestion(kind, input));
            if (ok) setAdding(false);
          }}
        />
      )}
      {editing && form && (
        <QuestionDialog
          form={form}
          question={editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = await run('Question saved', () => api.patchCallQuestion(editing.id, input));
            if (ok) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/* ── The script ─────────────────────────────────────────────────────────────*/

/**
 * What the caller reads out before asking anything.
 *
 * ⚠️ Held until Save rather than written as it is typed. A script is read
 * ALOUD, and a half-typed sentence reaching a caller mid-shift is the one
 * failure this screen can cause on the phone.
 */
function ScriptCard({
  form,
  writable,
  onSave,
}: {
  form: CallFormView;
  writable: boolean;
  onSave: (script: string) => Promise<void>;
}) {
  const [text, setText] = useState(form.script);
  const [busy, setBusy] = useState(false);
  const dirty = text !== form.script;

  return (
    <Panel
      title='Call script'
      note='Shown at the top of the Log Call dialog, for the caller to read out. Leave it empty and no script is shown.'
      footer={
        <Btn
          kind='primary'
          disabled={!writable || !dirty || busy}
          onClick={async () => {
            setBusy(true);
            await onSave(text.trim());
            setBusy(false);
          }}
        >
          <Icon name='check' size={14} />
          Save script
        </Btn>
      }
    >
      <FormField id='cf-script' label='What to say'>
        <Textarea
          id='cf-script'
          rows={4}
          disabled={!writable}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='Namaskaram, calling from the Isha stall team about your stall at Mahashivratri…'
        />
      </FormField>
    </Panel>
  );
}

/* ── One question, in the list ──────────────────────────────────────────────*/

function QuestionRow({
  q,
  form,
  writable,
  first,
  last,
  onEdit,
  onMove,
  onDelete,
  onToggle,
}: {
  q: CallQuestionView;
  form: CallFormView;
  writable: boolean;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (to: number) => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const parent = q.showIfQuestionId
    ? form.questions.find((x) => x.id === q.showIfQuestionId)
    : null;
  const branchOption = parent?.options?.find((o) => o.value === q.showIfValue);
  // ⚠️ Empty means the DEFAULT set, not "never". Spelling it out is the whole
  // of what stops an admin ticking all six to "make sure it gets asked".
  const outcomes = q.showOnOutcomes.length ? q.showOnOutcomes : SPOKEN_OUTCOMES;

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '11px 13px',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r2)',
        background: q.isActive ? 'var(--card)' : 'var(--rail)',
        opacity: q.isActive ? 1 : 0.7,
      }}
    >
      <div style={{ width: 20, flex: 'none', fontSize: 12, color: 'var(--mfg)', paddingTop: 2 }}>
        {q.ordinal}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 3 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
          {q.label}
          {q.isRequired && <span style={{ color: 'var(--des)' }}> *</span>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          {TYPE_WORD[q.fieldType] ?? q.fieldType}
          {(q.options?.length ?? 0) > 0 && ` · ${q.options?.map((o) => o.label).join(' / ')}`}
          {!q.isActive && ' · not asked'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
          {outcomes.map((o) => (
            <Tag key={o} tone='neutral' size='sm'>
              {CALL_OUTCOME_LABEL[o]}
            </Tag>
          ))}
        </div>
        {parent && (
          <div style={{ fontSize: 11.5, color: 'var(--pri)', marginTop: 2 }}>
            Only if “{parent.label}” = {branchOption?.label ?? q.showIfValue}
          </div>
        )}
        {q.answerCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--mfg)', marginTop: 2 }}>
            Answered on {q.answerCount} call{q.answerCount === 1 ? '' : 's'} — it can be switched
            off, not removed.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
        <IconBtn
          label={`Move ${q.label} up`}
          glyph='chevron-up'
          disabled={!writable || first}
          onClick={() => onMove(q.ordinal - 1)}
        />
        <IconBtn
          label={`Move ${q.label} down`}
          glyph='chevron-down'
          disabled={!writable || last}
          onClick={() => onMove(q.ordinal + 1)}
        />
        <EditBtn what={q.label} writable={writable} onClick={onEdit} />
        {/* 🔴 Delete only while nothing has answered it. After that the answers
            are on the record of the calls that gave them, and the question they
            answered has to stay readable — `canDeleteCallQuestion` is the same
            rule the API refuses the write with. */}
        {canDeleteCallQuestion(q) ? (
          <IconBtn
            label={`Remove ${q.label}`}
            glyph='trash'
            disabled={!writable}
            onClick={onDelete}
          />
        ) : (
          <IconBtn
            label={q.isActive ? `Stop asking ${q.label}` : `Ask ${q.label} again`}
            glyph={q.isActive ? 'ban' : 'eye'}
            disabled={!writable}
            onClick={onToggle}
          />
        )}
      </div>
    </div>
  );
}

/** The short word for a type, in the list. The dialog's picker carries the
 *  longer description; a row has space for two words. */
const TYPE_WORD: Record<string, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  tel: 'Phone number',
  select: 'Dropdown',
  radio: 'Choice list',
  checkbox: 'Tick box',
  date: 'Date',
};

/* ── The question dialog ────────────────────────────────────────────────────*/

interface QuestionValues extends FieldRuleValues {
  label: string;
  help: string | null;
  fieldType: string;
  isRequired: boolean;
  isActive: boolean;
  options: FieldOption[] | null;
  showIfQuestionId: string | null;
  showIfValue: string | null;
  showOnOutcomes: CallOutcome[];
}

function QuestionDialog({
  form,
  question,
  onClose,
  onSave,
}: {
  form: CallFormView;
  question?: CallQuestionView;
  onClose: () => void;
  onSave: (input: AddCallQuestionInput) => void;
}) {
  const [v, setV] = useState<QuestionValues>({
    label: question?.label ?? '',
    help: question?.help ?? '',
    fieldType: question?.fieldType ?? 'text',
    isRequired: question?.isRequired ?? false,
    isActive: question?.isActive ?? true,
    options: question?.options ?? null,
    ...(question
      ? {
          min: question.min,
          max: question.max,
          minLen: question.minLen,
          maxLen: question.maxLen,
          decimals: question.decimals,
          pattern: question.pattern,
          patternHint: question.patternHint,
          window: question.window,
        }
      : NO_RULES),
    showIfQuestionId: question?.showIfQuestionId ?? null,
    showIfValue: question?.showIfValue ?? null,
    showOnOutcomes: question?.showOnOutcomes ?? [],
  });
  const [busy, setBusy] = useState(false);

  const wantsOptions = needsOptions(v.fieldType);
  // A new question goes to the end, which is what decides what it may branch
  // on — everything already on the form is "earlier" than it.
  const ordinal = question?.ordinal ?? form.questions.length + 1;
  const asQuestions = form.questions.map(toCoreQuestion);
  const branches = callBranchChoices(asQuestions, { id: question?.id, ordinal });

  const rules = rulesAfterRetype(
    (question?.fieldType ?? v.fieldType) as FieldType,
    v.fieldType as FieldType,
    v,
  );
  const ruleProblem = checkRuleShape(v.fieldType as FieldType, rules);
  // 🔴 The SAME function the API refuses the write with, so a branch the
  // dialog lets through is one the server accepts.
  const branchProblem = callBranchProblem(
    asQuestions,
    { id: question?.id, ordinal },
    v.showIfQuestionId,
    v.showIfValue,
  );
  const valid =
    v.label.trim() !== '' &&
    (!wantsOptions || (v.options?.length ?? 0) > 0) &&
    ruleProblem === null &&
    branchProblem === null;

  const branchValue =
    v.showIfQuestionId && v.showIfValue ? `${v.showIfQuestionId}::${v.showIfValue}` : '';

  return (
    <Dialog
      title={question ? `Edit "${question.label}"` : 'Add a question'}
      note='Asked while a call is being logged, and only when the call status and the condition below both allow.'
      width={620}
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={() => {
            setBusy(true);
            onSave({
              label: v.label.trim(),
              help: v.help?.trim() || null,
              fieldType: v.fieldType as AddCallQuestionInput['fieldType'],
              isRequired: v.isRequired,
              isActive: v.isActive,
              options: wantsOptions ? v.options : null,
              ...rules,
              showIfQuestionId: v.showIfQuestionId,
              showIfValue: v.showIfValue,
              showOnOutcomes: v.showOnOutcomes,
            } as AddCallQuestionInput);
            setBusy(false);
          }}
          disabled={busy || !valid}
          save={question ? 'Save' : 'Add question'}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='cq-label' label='Question'>
          <Input
            id='cq-label'
            value={v.label}
            onChange={(e) => setV({ ...v, label: e.target.value })}
            placeholder='What reason did they give?'
          />
        </FormField>

        <FormField id='cq-help' label='Help Text (Optional)'>
          <Textarea
            id='cq-help'
            rows={2}
            value={v.help ?? ''}
            onChange={(e) => setV({ ...v, help: e.target.value })}
          />
        </FormField>

        <TypePicker
          value={v.fieldType}
          choices={CALL_QUESTION_TYPES}
          onChange={(fieldType) => setV({ ...v, fieldType })}
          note={null}
        />

        {wantsOptions && (
          <FormField id='cq-options' label='Choices'>
            <Textarea
              id='cq-options'
              rows={4}
              value={(v.options ?? []).map((o) => o.label).join('\n')}
              onChange={(e) =>
                setV({
                  ...v,
                  options: e.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((label) => ({
                      value: label.toUpperCase().replace(/\W+/g, '_'),
                      label,
                      labelTa: null,
                    })),
                })
              }
            />
            <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 6 }}>
              One per line, in the order they should appear. A later question can be asked only when
              one of these is picked.
            </div>
          </FormField>
        )}

        <RulesEditor
          type={v.fieldType}
          values={v}
          onChange={(patch) => setV({ ...v, ...patch })}
          problem={ruleProblem}
        />

        {/* 🔴 Which statuses this is asked on. Empty is the DEFAULT set, not
            "never": a scripted question is something you ask a person, and
            putting "what reason did they give" in front of a caller whose phone
            rang out is how a form teaches people to type anything to get past
            it. */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            Ask on which call statuses
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CALL_OUTCOMES.map((o) => {
              const on = v.showOnOutcomes.includes(o);
              return (
                <button
                  key={o}
                  type='button'
                  onClick={() =>
                    setV({
                      ...v,
                      showOnOutcomes: on
                        ? v.showOnOutcomes.filter((x) => x !== o)
                        : [...v.showOnOutcomes, o],
                    })
                  }
                  aria-pressed={on}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 999,
                    fontSize: 12,
                    cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--pri)' : 'var(--bd)'}`,
                    background: on ? 'var(--pri-t)' : 'var(--card)',
                    color: on ? 'var(--pri)' : 'var(--mfg)',
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {CALL_OUTCOME_LABEL[o]}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 6, lineHeight: 1.55 }}>
            {v.showOnOutcomes.length === 0
              ? `Pick none and it is asked whenever somebody was actually spoken to — ${SPOKEN_OUTCOMES.map(
                  (o) => CALL_OUTCOME_LABEL[o],
                ).join(' and ')}.`
              : 'Asked only on the statuses ticked above.'}
          </div>
        </div>

        <FormField id='cq-branch' label='Ask Only If'>
          <Select
            id='cq-branch'
            value={branchValue}
            onChange={(picked) => {
              const [qid, val] = picked ? picked.split('::') : [null, null];
              setV({ ...v, showIfQuestionId: qid ?? null, showIfValue: val ?? null });
            }}
          >
            <option value=''>Always — no earlier answer needed</option>
            {branches.map((b) => (
              <option key={`${b.questionId}::${b.value}`} value={`${b.questionId}::${b.value}`}>
                {b.label}
              </option>
            ))}
          </Select>
          <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 6, lineHeight: 1.55 }}>
            {branches.length === 0
              ? 'Nothing to hang this on yet — add a dropdown or a choice list above it first.'
              : 'The question is only put to the caller when that earlier answer matches.'}
          </div>
          {branchProblem && (
            <div style={{ fontSize: 11.5, color: 'var(--des)', marginTop: 6 }}>{branchProblem}</div>
          )}
        </FormField>

        {/* biome-ignore lint/a11y/noLabelWithoutControl: the label WRAPS its control,
            which associates them implicitly; the rule cannot see the input inside
            <Checkbox>. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <Checkbox
            checked={v.isRequired}
            onChange={(e) => setV({ ...v, isRequired: e.target.checked })}
          />
          Required — the call cannot be saved without an answer
        </label>

        {/* biome-ignore lint/a11y/noLabelWithoutControl: as above */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <Checkbox
            checked={v.isActive}
            onChange={(e) => setV({ ...v, isActive: e.target.checked })}
          />
          Asked — untick to stop asking it without losing the answers already given
        </label>
      </div>
    </Dialog>
  );
}

/** A question as `@stalls/core` reads it. The view carries `fieldType` as the
 *  string its column holds; this is where it becomes a `FieldType`. */
function toCoreQuestion(q: CallQuestionView): CallQuestion {
  return {
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
  };
}
