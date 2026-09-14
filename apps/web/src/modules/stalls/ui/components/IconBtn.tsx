import { Icon } from '../icons';

/**
 * A row action — edit, delete, push, move, reveal history.
 *
 * 🔴 There were FIVE local copies of this across the screens, drifted apart in
 * every dimension that matters: the prop was `glyph` in four and `icon` in the
 * fifth; the glyph 14px in four and 13px in the fifth; the radius a raw `8` in
 * four and `calc(var(--r4) - 10px)` — 8.7px — in the fifth, so two buttons a
 * screen apart were different shapes nobody chose. Three supported `disabled`,
 * one added `tone`, one had neither, and two named themselves with `title`
 * alone. Three of the five were byte-identical triplicates. The cost of a
 * missing component is not the duplication; it is that fixing one of these
 * fixed a fifth of the product.
 *
 * ⚠️ **The visual box is 28px and the TOUCH TARGET is 44px.** This module is an
 * installed PWA used on phones at the event site, and every copy of this button
 * shipped a 26–30px tap target — roughly half the size a thumb reliably hits,
 * for controls that DELETE things. The hit area is expanded with a pseudo
 * element in `tokens.css` rather than by growing the button, so a row's layout
 * is unchanged and only the reachable area grows.
 */
export function IconBtn({
  label,
  glyph,
  onClick,
  tone,
  disabled,
}: {
  /** The accessible name, and the tooltip. Required — an icon has no text. */
  label: string;
  glyph: string;
  onClick: () => void;
  /**
   * A token reference for the ink, e.g. `var(--des)` on a destructive action.
   * The hover well derives from whatever this resolves to, so a tone needs no
   * second declaration.
   */
  tone?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type='button'
      // ⚠️ BOTH, and they are not redundant. `title` is the tooltip a mouse
      // user gets; `aria-label` is what a screen reader announces. Two of the
      // five copies had only `title`, which some readers do not announce and
      // which nothing visible replaces on an icon-only control.
      aria-label={label}
      title={label}
      disabled={disabled}
      // Conditional: a disabled control must not answer the pointer.
      className={disabled ? undefined : 'msrs-icon-btn'}
      onClick={(e) => {
        // ⚠️ These sit inside rows that are themselves clickable, so without
        // this, deleting a thing also navigates to it.
        e.stopPropagation();
        onClick();
      }}
      style={{
        width: 28,
        height: 28,
        // Anchors the expanded touch target in `tokens.css`.
        position: 'relative',
        borderRadius: 'var(--r2)',
        border: '1px solid var(--bd)',
        background: 'var(--card)',
        color: tone ?? 'var(--fg)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        flex: 'none',
      }}
    >
      <Icon name={glyph} size={14} />
    </button>
  );
}
