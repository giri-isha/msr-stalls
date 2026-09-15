import { useRef, type ReactNode } from 'react';
import { Icon } from '../icons';
import { useIsMobile } from '../useBreakpoint';
import {
  SheetGrip,
  scrim,
  sheet,
  useEscape,
  useFocusTrap,
  useLockScroll,
  useTopmostOverlay,
} from './Overlay';

/**
 * Modal shell. Escape and the scrim both close it.
 *
 * A centred box on desktop, a bottom sheet on a phone — same API, so no caller
 * knows the difference. A 460px box centred on a 375px screen is a box with
 * 20px of margin and its footer buttons squeezed onto one line; a sheet is
 * full width, thumb-reachable, and can grow to 90vh with its body scrolling.
 */
export function Dialog({
  title,
  note,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: string;
  note?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const mobile = useIsMobile();
  const box = useRef<HTMLDivElement>(null);
  // ⚠️ Escape and the focus trap answer only while nothing is stacked on top.
  // A dialog opened FROM a dialog would otherwise take both boxes down with one
  // key press, and both traps would fight over Tab. The scroll lock is the
  // exception — it counts, so the inner one closing must not free the outer
  // one's hold on the page.
  const top = useTopmostOverlay();
  useEscape(onClose, top);
  useLockScroll();
  useFocusTrap(box, top);

  const surface: React.CSSProperties = mobile
    ? sheet
    : {
        width,
        maxWidth: '100%',
        maxHeight: '86vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--card)',
        border: '1px solid var(--bd)',
        borderRadius: 'var(--r4)',
        boxShadow: 'var(--sh-3)',
      };

  return (
    <>
      <div onClick={onClose} style={scrim} />
      <div
        style={
          mobile
            ? undefined
            : {
                position: 'fixed',
                inset: 0,
                zIndex: 201,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 20,
                pointerEvents: 'none',
              }
        }
      >
        <div
          ref={box}
          role='dialog'
          aria-modal='true'
          aria-label={title}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          style={{ ...surface, pointerEvents: 'auto', outline: 'none' }}
        >
          {mobile && <SheetGrip />}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: mobile ? '8px 16px 12px' : '16px 18px 12px',
              flex: 'none',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 700 }}>{title}</div>
              {note && (
                <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 3 }}>{note}</div>
              )}
            </div>
            <button
              type='button'
              onClick={onClose}
              aria-label='Close'
              style={{
                border: 0,
                background: 'none',
                cursor: 'pointer',
                color: 'var(--mfg)',
                display: 'flex',
                // A 17px glyph is not a tap target; pad it out to 44px on touch.
                padding: mobile ? 12 : 0,
                margin: mobile ? -12 : 0,
              }}
            >
              <Icon name='x' size={17} />
            </button>
          </div>
          <div
            style={{ padding: mobile ? '0 16px 12px' : '0 18px 16px', overflowY: 'auto', flex: 1 }}
          >
            {children}
          </div>
          {footer && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                flex: 'none',
                padding: mobile ? '12px 16px' : '13px 18px',
                borderTop: '1px solid var(--line)',
                // Stacked and full-width on a phone: reversed so the primary
                // action, which callers pass last, ends up on top under the thumb.
                ...(mobile
                  ? { flexDirection: 'column-reverse' as const }
                  : { justifyContent: 'flex-end' as const }),
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.6px',
          textTransform: 'uppercase',
          color: 'var(--mfg)',
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 'var(--r2)',
  border: '1px solid var(--bd)',
  background: 'var(--field)',
  fontSize: 13,
  color: 'var(--fg)',
  outline: 'none',
  fontFamily: 'inherit',
};
