import { PLACEHOLDERS, TEMPLATE_KEYS, TEMPLATE_LABEL, type TemplateKey } from '@msr/stalls';
import { useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { Field, SelectInput, TextArea, TextInput } from '../components/FormControls';
import { Grid, Mono, Sub } from '../components/Grid';
import { StagePill, TYPE_LABEL, TypeTag } from '../components/StatusPill';
import { formatDateTime, useLoad } from '../hooks';
import { useMe } from '../me';
import { Dialog } from '../ui/components/Dialog';
import { useToast } from '../ui/components/Toast';
import { Icon } from '../ui/icons';
import { Btn, Card, ErrorBox, H1, Loading, Tag, Toolbar } from '../ui/ui';

/** Requirement 3: one template per audience, bulk or individual send, and a
 *  confirmation that is never sent twice. Two tabs — Send, and Templates. */
export function Communication() {
  const { can } = useMe();
  const [tab, setTab] = useState<'send' | 'templates'>('send');
  return (
    <div>
      <H1
        icon={<Icon name='megaphone' size={20} />}
        sub='Selection confirmations, payment details and reminders. A confirmation goes out once; the log is the proof.'
        actions={
          <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--mut)', borderRadius: 'calc(var(--r4) - 4px)' }}>
            {(['send', 'templates'] as const).map((t) => (
              <button
                type='button'
                key={t}
                onClick={() => setTab(t)}
                style={{ padding: '7px 14px', borderRadius: 'calc(var(--r4) - 8px)', border: 0, cursor: 'pointer', fontSize: 12.5, fontWeight: tab === t ? 700 : 500, background: tab === t ? 'var(--card)' : 'transparent', color: tab === t ? 'var(--fg)' : 'var(--mfg)', boxShadow: tab === t ? 'var(--ring)' : 'none' }}
              >
                {t === 'send' ? 'Send' : 'Templates'}
              </button>
            ))}
          </div>
        }
      >
        Communication
      </H1>
      {tab === 'send' ? <SendTab canSend={can('comms:write')} /> : <TemplatesTab writable={can('comms:write')} />}
    </div>
  );
}

const SELECTION_FOR: Record<string, TemplateKey> = {
  VENDOR: 'SELECTION_VENDOR',
  LOCAL_WELFARE: 'SELECTION_LOCAL_WELFARE',
  ASHRAM: 'SELECTION_ASHRAM',
  ASHRAM_FOOD: 'SELECTION_ASHRAM',
};

function SendTab({ canSend }: { canSend: boolean }) {
  const toast = useToast();
  const [requestType, setRequestType] = useState('VENDOR');
  const [templateKey, setTemplateKey] = useState<TemplateKey>('SELECTION_VENDOR');
  const [onlyUnsent, setOnlyUnsent] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [force, setForce] = useState(false);
  const [preview, setPreview] = useState<{ id: string; subject: string; body: string; missing: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useLoad(() => api.commsRows(requestType || undefined), [requestType]);

  // Choosing an audience picks its confirmation template, and clears the picks.
  useEffect(() => {
    setTemplateKey(SELECTION_FOR[requestType] ?? 'PAYMENT_DETAILS');
    setPicked(new Set());
  }, [requestType]);

  const shown = useMemo(() => (rows.data ?? []).filter((r) => !onlyUnsent || !r.lastSent[templateKey]), [rows.data, onlyUnsent, templateKey]);
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));

  const send = async () => {
    setBusy(true);
    try {
      const res = await api.sendEmails({ requestIds: [...picked], templateKey, force });
      const bits = [`${res.sent.length} sent`];
      if (res.skipped.length) bits.push(`${res.skipped.length} skipped`);
      if (res.failed.length) bits.push(`${res.failed.length} failed`);
      if (res.failed.length) toast.fail(new Error(bits.join(', ')));
      else toast.ok(bits.join(', '));
      if (res.skipped.length) toast.info(res.skipped.map((s) => s.reason).filter((v, i, a) => a.indexOf(v) === i).join(' · '));
      setPicked(new Set());
      rows.reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async (id: string) => {
    try {
      const p = await api.previewTemplate(templateKey, id);
      setPreview({ id, ...p });
    } catch (e) {
      toast.fail(e);
    }
  };

  return (
    <>
      <Toolbar>
        <SelectInput aria-label='Audience' value={requestType} onChange={(e) => setRequestType(e.target.value)} style={{ width: 180 }}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectInput>
        <SelectInput aria-label='Template' value={templateKey} onChange={(e) => setTemplateKey(e.target.value as TemplateKey)} style={{ width: 300 }}>
          {TEMPLATE_KEYS.map((k) => (
            <option key={k} value={k}>
              {TEMPLATE_LABEL[k]}
            </option>
          ))}
        </SelectInput>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
          <input type='checkbox' checked={onlyUnsent} onChange={(e) => setOnlyUnsent(e.target.checked)} style={{ accentColor: 'var(--pri)' }} /> Not yet sent this template
        </label>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--mfg)' }}>
          <input type='checkbox' checked={force} onChange={(e) => setForce(e.target.checked)} style={{ accentColor: 'var(--des)' }} /> Allow re-send
        </label>
        <Btn kind='primary' disabled={!canSend || busy || picked.size === 0} onClick={send}>
          {busy ? 'Sending…' : `Send to ${picked.size || ''}`.trim()}
        </Btn>
      </Toolbar>
      {rows.error && <ErrorBox>{rows.error.message}</ErrorBox>}
      {rows.loading ? (
        <Loading />
      ) : (
        <Grid
          rows={shown}
          rowKey={(r) => r.id}
          empty={onlyUnsent ? 'Everyone here has already had this template.' : 'No selected requests of this type.'}
          columns={[
            {
              key: 'pick',
              header: (
                <input
                  type='checkbox'
                  aria-label='Select all'
                  checked={allPicked}
                  onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())}
                  style={{ accentColor: 'var(--pri)' }}
                />
              ),
              width: '36px',
              mobile: 'hide',
              render: (r) => (
                <input
                  type='checkbox'
                  aria-label={`Select ${r.stallName}`}
                  checked={picked.has(r.id)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const n = new Set(p);
                      e.target.checked ? n.add(r.id) : n.delete(r.id);
                      return n;
                    })
                  }
                  style={{ accentColor: 'var(--pri)' }}
                />
              ),
            },
            {
              key: 'stall',
              header: 'Stall',
              width: '1.5fr',
              mobile: 'title',
              render: (r) => (
                <>
                  <b>{r.stallName}</b>
                  <Sub>
                    <Mono>{r.reference}</Mono> · {r.email}
                  </Sub>
                </>
              ),
            },
            { key: 'type', header: 'Type', width: '110px', render: (r) => <TypeTag type={r.requestType} size='sm' /> },
            { key: 'alloc', header: 'Stalls', width: '110px', render: (r) => <Mono>{r.allocatedStalls.join(', ')}</Mono> },
            { key: 'stage', header: 'Stage', width: '140px', render: (r) => <StagePill stage={r.stage} size='sm' /> },
            {
              key: 'last',
              header: 'Last sent',
              width: '160px',
              render: (r) => (r.lastSent[templateKey] ? <Tag tone='ok' size='sm'>{formatDateTime(r.lastSent[templateKey]!)}</Tag> : <Tag size='sm'>Not sent</Tag>),
            },
          ]}
          actions={(r) => <Btn onClick={() => doPreview(r.id)}>Preview</Btn>}
        />
      )}
      {preview && (
        <Dialog width={640} title={preview.subject} note={preview.missing.length ? `Blank placeholders: ${preview.missing.join(', ')}` : undefined} onClose={() => setPreview(null)} footer={<Btn onClick={() => setPreview(null)}>Close</Btn>}>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, margin: 0 }}>{preview.body}</pre>
        </Dialog>
      )}
    </>
  );
}

function TemplatesTab({ writable }: { writable: boolean }) {
  const toast = useToast();
  const list = useLoad(api.listTemplates);
  const [key, setKey] = useState<TemplateKey>('SELECTION_VENDOR');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const current = list.data?.find((t) => t.key === key);
  useEffect(() => {
    if (current) {
      setSubject(current.subject);
      setBody(current.body);
    }
  }, [current]);
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorBox>{list.error.message}</ErrorBox>;
  const dirty = current && (subject !== current.subject || body !== current.body);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 260px) 1fr', gap: 14, alignItems: 'start' }}>
      <Card pad={6}>
        {TEMPLATE_KEYS.map((k) => (
          <button
            type='button'
            key={k}
            onClick={() => setKey(k)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 'var(--r2)', border: 0, cursor: 'pointer', fontSize: 13, fontWeight: key === k ? 700 : 500, background: key === k ? 'var(--pri-t)' : 'transparent', color: key === k ? 'var(--pri)' : 'var(--fg)' }}
          >
            {TEMPLATE_LABEL[k]}
          </button>
        ))}
      </Card>
      <Card>
        <Field id='t-subject' label='Subject'>
          <TextInput id='t-subject' value={subject} disabled={!writable} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field id='t-body' label='Body' help={`Placeholders: ${PLACEHOLDERS[key].map((p) => `{{${p}}}`).join(' ')}`}>
          <TextArea id='t-body' rows={16} value={body} disabled={!writable} onChange={(e) => setBody(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} />
        </Field>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Btn
            kind='primary'
            disabled={!writable || !dirty}
            onClick={async () => {
              try {
                await api.putTemplate(key, { subject, body });
                toast.ok('Template saved');
                list.reload();
              } catch (e) {
                toast.fail(e);
              }
            }}
          >
            Save
          </Btn>
          {current?.updatedAt && <span style={{ fontSize: 12, color: 'var(--mfg)' }}>Last edited {formatDateTime(current.updatedAt)}</span>}
        </div>
      </Card>
    </div>
  );
}
