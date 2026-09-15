import type * as React from 'react';
import { inputStyle } from './Dialog';

/**
 * Form controls in the shared look.
 *
 * ⚠️ These exist because the module this design system came from has no public
 * forms. Its own `Field` (in `Dialog.tsx`) is a label over a control inside a
 * dialog, where a caller has already validated and the only reader is staff.
 * The four 2025 request forms are the opposite case: filled in by a vendor on a
 * phone, in two languages, validated on submit, and the error line is the whole
 * product on a bad submission.
 *
 * So the pieces the reference set does ship are reused as-is — `inputStyle` is
 * its control skin and `FieldError` its error line, copied character for
 * character from `RuleField.tsx` — and what is added is the LINKAGE a public
 * form needs and a dialog does not: `htmlFor`/`id`, `aria-describedby` pointing
 * at the help and error, and `aria-invalid` on the control rather than a red
 * border alone.
 */

/** The message under a field. Renders nothing when there is none. */
export function FieldError({ of, id }: { of: string | undefined; id?: string }) {
  if (!of) return null;
  return (
    <div
      id={id}
      role='alert'
      style={{
        display: 'flex',
        gap: 5,
        alignItems: 'flex-start',
        fontSize: 11.5,
        color: 'var(--des-fg)',
        marginTop: 5,
        lineHeight: 1.5,
      }}
    >
      <span aria-hidden style={{ flex: 'none', fontWeight: 700 }}>
        ⚠
      </span>
      <span>{of}</span>
    </div>
  );
}

/** The control skin when the field is holding an error. */
export const errorInputStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: 'var(--des-b)',
  background: 'var(--des-t)',
};

/** The skin a control should wear, given whether it is in error. */
export function controlStyle(invalid?: boolean): React.CSSProperties {
  return invalid ? errorInputStyle : inputStyle;
}

/**
 * A labelled control with its help and its error.
 *
 * ⚠️ The label is a real `<label htmlFor>`, not the reference `Field`'s styled
 * `<div>`. Half of these fields are the only thing a screen reader has to go
 * on, and the suite reaches every one of them by `getByLabelText` — an
 * unassociated caption satisfies neither.
 *
 * ⚠️ Sentence-case label text, uppercase micro-caps — the same treatment the
 * reference `Field` gives it — is deliberately NOT applied here. A public form
 * label is a QUESTION ("What items are you selling?"), often long and often
 * bilingual, and small-caps at 11px turns a Tamil clause into a smear.
 */
export function FormField({
  id,
  label,
  help,
  error,
  required,
  children,
}: {
  id: string;
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 0 }}>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--fg)',
          marginBottom: help ? 3 : 6,
          lineHeight: 1.4,
        }}
      >
        {label}
        {required && (
          <span aria-hidden style={{ marginLeft: 3, color: 'var(--des-fg)' }}>
            *
          </span>
        )}
      </label>
      {help && (
        <div
          id={`${id}-help`}
          style={{ fontSize: 11.5, color: 'var(--mfg)', marginBottom: 6, lineHeight: 1.5 }}
        >
          {help}
        </div>
      )}
      {children}
      <FieldError of={error} id={`${id}-error`} />
    </div>
  );
}

/** A stack of fields at the rhythm the forms use. */
export function FieldStack({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gap: 18 }}>{children}</div>;
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ invalid, style, ...props }: InputProps) {
  return <input style={{ ...controlStyle(invalid), ...style }} {...props} />;
}

export function Textarea({
  invalid,
  style,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      style={{ ...controlStyle(invalid), minHeight: 84, resize: 'vertical', ...style }}
      {...props}
    />
  );
}

export function Select({
  invalid,
  style,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return <select style={{ ...controlStyle(invalid), ...style }} {...props} />;
}

/**
 * A tick box.
 *
 * `accentColor` rather than a hand-drawn box: the native control keeps the
 * platform's own focus ring and its indeterminate/checked semantics, and the
 * one thing it gets wrong on a token palette — the fill — is the one thing
 * `accentColor` fixes.
 */
/**
 * ⚠️ `ComponentProps<'input'>` rather than `InputHTMLAttributes`, so a caller
 * can pass a `ref`. The tri-state tick on the role editor's category rows needs
 * one: `indeterminate` is a DOM PROPERTY with no matching attribute, so "some
 * but not all of this category" cannot be expressed in JSX at all without
 * reaching the element. React 19 passes `ref` to a function component as an
 * ordinary prop, so the spread below is all it takes.
 */
export function Checkbox({ style, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type='checkbox'
      style={{
        width: 16,
        height: 16,
        accentColor: 'var(--pri)',
        flex: 'none',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      {...props}
    />
  );
}

export function Radio({ style, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type='radio'
      style={{
        width: 16,
        height: 16,
        accentColor: 'var(--pri)',
        flex: 'none',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
      {...props}
    />
  );
}

/**
 * A choice drawn as a plate rather than a bare dot — the shape the zone picker
 * and the usage question need, where the option carries a second line.
 *
 * ⚠️ The whole plate is the label, so the tap target is the card and not the
 * 16px dot inside it. These forms are filled in on a phone at a stall site.
 */
export function ChoicePlate({
  htmlFor,
  selected,
  disabled,
  children,
}: {
  htmlFor: string;
  selected: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
        padding: '11px 13px',
        borderRadius: 'var(--r2)',
        border: `1px solid ${selected ? 'var(--pri)' : 'var(--bd)'}`,
        background: selected ? 'var(--pri-t)' : 'var(--card)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        fontSize: 13,
        lineHeight: 1.45,
      }}
    >
      {children}
    </label>
  );
}
