import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/** A small modal on the native <dialog> element — enough for a confirm, a
 *  stall picker, or a reason prompt. Closes on Escape and on backdrop click. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'
      onClick={onClose}
      onKeyDown={() => {}}
      role='presentation'
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='dialog-title'
        className={cn(
          'w-full max-w-lg rounded-lg border border-line bg-surface p-5 shadow-xl',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className='mb-3 flex items-start justify-between gap-4'>
          <div>
            <h2 id='dialog-title' className='text-base font-semibold'>
              {title}
            </h2>
            {description && <p className='mt-1 text-sm text-ink-2'>{description}</p>}
          </div>
          <Button variant='ghost' size='icon' onClick={onClose} aria-label='Close'>
            <X className='h-4 w-4' />
          </Button>
        </div>
        {children}
        {footer && <div className='mt-5 flex justify-end gap-2'>{footer}</div>}
      </div>
    </div>
  );
}
