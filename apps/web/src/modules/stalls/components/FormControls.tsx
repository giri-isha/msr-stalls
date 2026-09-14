import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { inputStyle } from '../ui/components/Dialog';
import { BilingualLabel } from './BilingualLabel';

/** Form controls in the volunteering module's idiom — `inputStyle` from its
 *  Dialog, the small uppercase label, the ⚠ error line — with the two things
 *  this module's public forms add: a Tamil label beside the English one, and
 *  a help sentence that may also be bilingual. */

export { inputStyle };

export const errorInput: CSSProperties = {
  ...inputStyle,
  borderColor: 'var(--des-b)',
  background: 'var(--des-t)',
};

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '.7px',
        textTransform: 'uppercase',
        color: 'var(--mfg)',
        margin: '18px 0 10px',
        paddingBottom: 6,
        borderBottom: '1px solid var(--line)',
      }}
    >
      {children}
    </div>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role='alert'
      style={{ display: 'flex', gap: 5, alignItems: 'flex-start', fontSize: 11.5, color: 'var(--des)', marginTop: 5, lineHeight: 1.5 }}
    >
      <span aria-hidden style={{ flex: 'none', fontWeight: 700 }}>
        ⚠
      </span>
      <span>{children}</span>
    </div>
  );
}

export function HelpLine({ en, ta }: { en?: ReactNode; ta?: string | null }) {
  if (!en && !ta) return null;
  return (
    <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 4, lineHeight: 1.5 }}>
      {en}
      {ta && (
        <>
          {en ? ' / ' : ''}
          <span className='msrs-ta' lang='ta'>
            {ta}
          </span>
        </>
      )}
    </div>
  );
}

/** A labelled control. The label is a real `<label for>` so Testing Library,
 *  screen readers and a tap on the label all reach the control. */
export function Field({
  id,
  label,
  labelTa = null,
  help,
  helpTa,
  error,
  required,
  children,
  style,
}: {
  id: string;
  label: ReactNode;
  labelTa?: string | null;
  help?: ReactNode;
  helpTa?: string | null;
  error?: string;
  required?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ marginBottom: 14, ...style }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--fg)',
          marginBottom: 6,
          lineHeight: 1.4,
        }}
      >
        {typeof label === 'string' ? <BilingualLabel en={label} ta={labelTa} /> : label}
        {required && (
          <span aria-hidden style={{ color: 'var(--des)', marginLeft: 4 }}>
            *
          </span>
        )}
      </label>
      {(help || helpTa) && <div style={{ marginBottom: 6 }}><HelpLine en={help} ta={helpTa} /></div>}
      {children}
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}

type Invalid = { invalid?: boolean };

export function TextInput({ invalid, style, ...props }: InputHTMLAttributes<HTMLInputElement> & Invalid) {
  return <input {...props} aria-invalid={invalid || undefined} style={{ ...(invalid ? errorInput : inputStyle), ...style }} />;
}

/** A numeric keypad on a text input, not `type="number"`: the spinner swallows
 *  arrow keys, rounds pastes, and on iOS reports "" for anything it dislikes. */
export function NumberInput({ invalid, style, ...props }: InputHTMLAttributes<HTMLInputElement> & Invalid) {
  return (
    <input
      {...props}
      inputMode='numeric'
      aria-invalid={invalid || undefined}
      style={{ ...(invalid ? errorInput : inputStyle), ...style }}
    />
  );
}

export function TextArea({ invalid, style, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & Invalid) {
  return (
    <textarea
      rows={3}
      {...props}
      aria-invalid={invalid || undefined}
      style={{ ...(invalid ? errorInput : inputStyle), resize: 'vertical', ...style }}
    />
  );
}

export function SelectInput({ invalid, style, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & Invalid) {
  return (
    <select {...props} aria-invalid={invalid || undefined} style={{ ...(invalid ? errorInput : inputStyle), cursor: 'pointer', ...style }}>
      {children}
    </select>
  );
}

/** A checkbox with its label and optional help — the disclaimer and the
 *  acknowledgements on the public forms. */
export function CheckRow({
  id,
  checked,
  onChange,
  label,
  labelTa = null,
  help,
  helpTa,
  error,
  required,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  labelTa?: string | null;
  help?: ReactNode;
  helpTa?: string | null;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      {(help || helpTa) && <div style={{ marginBottom: 6 }}><HelpLine en={help} ta={helpTa} /></div>}
      <label htmlFor={id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer', lineHeight: 1.45 }}>
        <input
          id={id}
          type='checkbox'
          checked={checked}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.checked)}
          style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--pri)', flex: 'none' }}
        />
        <span>
          {typeof label === 'string' ? <BilingualLabel en={label} ta={labelTa} /> : label}
          {required && (
            <span aria-hidden style={{ color: 'var(--des)', marginLeft: 4 }}>
              *
            </span>
          )}
        </span>
      </label>
      <div id={`${id}-error`}>
        <ErrorLine>{error}</ErrorLine>
      </div>
    </div>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  labelTa?: string | null;
  hint?: ReactNode;
  disabled?: boolean;
}

/** A vertical list of choices, each a full-width row — the shape both the
 *  2025 forms and the volunteering module use for "pick one". */
export function RadioList({
  name,
  value,
  onChange,
  options,
  invalid,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: RadioOption[];
  invalid?: boolean;
}) {
  return (
    <div role='radiogroup' aria-invalid={invalid || undefined} style={{ display: 'grid', gap: 6 }}>
      {options.map((o) => {
        const on = value === o.value;
        const id = `${name}-${o.value}`;
        return (
          <label
            key={o.value}
            htmlFor={id}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '9px 12px',
              borderRadius: 'var(--r2)',
              border: `1px solid ${on ? 'var(--pri)' : invalid ? 'var(--des-b)' : 'var(--bd)'}`,
              background: on ? 'var(--pri-t)' : 'var(--card)',
              cursor: o.disabled ? 'not-allowed' : 'pointer',
              opacity: o.disabled ? 0.55 : 1,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            <input
              id={id}
              type='radio'
              name={name}
              value={o.value}
              checked={on}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              style={{ marginTop: 2, accentColor: 'var(--pri)', flex: 'none' }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>
                <BilingualLabel en={o.label} ta={o.labelTa ?? null} />
              </span>
              {o.hint && <span style={{ display: 'block', fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>{o.hint}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Two controls side by side on desktop, stacked on a phone. */
export function Row2({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 14px' }}>
      {children}
    </div>
  );
}
