import type { CommRecipient, ReminderKind, ReminderRow, TemplateKeyValue } from '@stalls/core';
import { CALL_OUTCOME_LABEL, DEFAULT_TEMPLATES, unknownPlaceholders } from '@stalls/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  clearSent,
  getTemplates,
  listRecipients,
  listReminders,
  putTemplate,
  putTemplateAttachment,
  presignBackofficeUpload,
  sendEmails,
  type TemplatesResponse,
  uploadFile,
} from '../api';
import { TYPE_LABEL, TypeBadge } from '../components/StatusPill';
import { CallHistoryDialog, LogCallDialog } from './LogCallDialog';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Checkbox,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Input,
  Loading,
  Search,
  Select,
  Tag,
  type Tone,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tabs,
  Textarea,
  toolBtnStyle,
  useIsMobile,
  useToast,
} from '../ui';

/**
 * Vendor communication — the selection letter, and chasing the people who have
 * not answered it.
 *
 * ⚠️ **Bulk and individual send are the same button.** The requirement asks for
 * both, and the tempting shape is two code paths; this screen ticks boxes and
 * sends the ticked set, and a set of one is an individual send. The "once sent,
 * never again" rule then lives in exactly one place — a unique constraint in
 * the database — instead of in two call sites that drift.
 */
export function Communication() {
  const [tab, setTab] = useState<'send' | 'templates' | 'reminders'>('send');
  const { can } = useMe();

  // ⚠️ The gate is the READ, and the sends inside carry their own `comms.write`.
  // This was one check for the whole screen back when seeing the letters and
  // sending them were the same privilege — so a local welfare coordinator who
  // wanted to know whether a vendor had been written to had to be trusted with
  // the button that writes to every vendor in the edition.
  if (!can('comms.read')) {
    return (
      <div>
        <H1 icon={<Icon name='megaphone' size={18} />}>Communication</H1>
        <Empty>You do not have access to vendor communication.</Empty>
      </div>
    );
  }

  return (
    <div>
      <H1
        icon={<Icon name='megaphone' size={18} />}
        sub='Send the selection letter, edit what it says, and log the calls chasing what has not come back.'
      >
        Communication
      </H1>
      <Tabs
        label='Communication Sections'
        tabs={[
          { key: 'send', label: 'Send letters', glyph: 'send' },
          { key: 'templates', label: 'Templates', glyph: 'file-text' },
          { key: 'reminders', label: 'Reminder calls', glyph: 'phone' },
        ]}
        active={tab}
        onPick={(t) => setTab(t as typeof tab)}
      />
      {tab === 'send' && <SendPanel />}
      {tab === 'templates' && <TemplatePanel />}
      {tab === 'reminders' && <ReminderPanel />}
    </div>
  );
}

// ── Send ────────────────────────────────────────────────────────────────────

const TEMPLATE_LABEL: Record<string, string> = {
  SELECTION_VENDOR: 'Vendor Selection Confirmation',
  SELECTION_ASHRAM: 'Ashram Selection Confirmation',
  PAYMENT_DETAILS: 'Payment Details',
  ONBOARDING_FSSAI_STAFF: 'FSSAI and Staff Registration',
};

/**
 * Which requester types each letter is written for.
 *
 * 🔴 The same fact the send path refuses a mismatch on — an ashram department
 * must never be handed the vendor letter with its bank-form link. It was only
 * enforced at the end, so the screen offered every selected requester for every
 * letter and the mismatch came back as a row of skips AFTER the send. Read from
 * the seeds rather than the loaded templates because `appliesTo` is a property
 * of the letter's PURPOSE, not of its wording: the API serves it from the same
 * seeds, and an admin editing the body cannot move it.
 */
const TEMPLATE_TYPES = new Map<string, ReadonlySet<string>>(
  DEFAULT_TEMPLATES.map((t) => [t.key, new Set<string>(t.appliesTo)]),
);

const appliesToText = (types: ReadonlySet<string>) =>
  [...types].map((t) => TYPE_LABEL[t] ?? t).join(', ');

function SendPanel() {
  const { can } = useMe();
  const canSend = can('comms.write');
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(listRecipients);
  const [templateKey, setTemplateKey] = useState<TemplateKeyValue>('SELECTION_VENDOR');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [sentFilter, setSentFilter] = useState<'all' | 'sent' | 'unsent'>('all');
  const [busy, setBusy] = useState(false);
  const mobile = useIsMobile();

  const sentAt = useCallback(
    (r: CommRecipient) => r.sentTemplates.find((t) => t.key === templateKey)?.sentAt ?? null,
    [templateKey],
  );

  // The types this letter is for. An unknown key applies to nobody rather than
  // to everybody: a letter the screen cannot vouch for is the one that must not
  // be offered against every requester in the edition.
  const forTypes = useMemo(
    () => TEMPLATE_TYPES.get(templateKey) ?? new Set<string>(),
    [templateKey],
  );

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      // ⚠️ Before the search and the sent filter, because this one is not a
      // preference — a row the letter cannot go to is not a row this screen has
      // anything to say about.
      if (!forTypes.has(r.requestType)) return false;
      if (
        term &&
        !r.stallName.toLowerCase().includes(term) &&
        !r.requesterName.toLowerCase().includes(term) &&
        !r.reference.toLowerCase().includes(term)
      ) {
        return false;
      }
      // ⚠️ Per LETTER, not per vendor. "Already sent" is a fact about this
      // template and this row together — the same vendor is sent and unsent at
      // the same moment for two different letters — so the filter has to move
      // when the letter picker does, and it does because `sentAt` closes over
      // `templateKey`.
      if (sentFilter === 'sent') return sentAt(r) !== null;
      if (sentFilter === 'unsent') return sentAt(r) === null;
      return true;
    });
  }, [data, q, sentFilter, sentAt, forTypes]);

  // A row already sent this letter cannot be ticked — the send would skip it,
  // and offering the tick would make the result read as a failure.
  const sendable = rows.filter((r) => sentAt(r) === null);

  // Clearing the ticks when the letter changes: the set that made sense for the
  // vendor letter is the wrong set for the payment letter.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on letter change
  useEffect(() => setPicked(new Set()), [templateKey]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const result = await sendEmails(templateKey, ids);
      if (result.sent.length > 0) {
        toast.ok(`Sent ${result.sent.length} ${result.sent.length === 1 ? 'letter' : 'letters'}.`);
      }
      // Every skip is reported, never swallowed: a bulk send that silently drops
      // a vendor is the failure this screen exists to prevent.
      for (const s of result.skipped.slice(0, 5)) {
        const row = (data ?? []).find((r) => r.id === s.requestId);
        toast.info(`${row?.stallName ?? s.requestId}: ${s.reason}`);
      }
      if (result.skipped.length > 5) {
        toast.info(`…and ${result.skipped.length - 5} more skipped.`);
      }
      setPicked(new Set());
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Select
          aria-label='Letter'
          value={templateKey}
          onChange={(v) => setTemplateKey(v as TemplateKeyValue)}
          style={{ width: 'auto', minWidth: 240 }}
        >
          {Object.entries(TEMPLATE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        {/* Why the list below is shorter than the edition. The filtering is
            silent otherwise, and a reader looking for an ashram stall under the
            vendor letter would read the absence as missing data rather than as
            a letter that was never written for them. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>Goes to</span>
          {[...forTypes].map((t) => (
            <Tag key={t} size='sm'>
              {TYPE_LABEL[t] ?? t}
            </Tag>
          ))}
        </div>
        <Search value={q} onChange={setQ} placeholder='Search vendors…' />
        <Select
          aria-label='Sent'
          value={sentFilter}
          onChange={(v) => setSentFilter(v as typeof sentFilter)}
          style={{ width: 'auto', minWidth: 150 }}
        >
          <option value='all'>All Vendors</option>
          <option value='unsent'>Not Sent Yet</option>
          <option value='sent'>Already Sent</option>
        </Select>
        <div style={{ flex: 1 }} />
        {/* ⚠️ Both of these are hidden rather than disabled for a reader who
            may only LOOK at this screen. Ticking rows is the first half of
            sending them, so a live Select all beside a dead Send offers a
            gesture with no ending. */}
        {canSend && (
          <Btn
            onClick={() => setPicked(new Set(sendable.map((r) => r.id)))}
            disabled={sendable.length === 0}
          >
            <Icon name='check-square' size={14} />
            Select All {sendable.length > 0 ? `(${sendable.length})` : ''}
          </Btn>
        )}
        {/* Named "Send selected", not "Send": the row buttons are also called
            Send, and two controls sharing an accessible name in one toolbar is
            ambiguous to a screen reader before it is ambiguous to a test. */}
        {canSend && (
          <Btn
            kind='primary'
            onClick={() => send([...picked])}
            disabled={busy || picked.size === 0}
          >
            <Icon name='megaphone' size={14} />
            {picked.size > 0 ? `Send ${picked.size} selected` : 'Send selected'}
          </Btn>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty>
          {`No selected ${appliesToText(forTypes).toLowerCase()} requests. This letter only goes to ${appliesToText(forTypes)} requests, and only once one is selected.`}
        </Empty>
      ) : mobile ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <RecipientCard
              key={r.id}
              r={r}
              sentAt={sentAt(r)}
              checked={picked.has(r.id)}
              onToggle={() => toggle(r.id)}
              onSend={() => send([r.id])}
              busy={busy}
            />
          ))}
        </div>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH> </TH>
                <TH>Vendor</TH>
                <TH>Type</TH>
                <TH>Stall</TH>
                <TH>Email Status</TH>
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const sent = sentAt(r);
                return (
                  <TR key={r.id}>
                    <TD>
                      <Checkbox
                        checked={picked.has(r.id)}
                        disabled={sent !== null}
                        aria-label={`Select ${r.stallName}`}
                        onChange={() => toggle(r.id)}
                      />
                    </TD>
                    <TD>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.stallName}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{r.email}</div>
                    </TD>
                    <TD>
                      <TypeBadge type={r.requestType} />
                    </TD>
                    <TD mono style={{ fontSize: 11.5 }}>
                      {r.stallNumbers.join(', ') || '—'}
                    </TD>
                    <TD>
                      {sent ? (
                        <Tag tone='ok' size='sm'>
                          Sent {formatDateTime(sent)}
                        </Tag>
                      ) : (
                        <Tag tone='warn' size='sm'>
                          Not Sent
                        </Tag>
                      )}
                    </TD>
                    <TD align='right'>
                      {!canSend ? null : sent ? (
                        <ResendButton row={r} templateKey={templateKey} onDone={reload} />
                      ) : (
                        <Btn onClick={() => send([r.id])} disabled={busy}>
                          <Icon name='send' size={14} />
                          Send
                        </Btn>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/** Re-sending is deliberately two steps and admin-only. "Once sent it should
 *  not be sent again" is the rule; this is the escape hatch for the day a
 *  vendor's address was wrong, not a second Send button. */
function ResendButton({
  row,
  templateKey,
  onDone,
}: {
  row: CommRecipient;
  templateKey: TemplateKeyValue;
  onDone: () => void;
}) {
  const { can } = useMe();
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  if (!can('config.write')) return null;

  return armed ? (
    <Btn
      kind='danger'
      onClick={async () => {
        try {
          await clearSent(row.id, templateKey);
          toast.ok('Cleared — this letter can be sent again.');
          onDone();
        } catch (e) {
          toast.fail(e);
        } finally {
          setArmed(false);
        }
      }}
    >
      <Icon name='check' size={14} />
      Confirm
    </Btn>
  ) : (
    <Btn onClick={() => setArmed(true)}>
      <Icon name='refresh' size={14} />
      Allow Re-Send
    </Btn>
  );
}

function RecipientCard({
  r,
  sentAt,
  checked,
  onToggle,
  onSend,
  busy,
}: {
  r: CommRecipient;
  sentAt: string | null;
  checked: boolean;
  onToggle: () => void;
  onSend: () => void;
  busy: boolean;
}) {
  return (
    <Card pad={14} style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Checkbox
          checked={checked}
          disabled={sentAt !== null}
          aria-label={`Select ${r.stallName}`}
          onChange={onToggle}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{r.stallName}</div>
          <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{r.email}</div>
        </div>
        <TypeBadge type={r.requestType} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {sentAt ? (
          <Tag tone='ok' size='sm'>
            Sent {formatDateTime(sentAt)}
          </Tag>
        ) : (
          <Btn onClick={onSend} disabled={busy}>
            <Icon name='send' size={14} />
            Send
          </Btn>
        )}
      </div>
    </Card>
  );
}

// ── Templates ───────────────────────────────────────────────────────────────

function TemplatePanel() {
  const { can } = useMe();
  const canWrite = can('comms.write');
  const toast = useToast();
  const { data, error, loading, reload } = useLoad<TemplatesResponse>(getTemplates);
  const [key, setKey] = useState<TemplateKeyValue>('SELECTION_VENDOR');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [whatsappBody, setWhatsappBody] = useState('');
  const [dirty, setDirty] = useState(false);

  const current = data?.templates.find((t) => t.key === key);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load the picked letter
  useEffect(() => {
    if (!current) return;
    setSubject(current.subject);
    setBody(current.body);
    setWhatsappBody(current.whatsappBody);
    setDirty(false);
  }, [current?.key, current?.subject, current?.body, current?.whatsappBody]);

  const unknown = useMemo(
    () => unknownPlaceholders(`${subject}\n${body}\n${whatsappBody}`),
    [subject, body, whatsappBody],
  );

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;
  if (!data || !current) return <Empty>No templates.</Empty>;

  const save = async () => {
    try {
      // ⚠️ `whatsappBody` goes with every save. The contract defaults it to the
      // empty string, and an empty WhatsApp body means "this letter is email
      // only" — so a save that left it out silently switched the WhatsApp
      // message off every time somebody fixed a typo in the email.
      await putTemplate(key, { subject, body, whatsappBody });
      toast.ok('Template saved.');
      setDirty(false);
      reload();
    } catch (e) {
      toast.fail(e);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0,1fr)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {data.templates.map((t) => (
          <button
            key={t.key}
            type='button'
            aria-pressed={t.key === key}
            onClick={() => setKey(t.key)}
            style={toolBtnStyle(t.key === key)}
          >
            {t.name}
          </button>
        ))}
      </div>

      <Card pad={16} style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: 'var(--mfg)' }}>{current.description}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {current.appliesTo.map((t) => (
            <Tag key={t} size='sm'>
              {TYPE_LABEL[t] ?? t}
            </Tag>
          ))}
        </div>

        <label htmlFor='template-subject' style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Subject</span>
          <Input
            id='template-subject'
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setDirty(true);
            }}
          />
        </label>

        <label htmlFor='template-body' style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Body</span>
          <Textarea
            id='template-body'
            rows={16}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(true);
            }}
            style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12.5 }}
          />
        </label>

        {/* 🔴 The selection letter goes out on both channels — "we would like
            to send them a WhatsApp message, as well as an email" — and the two
            are not the same text. A letter pasted into WhatsApp whole is a wall
            nobody scrolls, so this is written short and carries no attachment.
            Empty means this letter is email-only. */}
        <label htmlFor='template-whatsapp' style={{ display: 'grid', gap: 5 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>WhatsApp message</span>
          <Textarea
            id='template-whatsapp'
            rows={6}
            value={whatsappBody}
            placeholder='Leave empty to send this letter by email only.'
            onChange={(e) => {
              setWhatsappBody(e.target.value);
              setDirty(true);
            }}
            style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12.5 }}
          />
        </label>

        {/* A typo in a placeholder renders as an empty gap in a vendor's inbox,
            which is invisible here and obvious there. Named while typing. */}
        {unknown.length > 0 && (
          <ErrorBox>
            {`Unknown placeholder${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. These will be left blank in the email.`}
          </ErrorBox>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* The wording itself stays readable — knowing what the letter says
              is the point of the tab — and only committing a change is gated. */}
          <Btn kind='primary' onClick={save} disabled={!dirty || !canWrite}>
            <Icon name='check' size={14} />
            Save Template
          </Btn>
          <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
            {current.updatedAt ? `Edited ${formatDateTime(current.updatedAt)}` : 'Default wording'}
          </span>
          <div style={{ flex: 1 }} />
          {canWrite && <AttachmentControl template={current} onDone={reload} />}
        </div>

        <details>
          <summary style={{ fontSize: 12.5, cursor: 'pointer', color: 'var(--mfg)' }}>
            Placeholders You Can Use
          </summary>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
              gap: 6,
              marginTop: 10,
            }}
          >
            {data.placeholders.map((p) => (
              <div key={p.key} style={{ fontSize: 11.5 }}>
                <code style={{ color: 'var(--pri)' }}>{`{{${p.key}}}`}</code>
                <span style={{ color: 'var(--mfg)' }}> — {p.description}</span>
              </div>
            ))}
          </div>
        </details>
      </Card>
    </div>
  );
}

function AttachmentControl({
  template,
  onDone,
}: {
  template: TemplatesResponse['templates'][number];
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {template.attachment && (
        <Tag size='sm'>
          <Icon name='file-text' size={12} /> {template.attachment.name}
        </Tag>
      )}
      <label htmlFor='template-attachment' style={{ cursor: busy ? 'progress' : 'pointer' }}>
        <input
          id='template-attachment'
          type='file'
          accept='application/pdf,image/*'
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            try {
              const up = await uploadFile(presignBackofficeUpload, file, 'TEMPLATE_ATTACHMENT');
              await putTemplateAttachment(template.key, {
                key: up.key,
                name: up.name,
                bytes: file.size,
              });
              toast.ok('Attachment added.');
              onDone();
            } catch (err) {
              toast.fail(err);
            } finally {
              setBusy(false);
              e.target.value = '';
            }
          }}
        />
        <span style={{ ...toolBtnStyle(false), display: 'inline-flex' }}>
          <Icon name='plus' size={13} />
          {template.attachment ? 'Replace attachment' : 'Add attachment'}
        </span>
      </label>
      {template.attachment && (
        <Btn
          onClick={async () => {
            try {
              await putTemplateAttachment(template.key, null);
              toast.ok('Attachment removed.');
              onDone();
            } catch (e) {
              toast.fail(e);
            }
          }}
        >
          <Icon name='trash' size={14} />
          Remove
        </Btn>
      )}
    </div>
  );
}

// ── Reminder calls ──────────────────────────────────────────────────────────

function ReminderPanel() {
  const { can } = useMe();
  const canLog = can('comms.write');
  const [kind, setKind] = useState<ReminderKind>('BANK');
  const { data, error, loading, reload } = useLoad(() => listReminders(kind), [kind]);
  // The row being logged, and the row whose history is open. Two pieces of
  // state rather than one mode, because opening the history from a row and then
  // logging a call on it is the ordinary sequence.
  const [logging, setLogging] = useState<ReminderRow | null>(null);
  const [showing, setShowing] = useState<ReminderRow | null>(null);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Tabs
        label='Reminder Kind'
        tabs={[
          { key: 'BANK', label: 'Pending Bank Details' },
          { key: 'PAYMENT', label: 'Pending Payment' },
        ]}
        active={kind}
        onPick={(k) => setKind(k as ReminderKind)}
      />
      <div style={{ fontSize: 12.5, color: 'var(--mfg)', maxWidth: 640 }}>
        {kind === 'BANK'
          ? 'Vendors whose bank details have not arrived. Log a call each time you follow one up.'
          : 'Selected vendors with no payment recorded yet.'}
      </div>

      {error && <ErrorBox>{error.message}</ErrorBox>}
      {loading && !data ? (
        <Loading />
      ) : (data?.length ?? 0) === 0 ? (
        <Empty>
          {kind === 'BANK'
            ? 'Every vendor has submitted their bank details.'
            : 'Every vendor has a payment recorded.'}
        </Empty>
      ) : (
        <Card pad={0} style={{ overflow: 'hidden' }}>
          <Table>
            <THead>
              <TR>
                <TH>Vendor</TH>
                <TH>Contact</TH>
                <TH align='right'>Calls Logged</TH>
                <TH>Last Call</TH>
                <TH>Call Status</TH>
                <TH> </TH>
              </TR>
            </THead>
            <TBody>
              {(data ?? []).map((r) => (
                <TR key={r.requestId}>
                  <TD>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{r.stallName}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{r.requesterName}</div>
                  </TD>
                  <TD mono style={{ fontSize: 12 }}>
                    {r.contactNumber}
                  </TD>
                  <TD align='right'>
                    {/* The count is the way in to what was actually SAID. A
                        number nobody can open is the state this screen was in
                        before the call form existed. */}
                    {r.callCount > 0 ? (
                      <button
                        type='button'
                        onClick={() => setShowing(r)}
                        style={{
                          border: 0,
                          background: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: 'var(--pri)',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {r.callCount}
                      </button>
                    ) : (
                      r.callCount
                    )}
                  </TD>
                  <TD muted style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                    {r.lastCalledAt ? formatDateTime(r.lastCalledAt) : '—'}
                  </TD>
                  <TD>
                    {r.lastOutcome ? (
                      <div style={{ display: 'grid', gap: 3 }}>
                        <Tag tone={OUTCOME_TONE[r.lastOutcome] ?? 'neutral'} size='sm'>
                          {CALL_OUTCOME_LABEL[r.lastOutcome]}
                        </Tag>
                        {/* ⚠️ The day they ASKED to be rung, shown whether or
                            not it has passed — a callback nobody made is the
                            one this list exists to surface. */}
                        {r.callbackDate && (
                          <span style={{ fontSize: 11, color: 'var(--mfg)' }}>
                            back on {r.callbackDate}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>—</span>
                    )}
                  </TD>
                  <TD align='right'>
                    {canLog && (
                      <Btn onClick={() => setLogging(r)}>
                        <Icon name='phone-call' size={13} />
                        Log Call
                      </Btn>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {logging && (
        <LogCallDialog
          requestId={logging.requestId}
          stallName={logging.stallName}
          kind={kind}
          onClose={() => setLogging(null)}
          onLogged={() => {
            setLogging(null);
            reload();
          }}
        />
      )}
      {showing && (
        <CallHistoryDialog
          requestId={showing.requestId}
          stallName={showing.stallName}
          kind={kind}
          onClose={() => setShowing(null)}
        />
      )}
    </div>
  );
}

/** ⚠️ Keyed by the outcome NAME rather than by `statusTone`, which reads
 *  English words — "DONE" is not a word that function knows. */
const OUTCOME_TONE: Record<string, Tone> = {
  CALL_COMPLETED: 'ok',
  CALLBACK: 'warn',
  WRONG_NUMBER: 'des',
  NOT_REACHABLE: 'neutral',
  NOT_ANSWERED: 'neutral',
  NA: 'neutral',
};
