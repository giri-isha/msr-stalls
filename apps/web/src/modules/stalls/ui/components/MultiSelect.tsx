import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useIsMobile } from '../useBreakpoint';
import { OptionRow } from './Popover';
import { SearchList, matchLabel } from './SearchList';
import { inputStyle } from './Dialog';

export interface MultiOption {
  value: string;
  label: string;
  group?: string;
}

/** Matches SearchSelect's panel height, so the two flip at the same point. */
const PANEL_MAX = 320;

/**
 * A searchable multi-select shaped like a form field.
 *
 * `SearchSelect` next door is single-select and has 28 call sites, so it is
 * left alone; the rows, search box and tick behaviour here are the same
 * primitives the list toolbar's facets use, which is where the visual
 * agreement between the two comes from.
 */
export function MultiSelect({
  values,
  onChange,
  options,
  placeholder = 'Select one or more',
  groupSelectAll = false,
  label,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  options: MultiOption[];
  placeholder?: string;
  /**
   * The accessible name of the control.
   *
   * ⚠️ Without it the combobox is named by its own VALUE — "Every bay" while
   * empty, "A1 — Bay A1" once picked — so it renames itself as it is used and
   * announces nothing about what it is for. The assignment dialog draws one of
   * these per axis per role, where "which of these four is the bays picker for
   * Finance" is the only question that matters.
   */
  label?: string;
  /** Offers "select all" / "clear" on each group header. Only the scope
   *  picker asks for it — granting a whole region is one click there and
   *  eight everywhere else. */
  groupSelectAll?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<{
    top: number;
    left: number;
    width: number;
    flip: boolean;
  } | null>(null);
  const mobile = useIsMobile();

  // Position against the viewport, NOT the offset parent. This picker's only
  // caller mounts it inside Dialog, whose body sets overflowY:auto — which
  // clips an absolutely-positioned panel. SearchSelect solves the same problem
  // the same way; the two must not disagree about where a dropdown goes.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const flip = below < PANEL_MAX && r.top > below;
      setPanel({ top: flip ? r.top : r.bottom + 4, left: r.left, width: r.width, flip });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  /** Options in the order they render, so arrow keys walk what the eye sees. */
  const flat = useMemo(() => options.map((o) => o.value), [options]);

  const toggle = (v: string) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  const labelOf = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);

  // Groups render as headed sections in the order they first appear, so the
  // picker reads as Roles / Areas / Regions rather than one flat list.
  const groups = useMemo(() => {
    const out: { name: string; items: MultiOption[] }[] = [];
    for (const o of options) {
      const name = o.group ?? '';
      const found = out.find((g) => g.name === name);
      if (found) found.items.push(o);
      else out.push({ name, items: [o] });
    }
    return out;
  }, [options]);

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        ref={trigger}
        type='button'
        onClick={() => setOpen((o) => !o)}
        // Dialog listens for Escape on document. Without stopping it here, one
        // press would close this panel AND the dialog around it, discarding
        // everything typed. SearchSelect guards the same hazard the same way.
        role='combobox'
        aria-label={label}
        aria-expanded={open}
        aria-haspopup='listbox'
        aria-controls={open ? listId : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
            return;
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            setActive((i) => {
              const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
              return (next + flat.length) % Math.max(flat.length, 1);
            });
            return;
          }
          if (open && (e.key === 'Enter' || e.key === ' ')) {
            const v = flat[active];
            if (v !== undefined) {
              e.preventDefault();
              toggle(v);
            }
          }
        }}
        style={{
          ...inputStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: values.length ? 'var(--fg)' : 'var(--mfg)',
          }}
        >
          {values.length === 0 ? placeholder : values.map((v) => labelOf.get(v) ?? v).join(', ')}
        </span>
        {values.length > 0 && (
          <span
            style={{
              background: 'var(--pri)',
              color: 'var(--pfg)',
              borderRadius: 999,
              padding: '1px 7px',
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            {values.length}
          </span>
        )}
        <Icon name='chevron-down' size={14} color='var(--mfg)' />
      </button>

      {open && panel && (
        <div
          style={{
            position: 'fixed',
            left: panel.left,
            width: panel.width,
            zIndex: 260,
            ...(panel.flip ? { bottom: window.innerHeight - panel.top + 4 } : { top: panel.top }),
            background: 'var(--pop)',
            border: '1px solid var(--bd)',
            borderRadius: 'var(--r4)',
            boxShadow: 'var(--sh)',
            padding: 10,
            maxHeight: mobile ? 260 : PANEL_MAX,
            overflowY: 'auto',
          }}
          id={listId}
          role='listbox'
          aria-multiselectable='true'
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <SearchList items={options} match={matchLabel} placeholder='Search…'>
            {(shown) =>
              groups.map((g) => {
                const items = g.items.filter((i) => shown.includes(i));
                if (items.length === 0) return null;
                return (
                  <div key={g.name}>
                    {g.name && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '.6px',
                          textTransform: 'uppercase',
                          color: 'var(--mfg)',
                          padding: '8px 6px 4px',
                        }}
                      >
                        <span>{g.name}</span>
                        {groupSelectAll &&
                          (() => {
                            // Acts on what the search has left VISIBLE, not on the
                            // whole group: a header reading "select all" beside two
                            // shown rows must not quietly tick eleven.
                            const ids = items.map((i) => i.value);
                            const allOn = ids.every((v) => values.includes(v));
                            return (
                              <button
                                type='button'
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onChange(
                                    allOn
                                      ? values.filter((v) => !ids.includes(v))
                                      : [...new Set([...values, ...ids])],
                                  );
                                }}
                                style={{
                                  border: 0,
                                  background: 'none',
                                  padding: 0,
                                  cursor: 'pointer',
                                  color: 'var(--pri)',
                                  font: 'inherit',
                                  letterSpacing: 'inherit',
                                }}
                              >
                                {allOn ? 'clear' : 'select all'}
                              </button>
                            );
                          })()}
                      </div>
                    )}
                    {items.map((o) => (
                      <OptionRow
                        key={o.value}
                        role='option'
                        active={flat[active] === o.value}
                        ticked={values.includes(o.value)}
                        label={o.label}
                        onClick={() => toggle(o.value)}
                      />
                    ))}
                  </div>
                );
              })
            }
          </SearchList>
        </div>
      )}
    </div>
  );
}
