import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import { Icon } from '../icons';
import { useIsMobile } from '../useBreakpoint';
import { panelStyle, useAnchoredPanel } from './anchor';
import { controlStyle } from './Form';

/**
 * A dropdown the module draws itself.
 *
 * 🔴 **This was a native `<select>`, and a native `<select>` is the one control
 * a design system cannot style.** Its popup is painted by the operating system:
 * on Windows a white list with a blue bar, on a Mac a translucent sheet, on
 * Android a full-screen modal — none of them in the module's tokens, none of
 * them respecting the dark theme, and all of them beside pickers the module DID
 * draw (`SearchSelect`, `MultiSelect`, the toolbar facets), so two dropdowns on
 * the same toolbar opened into two different-looking lists. The closed box
 * could be skinned and the open one could not, which is the half nobody sees
 * until they use it.
 *
 * So the options are drawn here: the same `--pop` panel, the same rows and the
 * same tick the other three pickers use, anchored by the same hook.
 *
 * ⚠️ **The authoring surface is still `<option>` children.** Twenty call sites
 * build their options with a `.map()` inside the element, and an `options={[…]}`
 * prop would have rewritten every one of them for no gain — so the children are
 * walked instead, and a caller that has options as data can pass `options`.
 *
 * ⚠️ `onChange` hands over the VALUE, not an event. It is what `SearchSelect`
 * and `MultiSelect` do, and the alternative — synthesising an object with a
 * `target.value` on it so the old call sites could stay — would be a lie about
 * a control that no longer has a DOM node to be the target.
 *
 * The trigger is a `combobox` button, so a `<label htmlFor>` still names it
 * (a button is a labelable element) and the suite still reaches it by label.
 */
export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface Opt {
  value: string;
  node: React.ReactNode;
  /** The label flattened to text, for type-ahead and for the title tooltip. */
  text: string;
  disabled?: boolean;
}

/** Everything an `<option>`'s children say, as one string. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return '';
}

/**
 * The `<option>`s a caller wrote, in the order they were written.
 *
 * ⚠️ Walks THROUGH anything that is not an option — a fragment, a `.map()`, a
 * conditional — rather than requiring options to be direct children. Half the
 * call sites wrap theirs in `<>…</>` or produce them from an array, and a
 * shallow read would silently find none of them: an empty list, no error.
 */
function collect(children: React.ReactNode, out: Opt[] = []): Opt[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      children?: React.ReactNode;
    };
    if (child.type === 'option') {
      const text = textOf(props.children);
      out.push({
        value: String(props.value ?? text),
        node: props.children,
        text,
        disabled: props.disabled,
      });
      return;
    }
    if (props.children !== undefined) collect(props.children, out);
  });
  return out;
}

export function Select({
  value,
  onChange,
  options,
  children,
  placeholder = 'Select…',
  invalid,
  disabled,
  required,
  id,
  style,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
}: {
  /** The chosen value. Empty string where the list carries a "none" option. */
  value: string;
  onChange: (value: string) => void;
  /** Options as data, for a caller that already has them in an array. */
  options?: readonly SelectOption[];
  /** Options as `<option>` elements — the native spelling, kept. */
  children?: React.ReactNode;
  /** Shown when the value matches no option. A list with its own "All…" row
   *  never sees this, which is most of them. */
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const mobile = useIsMobile();
  const { trigger, panel, box } = useAnchoredPanel({ open, onClose: () => setOpen(false) });

  const items = useMemo<Opt[]>(
    () =>
      options
        ? options.map((o) => ({
            value: o.value,
            node: o.label,
            text: textOf(o.label),
            disabled: o.disabled,
          }))
        : collect(children),
    [options, children],
  );

  const selected = items.find((o) => o.value === value);
  const activeId = items[active] ? `${listId}-${active}` : undefined;

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const commit = (o: Opt | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    close();
  };

  /** What has been typed in the last second, for type-ahead. */
  const typed = useRef({ text: '', at: 0 });
  /** A letter pressed while the list was SHUT, which is what opened it. */
  const pending = useRef<string | null>(null);

  /** The next option whose label starts with `text`, wrapping from `from`. */
  const matchFrom = (text: string, from: number) => {
    const want = text.toLowerCase();
    for (let i = 0; i < items.length; i++) {
      const at = (from + i) % items.length;
      if (items[at].text.toLowerCase().startsWith(want)) return at;
    }
    return -1;
  };

  // Opens on the current value, so the first Arrow key moves from where the
  // list already is rather than from its top.
  //
  // ⚠️ A letter that OPENED the list is honoured here rather than where it was
  // pressed. This effect runs after that render, and seeding the cursor back
  // onto the current value is exactly what it would undo — so typing a letter
  // to open a list landed on whatever was already chosen.
  //
  // ⚠️ `open` is the whole dependency by design: re-seeding while the panel is
  // up would drag the highlight back under the person's hands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds the cursor on open; re-seeding mid-use would move it under the person
  useEffect(() => {
    if (!open) return;
    const key = pending.current;
    pending.current = null;
    if (key) {
      typed.current = { text: key, at: Date.now() };
      setActive(Math.max(0, matchFrom(key, 0)));
      return;
    }
    setActive(
      Math.max(
        0,
        items.findIndex((o) => o.value === value),
      ),
    );
  }, [open]);

  // Keeps the highlighted row in view when the arrows walk past the fold.
  // ⚠️ Called optionally — jsdom does not implement `scrollIntoView`, and the
  // suite drives this control with the keyboard.
  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeId]);

  const jump = (key: string) => {
    const now = Date.now();
    // ⚠️ Repeating one letter cycles through the options starting with it,
    // which is what a native select does; anything else extends the search.
    const text =
      now - typed.current.at < 900 && typed.current.text !== key ? typed.current.text + key : key;
    typed.current = { text, at: now };
    // A fresh letter starts PAST the cursor, so pressing it again moves on to
    // the next match; a longer search re-reads from where the cursor is.
    const hit = matchFrom(text, text.length === 1 ? active + 1 : active);
    if (hit >= 0) setActive(hit);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      // ⚠️ `Dialog` listens for Escape on the document. Without stopping it
      // here, one press would close this panel AND the dialog around it.
      e.stopPropagation();
      close();
      return;
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        pending.current = e.key;
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => (i + 1) % Math.max(1, items.length));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => (i - 1 + items.length) % Math.max(1, items.length));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(Math.max(0, items.length - 1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(items[active]);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) jump(e.key);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type='button'
        id={id}
        disabled={disabled}
        role='combobox'
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        aria-required={required || undefined}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? activeId : undefined}
        title={selected?.text}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        style={{
          ...controlStyle(invalid),
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          ...style,
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
          {selected ? selected.node : placeholder}
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={15} color='var(--mfg)' />
      </button>

      {open && box && (
        <div
          ref={panel}
          id={listId}
          role='listbox'
          aria-label={ariaLabel}
          onKeyDown={onKey}
          style={{ ...panelStyle(box, { grow: true }), padding: 4 }}
        >
          {items.length === 0 ? (
            <div style={{ padding: '10px 8px', fontSize: 12, color: 'var(--mfg)' }}>
              Nothing to choose from
            </div>
          ) : (
            items.map((o, i) => {
              const chosen = o.value === value;
              return (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role='option'
                  data-value={o.value}
                  aria-selected={chosen}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => commit(o)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    // A 29px row is a fine mouse target and a poor thumb one,
                    // so it grows on touch — as `OptionRow` does next door.
                    padding: mobile ? '11px 10px' : '7px 9px',
                    borderRadius: 'var(--r2)',
                    cursor: o.disabled ? 'not-allowed' : 'pointer',
                    opacity: o.disabled ? 0.45 : 1,
                    fontSize: mobile ? 14 : 13,
                    fontWeight: chosen ? 600 : 400,
                    background: i === active ? 'var(--pri-t)' : 'transparent',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{o.node}</span>
                  {/* Reserved whether or not it is ticked, so choosing a row
                      does not shuffle the text of every row beside it. */}
                  <span
                    aria-hidden
                    style={{
                      flex: 'none',
                      width: 14,
                      color: chosen ? 'var(--pri)' : 'transparent',
                    }}
                  >
                    <Icon name='check' size={14} />
                  </span>
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
}
