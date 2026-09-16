import { DEFAULT_PAGE_SIZE, PAGE_SIZES, rangeLabel } from '../paging';
import { Icon } from '../icons';

/**
 * Page footer shared by every table.
 *
 * Renders the count even on a single page — knowing there are 41 rows and no
 * more is worth as much as the arrows are.
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
   * Omit on a table whose size it cannot honour — the select is then absent
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
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}
          htmlFor='msrs-rows-per-page'
        >
          Rows
          <select
            id='msrs-rows-per-page'
            aria-label='Rows per Page'
            value={size}
            onChange={(e) => {
              onSize(Number(e.target.value));
              onPage(0);
            }}
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--r2)',
              border: '1px solid var(--bd)',
              background: 'var(--card)',
              color: 'var(--fg)',
              fontSize: 12,
              outline: 'none',
            }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      <div style={{ flex: 1 }}>{rangeLabel({ page, size, total, noun })}</div>
      {pages > 1 && (
        <>
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
          <span style={{ flex: 'none' }}>
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
        </>
      )}
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
