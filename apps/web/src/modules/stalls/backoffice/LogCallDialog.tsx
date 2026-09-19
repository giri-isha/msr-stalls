import {
  CALL_OUTCOME_LABEL,
  CALL_OUTCOMES,
  CALLBACK_OUTCOME,
  type CallAnswers,
  type CallOutcome,
  type CallQuestion,
  type CallQuestionView,
  type FieldType,
  type ReminderKind,
  callQuestionAsField,
  checkCallAnswers,
  visibleCallQuestions,
} from '@stalls/core';
import { useMemo, useState } from 'react';
import * as api from '../api';
import { FieldControl, type FieldValue } from '../components/FormFields';
import { formatDateTime, useLoad } from '../hooks';
import {
  DateField,
  Dialog,
  DialogButtons,
  Empty,
  ErrorBox,
  FormField,
  KV,
  Loading,
  Select,
  Tag,
  type Tone,
  Textarea,
} from '../ui';

/**
 * Logging one reminder call.
 *
 * 🔴 This used to be a button that wrote a row. The row had a `note` column no
 * screen ever filled, so the list could say a vendor had been rung four times
 * and not one word about what came of it — which is the only thing the next
 * caller needs before ringing a fifth.
 *
 * 🔴 The questions are the EDITION'S, written on Admin › Call Log Form, and
 * they are drawn by `FieldControl` — the same component the vendor's own forms
 * use. A dropdown here and a dropdown on the bank form are then the same
 * control with the same error styling and the same rule hint, because they are
 * literally the same code.
 *
 * ⚠️ Which questions appear is decided by `visibleCallQuestions`, which the API
 * runs again on the write. A dialog that merely hid a control would leave the
 * server insisting on an answer to a question that was never on the screen.
 */
export function LogCallDialog({
  requestId,
  stallName,
  kind,
  onClose,
  onLogged,
}: {
  requestId: string;
  stallName: string;
  kind: ReminderKind;
  onClose: () => void;
  onLogged: () => void;
}) {
  const { data, error, loading } = useLoad(() => api.getCallForm(kind), [kind]);

  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [callbackDate, setCallbackDate] = useState<string>('');
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<CallAnswers>({});
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const questions = useMemo(() => (data ? data.questions.map(toCoreQuestion) : []), [data]);
  const visible = useMemo(
    () => visibleCallQuestions(questions, answers, outcome),
    [questions, answers, outcome],
  );
  // The SAME check the API refuses the write with, so nothing gets as far as a
  // round trip to be told a limit the screen could have said.
  const problems = useMemo(
    () => checkCallAnswers(questions, answers, outcome),
    [questions, answers, outcome],
  );

  const save = async () => {
    if (!outcome) return;
    if (Object.keys(problems).length > 0) {
      setShowProblems(true);
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      await api.logReminder(requestId, {
        kind,
        outcome,
        // ⚠️ Sent only on the outcome that asks for it. The database refuses
        // the pair outright — a day to ring back on, hanging off a call that
        // was refused, is a date nobody can reconstruct a reason for.
        callbackDate: outcome === CALLBACK_OUTCOME && callbackDate ? callbackDate : null,
        note: note.trim() || undefined,
        // Only what was SHOWN. A branch answered and then abandoned leaves a
        // stale value in state, and it must not leave the browser.
        answers: Object.fromEntries(visible.map((q) => [q.id, answers[q.id]])),
      });
      onLogged();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Log a call — ${stallName}`}
      note={
        kind === 'BANK'
          ? 'Chasing the bank details form.'
          : 'Chasing the payment that has not arrived.'
      }
      width={600}
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={save}
          disabled={busy || !outcome || loading}
          save='Log call'
        />
      }
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox>{error.message}</ErrorBox>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {failed && <ErrorBox>{failed}</ErrorBox>}

          {/* The script, where the edition has written one. No box at all where
              it has not — an empty quotation reads as a script nobody wrote
              down, which is a different thing from one that is not needed. */}
          {data?.script ? (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.6,
                padding: '11px 13px',
                borderRadius: 'var(--r2)',
                background: 'var(--mut)',
                border: '1px solid var(--line)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {data.script}
            </div>
          ) : null}

          {/* 🔴 First, and everything else hangs off it: a question is asked on
              the statuses it names, so until one is picked there is nothing
              below but the remarks. */}
          <FormField id='lc-status' label='Call Status'>
            <Select
              id='lc-status'
              value={outcome ?? ''}
              onChange={(v) => setOutcome(v ? (v as CallOutcome) : null)}
              placeholder='Pick a status…'
              options={CALL_OUTCOMES.map((o) => ({ value: o, label: CALL_OUTCOME_LABEL[o] }))}
            />
          </FormField>

          {outcome === CALLBACK_OUTCOME && (
            <FormField id='lc-callback' label='Call Back On'>
              <DateField value={callbackDate} onChange={setCallbackDate} title='Call back on' />
            </FormField>
          )}

          {visible.map((q) => (
            <FieldControl
              key={q.id}
              field={callQuestionAsField(q)}
              value={answers[q.id] as FieldValue}
              error={showProblems ? problems[q.id] : undefined}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
            />
          ))}

          <FormField id='lc-note' label='Remarks (Optional)'>
            <Textarea
              id='lc-note'
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='Anything worth recording for whoever rings next…'
            />
          </FormField>
        </div>
      )}
    </Dialog>
  );
}

/** A question as `@stalls/core` reads it — the view carries `fieldType` as the
 *  string its column holds. */
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

/* ── What has already been said ─────────────────────────────────────────────*/

/**
 * Every call logged against one vendor for one kind, newest first.
 *
 * 🔴 Without this the call form is write-only: a caller answers six questions
 * and nobody reads them back, which wastes the caller's time instead of saving
 * the next one's. The Calls Logged count on the list is what opens it.
 *
 * ⚠️ A call logged before the form existed shows its date and its caller and
 * nothing else. That is the honest rendering of a row that holds nothing else —
 * see the nullable `outcome`.
 */
export function CallHistoryDialog({
  requestId,
  stallName,
  kind,
  onClose,
}: {
  requestId: string;
  stallName: string;
  kind: ReminderKind;
  onClose: () => void;
}) {
  const { data, error, loading } = useLoad(
    () => api.listReminderCalls(requestId, kind),
    [requestId, kind],
  );

  return (
    <Dialog title={`Calls — ${stallName}`} width={560} onClose={onClose}>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox>{error.message}</ErrorBox>
      ) : (data?.length ?? 0) === 0 ? (
        <Empty>No calls logged yet.</Empty>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {(data ?? []).map((c) => (
            <div
              key={c.id}
              style={{
                border: '1px solid var(--line)',
                borderRadius: 'var(--r2)',
                padding: '11px 13px',
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag tone={OUTCOME_TONE[c.outcome ?? ''] ?? 'neutral'} size='sm'>
                  {c.outcome ? CALL_OUTCOME_LABEL[c.outcome] : 'Not recorded'}
                </Tag>
                <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                  {formatDateTime(c.calledAt)} · {c.calledBy}
                </span>
              </div>
              {c.callbackDate && (
                <div style={{ fontSize: 12, color: 'var(--pri)' }}>
                  Call back on {c.callbackDate}
                </div>
              )}
              {c.answers.map((a) => (
                <KV key={a.questionId} k={a.label} v={a.value} />
              ))}
              {c.note && (
                <div style={{ fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                  {c.note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** ⚠️ Keyed by the outcome NAME rather than by `statusTone`, which reads
 *  English words. These are enum members, and "DONE" is not a word that
 *  function knows. */
const OUTCOME_TONE: Record<string, Tone> = {
  CALL_COMPLETED: 'ok',
  CALLBACK: 'warn',
  WRONG_NUMBER: 'des',
  NOT_REACHABLE: 'neutral',
  NOT_ANSWERED: 'neutral',
  NA: 'neutral',
};
