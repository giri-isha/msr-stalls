import type { FieldRuleValues, FormField, PublicConfig, StallRequestType } from '@stalls/core';
import { resolveWindow, ruleHintFor, ruleKindOf, todayISO, zoneChoices } from '@stalls/core';
import { formImageUrl } from '../api';
import { useState } from 'react';
import { type ApplianceRow, ApplianceRows } from './ApplianceRows';
import { BilingualLabel } from './BilingualLabel';
import { ZoneSelect } from './ZoneSelect';
import {
  Checkbox,
  ChoicePlate,
  DateField,
  FieldError,
  FormField as Labelled,
  Icon,
  Input,
  Radio,
  Select,
  Textarea,
} from '../ui';

/**
 * One question, drawn.
 *
 * 🔴 Shared by all four public forms. It lived inside `RequestForm` while the
 * request forms were the only ones built from rows; the bank, FSSAI and staff
 * forms are rows now too, and four copies of "what does a required checkbox
 * look like" is four places for them to drift apart.
 *
 * ⚠️ `config`, `type` and `isFood` are only consulted by the `zone` branch,
 * which is why they are optional. A form with no zone question passes none of
 * them.
 */

export type FieldValue = string | boolean | ApplianceRow[] | string[] | undefined;

const str = (v: FieldValue): string => (typeof v === 'string' ? v : '');

/**
 * The field's limits, as the checker spells them.
 *
 * ⚠️ `FormField` says `undefined` for "no limit" and `FieldRuleValues` says
 * `null`, because one is a constant somebody types by hand and the other is a
 * column. One conversion, here, rather than eight `?? null`s scattered through
 * the branches below.
 */
const ruleValues = (f: FormField): FieldRuleValues => ({
  min: f.min ?? null,
  max: f.max ?? null,
  minLen: f.minLen ?? null,
  maxLen: f.maxLen ?? null,
  decimals: f.decimals ?? null,
  pattern: f.pattern ?? null,
  patternHint: f.patternHint ?? null,
  window: f.window ?? null,
});

/** ⚠️ Both `appliances` and `files` answer with an array, so `Array.isArray`
 *  alone cannot tell them apart — and handing a list of upload keys to the
 *  appliance editor would render a row per key with no name and no wattage. */
const isApplianceRows = (v: FieldValue): v is ApplianceRow[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && 'watts' in x);

export function FieldControl({
  field: f,
  value,
  error,
  onChange,
  config,
  type,
  isFood,
  onPickFile,
  fieldId,
  today = todayISO(),
}: {
  field: FormField;
  value: FieldValue;
  error?: string;
  onChange: (v: FieldValue) => void;
  config?: PublicConfig | null;
  type?: StallRequestType;
  isFood?: boolean;
  /** Uploads one file and yields its media-store key. Required for `file` and
   *  `files` questions and unused by every other type. */
  onPickFile?: (file: File, fieldId?: string) => Promise<{ key: string; name: string }>;
  /** The field's row id, for an admin-added file question — it scopes the
   *  upload key so the answer belongs to this question alone. */
  fieldId?: string;
  /** Today, as a calendar day, for a date question whose window rolls with it.
   *  Defaults to the browser's own day; passed in only by tests. */
  today?: string;
}) {
  const id = f.name;
  const label = <BilingualLabel en={f.label} ta={f.labelTa} />;
  /**
   * What the question accepts, said before it is typed into rather than after.
   *
   * 🔴 The same row the API enforces against — `ruleHintFor` reads the field's
   * own limits, so a question capped at 6 characters says so, and a form
   * refused for a limit the page never mentioned stops happening. It sits under
   * the help text; a field with neither shows neither.
   */
  const limit = ruleHintFor(
    { label: f.label, type: f.type, required: f.required, ...ruleValues(f) },
    today,
  );
  const written = f.help ? (
    <>
      {f.help}
      {f.helpTa && (
        <>
          {' / '}
          <span className='stalls-tamil' lang='ta'>
            {f.helpTa}
          </span>
        </>
      )}
    </>
  ) : undefined;
  const help =
    written || limit ? (
      <>
        {written}
        {written && limit && <br />}
        {limit && <span style={{ color: 'var(--mfg)' }}>{limit}</span>}
      </>
    ) : undefined;
  // 🔴 Not a question, and it leaves before anything that deals in answers. A
  // display block has no control, no value and no error — it is the venue
  // layout above the location question, or the note about what counts as a
  // food stall — so wrapping it in `Labelled` would draw a label, a required
  // star and an empty control well for something nobody types into.
  if (f.type === 'display') return <DisplayBlock field={f} />;

  const invalid = error ? true : undefined;
  const common = {
    id,
    invalid,
    'aria-invalid': invalid,
    'aria-describedby': error ? `${id}-error` : f.help ? `${id}-help` : undefined,
  };

  if (f.type === 'checkbox') {
    // ⚠️ The consent question is a PLATE, not a bare tick and a line of text.
    // It is the control that gates submission, and on a phone a 16px box beside
    // a two-line paragraph is the smallest target on the longest screen.
    const on = value === true;
    return (
      <div>
        {f.help && (
          <div
            id={`${id}-help`}
            style={{ fontSize: 12.5, color: 'var(--mfg)', marginBottom: 8, lineHeight: 1.6 }}
          >
            {help}
          </div>
        )}
        <ChoicePlate htmlFor={id} selected={on}>
          <Checkbox
            {...common}
            checked={on}
            onChange={(e) => onChange(e.target.checked)}
            style={{ marginTop: 1 }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            {label}
            {f.required && (
              <span aria-hidden style={{ marginLeft: 3, color: 'var(--des-fg)' }}>
                *
              </span>
            )}
          </span>
        </ChoicePlate>
        <FieldError of={error} id={`${id}-error`} />
      </div>
    );
  }

  return (
    <Labelled id={id} label={label} help={help} error={error} required={f.required}>
      {f.type === 'file' || f.type === 'files' ? (
        <FilePicker
          id={id}
          multiple={f.type === 'files'}
          max={f.type === 'files' ? (f.max ?? 5) : 1}
          value={
            Array.isArray(value) && !isApplianceRows(value)
              ? (value as string[])
              : str(value)
                ? [str(value)]
                : []
          }
          onChange={(keys) => onChange(f.type === 'files' ? keys : (keys[0] ?? ''))}
          onPickFile={onPickFile}
          fieldId={fieldId}
          invalid={invalid}
        />
      ) : f.type === 'appliances' ? (
        <ApplianceRows
          id={id}
          value={isApplianceRows(value) ? value : []}
          onChange={onChange}
          max={f.max}
        />
      ) : f.type === 'zone' ? (
        // ⚠️ The choices are the edition's own bays unless the edition has
        // AUTHORED a list on the question — see `zoneChoices`. Resolved here
        // rather than baked into the field, so a bay added for a redrawn layout
        // appears on the form without a code change. The vendor form drops the
        // bays closed to trade; the local welfare form keeps them, because
        // those are the ones a village trader is most likely to want.
        //
        // ⚠️ `zones` is passed WHATEVER the list is: a bay the asking scope has
        // no rate for is dropped from the dropdown, and that is decided by
        // looking each choice's value up as a bay code.
        //
        // Local welfare is quoted a rent too — a lower one for the same ground,
        // not no rent at all. Only the ashram forms, which are billed
        // internally and never quoted, are offered every bay.
        <ZoneSelect
          id={id}
          value={str(value)}
          onChange={onChange}
          options={zoneChoices(f.options, config?.zones ?? [], type === 'VENDOR')}
          zones={config?.zones ?? null}
          showRent={type === 'VENDOR' || type === 'LOCAL_WELFARE'}
          isFood={isFood ?? false}
          invalid={invalid}
          describedBy={common['aria-describedby']}
        />
      ) : f.type === 'radio' && f.options ? (
        <div style={{ display: 'grid', gap: 8 }} role='radiogroup'>
          {f.options.map((o) => (
            <ChoicePlate key={o.value} htmlFor={`${id}-${o.value}`} selected={value === o.value}>
              <Radio
                id={`${id}-${o.value}`}
                name={id}
                value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                style={{ marginTop: 2 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <BilingualLabel en={o.label} ta={o.labelTa} />
              </span>
            </ChoicePlate>
          ))}
        </div>
      ) : f.type === 'select' && f.options ? (
        <Select {...common} value={str(value)} onChange={(v) => onChange(v)}>
          <option value=''>Choose…</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.labelTa ? ` / ${o.labelTa}` : ''}
            </option>
          ))}
        </Select>
      ) : f.type === 'date' ? (
        // ⚠️ The app's own picker, bounded by the question's OWN window, so a
        // day the form would refuse cannot be picked in the first place. The
        // window is resolved here because a rolling one — "up to 30 days from
        // today" — is a pair of real dates only once today is known.
        <DateField
          value={str(value)}
          title={f.label}
          onChange={(v) => onChange(v)}
          minDate={dateBounds(f, today).min ?? null}
          maxDate={dateBounds(f, today).max ?? null}
        />
      ) : f.type === 'textarea' ? (
        <Textarea
          {...common}
          {...lengthAttrs(f)}
          value={str(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : f.type === 'number' ? (
        <Input
          {...common}
          type='number'
          inputMode='numeric'
          min={f.min}
          max={f.max}
          value={str(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          {...common}
          {...lengthAttrs(f)}
          type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
          inputMode={f.type === 'tel' ? 'tel' : undefined}
          autoComplete={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : undefined}
          value={str(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Labelled>
  );
}

/**
 * What a form SAYS, as opposed to what it asks.
 *
 * 🔴 The picture is the case this exists for: the venue layout, drawn where
 * the reader is about to be asked which bay they want. It used to be a link in
 * an email, or a paragraph nobody could change without a redeploy.
 *
 * ⚠️ The heading doubles as the picture's `alt`. A form that draws a layout
 * with no description is a form a screen reader reads as "image", and the
 * builder asks for a heading on every block for exactly this reason.
 *
 * ⚠️ The image LINKS to itself. A venue map legible on a laptop is unreadable
 * at 360px, and opening it full size is the only zoom a plain `<img>` has.
 */
function DisplayBlock({ field: f }: { field: FormField }) {
  const src = f.mediaKey ? formImageUrl(f.mediaKey) : null;
  return (
    <div
      style={{
        display: 'grid',
        gap: 9,
        padding: '13px 14px',
        background: 'var(--rail)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r2)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700 }}>
        <BilingualLabel en={f.label} ta={f.labelTa} />
      </div>
      {f.help && (
        <div style={{ fontSize: 12.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
          {f.help}
          {f.helpTa && (
            <>
              {' / '}
              <span className='stalls-tamil' lang='ta'>
                {f.helpTa}
              </span>
            </>
          )}
        </div>
      )}
      {src && (
        <a href={src} target='_blank' rel='noreferrer' style={{ display: 'block' }}>
          <img
            src={src}
            alt={f.label}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              borderRadius: 'var(--r2)',
              border: '1px solid var(--line)',
              background: 'var(--bg)',
            }}
          />
        </a>
      )}
    </div>
  );
}

/** The days a date question admits, with a rolling window resolved against the
 *  day it is being filled in on. */
function dateBounds(f: FormField, today: string): { min?: string; max?: string } {
  return f.window ? resolveWindow(f.window, today) : {};
}

/**
 * The browser's own length cap, and only well past the limit.
 *
 * ⚠️ `maxLen * 2` rather than `maxLen`, which is what the volunteering module
 * settled on for the same reason: a hard cap at the limit stops typing mid-word
 * with no explanation, while the counted message — "must be 200 characters or
 * fewer (currently 214)" — tells somebody by how much they are over. The double
 * is there to stop a pasted document, not a sentence.
 */
function lengthAttrs(f: FormField): { maxLength?: number } {
  if (ruleKindOf(f.type) !== 'text' && ruleKindOf(f.type) !== 'email') return {};
  return f.maxLen === undefined ? {} : { maxLength: f.maxLen * 2 };
}

/**
 * The control behind a `file` or `files` question.
 *
 * ⚠️ Presigns and uploads on SELECTION, then keeps the key. The form posts keys
 * and never bytes, which is why a slow upload does not block the rest of the
 * page and why a re-submitted form does not re-send a file already stored.
 *
 * 🔴 `fieldId` goes to the presign for an admin-added question. The id is part
 * of the key's path, so the answer to "GST certificate" can never be a file
 * uploaded for "PAN card" — see `isOurKey`.
 */
function FilePicker({
  id,
  multiple,
  max,
  value,
  onChange,
  onPickFile,
  fieldId,
  invalid,
}: {
  id: string;
  multiple: boolean;
  max: number;
  value: string[];
  onChange: (keys: string[]) => void;
  onPickFile?: (file: File, fieldId?: string) => Promise<{ key: string; name: string }>;
  fieldId?: string;
  invalid?: true;
}) {
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const full = value.length >= max;

  return (
    <div style={{ display: 'grid', gap: 7 }}>
      {value.map((key) => (
        <div
          key={key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            color: 'var(--ok-fg)',
          }}
        >
          <Icon name='check' size={14} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {names[key] ?? 'Uploaded'}
          </span>
          <button
            type='button'
            onClick={() => onChange(value.filter((k) => k !== key))}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--mfg)',
              fontSize: 12,
            }}
          >
            Remove
          </button>
        </div>
      ))}

      {!full && onPickFile && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            border: `1px dashed ${invalid ? 'var(--des-fg)' : 'var(--bd)'}`,
            borderRadius: 'var(--r2)',
            cursor: busy ? 'progress' : 'pointer',
            fontSize: 13,
            color: 'var(--mfg)',
          }}
        >
          <input
            id={value.length === 0 ? id : undefined}
            type='file'
            accept='application/pdf,image/*'
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              try {
                const up = await onPickFile(file, fieldId);
                setNames((was) => ({ ...was, [up.key]: up.name }));
                onChange([...value, up.key]);
              } finally {
                setBusy(false);
                e.target.value = '';
              }
            }}
          />
          <Icon name='plus' size={14} />
          {busy
            ? 'Uploading…'
            : multiple
              ? `Add a file (PDF or photo, up to ${max})`
              : 'Choose a file (PDF or photo, up to 20 MB)'}
        </label>
      )}
    </div>
  );
}
