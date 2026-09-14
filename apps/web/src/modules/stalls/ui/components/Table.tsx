import type * as React from 'react';

/**
 * The module's table, in the shared look.
 *
 * ⚠️ **A real `<table>`, where the module this design system came from draws a
 * CSS grid of `<div>`s.** The look is matched line for line — the same rail
 * header at 11px/700/uppercase on `--rail`, the same `--line` row rules, the
 * same 12.5px body and 16px gutters — but the element underneath is different,
 * and that is deliberate rather than a shortcut.
 *
 * The grid version exists there to solve a problem these screens do not have:
 * its columns are chosen at runtime by a Columns popover, so the template is a
 * string the screen computes and `gridMinWidth` measures. Nothing here picks
 * its own columns. What these screens DO have is a suite that reaches the
 * pipeline through `getByRole('table')` and the rows through `within(table)` —
 * and a grid of divs has no table role, no row role and no column association,
 * so every one of those queries would have to be rewritten into class or
 * test-id lookups, and a screen reader would meet a wall of unrelated cells.
 *
 * ⚠️ So: same paint, native semantics. If a column picker ever lands on these
 * screens, the answer is `<colgroup>` and conditional `<th>`s — not a port of
 * the grid.
 *
 * The horizontal scroller is the grid version's, kept: a table wider than its
 * card must scroll inside the card rather than push its own last column out
 * past the border.
 */
export function Table({ className, style, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12.5,
          ...style,
        }}
        {...props}
      />
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

/**
 * A row.
 *
 * `onClick` makes it a control, so it takes the hover lift's pointer and the
 * row keeps a `--hov` wash — the same affordance `Card`'s actionable form has.
 * `selected` paints the primary tint, which is how the list says which record
 * the open detail panel belongs to.
 */
export function TR({
  selected,
  onClick,
  style,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr
      onClick={onClick}
      style={{
        borderBottom: '1px solid var(--line)',
        background: selected ? 'var(--pri-t)' : undefined,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
      {...props}
    />
  );
}

/**
 * A header cell, on the table's rail.
 *
 * ⚠️ `--rail-fg`, never `--mfg`. The rail is a SURFACE one step off the card,
 * and in the dark theme the muted grey on it measures 3.45:1 — under the floor,
 * on the header row of every table in the module. `tokens.css` carries the
 * measurement and the reason the fix is on the text rather than the rail.
 */
export function TH({
  align = 'left',
  style,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        position: 'sticky',
        top: 0,
        textAlign: align,
        padding: '10px 16px',
        background: 'var(--rail)',
        borderBottom: '1px solid var(--line)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '.5px',
        textTransform: 'uppercase',
        color: 'var(--rail-fg)',
        whiteSpace: 'nowrap',
        ...style,
      }}
      {...props}
    />
  );
}

export function TD({
  align = 'left',
  muted,
  mono,
  style,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  align?: 'left' | 'right';
  /** Secondary text — a timestamp, a description, a count nobody acts on. */
  muted?: boolean;
  /** References and stall numbers, where the digits should line up. */
  mono?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '11px 16px',
        verticalAlign: 'middle',
        color: muted ? 'var(--mfg)' : undefined,
        fontVariantNumeric: align === 'right' || mono ? 'tabular-nums' : undefined,
        fontFamily: mono ? 'ui-monospace,SFMono-Regular,Menlo,monospace' : undefined,
        ...style,
      }}
      {...props}
    />
  );
}
