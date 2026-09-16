import {
  AUTHORABLE_FIELD_TYPES,
  type BuilderForm,
  type BuiltFormField,
  canCarryMedia,
  canDeleteField,
  checkRuleShape,
  type DateWindow,
  type FieldOption,
  type FieldRuleValues,
  type FieldType,
  fieldTypeChoices,
  isDisplayField,
  isLockedRequired,
  needsOptions,
  NO_RULES,
  renderForm,
  resolveWindow,
  ruleHintFor,
  ruleKnobsFor,
  rulesAfterRetype,
  ruleValuesOf,
  STALL_FORM_TYPES,
  type StallFormType,
  todayISO,
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
 * ⚠️ The one thing this screen cannot do is DELETE a built-in question, or
 * change what KIND of answer one posts, and that is a property of there being a
 * database underneath rather than a limit anybody chose: those answers land in
 * typed columns on `stall_request`. A built-in that should stop being asked is
 * switched off.
 *
 * 🔴 Its Answer Type is editable, and it did not used to be. The column under a
 * built-in cares what ARRIVES, not which control produced it — "Items Selling"
 * as a paragraph box, a dropdown or a radio list all post a string into a text
 * column — so the rule is the value SHAPE rather than a flat refusal. See
 * `fieldTypeChoices`, which fills the picker, and `canRetypeBuiltInTo`, which
 * is what the API refuses on.
 *
 * 🔴 And what a question ACCEPTS is here too: how long an answer may run, how
 * many digits a number has, which days a date question admits. Those limits
 * were hard-coded in the contract or not checked at all, so an appended "GST
 * Number" took four thousand characters and a plug count took `abc`. They are
 * rows now, enforced by one function on the requester's own page and again on
 * the server — `checkFieldValue`.
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
      note='What each request form asks, what it shows, and what it will accept as an answer. A question whose answer goes into a record of its own cannot be removed — switch it off instead — and can take any answer type that posts the same kind of answer. A display block asks nothing: give it the answer type "Display only" to put words or a picture, such as the venue layout, in the middle of the form.'
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
                // Every limit cleared, then the ones this dialog collected laid
                // over it. A new question starts unlimited — `NO_RULES` is the
                // same starting point `clearedRulesFor` resets a retyped field
                // to, so "no limit set" has one spelling.
                //
                // ⚠️ Spread whole rather than knob by knob. Listing `min` and
                // `max` by hand is how a date question's accepted window, or a
                // pattern, gets collected by the dialog and then dropped on the
                // way to the API — a save that looks like it worked.
                ...NO_RULES,
                ...ruleValuesOf({ ...NO_RULES, ...patch }),
                label: patch.label ?? '',
                labelTa: patch.labelTa ?? null,
                help: patch.help ?? null,
                fieldType: (patch.fieldType ?? 'text') as 'text',
                isRequired: patch.isRequired ?? false,
                sectionId: patch.sectionId ?? null,
                options: patch.options ?? null,
                mediaKey: patch.mediaKey ?? null,
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
  const limit = ruleHintFor(field);
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
        {/* What the block SAYS, shortened. Two display blocks in a row are told
            apart by their wording, not by their headings — "Please note" twice
            is a list nobody can read. */}
        {isDisplayField(field.type) && field.help && (
          <div
            style={{
              fontSize: 11.5,
              color: 'var(--mfg)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {field.help}
          </div>
        )}
        {field.labelTa && (
          <div className='msrs-tamil' lang='ta' style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
            {field.labelTa}
          </div>
        )}
        {/* ⚠️ What the question ACCEPTS, on the row rather than inside the
            dialog. "Which of these has a limit, and what is it" is the question
            somebody reviewing a form before an edition opens is actually
            asking, and answering it by opening thirty dialogs is how a wrong
            limit survives the review. */}
        {limit && <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{limit}</div>}
      </div>

      {/* ⚠️ "Display" rather than the raw type, and a second tag when it carries
          a picture. The list is read to answer "what does this form show, in
          what order" — a row that asks nothing should not have to be opened to
          find that out. */}
      <Tag size='sm'>{isDisplayField(field.type) ? 'Display' : field.type}</Tag>
      {field.mediaKey && (
        <Tag tone='info' size='sm'>
          Picture
        </Tag>
      )}
      {/* ⚠️ Said on the row, not discovered in the dialog. "Why can I not change
          the type of this one?" is a question the list should answer before it
          is asked. */}
      {field.isBuiltIn && (
        <Tag tone='info' size='sm'>
          Built In
        </Tag>
      )}
      {!field.isActive && (
        <Tag size='sm'>{isDisplayField(field.type) ? 'Hidden' : 'Not Asked'}</Tag>
      )}

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

/** What each answer type is called on this screen, and what picking it means.
 *
 *  ⚠️ The picker used to show the raw type names, which is readable enough
 *  while every entry IS an answer type. `display` is not one — it is the only
 *  choice here that asks nothing — and "display" alone beside "text" and
 *  "number" reads like another kind of box to type in.
 *
 *  🔴 The second line is what makes the picker choosable rather than
 *  guessable. The difference between "Choose one, from a list" and "Choose one,
 *  from buttons" is a dropdown against a stack of plates, which matters on a
 *  phone and is invisible from the name; the difference between a tick box and
 *  a yes/no list is whether "No" is an answer or an omission. */
const TYPE_NAME: Record<string, { name: string; note: string }> = {
  text: { name: 'Text', note: 'One line. Names, numbers written as words, short answers.' },
  textarea: { name: 'Paragraph', note: 'Several lines, for an answer that runs on.' },
  email: { name: 'Email address', note: 'Checked for an @ and a domain before it is sent.' },
  tel: { name: 'Phone number', note: 'Digits, spaces, brackets and +. Counted, not dialled.' },
  number: { name: 'Number', note: 'A count or an amount, with a numeric keypad on a phone.' },
  date: { name: 'Date', note: 'One day, picked from a calendar within the days you allow.' },
  select: { name: 'Choose one, from a list', note: 'A dropdown. Best past about six choices.' },
  radio: { name: 'Choose one, from buttons', note: 'Every choice on screen at once.' },
  checkbox: { name: 'Tick box', note: 'Ticked or not. An untick is an unanswered question.' },
  file: { name: 'A file', note: 'One PDF or photograph, uploaded as the answer.' },
  files: { name: 'Several files', note: 'Up to as many as you allow — a certificate per page.' },
  zone: {
    name: 'Preferred bay',
    note: "The edition's own bays, with their rents. Not authorable.",
  },
  appliances: {
    name: 'Appliance list',
    note: 'A repeating name-and-wattage editor. Not authorable.',
  },
  display: { name: 'Display only', note: 'Words and a picture, shown where it sits. No answer.' },
};

const typeName = (t: string) => TYPE_NAME[t]?.name ?? t;
const typeNote = (t: string) => TYPE_NAME[t]?.note ?? '';

interface FieldValues extends FieldRuleValues {
  label: string;
  labelTa: string | null;
  help: string | null;
  fieldType: string;
  isRequired: boolean;
  isActive: boolean;
  sectionId: string | null;
  options: FieldOption[] | null;
  mediaKey: string | null;
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
    ...(field ? ruleValuesOf(field) : NO_RULES),
    mediaKey: field?.mediaKey ?? null,
  });
  const [busy, setBusy] = useState(false);

  const builtIn = field?.isBuiltIn ?? false;
  /**
   * The types this field may be given, and why the list is the length it is.
   *
   * 🔴 A built-in's list is the types that post the SAME KIND of answer its
   * column already holds — `fieldTypeChoices` is the same rule the API refuses
   * the write with, so the picker offers exactly what would be accepted. It
   * used to be no list at all: a built-in's Answer Type was a disabled box, and
   * turning "Items Selling" into a paragraph question meant asking an engineer.
   */
  const choices = fieldTypeChoices(field ?? null);
  const shapeLimited = builtIn && choices.length < AUTHORABLE_FIELD_TYPES.length;
  const wantsOptions = needsOptions(v.fieldType);
  /** Whether this row SAYS something rather than asking it. */
  const says = isDisplayField(v.fieldType);
  /**
   * The limits as they will be STORED — a knob the type has no meaning for is
   * dropped here, on the way out, exactly as the API drops it.
   *
   * ⚠️ Not applied to `v` as the type changes. A coordinator flicking between
   * Text and Number to see what each offers would lose the cap they had typed,
   * and typing it again is the sort of thing that makes a screen feel like it
   * is fighting back. It is dropped on save, where it is real.
   */
  const rules = rulesAfterRetype(
    (field?.type ?? v.fieldType) as FieldType,
    v.fieldType as FieldType,
    ruleValuesOf(v),
  );
  /** What is wrong with the LIMITS, in the words the API would refuse with. */
  const ruleProblem = checkRuleShape(v.fieldType as FieldType, rules);
  const valid =
    v.label.trim() !== '' &&
    (!wantsOptions || (v.options?.length ?? 0) > 0) &&
    ruleProblem === null;

  return (
    <Dialog
      title={field ? `Edit "${field.label}"` : says ? 'Add something to show' : 'Add a question'}
      note={
        builtIn
          ? 'A built-in question: its answer goes into a record of its own, so it cannot be removed and cannot change what KIND of answer it posts. Its wording, its answer type within that kind, and what it accepts are all yours.'
          : says
            ? 'A display block asks nothing. It shows a heading, some words and — if you add one — a picture, where it sits in the form.'
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
              ...rules,
              labelTa: v.labelTa?.trim() || null,
              help: v.help?.trim() || null,
              options: wantsOptions ? v.options : null,
              // ⚠️ Cleared when the row is not a display block, so a picture
              // added and then retyped away does not travel with the save. The
              // API clears it too — this is only so the screen and the row
              // agree about what was just sent.
              mediaKey: says ? v.mediaKey : null,
            });
            setBusy(false);
          }}
          disabled={busy || !valid}
          save={field ? 'Save' : says ? 'Add block' : 'Add question'}
        />
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {/* ⚠️ Required on a display block too, and it earns it: the heading is
            what the builder's own list calls the row, and it is the picture's
            description for anybody using a screen reader. */}
        <FormField id='fb-label' label={says ? 'Heading' : 'Question'}>
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

        <FormField id='fb-help' label={says ? 'Words Shown (Optional)' : 'Help Text (Optional)'}>
          <Textarea
            id='fb-help'
            rows={2}
            value={v.help ?? ''}
            onChange={(e) => setV({ ...v, help: e.target.value })}
          />
        </FormField>

        <TypePicker
          value={v.fieldType}
          choices={choices}
          onChange={(fieldType) => setV({ ...v, fieldType })}
          note={
            shapeLimited
              ? `A built-in question: its answer goes into a column of its own, so it can ` +
                `take any type that posts the same kind of answer — and not one that ` +
                `posts a different kind.`
              : null
          }
        />

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

        {/* 🔴 What the question ACCEPTS, beside what it asks. A form that takes
            any answer and then refuses it — at the API, in a message naming a
            body key — is the problem this ends; every limit set here is checked
            on the reader's own page before the round-trip and again on the
            server, by one function. See `checkFieldValue`. */}
        <RulesEditor
          type={v.fieldType}
          values={v}
          onChange={(patch) => setV({ ...v, ...patch })}
          problem={ruleProblem}
        />

        {/* Only a display block carries a picture. A `file` question's picture
            is the READER's answer and lives on their record, which is why the
            picker is here and not on every type — `canCarryMedia` is the same
            rule the API refuses the write with. */}
        {canCarryMedia(v.fieldType) && (
          <PicturePicker mediaKey={v.mediaKey} onChange={(mediaKey) => setV({ ...v, mediaKey })} />
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

        {/* 🔴 No Required tick on a display block. There is nothing to answer,
            so a required one would refuse every submission with an error
            pointing at a paragraph of text — the API forces it false whatever
            arrives, and drawing a tick that is overruled is worse than drawing
            none. */}
        {!says && (
          /* biome-ignore lint/a11y/noLabelWithoutControl: the label WRAPS its control,
             which associates them implicitly; the rule cannot see the input inside
             <Checkbox>. */
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Checkbox
              checked={v.isRequired}
              disabled={locked}
              onChange={(e) => setV({ ...v, isRequired: e.target.checked })}
            />
            Required — the form will not submit without an answer
          </label>
        )}

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
          {says
            ? 'Shown — untick to take the block off the form without deleting it'
            : 'Asked — untick to take the question off the form without losing the answers already given'}
        </label>
      </div>
    </Dialog>
  );
}

/**
 * The picture inside a display block.
 *
 * ⚠️ Uploaded on SELECTION, straight at the store, and the field then holds a
 * key. The bytes never pass through the API — a 5 MB venue map in a JSON body
 * is base64 in a request log — which is the same shape the public forms' file
 * questions use.
 *
 * ⚠️ The preview is drawn through `/public/form-image`, which is the route the
 * requester's browser will use. A preview that read the store some other way
 * would be a preview that works while the real thing is broken.
 */
function PicturePicker({
  mediaKey,
  onChange,
}: {
  mediaKey: string | null;
  onChange: (key: string | null) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <FormField id='fb-picture' label='Picture (Optional)'>
      <div style={{ display: 'grid', gap: 9 }}>
        {mediaKey && (
          <img
            src={api.formImageUrl(mediaKey)}
            alt='What this block shows on the form'
            style={{
              display: 'block',
              maxWidth: '100%',
              maxHeight: 220,
              width: 'auto',
              borderRadius: 'var(--r2)',
              border: '1px solid var(--line)',
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 13px',
              border: '1px dashed var(--bd)',
              borderRadius: 'var(--r2)',
              cursor: busy ? 'progress' : 'pointer',
              fontSize: 13,
              color: 'var(--mfg)',
            }}
          >
            <input
              id='fb-picture'
              type='file'
              accept='image/*'
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  const up = await api.uploadFile(api.presignBackofficeUpload, file, 'FORM_NOTE');
                  onChange(up.key);
                } catch (err) {
                  toast.fail(err);
                } finally {
                  setBusy(false);
                  e.target.value = '';
                }
              }}
            />
            <Icon name='plus' size={14} />
            {busy ? 'Uploading…' : mediaKey ? 'Replace the picture' : 'Choose a picture'}
          </label>
          {mediaKey && (
            <button
              type='button'
              onClick={() => onChange(null)}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--mfg)',
                fontSize: 12.5,
              }}
            >
              Remove
            </button>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          {/* A PDF cannot be drawn in an image, and the presign refuses one —
              said here so it is read before the refusal rather than after. */}
          A photograph or a drawing — the venue layout, a plan, a sample. Images only, up to 20 MB.
        </div>
      </div>
    </FormField>
  );
}

/**
 * The Answer Type, as plates rather than as a dropdown.
 *
 * 🔴 It was a `<select>`, and a `<select>` cannot say what a choice MEANS. The
 * difference between "Choose one, from a list" and "Choose one, from buttons"
 * is a dropdown against a stack of plates — invisible from the name, and the
 * decision that matters most on a phone. The volunteering module's Field Rules
 * screen draws its date modes the same way, for the same reason: the note
 * belongs beside the choice, not in documentation nobody opens.
 *
 * ⚠️ Only the types this field may actually take are drawn. A built-in gets the
 * ones that post the same kind of answer its column holds; nothing greyed out,
 * because a disabled row invites the question "why?" and the note above the
 * list has already answered it.
 */
function TypePicker({
  value,
  choices,
  onChange,
  note,
}: {
  value: string;
  choices: readonly string[];
  onChange: (t: string) => void;
  /** Why this list is shorter than the full one. Null when it is not. */
  note: string | null;
}) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Answer Type</div>
      {note && (
        <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginBottom: 8, lineHeight: 1.55 }}>
          {note}
        </div>
      )}
      <div
        style={{
          display: 'grid',
          // Two across where there is room, one on a phone. Eleven choices in a
          // single column is a dialog nobody can see the bottom of.
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 7,
        }}
        role='radiogroup'
        aria-label='Answer Type'
      >
        {choices.map((t) => {
          const on = value === t;
          return (
            // ⚠️ A real radio inside its label, not a button wearing
            // `role='radio'`. The plates are what a coordinator presses, but
            // arrow-key movement between the choices and what a screen reader
            // announces both come free from the input and from nothing else.
            <label
              key={t}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '9px 11px',
                borderRadius: 'var(--r2)',
                border: `1px solid ${on ? 'var(--pri)' : 'var(--line)'}`,
                background: on ? 'var(--pri-t)' : 'var(--bg)',
                cursor: 'pointer',
              }}
            >
              <input
                type='radio'
                name='fb-type'
                value={t}
                checked={on}
                onChange={() => onChange(t)}
                style={{ marginTop: 2, flex: 'none' }}
              />
              <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 600 }}>{typeName(t)}</span>
                <span style={{ fontSize: 11, color: 'var(--mfg)', lineHeight: 1.45 }}>
                  {typeNote(t)}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What the question accepts, beyond its type.
 *
 * 🔴 Drawn from `ruleKnobsFor`, which is the same function the API clears
 * against. A screen that offered a length limit on a number would be offering a
 * control whose value the write silently drops — which reads, next time the
 * dialog is opened, as a save that did not work.
 *
 * ⚠️ `min` and `max` are ONE pair of columns read three ways, so the labels
 * change with the type: the value of a number, the digit count of a phone
 * number, how many files may be uploaded. The words are the whole of what makes
 * that legible.
 */
function RulesEditor({
  type,
  values,
  onChange,
  problem,
}: {
  type: string;
  values: FieldRuleValues;
  onChange: (patch: Partial<FieldRuleValues>) => void;
  /** What is wrong with the limits as they stand, in the API's own words. */
  problem: string | null;
}) {
  const knobs = ruleKnobsFor(type as FieldType);
  if (knobs.length === 0) return null;
  const has = (k: (typeof knobs)[number]) => knobs.includes(k);
  const set = (patch: Partial<FieldRuleValues>) => onChange(patch);

  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--r2)',
        padding: '12px 14px',
        background: 'var(--rail)',
        display: 'grid',
        gap: 10,
      }}
    >
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>What This Answer May Be</div>
        <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 2, lineHeight: 1.55 }}>
          Checked on the requester's own page before they submit, and again here. Leave a box empty
          to set no limit.
        </div>
      </div>

      {has('bounds') && (
        <NumberPair
          idPrefix='fb-bounds'
          loLabel='Smallest Allowed'
          hiLabel='Largest Allowed'
          lo={values.min}
          hi={values.max}
          onLo={(min) => set({ min })}
          onHi={(max) => set({ max })}
        />
      )}
      {has('digits') && (
        <NumberPair
          idPrefix='fb-digits'
          loLabel='Fewest Digits'
          hiLabel='Most Digits'
          note='Left empty, a phone number is accepted at 8 to 15 digits — an overseas number is longer than an Indian one and a landline is shorter.'
          lo={values.min}
          hi={values.max}
          onLo={(min) => set({ min })}
          onHi={(max) => set({ max })}
        />
      )}
      {has('count') && (
        <NumberPair
          idPrefix='fb-count'
          loLabel='Fewest Files'
          hiLabel='Most Files'
          lo={values.min}
          hi={values.max}
          onLo={(min) => set({ min })}
          onHi={(max) => set({ max })}
        />
      )}
      {has('length') && (
        <NumberPair
          idPrefix='fb-length'
          loLabel='Shortest Answer'
          hiLabel='Longest Answer'
          note='In characters. Somebody over the limit is told by how much rather than stopped mid-word.'
          lo={values.minLen}
          hi={values.maxLen}
          onLo={(minLen) => set({ minLen })}
          onHi={(maxLen) => set({ maxLen })}
        />
      )}
      {has('decimals') && (
        <FormField id='fb-decimals' label='Decimal Places'>
          <Input
            id='fb-decimals'
            inputMode='numeric'
            style={{ maxWidth: 120 }}
            value={values.decimals === null ? '' : String(values.decimals)}
            onChange={(e) => set({ decimals: intOrNull(e.target.value) })}
          />
          <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 5 }}>
            Empty or 0 means a whole number. A built-in question answers into a whole-number column
            and cannot take decimals.
          </div>
        </FormField>
      )}
      {has('pattern') && (
        <div style={{ display: 'grid', gap: 8 }}>
          <FormField id='fb-pattern' label='Must Match (Optional)'>
            <Input
              id='fb-pattern'
              value={values.pattern ?? ''}
              placeholder='^[0-9]{6}$'
              onChange={(e) => set({ pattern: e.target.value.trim() || null })}
            />
          </FormField>
          {values.pattern && (
            <FormField id='fb-pattern-hint' label='Say What That Means'>
              <Input
                id='fb-pattern-hint'
                value={values.patternHint ?? ''}
                placeholder='six digits'
                onChange={(e) => set({ patternHint: e.target.value || null })}
              />
              {/* 🔴 Required alongside a pattern, and the API refuses without
                  it. The message quotes these words — "Pincode must be six
                  digits" — and the alternative is "Pincode is not in the
                  expected format", which tells somebody to guess. */}
              <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 5 }}>
                The message reads "{`${'…'} must be ${values.patternHint || 'six digits'}`}".
              </div>
            </FormField>
          )}
        </div>
      )}
      {has('window') && (
        <WindowEditor window={values.window} onChange={(window) => set({ window })} />
      )}

      {problem && (
        <div style={{ fontSize: 12, color: 'var(--des)', lineHeight: 1.5 }} role='alert'>
          {problem}
        </div>
      )}
    </div>
  );
}

/** Empty is NO LIMIT, which is not the same as zero — a maximum of 0 is a
 *  question whose only valid answer is nothing. */
const intOrNull = (raw: string): number | null => {
  const s = raw.trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

function NumberPair({
  idPrefix,
  loLabel,
  hiLabel,
  note,
  lo,
  hi,
  onLo,
  onHi,
}: {
  idPrefix: string;
  loLabel: string;
  hiLabel: string;
  note?: string;
  lo: number | null;
  hi: number | null;
  onLo: (v: number | null) => void;
  onHi: (v: number | null) => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <FormField id={`${idPrefix}-lo`} label={loLabel}>
          <Input
            id={`${idPrefix}-lo`}
            inputMode='numeric'
            style={{ maxWidth: 140 }}
            value={lo === null ? '' : String(lo)}
            onChange={(e) => onLo(intOrNull(e.target.value))}
          />
        </FormField>
        <FormField id={`${idPrefix}-hi`} label={hiLabel}>
          <Input
            id={`${idPrefix}-hi`}
            inputMode='numeric'
            style={{ maxWidth: 140 }}
            value={hi === null ? '' : String(hi)}
            onChange={(e) => onHi(intOrNull(e.target.value))}
          />
        </FormField>
      </div>
      {note && (
        <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 5, lineHeight: 1.5 }}>
          {note}
        </div>
      )}
    </div>
  );
}

/**
 * The days a date question accepts: pinned, or rolling with today.
 *
 * 🔴 The resolved line is computed here as it is typed, because the whole point
 * of the choice is which days it admits — "30 days ahead" tells nobody that.
 * Lifted from the volunteering module's own window editor, minus its third mode:
 * that one follows the active edition's start and end dates, and a stalls
 * edition has a year and a name and no dates at all.
 */
function WindowEditor({
  window: w,
  onChange,
}: {
  window: DateWindow | null;
  onChange: (w: DateWindow | null) => void;
}) {
  const today = todayISO();
  const mode = w?.mode ?? 'any';
  const fixed = w?.mode === 'fixed' ? w : { mode: 'fixed' as const };
  const rolling = w?.mode === 'rolling' ? w : { mode: 'rolling' as const };

  let resolves: string;
  if (w === null) resolves = 'Any date.';
  else {
    const r = resolveWindow(w, today);
    resolves =
      !r.min && !r.max ? 'Any date — nothing is set.' : `${r.min ?? 'any'} … ${r.max ?? 'any'}`;
  }

  const modes: Array<{ key: string; label: string; note: string }> = [
    { key: 'any', label: 'Any Date', note: 'No window. Past and future both accepted.' },
    { key: 'fixed', label: 'Between Two Dates', note: 'Pinned days, the same all year.' },
    {
      key: 'rolling',
      label: 'Relative To Today',
      note: 'A window that moves with the day the form is filled in.',
    },
  ];

  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 7 }}>Accepted Dates</div>
      <div style={{ display: 'grid', gap: 7 }}>
        {modes.map((m) => (
          <label
            key={m.key}
            style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type='radio'
              name='fb-date-mode'
              checked={mode === m.key}
              onChange={() =>
                onChange(m.key === 'any' ? null : m.key === 'fixed' ? fixed : rolling)
              }
              style={{ marginTop: 3 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: mode === m.key ? 700 : 500 }}>
                {m.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mfg)' }}>{m.note}</div>

              {m.key === 'fixed' && mode === 'fixed' && (
                <div style={{ display: 'flex', gap: 10, marginTop: 7, flexWrap: 'wrap' }}>
                  <FormField id='fb-date-min' label='Earliest'>
                    <Input
                      id='fb-date-min'
                      type='date'
                      style={{ maxWidth: 180 }}
                      value={fixed.min ?? ''}
                      onChange={(e) => onChange({ ...fixed, min: e.target.value || undefined })}
                    />
                  </FormField>
                  <FormField id='fb-date-max' label='Latest'>
                    <Input
                      id='fb-date-max'
                      type='date'
                      style={{ maxWidth: 180 }}
                      value={fixed.max ?? ''}
                      onChange={(e) => onChange({ ...fixed, max: e.target.value || undefined })}
                    />
                  </FormField>
                </div>
              )}

              {m.key === 'rolling' && mode === 'rolling' && (
                <div style={{ display: 'flex', gap: 10, marginTop: 7, flexWrap: 'wrap' }}>
                  <FormField id='fb-date-from' label='Days From Today'>
                    <Input
                      id='fb-date-from'
                      inputMode='numeric'
                      style={{ maxWidth: 140 }}
                      placeholder='0'
                      value={rolling.minDays === undefined ? '' : String(rolling.minDays)}
                      onChange={(e) =>
                        onChange({ ...rolling, minDays: intOrNull(e.target.value) ?? undefined })
                      }
                    />
                  </FormField>
                  <FormField id='fb-date-to' label='Days Until'>
                    <Input
                      id='fb-date-to'
                      inputMode='numeric'
                      style={{ maxWidth: 140 }}
                      placeholder='90'
                      value={rolling.maxDays === undefined ? '' : String(rolling.maxDays)}
                      onChange={(e) =>
                        onChange({ ...rolling, maxDays: intOrNull(e.target.value) ?? undefined })
                      }
                    />
                  </FormField>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--mfg)',
                      alignSelf: 'center',
                      lineHeight: 1.5,
                    }}
                  >
                    Negative reaches into the past — −7 to 0 is "sometime in the last week".
                  </div>
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 9 }}>
        Accepts <strong style={{ color: 'var(--fg)' }}>{resolves}</strong>
        {w?.mode === 'rolling' && ` · as of today, ${today}`}
      </div>
    </div>
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
