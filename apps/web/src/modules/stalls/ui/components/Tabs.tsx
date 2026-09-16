import { type CSSProperties, useRef } from 'react';
import { Icon } from '../icons';

export type TabDef = {
  key: string;
  label: string;
  /** Icon name from `ui/icons`. Omitted on strips whose labels carry enough. */
  glyph?: string;
};

/**
 * The page-section tab strip: an underlined rail, not a row of pills.
 *
 * ⚠️ This deliberately does NOT use `toolBtnStyle`. That style is the look a
 * CHOSEN CONTROL wears — a filter that is on, a view that is picked — and five
 * screens had each grown their own near-copy of it to draw page sections.
 * Pills say "these are options you may toggle"; sections are not toggles, they
 * are where you ARE on the page, which is what an underline says. The filters
 * that genuinely are toggles (Check-in, Equipment, Electrical, the Flagged
 * button on Requests) keep `toolBtnStyle` — that is the distinction, and it is
 * the reason this is a separate component rather than a flag on that one.
 *
 * Arrow keys move between tabs and only the active tab is in the Tab order, as
 * the tablist pattern requires — the old copies were a row of plain buttons
 * wearing `role='tab'`, which promised that behaviour without providing it.
 */
export function Tabs({
  tabs,
  active,
  onPick,
  label,
  style,
}: {
  tabs: TabDef[];
  active: string;
  onPick: (key: string) => void;
  /** Names the strip for a screen reader, e.g. 'Configuration Sections'. */
  label: string;
  style?: CSSProperties;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // A strip whose `active` matches nothing would put every tab at tabIndex -1
  // and drop out of the Tab order entirely. The first tab stands in.
  const focused = tabs.some((t) => t.key === active) ? active : tabs[0]?.key;

  const move = (from: number, delta: number) => {
    const next = (from + delta + tabs.length) % tabs.length;
    onPick(tabs[next].key);
    // The moved-to tab is the only one in the Tab order once `active` follows,
    // so focus has to be pushed to it by hand.
    strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      ref={strip}
      role='tablist'
      aria-label={label}
      style={{
        display: 'flex',
        gap: 2,
        // The rail the active tab's underline sits on. It runs the full width
        // rather than stopping at the last tab, so the strip reads as an edge
        // of the page and not as a group of buttons.
        borderBottom: '1px solid var(--bd)',
        marginBottom: 16,
        overflowX: 'auto',
        // A strip too wide for a phone scrolls rather than wrapping: wrapped
        // rows each grow their own underline and stop reading as one rail.
        scrollbarWidth: 'none',
        ...style,
      }}
    >
      {tabs.map((t, i) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type='button'
            role='tab'
            aria-selected={on}
            tabIndex={t.key === focused ? 0 : -1}
            onClick={() => onPick(t.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                move(i, -1);
              } else if (e.key === 'Home') {
                e.preventDefault();
                move(i, -i);
              } else if (e.key === 'End') {
                e.preventDefault();
                move(i, tabs.length - 1 - i);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 14px',
              // Sits ON the rail: the 2px underline overlaps the container's
              // 1px border rather than stacking below it.
              marginBottom: -1,
              borderRadius: 0,
              border: 'none',
              borderBottom: `2px solid ${on ? 'var(--pri)' : 'transparent'}`,
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: 600,
              color: on ? 'var(--pri)' : 'var(--mfg)',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            {t.glyph && <Icon name={t.glyph} size={14} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
