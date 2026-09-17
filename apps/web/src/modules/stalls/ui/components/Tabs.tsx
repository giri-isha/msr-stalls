import { type CSSProperties, useRef } from 'react';
import { Icon } from '../icons';

export type TabDef = {
  key: string;
  label: string;
  /** Icon name from `ui/icons`. Omitted on strips whose labels carry enough. */
  glyph?: string;
  /** A dot after the label: `warn` for a section with something outstanding
   *  in it, `ok` for one that is settled. The strip then reads as a checklist
   *  before any tab is opened. ⚠️ Decoration only — the section's own body
   *  says the same thing in words, so nothing is lost on a screen reader. */
  mark?: 'warn' | 'ok';
  /** A word in place of the dot, on a vertical rail only — "Due", "Done" — so
   *  the rail reads as a checklist in words rather than colours. ⚠️ Hidden
   *  from the accessible name, like the dot: the section's body says it. */
  note?: string;
  /** A shorter label for the phone's bottom bar, where six sections share
   *  one row. The full `label` stays the accessible name. */
  short?: string;
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
 * ⚠️ `orientation='vertical'` turns the same strip on its side, for a page
 * whose sections sit in a rail down the left rather than across the top. It is
 * the SAME component and not a second one because everything that is hard here
 * is orientation-independent: the roving tabindex, the marks, the active
 * accent, and the rule about what a section strip may look like. What changes
 * is the axis the accent runs along and which two arrow keys move between tabs
 * — and the tablist pattern requires that pair to follow the axis, which is
 * exactly the thing a hand-rolled copy in a page file would get wrong.
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
  orientation = 'horizontal',
  variant = 'strip',
}: {
  tabs: TabDef[];
  active: string;
  onPick: (key: string) => void;
  /** Names the strip for a screen reader, e.g. 'Configuration Sections'. */
  label: string;
  style?: CSSProperties;
  /** Which way the strip runs. See the note above. */
  orientation?: 'horizontal' | 'vertical';
  /** `bar` is the phone's bottom bar: icon over a short label, one row shared
   *  equally, no underline. The tablist behaviour is unchanged. */
  variant?: 'strip' | 'bar';
}) {
  const strip = useRef<HTMLDivElement>(null);
  const vertical = orientation === 'vertical';
  const bar = variant === 'bar' && !vertical;
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

  // ⚠️ The arrow pair FOLLOWS the axis, which is what the tablist pattern asks
  // for: left/right on a horizontal strip, up/down on a vertical one. A rail
  // that answered left/right would be a rail whose keys point across the page
  // at nothing.
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft';
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';

  return (
    <div
      ref={strip}
      role='tablist'
      aria-label={label}
      // Only stated when it is not the default. `horizontal` is what a tablist
      // is assumed to be, and saying so adds nothing.
      aria-orientation={vertical ? 'vertical' : undefined}
      style={{
        display: 'flex',
        ...(vertical
          ? {
              flexDirection: 'column',
              gap: 1,
              // No rail of its own: the rail is the COLUMN this sits in, drawn
              // by the page. A border here would be a second line beside it.
              alignItems: 'stretch',
            }
          : bar
            ? {
                gap: 0,
                justifyContent: 'space-around',
                overflowX: 'auto',
                scrollbarWidth: 'none',
              }
            : {
                gap: 2,
                // The rail the active tab's underline sits on. It runs the full
                // width rather than stopping at the last tab, so the strip reads
                // as an edge of the page and not as a group of buttons.
                borderBottom: '1px solid var(--bd)',
                marginBottom: 16,
                overflowX: 'auto',
                // A strip too wide for a phone scrolls rather than wrapping:
                // wrapped rows each grow their own underline and stop reading as
                // one rail.
                scrollbarWidth: 'none',
              }),
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
            aria-label={bar && t.short ? t.label : undefined}
            onKeyDown={(e) => {
              if (e.key === nextKey) {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === prevKey) {
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
              gap: vertical ? 9 : 6,
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flex: 'none',
              ...(vertical
                ? {
                    // The vertical answer to the underline: a 2px accent down
                    // the leading edge, and a soft plate lifting the chosen
                    // row off the page. Same two signals, turned.
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px 8px 9px',
                    borderRadius: 'var(--r2)',
                    border: '1px solid transparent',
                    borderLeft: `2px solid ${on ? 'var(--pri)' : 'transparent'}`,
                    background: on ? 'var(--mut)' : 'transparent',
                    color: on ? 'var(--pri)' : 'var(--mfg)',
                  }
                : bar
                  ? {
                      // The phone's bottom bar: glyph over a short label, every
                      // section given the same share of the row.
                      display: 'grid',
                      justifyItems: 'center',
                      gap: 3,
                      flex: '1 1 0',
                      minWidth: 54,
                      padding: '7px 4px 6px',
                      border: 'none',
                      borderRadius: 'var(--r2)',
                      background: 'transparent',
                      color: on ? 'var(--pri)' : 'var(--mfg)',
                      fontSize: 10.5,
                      fontWeight: on ? 700 : 600,
                      position: 'relative',
                    }
                  : {
                      padding: '9px 14px',
                      // Sits ON the rail: the 2px underline overlaps the
                      // container's 1px border rather than stacking below it.
                      marginBottom: -1,
                      borderRadius: 0,
                      border: 'none',
                      borderBottom: `2px solid ${on ? 'var(--pri)' : 'transparent'}`,
                      background: 'transparent',
                      color: on ? 'var(--pri)' : 'var(--mfg)',
                    }),
            }}
          >
            {t.glyph && <Icon name={t.glyph} size={bar ? 18 : 14} />}
            {/* On the rail the label takes the slack, so the mark lands in a
                column down the right rather than trailing each label at a
                different x. Across the top there is no column to line up. */}
            <span style={vertical ? { flex: 1, minWidth: 0 } : undefined}>
              {bar ? (t.short ?? t.label) : t.label}
            </span>
            {vertical && t.note ? (
              <span
                data-mark={t.mark}
                aria-hidden
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  flex: 'none',
                  color: t.mark === 'warn' ? 'var(--warn-fg)' : 'var(--ok-fg)',
                }}
              >
                {t.note}
              </span>
            ) : (
              t.mark && (
                <span
                  data-mark={t.mark}
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    flex: 'none',
                    background: t.mark === 'warn' ? 'var(--warn)' : 'var(--ok)',
                    // In the bar the dot sits on the glyph's corner, not after
                    // a label there is no room beside.
                    ...(bar ? { position: 'absolute', top: 6, right: 'calc(50% - 14px)' } : {}),
                  }}
                />
              )
            )}
          </button>
        );
      })}
    </div>
  );
}
