import {
  type DeclarationRow,
  declarationPreview,
  isDeclarationKey,
  needsNewVersion,
} from '@msr/stalls';
import { useMemo, useState } from 'react';
import * as api from '../api';
import { DeclarationText } from '../components/DeclarationText';
import { TYPE_LABEL } from '../components/StatusPill';
import { Panel } from '../components/Panel';
import { CopyAction } from './CopyFromDialog';
import { formatDate, useLoad } from '../hooks';
import {
  AddBtn,
  Btn,
  Card,
  Checkbox,
  Dialog,
  DialogButtons,
  EditBtn,
  Empty,
  ErrorBox,
  FormField,
  Icon,
  Input,
  Loading,
  Tag,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Textarea,
  useToast,
} from '../ui';

const FORM_TYPES = ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM', 'ASHRAM_FOOD'] as const;
type FormType = (typeof FORM_TYPES)[number];

/** ⚠️ A narrowing, not a cast. The `<select>` hands back a plain string and
 *  the contract wants the union — writing `as FormType` there would let a
 *  value the enum has never heard of through to a 400 from the server with no
 *  hint of where it came from. */
const asFormType = (v: string): FormType | null =>
  (FORM_TYPES as readonly string[]).includes(v) ? (v as FormType) : null;

/**
 * The wording a requester ticks, and every version of it.
 *
 * 🔴 The disclaimer used to be a constant in `packages/stalls/src/forms.ts` and
 * the consent was one timestamp on the request. Together those record THAT
 * somebody agreed and never WHAT they agreed to: editing the line silently
 * rewrote history for every request already submitted.
 *
 * So this screen shows HISTORY, not a form. Changing the wording archives the
 * version it replaces and the old row stays visible, because "what did this say
 * in January?" is the question the whole feature exists to answer.
 */
export function Declarations({
  writable,
  editionId,
}: {
  writable: boolean;
  /** Which edition's declarations to SHOW. Undefined is the active one. */
  editionId?: string;
}) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(
    () => api.listDeclarations(editionId),
    [editionId],
  );
  const [editing, setEditing] = useState<DeclarationRow | null>(null);
  const [adding, setAdding] = useState<{ key?: string } | null>(null);

  const rows = data?.declarations ?? [];

  /** Grouped the way an admin reads them: one block per key, and inside it one
   *  table per variant, newest version first. */
  const groups = useMemo(() => {
    const byKey = new Map<string, DeclarationRow[]>();
    for (const d of rows) {
      const list = byKey.get(d.key) ?? [];
      list.push(d);
      byKey.set(d.key, list);
    }
    return [...byKey.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, all]) => {
        const byVariant = new Map<string | null, DeclarationRow[]>();
        for (const d of all) {
          const list = byVariant.get(d.requestType) ?? [];
          list.push(d);
          byVariant.set(d.requestType, list);
        }
        return {
          key,
          variants: [...byVariant.entries()]
            // The default first, then the form-specific ones by name — the
            // order somebody reads a fallback rule in.
            .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
            .map(([requestType, versions]) => ({
              requestType,
              versions: [...versions].sort((x, y) => y.version - x.version),
            })),
          versionCount: all.length,
        };
      });
  }, [rows]);

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
    <Panel
      title='Consent declarations'
      note='The wording a requester ticks when they apply. A form shows its own variant if there is one, otherwise the default. Changing the text creates a new version and archives the old one; consents stay linked to the exact version agreed to.'
      actions={
        <>
          <CopyAction section='declarations' writable={writable} onCopied={reload} />
          <AddBtn what='declaration' writable={writable} onClick={() => setAdding({})} />
        </>
      }
    >
      {groups.length === 0 ? (
        <Empty>
          No declarations yet. Until one is written, every form falls back to the disclaimer printed
          on the 2025 paper forms.
        </Empty>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {groups.map((g) => (
            <Card key={g.key} pad={0} style={{ overflow: 'hidden' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--line)',
                  background: 'var(--rail)',
                }}
              >
                <code
                  style={{
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: 'var(--card)',
                    border: '1px solid var(--bd)',
                    borderRadius: 'var(--r)',
                    padding: '3px 8px',
                  }}
                >
                  {g.key}
                </code>
                <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                  {g.versionCount} {g.versionCount === 1 ? 'version' : 'versions'} ·{' '}
                  {g.variants.length} {g.variants.length === 1 ? 'variant' : 'variants'}
                </span>
                <div style={{ flex: 1 }} />
                {writable && (
                  <Btn onClick={() => setAdding({ key: g.key })}>
                    <Icon name='plus' size={14} />
                    Form variant
                  </Btn>
                )}
              </div>

              {g.variants.map((v) => (
                <div key={v.requestType ?? 'default'}>
                  <div style={{ padding: '10px 14px 6px' }}>
                    <Tag tone={v.requestType ? 'info' : 'neutral'} size='sm'>
                      {v.requestType
                        ? (TYPE_LABEL[v.requestType] ?? v.requestType)
                        : 'Default — every form'}
                    </Tag>
                  </div>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Version</TH>
                        <TH>Title</TH>
                        <TH>Preview</TH>
                        <TH>Status</TH>
                        <TH>Date</TH>
                        <TH align='right'>Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {v.versions.map((d) => (
                        <TR key={d.id} style={{ opacity: d.isCurrent ? 1 : 0.6 }}>
                          <TD>
                            <Tag tone={d.isCurrent ? 'ok' : 'neutral'} size='sm'>
                              v{d.version}
                              {d.isCurrent ? ' · Current' : ''}
                            </Tag>
                          </TD>
                          <TD style={{ fontWeight: 600 }}>{d.title}</TD>
                          <TD muted style={{ maxWidth: 380 }}>
                            {declarationPreview(d.body)}
                          </TD>
                          <TD>
                            {d.isCurrent ? (
                              <Tag tone={d.isActive ? 'ok' : 'warn'} size='sm'>
                                {d.isActive ? 'Active' : 'Switched off'}
                              </Tag>
                            ) : (
                              <Tag size='sm'>Archived</Tag>
                            )}
                          </TD>
                          <TD muted style={{ whiteSpace: 'nowrap', fontSize: 11.5 }}>
                            {formatDate(d.archivedAt ?? d.createdAt)}
                          </TD>
                          <TD align='right'>
                            {/* ⚠️ Only the current version. An archived one is a
                                record of what somebody agreed to, and editing
                                it would change that — the API refuses it too. */}
                            {d.isCurrent && (
                              <EditBtn
                                what={`${d.key} v${d.version}`}
                                writable={writable}
                                onClick={() => setEditing(d)}
                              />
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}

      {adding && (
        <DeclarationDialog
          presetKey={adding.key}
          taken={rows.filter((d) => d.isCurrent)}
          onClose={() => setAdding(null)}
          onSave={async (input) => {
            const ok = await run('Declaration added', () => api.createDeclaration(input));
            if (ok) setAdding(null);
          }}
        />
      )}
      {editing && (
        <DeclarationDialog
          existing={editing}
          taken={rows.filter((d) => d.isCurrent)}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = await run('Declaration saved', () =>
              api.patchDeclaration(editing.id, {
                title: input.title,
                body: input.body,
                bodyTa: input.bodyTa,
                isActive: input.isActive,
              }),
            );
            if (ok) setEditing(null);
          }}
        />
      )}
    </Panel>
  );
}

interface DeclarationValues {
  key: string;
  requestType: FormType | null;
  title: string;
  body: string;
  bodyTa: string | null;
  isActive: boolean;
}

/**
 * One declaration, written or rewritten.
 *
 * ⚠️ It tells the author BEFORE they save that the wording change will cut a
 * new version. That is the single most surprising thing about this screen — a
 * typo fix in the title edits the row, a typo fix in the body does not — and
 * finding out afterwards, from a history that grew a row, is how somebody
 * learns to distrust the screen.
 */
function DeclarationDialog({
  existing,
  presetKey,
  taken,
  onClose,
  onSave,
}: {
  existing?: DeclarationRow;
  presetKey?: string;
  taken: DeclarationRow[];
  onClose: () => void;
  onSave: (input: DeclarationValues) => void;
}) {
  const [v, setV] = useState<DeclarationValues>({
    key: existing?.key ?? presetKey ?? '',
    requestType: asFormType(existing?.requestType ?? ''),
    title: existing?.title ?? '',
    body: existing?.body ?? '',
    bodyTa: existing?.bodyTa ?? '',
    isActive: existing?.isActive ?? true,
  });
  const [busy, setBusy] = useState(false);

  const keyOk = isDeclarationKey(v.key.trim());
  const clash =
    !existing && taken.some((d) => d.key === v.key.trim() && d.requestType === v.requestType);
  const valid = keyOk && !clash && v.title.trim() !== '' && v.body.trim() !== '';

  const willVersion =
    existing !== undefined && needsNewVersion(existing, { body: v.body, bodyTa: v.bodyTa || null });

  return (
    <Dialog
      title={existing ? `Edit ${existing.key}` : 'Add declaration'}
      note={
        existing
          ? 'Changing the wording creates a new version and archives this one. The title and the switch edit this version in place.'
          : 'Reuse an existing key to add a form-specific variant of it.'
      }
      width={680}
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={() => {
            setBusy(true);
            onSave({ ...v, key: v.key.trim(), bodyTa: v.bodyTa?.trim() || null });
            setBusy(false);
          }}
          disabled={busy || !valid}
          save={existing ? 'Save' : 'Create'}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField
          id='dec-key'
          label='Key'
          error={
            v.key.trim() !== '' && !keyOk
              ? 'Lower case letters, digits and underscores.'
              : clash
                ? 'That key already has this variant — edit it instead.'
                : undefined
          }
        >
          <Input
            id='dec-key'
            value={v.key}
            placeholder='request_submission'
            // The key is what consents are filed under, and it is stable across
            // versions and variants — so an existing declaration shows it and
            // does not offer it.
            disabled={existing !== undefined}
            onChange={(e) => setV({ ...v, key: e.target.value.toLowerCase() })}
          />
        </FormField>

        <FormField id='dec-form' label='Form'>
          <select
            id='dec-form'
            value={v.requestType ?? ''}
            disabled={existing !== undefined}
            onChange={(e) => setV({ ...v, requestType: asFormType(e.target.value) })}
            style={{
              width: '100%',
              padding: '9px 11px',
              borderRadius: 'var(--r2)',
              border: '1px solid var(--bd)',
              background: 'var(--card)',
              color: 'var(--fg)',
              fontSize: 13,
            }}
          >
            <option value=''>Default — every form without its own</option>
            {FORM_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t] ?? t}
              </option>
            ))}
          </select>
        </FormField>

        <FormField id='dec-title' label='Title'>
          <Input
            id='dec-title'
            value={v.title}
            placeholder='Stall request'
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        </FormField>

        <FormField id='dec-body' label='Declaration text'>
          <Textarea
            id='dec-body'
            rows={6}
            value={v.body}
            onChange={(e) => setV({ ...v, body: e.target.value })}
          />
          <Hint />
        </FormField>

        <FormField id='dec-body-ta' label='Tamil (optional)'>
          <Textarea
            id='dec-body-ta'
            className='msrs-tamil'
            lang='ta'
            rows={5}
            value={v.bodyTa ?? ''}
            onChange={(e) => setV({ ...v, bodyTa: e.target.value })}
          />
        </FormField>

        {v.body.trim() !== '' && (
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '.6px',
                textTransform: 'uppercase',
                color: 'var(--mfg)',
                marginBottom: 6,
              }}
            >
              As the requester sees it
            </div>
            <div
              style={{
                padding: '11px 13px',
                borderRadius: 'var(--r3)',
                background: 'var(--pri-t)',
                border: '1px solid var(--pri-t2)',
                fontSize: 12.5,
                lineHeight: 1.65,
              }}
            >
              <DeclarationText body={v.body} />
              {v.bodyTa?.trim() && (
                <div className='msrs-tamil' lang='ta' style={{ marginTop: 7 }}>
                  <DeclarationText body={v.bodyTa} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* biome-ignore lint/a11y/noLabelWithoutControl: the label WRAPS its control,
            which associates them implicitly; the rule cannot see the input inside
            <Checkbox>. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <Checkbox
            checked={v.isActive}
            onChange={(e) => setV({ ...v, isActive: e.target.checked })}
          />
          Active — shown on the form
        </label>

        {willVersion && (
          <div
            style={{
              display: 'flex',
              gap: 9,
              padding: '10px 12px',
              borderRadius: 'var(--r3)',
              background: 'var(--warn-t)',
              border: '1px solid var(--warn-b)',
              fontSize: 12,
              color: 'var(--warn-fg)',
            }}
          >
            <Icon name='alert-triangle' size={15} />
            <span>
              The wording changed, so saving creates <strong>v{existing.version + 1}</strong> and
              archives v{existing.version}. Consents already given stay linked to v
              {existing.version}.
            </span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** What the body may contain. Spelled out beside the box rather than in a help
 *  centre nobody opens — there are exactly three markers, and the whole point
 *  is that anything else is text. */
function Hint() {
  return (
    <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 6, lineHeight: 1.6 }}>
      <code>**bold**</code>, <code>[label](https://…)</code> for a link, and a blank line for a new
      paragraph. Everything else is shown exactly as typed — including angle brackets, so pasting
      from a document is safe.
    </div>
  );
}
