import type * as React from 'react';
import { cn } from '@/lib/cn';

const control =
  'block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent disabled:opacity-50 aria-[invalid=true]:border-bad';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-9', className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-20', className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, 'h-9', className)} {...props} />;
}

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type='checkbox'
      className={cn('h-4 w-4 rounded border-line accent-accent', className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-sm font-medium text-ink', className)} {...props} />;
}

/** A labelled control with optional help and error. `id` links label to
 *  control; the error is announced via aria-describedby. */
export function Field({
  id,
  label,
  help,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  help?: React.ReactNode;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className='ml-1 text-bad' aria-hidden>
            *
          </span>
        )}
      </Label>
      {help && (
        <p id={`${id}-help`} className='text-xs text-ink-2'>
          {help}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} role='alert' className='text-xs text-bad'>
          {error}
        </p>
      )}
    </div>
  );
}
