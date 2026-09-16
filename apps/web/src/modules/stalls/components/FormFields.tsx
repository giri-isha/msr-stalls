import type { FormField, PublicConfig, StallRequestType } from '@msr/stalls';
import { zoneOptions } from '@msr/stalls';
import { useState } from 'react';
import { type ApplianceRow, ApplianceRows } from './ApplianceRows';
import { BilingualLabel } from './BilingualLabel';
import { ZoneSelect } from './ZoneSelect';
import {
  Checkbox,
  ChoicePlate,
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
}) {
  const id = f.name;
  const label = <BilingualLabel en={f.label} ta={f.labelTa} />;
  const help = f.help ? (
    <>
      {f.help}
      {f.helpTa && (
        <>
          {' / '}
          <span className='msrs-tamil' lang='ta'>
            {f.helpTa}
          </span>
        </>
      )}
    </>
  ) : undefined;
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
        // ⚠️ The choices are the edition's own bays, resolved here rather than
        // baked into the field, so a bay added for a redrawn layout appears on
        // the form without a code change. The vendor form drops the bays closed
        // to trade; the local welfare form keeps them, because those are the
        // ones a village trader is most likely to want.
        //
        // Local welfare is quoted a rent too — a lower one for the same ground,
        // not no rent at all. Only the ashram forms, which are billed
        // internally and never quoted, hide the figures.
        <ZoneSelect
          name={id}
          value={str(value)}
          onChange={onChange}
          options={zoneOptions(config?.zones ?? [], type === 'VENDOR')}
          zones={config?.zones ?? null}
          showRent={type === 'VENDOR' || type === 'LOCAL_WELFARE'}
          isFood={isFood ?? false}
          invalid={invalid}
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
        <Select {...common} value={str(value)} onChange={(e) => onChange(e.target.value)}>
          <option value=''>Choose…</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.labelTa ? ` / ${o.labelTa}` : ''}
            </option>
          ))}
        </Select>
      ) : f.type === 'textarea' ? (
        <Textarea {...common} value={str(value)} onChange={(e) => onChange(e.target.value)} />
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
