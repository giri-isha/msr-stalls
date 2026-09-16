import {
  AUTHORABLE_FIELD_TYPES,
  type BuilderForm,
  type BuiltFormField,
  canDeleteField,
  canEditFieldType,
  type FieldOption,
  isLockedRequired,
  needsOptions,
  renderForm,
  STALL_FORM_TYPES,
  type StallFormType,
} from '@msr/stalls';
import { useState } from 'react';
import * as api from '../api';
import { Panel } from '../components/Panel';
import { CopyAction } from './CopyFromDialog';
import { TYPE_LABEL } from '../components/StatusPill';
import { useLoad } from '../hooks';
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
  IconBtn,
  Input,
  Loading,
  Select,
  Tag,
  Textarea,
  toolBtnStyle,
  useToast,
} from '../ui';

/** 🔴 All seven, not the four application forms. The bank details form, the
 *  FSSAI upload and staff registration are rows now too — their questions used
 *  to live in JSX, so rewording a label or ceasing to ask one was a redeploy. */
const FORM_TYPES = STALL_FORM_TYPES;
type FormType = StallFormType;

/**
 * What each of the four request forms asks.
 *
 * 🔴 The forms were a constant in `packages/stalls/src/forms.ts`, and the
 * builder could only APPEND to them. Reordering a question, fixing a label or
 * marking something required meant a code change and a redeploy — an edition's
 * form waiting on an engineer, which is the same problem the bay list had
 * before zones became rows.
 *
 * ⚠️ The one thing this screen cannot do is retype or delete a BUILT-IN
 * question, and that is a property of there being a database underneath rather
 * than a limit anybody chose: those answers land in typed columns on
 * `stall_request`. Everything else — wording, Tamil, help, order, section,
 * required, and whether the question is asked at all — is editable on every
 * field. A built-in that should stop being asked is switched off.
 */
export function FormBuilder({
  writable,
  editionId,
}: {
  writable: boolean;
  /** Which edition's forms to SHOW. Undefined is the active one. A past edition
   *  arrives with `writable` already false — see the note in `Admin`. */
  editionId?: string;
}) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.listForms(editionId), [editionId]);
  const [formType, setFormType] = useState<FormType>('VENDOR');
  const [editing, setEditing] = useState<BuiltFormField | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingSection, setAddingSection] = useState(false);

  const form = (data?.forms ?? []).find((f) => f.formType === formType) ?? null;

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
      title='Form Builder'
      note='What each request form asks, in the order it asks. A question whose answer goes into a record of its own can be reworded, moved and switched off, but not retyped or removed — switch it off instead.'
      actions={
        form && (
          <>
            <CopyAction section='forms' writable={writable} onCopied={reload} />
            <Btn disabled={!writable} onClick={() => setAddingSection(true)}>
              <Icon name='plus' size={14} />
              Heading
            </Btn>
            <AddBtn what='question' writable={writable} onClick={() => setAdding(true)} />
          </>
        )
      }
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {FORM_TYPES.map((t) => (
          <button
            key={t}
            type='button'
            aria-pressed={formType === t}
            onClick={() => setFormType(t)}
            style={toolBtnStyle(formType === t)}
          >
            {TYPE_LABEL[t] ?? t}
          </button>
        ))}
      </div>

      {!form ? (
        <Empty>
          This edition has no form definition yet. It is written from the 2025 forms the next time
          the API starts, and until then the printed wording is what requesters see.
        </Empty>
      ) : (
        <FormOutline
          form={form}
          writable={writable}
          onEdit={setEditing}
          onMove={(fields) =>
            run('Order saved', () => api.reorderFormFields(form.definitionId, fields))
          }
          onDeleteSection={(id) => run('Heading removed', () => api.deleteFormSection(id))}
          onDelete={(f) => run(`"${f.label}" removed`, () => api.deleteFormField(f.id))}
        />
      )}

      {editing && (
        <FieldDialog
          field={editing}
          formType={formType}
          sections={form?.sections ?? []}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const ok = await run('Question saved', () => api.patchFormField(editing.id, patch));
            if (ok) setEditing(null);
          }}
        />
      )}
      {adding && form && (
        <FieldDialog
          formType={formType}
          sections={form.sections}
          onClose={() => setAdding(false)}
          onSave={async (patch) => {
            const ok = await run('Question added', () =>
              api.addFormField(form.definitionId, {
                label: patch.label ?? '',
                labelTa: patch.labelTa ?? null,
                help: patch.help ?? null,
                fieldType: (patch.fieldType ?? 'text') as 'text',
                isRequired: patch.isRequired ?? false,
                sectionId: patch.sectionId ?? null,
                options: patch.options ?? null,
                min: patch.min ?? null,
                max: patch.max ?? null,
              }),
            );
            if (ok) setAdding(false);
          }}
        />
      )}
      {addingSection && form && (
        <SectionDialog
          onClose={() => setAddingSection(false)}
          onSave={async (input) => {
            const ok = await run('Heading added', () =>
              api.addFormSection(form.definitionId, input),
            );
            if (ok) setAddingSection(false);
          }}
        />
      )}
    </Panel>
  );
}

function FormOutline({
  form,
  writable,
  onEdit,
  onMove,
  onDeleteSection,
  onDelete,
}: {
  form: BuilderForm;
  writable: boolean;
  onEdit: (f: BuiltFormField) => void;
  onMove: (fields: Array<{ id: string; sectionId: string | null }>) => void;
  onDeleteSection: (id: string) => void;
  onDelete: (field: BuiltFormField) => void;
}) {
  // The order as drawn, so a move can send the WHOLE list — see
  // `reorderFormFields` for why one field at a time is not enough.
  const groups = renderForm({ ...form, fields: form.fields });
  const flat = groups.flatMap((g) => g.fields);

  const move = (id: string, by: number) => {
    const at = flat.findIndex((f) => f.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= flat.length) return;
    const next = [...flat];
    const [moved] = next.splice(at, 1);
    if (!moved) return;
    // ⚠️ The field takes the SECTION of the row it lands beside. Dragging a
    // question under a heading is the only way to put it there, so a move that
    // kept the old section would look like it had not worked.
    next.splice(to, 0, { ...moved, sectionId: next[to - 1]?.sectionId ?? null });
    onMove(next.map((f) => ({ id: f.id, sectionId: f.sectionId })));
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {groups.map((g, gi) => (
        <Card key={g.section?.id ?? `loose-${gi}`} pad={0} style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '10px 14px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--rail)',
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            {g.section ? (
              <>
                {g.section.heading}
                {g.section.headingTa && (
                  <span className='msrs-tamil' lang='ta' style={{ color: 'var(--mfg)' }}>
                    {g.section.headingTa}
                  </span>
                )}
                <div style={{ flex: 1 }} />
                {writable && (
                  <IconBtn
                    label={`Remove the heading ${g.section.heading}`}
                    glyph='trash'
                    tone='var(--des)'
                    onClick={() => onDeleteSection(g.section?.id ?? '')}
                  />
                )}
              </>
            ) : (
              <span style={{ color: 'var(--mfg)', fontWeight: 600 }}>No Heading</span>
            )}
          </div>

          <div>
            {g.fields.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                writable={writable}
                onEdit={() => onEdit(f)}
                onUp={() => move(f.id, -1)}
                onDown={() => move(f.id, 1)}
                onDelete={() => onDelete(f)}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function FieldRow({
  field,
  writable,
  onEdit,
  onUp,
  onDown,
  onDelete,
}: {
  field: BuiltFormField;
  writable: boolean;
  onEdit: () => void;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        // ⚠️ Wraps. A question, two tags and four controls do not fit across a
        // 390px phone, and without this the label is squeezed to one word per
        // line while the buttons stay put — which is the opposite of what
        // should give way. `flex: 1` with a 160px floor on the label makes the
        // controls drop to their own line instead.
        flexWrap: 'wrap',
        gap: 10,
        padding: '10px 14px',
        borderBottom: '1px solid var(--line)',
        opacity: field.isActive ? 1 : 0.55,
      }}
    >
      <div style={{ minWidth: 160, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>
          {field.label}
          {field.required && <span style={{ color: 'var(--des)' }}> *</span>}
        </div>
        {field.labelTa && (
          <div className='msrs-tamil' lang='ta' style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
            {field.labelTa}
          </div>
        )}
      </div>

      <Tag size='sm'>{field.type}</Tag>
      {/* ⚠️ Said on the row, not discovered in the dialog. "Why can I not change
          the type of this one?" is a question the list should answer before it
          is asked. */}
      {field.isBuiltIn && (
        <Tag tone='info' size='sm'>
          Built In
        </Tag>
      )}
      {!field.isActive && <Tag size='sm'>Not Asked</Tag>}

      {writable && (
        <span style={{ display: 'inline-flex', gap: 4, flex: 'none' }}>
          <IconBtn label={`Move ${field.label} up`} glyph='chevron-up' onClick={onUp} />
          <IconBtn label={`Move ${field.label} down`} glyph='chevron-down' onClick={onDown} />
        </span>
      )}
      <EditBtn what={field.label} writable={writable} onClick={onEdit} />
      {/* ⚠️ Offered only where it is possible. A built-in question's answer
          lands in a column the submit path writes whether or not the form asked
          for it, so removing the question leaves that column with nothing to
          fill it — `canDeleteField` is the same rule the API refuses on, and
          drawing a button that would always be refused is worse than drawing
          none. Switching it off is the way to stop asking. */}
      {writable && canDeleteField(field) && (
        <IconBtn
          label={`Remove ${field.label}`}
          glyph='trash'
          tone='var(--des)'
          onClick={onDelete}
        />
      )}
    </div>
  );
}

interface FieldValues {
  label: string;
  labelTa: string | null;
  help: string | null;
  fieldType: string;
  isRequired: boolean;
  isActive: boolean;
  sectionId: string | null;
  options: FieldOption[] | null;
  min: number | null;
  max: number | null;
}

function FieldDialog({
  field,
  formType,
  sections,
  onClose,
  onSave,
}: {
  field?: BuiltFormField;
  formType: FormType;
  sections: BuilderForm['sections'];
  onClose: () => void;
  onSave: (patch: Partial<FieldValues>) => void;
}) {
  // ⚠️ Read from the same rule the API refuses the write with. Two spellings of
  // "which questions are structural" is how one gets switched off through an
  // API the screen would have stopped.
  const locked = isLockedRequired(formType, field?.name ?? null);
  const [v, setV] = useState<FieldValues>({
    label: field?.label ?? '',
    labelTa: field?.labelTa ?? '',
    help: field?.help ?? '',
    fieldType: field?.type ?? 'text',
    isRequired: field?.required ?? false,
    isActive: field?.isActive ?? true,
    sectionId: field?.sectionId ?? null,
    options: field?.options ?? null,
    min: field?.min ?? null,
    max: field?.max ?? null,
  });
  const [busy, setBusy] = useState(false);

  const builtIn = field?.isBuiltIn ?? false;
  const typeLocked = field !== undefined && !canEditFieldType(field);
  const wantsOptions = needsOptions(v.fieldType);
  const valid = v.label.trim() !== '' && (!wantsOptions || (v.options?.length ?? 0) > 0);

  return (
    <Dialog
      title={field ? `Edit "${field.label}"` : 'Add a question'}
      note={
        builtIn
          ? 'A built-in question: its answer goes into a record of its own, so its type cannot change and it cannot be removed. Everything else about it can.'
          : undefined
      }
      width={620}
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={() => {
            setBusy(true);
            onSave({
              ...v,
              labelTa: v.labelTa?.trim() || null,
              help: v.help?.trim() || null,
              options: wantsOptions ? v.options : null,
            });
            setBusy(false);
          }}
          disabled={busy || !valid}
          save={field ? 'Save' : 'Add question'}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='fb-label' label='Question'>
          <Input
            id='fb-label'
            value={v.label}
            onChange={(e) => setV({ ...v, label: e.target.value })}
          />
        </FormField>

        <FormField id='fb-label-ta' label='Tamil (Optional)'>
          <Input
            id='fb-label-ta'
            className='msrs-tamil'
            lang='ta'
            value={v.labelTa ?? ''}
            onChange={(e) => setV({ ...v, labelTa: e.target.value })}
          />
        </FormField>

        <FormField id='fb-help' label='Help Text (Optional)'>
          <Textarea
            id='fb-help'
            rows={2}
            value={v.help ?? ''}
            onChange={(e) => setV({ ...v, help: e.target.value })}
          />
        </FormField>

        <FormField
          id='fb-type'
          label='Answer Type'
          error={typeLocked ? 'Built in — its answer has a record of its own.' : undefined}
        >
          <Select
            id='fb-type'
            value={v.fieldType}
            disabled={typeLocked}
            onChange={(e) => setV({ ...v, fieldType: e.target.value })}
          >
            {/* A built-in may be `zone` or `appliances`, which nothing can
                author — so the current value is offered even when it is not in
                the authorable list, or the picker would silently show the
                wrong type for the field it is editing. */}
            {typeLocked && !AUTHORABLE_FIELD_TYPES.includes(v.fieldType as 'text') && (
              <option value={v.fieldType}>{v.fieldType}</option>
            )}
            {AUTHORABLE_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </FormField>

        {wantsOptions && (
          <FormField id='fb-options' label='Choices'>
            <Textarea
              id='fb-options'
              rows={4}
              value={(v.options ?? []).map((o) => o.label).join('\n')}
              onChange={(e) =>
                setV({
                  ...v,
                  // One per line. A choices editor with add/remove rows is more
                  // machinery than a list of words deserves, and a textarea is
                  // what somebody pasting from the printed form actually has.
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
              One per line, in the order they should appear.
            </div>
          </FormField>
        )}

        <FormField id='fb-section' label='Under Which Heading'>
          <Select
            id='fb-section'
            value={v.sectionId ?? ''}
            onChange={(e) => setV({ ...v, sectionId: e.target.value || null })}
          >
            <option value=''>No Heading</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.heading}
              </option>
            ))}
          </Select>
        </FormField>

        {/* biome-ignore lint/a11y/noLabelWithoutControl: the label WRAPS its control,
            which associates them implicitly; the rule cannot see the input inside
            <Checkbox>. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <Checkbox
            checked={v.isRequired}
            disabled={locked}
            onChange={(e) => setV({ ...v, isRequired: e.target.checked })}
          />
          Required — the form will not submit without an answer
        </label>

        {/* 🔴 One question cannot be switched off: the staff form's mobile
            number. It is half of the unique index behind "one person, one
            registration per stall", so without it somebody handed two coupon
            codes would appear twice and be counted twice at the gate. The API
            refuses the write too — a screen that only hides a control is a
            suggestion. */}
        {locked && (
          <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: -4 }}>
            This question identifies the person and cannot be switched off or made optional.
          </div>
        )}

        {/* biome-ignore lint/a11y/noLabelWithoutControl: as above */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <Checkbox
            checked={v.isActive}
            disabled={locked}
            onChange={(e) => setV({ ...v, isActive: e.target.checked })}
          />
          Asked — untick to take the question off the form without losing the answers already given
        </label>
      </div>
    </Dialog>
  );
}

function SectionDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (input: { heading: string; headingTa: string | null; help: string | null }) => void;
}) {
  const [heading, setHeading] = useState('');
  const [headingTa, setHeadingTa] = useState('');
  const [help, setHelp] = useState('');

  return (
    <Dialog
      title='Add a Heading'
      note='Questions are put under a heading by moving them beneath it. Removing a heading later leaves its questions on the form.'
      onClose={onClose}
      footer={
        <DialogButtons
          onClose={onClose}
          onSave={() =>
            onSave({
              heading: heading.trim(),
              headingTa: headingTa.trim() || null,
              help: help.trim() || null,
            })
          }
          disabled={heading.trim() === ''}
          save='Add heading'
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <FormField id='sec-heading' label='Heading'>
          <Input
            id='sec-heading'
            value={heading}
            placeholder='Electrical requirements'
            onChange={(e) => setHeading(e.target.value)}
          />
        </FormField>
        <FormField id='sec-heading-ta' label='Tamil (Optional)'>
          <Input
            id='sec-heading-ta'
            className='msrs-tamil'
            lang='ta'
            value={headingTa}
            onChange={(e) => setHeadingTa(e.target.value)}
          />
        </FormField>
        <FormField id='sec-help' label='Note Under the Heading (Optional)'>
          <Textarea id='sec-help' rows={2} value={help} onChange={(e) => setHelp(e.target.value)} />
        </FormField>
      </div>
    </Dialog>
  );
}
