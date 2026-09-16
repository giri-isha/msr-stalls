import type { ReactNode } from 'react';

/**
 * The actions at the end of a row — the edit, the delete, the move.
 *
 * 🔴 **`IconBtn` is `display: inline-flex`, and until this component existed
 * most cells relied on that and got it wrong anyway.** The button had been
 * `display: flex`, which is BLOCK level: two of them in one cell stacked
 * vertically, and neither obeyed the cell's own `align='right'` — a block box
 * ignores `text-align`. So the planning tables drew a column headed nothing,
 * right-aligned, with its buttons in a left-hand column one above the other,
 * and the edition table put a 30px `Btn` beside a 28px `IconBtn` with their
 * baselines two pixels apart and no space between them at all.
 *
 * Three screens had already hand-rolled the fix — `display:flex` with a `gap`
 * of 6, or 8, or 4, and `justifyContent:'flex-end'` in two of the three — which
 * is the same drift `IconBtn`'s own comment describes. This is the one copy.
 *
 * ⚠️ `alignItems: center` is what lets a labelled `Btn` sit beside an icon
 * button without either of them looking dropped, and `nowrap` keeps a pair of
 * actions from breaking apart when the table is squeezed — `Table` scrolls
 * sideways inside its card, which is the honest answer to a narrow screen.
 */
export function RowActions({
  children,
  align = 'right',
  wrap,
}: {
  children: ReactNode;
  /** Where the actions sit in the cell. Right, as a row's actions almost
   *  always are — the exception is a form row, where they follow the field. */
  align?: 'right' | 'left';
  /** Lets a cell carrying LABELLED buttons break onto a second line rather than
   *  widen the table past its card. Icon-only actions never want this. */
  wrap?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        gap: 6,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  );
}
