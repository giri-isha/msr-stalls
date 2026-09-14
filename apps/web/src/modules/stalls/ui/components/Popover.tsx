import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { toolBtnStyle } from '../ui';
import { useIsMobile } from '../useBreakpoint';
import { SheetGrip, scrim, sheet, useEscape, useLockScroll } from './Overlay';

/**
 * Toolbar button that opens an anchored panel, as the design's toolbar does.
 *
 * On a phone the panel becomes a bottom sheet instead. A 340px panel anchored
 * under a button that is itself near the right edge of a 375px screen hangs
 * off the viewport, and its 420px scroll area leaves nothing visible above the
 * keyboard once the search box inside it takes focus.
 */
export function Popover({
  icon,
  label,
  badge,
  width = 320,
  children,
}: {
  icon: string;
  label: string;
  badge?: number;
  width?: number;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  const close = () => setOpen(false);
  useEscape(close, open);
  useLockScroll(open && mobile);

  useEffect(() => {
    // The sheet covers the page, so its own scrim handles dismissal; an
    // outside-click listener would also fire for taps inside the sheet.
    if (!open || mobile) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, mobile]);

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        style={{
          ...toolBtnStyle(!!badge),
          // Open-but-empty keeps the primary EDGE without the tint: the panel
          // being open is not the same as a filter being applied, and tinting
          // it would read as one the moment it was opened and nothing chosen.
          border: `1px solid ${open || badge ? 'var(--pri)' : 'var(--bd)'}`,
        }}
      >
        <Icon name={icon} size={14} />
        {label}
        {badge ? (
          <span
            style={{
              background: 'var(--pri)',
              color: 'var(--pfg)',
              borderRadius: 999,
              padding: '1px 6px',
              fontSize: 11.5,
            }}
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open &&
        (mobile ? (
          <>
            <div onClick={close} style={scrim} />
            <div role='dialog' aria-modal='true' aria-label={label} style={sheet}>
              <SheetGrip />
              <div style={{ padding: '6px 16px 16px', overflowY: 'auto', flex: 1 }}>
                {children(close)}
              </div>
            </div>
          </>
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              zIndex: 60,
              width,
              background: 'var(--pop)',
              border: '1px solid var(--bd)',
              borderRadius: 'var(--r4)',
              boxShadow: 'var(--sh)',
              padding: 12,
              maxHeight: 420,
              overflowY: 'auto',
            }}
          >
            {children(close)}
          </div>
        ))}
    </div>
  );
}

export function PopHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <div
        style={{
          flex: 1,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.6px',
          textTransform: 'uppercase',
          color: 'var(--mfg)',
        }}
      >
        {title}
      </div>
      {action && (
        <button
          type='button'
          onClick={onAction}
          style={{
            background: 'none',
            border: 0,
            color: 'var(--pri)',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

/** Row with a tick box, a label and a count — the design's option row. */
export function OptionRow({
  ticked,
  label,
  count,
  onClick,
}: {
  ticked: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  const mobile = useIsMobile();
  return (
    // A 29px-tall row is a fine mouse target and a poor thumb one, so it grows
    // to 44px on touch — the same rows, twice the height, inside the sheet.
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: mobile ? '12px 8px' : '7px 6px',
        borderRadius: 'var(--r2)',
        cursor: 'pointer',
        fontSize: mobile ? 14 : 12.5,
      }}
    >
      <span
        style={{
          width: 15,
          height: 15,
          borderRadius: 'var(--r)',
          flex: 'none',
          border: `1px solid ${ticked ? 'var(--pri)' : 'var(--bd)'}`,
          background: ticked ? 'var(--pri)' : 'transparent',
          // Tracks the glyph, as everywhere else a tick is drawn in here.
          color: ticked ? 'var(--pfg)' : 'transparent',
          fontSize: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {ticked ? '✓' : ''}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {count !== undefined && (
        <span style={{ color: 'var(--mfg)', fontSize: 11.5 }}>{count.toLocaleString()}</span>
      )}
    </div>
  );
}
