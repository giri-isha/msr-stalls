import { COPY_SECTION_LABELS, type CopyPlan, type CopyRow, type CopySection } from '@msr/stalls';
import { useState } from 'react';
import * as api from '../api';
import { useLoad } from '../hooks';
import {
  Btn,
  Dialog,
  Empty,
  ErrorBox,
  FormField,
  Icon,
  Loading,
  Select,
  Tag,
  useToast,
} from '../ui';

/**
 * Bringing one section of a past edition's configuration into this year's.
 *
 * 🔴 It PREVIEWS before it writes. The button sits on a panel full of figures
 * an admin may already have corrected by hand, and "copy last year's rates"
 * over the top of that is not recoverable — there is no undo on a rate card.
 * So the dialog asks the server what would change and shows it row by row, and
 * nothing is written until the person has read it.
 *
 * ⚠️ One dialog for all seven sections rather than seven. The sections differ
 * only in what a row is called, and the server already answers in the same
 * shape for each — a per-panel copy box would be the same code seven times,
 * drifting in seven directions.
 */
export function CopyFromDialog({
  section,
  onClose,
  onCopied,
}: {
  section: CopySection;
  onClose: () => void;
  /** Reload whatever the panel is showing — the rows underneath have moved. */
  onCopied: () => void;
}) {
  const toast = useToast();
  const editions = useLoad(api.listEditions);
  const [from, setFrom] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Everything but the edition being copied INTO. Newest first, which is the
  // one they almost always want: last year's.
  const sources = (editions.data ?? []).filter((e) => !e.isActive);
  const chosen = from || sources[0]?.id || '';

  const plan = useLoad<CopyPlan | null>(
    () => (chosen ? api.previewCopy({ fromEditionId: chosen, section }) : Promise.resolve(null)),
    [chosen, section],
  );

  const total = plan.data ? plan.data.create.length + plan.data.overwrite.length : 0;

  const copy = async () => {
    if (!chosen) return;
    setSaving(true);
    try {
      const r = await api.copyFromEdition({ fromEditionId: chosen, section });
      toast.ok(`${r.created} added, ${r.overwritten} updated`);
      onCopied();
    } catch (e) {
      toast.fail(e);
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={`Copy ${COPY_SECTION_LABELS[section].toLowerCase()} from another edition`}
      note='Rows this edition already has are updated; rows it has that the other edition does not are left alone. Nothing is removed.'
      width={620}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' disabled={saving || total === 0} onClick={copy}>
            <Icon name='check' size={14} />
            {total === 0
              ? 'Nothing to copy'
              : `Copy ${total} ${total === 1 ? 'change' : 'changes'}${
                  plan.data ? ` into ${plan.data.intoEditionName}` : ''
                }`}
          </Btn>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {editions.loading ? (
          <Loading />
        ) : sources.length === 0 ? (
          <Empty>There is no other edition to copy from yet.</Empty>
        ) : (
          <>
            <FormField id='copy-from' label='Copy from'>
              <Select id='copy-from' value={chosen} onChange={(e) => setFrom(e.target.value)}>
                {sources.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </FormField>

            {plan.loading ? (
              <Loading />
            ) : plan.error ? (
              <ErrorBox>{plan.error.message}</ErrorBox>
            ) : plan.data ? (
              <Preview plan={plan.data} />
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

function Preview({ plan }: { plan: CopyPlan }) {
  const nothing = plan.create.length === 0 && plan.overwrite.length === 0 && plan.skip.length === 0;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {nothing ? (
        <Empty>
          {plan.intoEditionName} already matches {plan.fromEditionName} here.
        </Empty>
      ) : (
        <>
          <Group tone='ok' title='New' rows={plan.create} />
          <Group tone='warn' title='Overwritten' rows={plan.overwrite} />
          {plan.skip.length > 0 && (
            <section>
              <Heading tone='neutral' title='Skipped' n={plan.skip.length} />
              <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'grid', gap: 5 }}>
                {plan.skip.map((s) => (
                  <li key={s.key} style={{ fontSize: 12.5 }}>
                    <strong style={{ fontWeight: 650 }}>{s.label}</strong>
                    <span style={{ color: 'var(--mfg)' }}> — {s.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {plan.unchanged > 0 && (
        <div style={{ fontSize: 12, color: 'var(--mfg)' }}>
          {plan.unchanged} already the same, left alone.
        </div>
      )}
    </div>
  );
}

function Heading({
  tone,
  title,
  n,
}: {
  tone: 'ok' | 'warn' | 'neutral';
  title: string;
  n: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
      <Tag tone={tone} size='sm'>
        {n}
      </Tag>
    </div>
  );
}

/**
 * ⚠️ Shows every field that would change, with what it is now beside what it
 * would become. A count alone — "7 overwritten" — is the number an admin cannot
 * act on: it does not say whether the seven are the labels they fixed in
 * January or the rates Finance set last week.
 */
function Group({ tone, title, rows }: { tone: 'ok' | 'warn'; title: string; rows: CopyRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <Heading tone={tone} title={title} n={rows.length} />
      <div
        style={{
          display: 'grid',
          gap: 1,
          background: 'var(--line)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r4)',
          overflow: 'hidden',
        }}
      >
        {rows.map((r) => (
          <div key={r.key} style={{ background: 'var(--card)', padding: '9px 11px' }}>
            <div style={{ fontSize: 13, fontWeight: 650 }}>{r.label}</div>
            <div style={{ display: 'grid', gap: 2, marginTop: 4 }}>
              {r.changes.map((c) => (
                <div
                  key={c.field}
                  style={{ fontSize: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}
                >
                  <span style={{ color: 'var(--mfg)', minWidth: 110 }}>{c.field}</span>
                  {c.before !== null && (
                    <>
                      <span style={{ textDecoration: 'line-through', color: 'var(--mfg)' }}>
                        {c.before}
                      </span>
                      <Icon name='arrow-right' size={12} />
                    </>
                  )}
                  <span style={{ fontWeight: 600 }}>{c.after}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The panel-header control and the dialog it opens, as one thing.
 *
 * ⚠️ Holds its own open state so a panel adds copying with a single element in
 * its `actions`. Worded rather than a lone glyph, like `AddBtn` and for the same
 * reason: the Admin screen has several panels, and a bare icon at the top of one
 * does not say which section it would copy.
 */
export function CopyAction({
  section,
  writable,
  onCopied,
}: {
  section: CopySection;
  writable: boolean;
  onCopied: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn disabled={!writable} onClick={() => setOpen(true)}>
        <Icon name='copy' size={14} />
        Copy from…
      </Btn>
      {open && (
        <CopyFromDialog
          section={section}
          onClose={() => setOpen(false)}
          onCopied={() => {
            setOpen(false);
            onCopied();
          }}
        />
      )}
    </>
  );
}
