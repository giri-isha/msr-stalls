import { DEFAULT_PAGE_SIZE, PAGE_SIZES, rangeLabel } from '../paging';
import { Icon } from '../icons';
import { Select } from './Select';

/**
 * Page footer shared by every table.
 *
 * Renders the count even on a single page — knowing there are 41 rows and no
 * more is worth as much as the arrows are.
 *
 * ⚠️ **The navigation sits at the right, as one group.** Right is where a
 * table footer is read for it, and that part is convention — what was wrong
 * was never the side. The arrows and "Page 1 of 2" were five loose flex
 * children strung along the rule, and the indicator was 12px muted grey among
 * a row of 12px muted grey, so on a table wide enough to scroll sideways it
 * read as one more caption and people concluded the list ended at fifty. So
 * the four arrows and the indicator are now ONE element that cannot be
 * strung out or wrapped apart, and the indicator carries the weight and the
 * full-strength colour that says it is state rather than a label.
 *
 * ⚠️ **Changing the size resets the page, and this component does it** rather
 * than trusting its callers. Ten screens render this footer; the one that
 * forgets asks the server for rows 19,500–20,000 of 9,408 and shows an empty
 * table under a working filter, which reads as lost data rather than as a
 * paging slip.
 */
export function Pager({
  page,
  pages,
  total,
  size = DEFAULT_PAGE_SIZE,
  noun = 'row',
  onPage,
  onSize,
}: {
  page: number;
  pages: number;
  total: number;
  /** Rows on a page. Only meaningful alongside `onSize`. */
  size?: number;
  /** Singular; an "s" is appended for anything but one. */
  noun?: string;
  onPage: (p: number) => void;
  /**
   * Omit on a table whose size it cannot honour — the picker is then absent
   * rather than present and dead. A screen that decides its own page size on
   * the server has no business offering the choice.
   */
  onSize?: (n: number) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        borderTop: '1px solid var(--line)',
        fontSize: 12,
        color: 'var(--mfg)',
        flexWrap: 'wrap',
      }}
    >
      {onSize && (
        <RowsPerPage
          value={size}
          onChange={(n) => {
            onSize(n);
            onPage(0);
          }}
        />
      )}
      <div style={{ flex: 'none' }}>{rangeLabel({ page, size, total, noun })}</div>
      {/* The slack sits BETWEEN the count and the navigation: that is what puts
          the arrows on the right edge, and what keeps them there when a wider
          table stretches the footer under them. */}
      <div style={{ flex: 1 }} />
      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
          <Jump
            to={0}
            at={page}
            last={pages - 1}
            icon='chevrons-left'
            label='First Page'
            onPage={onPage}
          />
          <Jump
            to={page - 1}
            at={page}
            last={pages - 1}
            icon='chevron-left'
            label='Previous Page'
            onPage={onPage}
          />
          {/* ⚠️ `--fg` and 600, where the rest of the footer is muted. Which
              page you are on is the one piece of STATE down here — everything
              else is a label or a control — and at 12px muted grey it read as
              another caption and was skipped. */}
          <span
            style={{
              flex: 'none',
              color: 'var(--fg)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              padding: '0 2px',
            }}
          >
            Page {(page + 1).toLocaleString()} of {pages.toLocaleString()}
          </span>
          <Jump
            to={page + 1}
            at={page}
            last={pages - 1}
            icon='chevron-right'
            label='Next Page'
            onPage={onPage}
          />
          <Jump
            to={pages - 1}
            at={page}
            last={pages - 1}
            icon='chevrons-right'
            label='Last Page'
            onPage={onPage}
          />
        </div>
      )}
    </div>
  );
}

/**
 * How many rows at a time, on its own.
 *
 * Split out of the footer for the one list that cannot draw a footer: the
 * request pipeline pages on a CURSOR, so it knows what it has fetched and
 * never what it has not — there is no page count to print and no page to jump
 * to. What it can honour is "fetch me five hundred at a time", which is this
 * control and nothing else in the footer.
 *
 * ⚠️ The label sits BESIDE the picker rather than around it. A `<label>`
 * forwards a click on any non-interactive descendant to the control it names —
 * and the drawn list's option rows are `div`s, so choosing a size inside a
 * wrapping label re-opened the list it had just closed.
 */
export function RowsPerPage({
  value,
  onChange,
  label = 'Rows',
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
      <label htmlFor='stalls-rows-per-page'>{label}</label>
      <Select
        id='stalls-rows-per-page'
        aria-label='Rows per Page'
        value={String(value)}
        onChange={(n) => onChange(Number(n))}
        style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * One of the four arrows.
 *
 * Takes the page it would go to rather than a direction, so "disabled" is one
 * rule — the destination is not a page — instead of four hand-written
 * conditions that each have their own off-by-one to get wrong.
 */
function Jump({
  to,
  at,
  last,
  icon,
  label,
  onPage,
}: {
  to: number;
  at: number;
  last: number;
  icon: string;
  label: string;
  onPage: (p: number) => void;
}) {
  const dead = to < 0 || to > last || to === at;
  return (
    <button
      type='button'
      onClick={() => onPage(to)}
      disabled={dead}
      aria-label={label}
      style={{ ...btn, opacity: dead ? 0.4 : 1, cursor: dead ? 'not-allowed' : 'pointer' }}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

/** Client-side slice, for lists small enough to arrive whole. */
export function pageSlice<T>(rows: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safe = Math.min(page, pages - 1);
  return {
    pages,
    page: safe,
    total: rows.length,
    slice: rows.slice(safe * size, safe * size + size),
  };
}

const btn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 'var(--r2)',
  border: '1px solid var(--bd)',
  background: 'var(--card)',
  color: 'var(--mfg)',
  flex: 'none',
};
