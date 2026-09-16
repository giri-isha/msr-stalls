import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { Avatar, pillStyle } from '../ui';
import { panelStyle, useAnchoredPanel } from './anchor';
import { inputStyle } from './Dialog';

export interface PickOption {
  value: string;
  label: string;
  /** Secondary line — a role, or "12/40 allocated". */
  hint?: string;
  /** Sits beside the hint, e.g. "+1" for extra roles. */
  badge?: string;
  /** Right-aligned, e.g. "1244 calls". */
  meta?: string;
  avatar?: boolean;
  tint?: string;
}

/**
 * A select that can be searched, showing more per row than an <option> can.
 *
 * Closed, it is the same box as the native control it replaces. Open, it is a
 * panel of rows carrying an avatar, a second line and a right-aligned count.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchThreshold = 8,
  onQuery,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: PickOption[];
  placeholder?: string;
  searchThreshold?: number;
  /** Names the control for a screen reader. The `Field` label beside it is not
   *  associated — this is a button, not an input, so nothing links the two — and
   *  without a name the box announces only whatever is selected. Optional so the
   *  existing pickers are unchanged until each is given one. */
  label?: string;
  /**
   * Reports what was typed, for a caller that fetches its options from the
   * server. Without it the box can only filter the options already in hand,
   * so a list capped at fifty rows makes the fifty-first unfindable. Given,
   * the caller re-fetches and the local filter stays as a second pass.
   */
  onQuery?: (q: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const listId = useId();
  const search = useRef<HTMLInputElement>(null);
  // ⚠️ The measurement, the flip and the outside-press all live in the hook —
  // this component, `MultiSelect` and `Select` had three copies of them, and
  // they had drifted over what a page scroll should do. See `anchor.ts`.
  const { trigger, panel, box } = useAnchoredPanel({ open, onClose: () => setOpen(false) });

  const selected = options.find((o) => o.value === value);
  const searchable = !!onQuery || options.length >= searchThreshold;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  // ⚠️ Seeds the local editing state FROM the props when the panel opens, so
  // `open` is the whole dependency by design. Adding the value props would
  // re-seed mid-edit and discard whatever the person had picked. This carried a
  // dead `eslint-disable react-hooks/exhaustive-deps` from the standalone app,
  // which proves the omission was deliberate — restated so the reason survives,
  // since there is no eslint in this repo to read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds local edit state on open; re-seeding mid-edit would discard the person's input
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    if (searchable) queueMicrotask(() => search.current?.focus());
  }, [open]);

  // A filter change can strand the highlight past the end of the list.
  //
  // 🔴 `query` is the REASON this effect exists, not a redundant dependency.
  // The rule reads the callback body, sees `query` unreferenced, and offers to
  // remove it — which would leave `[]` and run this once on mount, so the
  // highlight would never reset again. The autofix here is the bug.
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is the trigger, not a read; removing it would run this once on mount
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Debounced, so typing a name is one request rather than one per keystroke.
  // ⚠️ Debounces on `query` alone, deliberately. `onQuery` is a fresh closure
  // on every render of the parent, so depending on it would restart the timer
  // on each one and the request would never fire while somebody kept typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: depending on onQuery would restart the debounce every render and never fire
  useEffect(() => {
    if (!onQuery) return;
    const t = setTimeout(() => onQuery(query), 220);
    return () => clearTimeout(t);
  }, [query]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const commit = (o: PickOption | undefined) => {
    if (o) {
      onChange(o.value);
      close();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => (i + 1) % Math.max(1, shown.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => (i - 1 + shown.length) % Math.max(1, shown.length));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(Math.max(0, shown.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        commit(shown[active]);
        break;
      case 'Tab':
        setOpen(false);
        break;
      case 'Escape':
        e.preventDefault();
        // Dialog listens for Escape on document. Without this, one press would
        // close the panel AND the dialog around it.
        e.stopPropagation();
        close();
        break;
    }
  };

  const activeId = shown[active] ? `${listId}-${active}` : undefined;

  return (
    <>
      {/* onKeyDown is safe to attach unconditionally: once a search box is open
          it holds focus, so this fires only when closed, or for a bare list. */}
      <button
        ref={trigger}
        type='button'
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        role='combobox'
        aria-label={label}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={!searchable && open ? activeId : undefined}
        style={{
          ...inputStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selected ? 'var(--fg)' : 'var(--mfg)',
          }}
        >
          {selected?.label ?? placeholder}
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={15} color='var(--mfg)' />
      </button>

      {open && box && (
        <div
          ref={panel}
          // ⚠️ The panel itself does not scroll — its option list does, below
          // the search box that must stay put while the list moves under it.
          style={{ ...panelStyle(box), maxHeight: 'none', overflow: 'hidden' }}
        >
          {searchable && (
            <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder='Search…'
                aria-controls={listId}
                aria-activedescendant={activeId}
                style={{ ...inputStyle, padding: '7px 10px', fontSize: 12.5 }}
              />
            </div>
          )}
          <div id={listId} role='listbox' style={{ maxHeight: 320, overflowY: 'auto', padding: 4 }}>
            {shown.length === 0 ? (
              <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--mfg)' }}>
                No Matches
              </div>
            ) : (
              shown.map((o, i) => (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role='option'
                  aria-selected={o.value === value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(o)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 8px',
                    borderRadius: 'var(--r2)',
                    cursor: 'pointer',
                    background: i === active ? 'var(--pri-t)' : 'transparent',
                  }}
                >
                  {o.avatar && <Avatar name={o.label} tint={o.tint} size={28} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {o.label}
                    </div>
                    {o.hint && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 11.5,
                          color: 'var(--mfg)',
                          marginTop: 1,
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {o.hint}
                        </span>
                        {o.badge && (
                          <span
                            style={{
                              ...pillStyle('info', 'sm'),
                              flex: 'none',
                            }}
                          >
                            {o.badge}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {o.meta && (
                    <span style={{ flex: 'none', fontSize: 11.5, color: 'var(--mfg)' }}>
                      {o.meta}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
