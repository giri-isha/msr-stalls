import { useEffect, useState } from 'react';
import { pageSlice } from './components/Pager';
import { usePageSize } from './usePageSize';

/** Everything `Pager` needs, so a screen spreads it rather than wiring six props. */
export type PagerProps = {
  page: number;
  pages: number;
  total: number;
  size: number;
  onPage: (p: number) => void;
  onSize: (n: number) => void;
};

/**
 * One page of a list the screen already holds, plus the footer that moves it.
 *
 * ── Why client-side ─────────────────────────────────────────────────────────
 * Most lists in the module arrive whole: the check-in counter, the onboarding
 * queue, the equipment register and the finance tabs all fetch an edition's
 * rows in one call and filter them in the browser, because every filter on
 * those screens is answered from fields that came with the row. Paging them
 * is therefore a RENDERING question, not a fetching one — eight hundred rows
 * of `<TR>` with a control in each is what makes those screens slow to open,
 * and drawing twenty-five of them is the whole fix.
 *
 * ⚠️ The two lists that genuinely run long — the audit log and the user
 * directory — page on the SERVER and do not use this. They pass their own
 * numbers to `Pager` directly, because a page they did not fetch is not a
 * page they can slice.
 *
 * ── The reset ───────────────────────────────────────────────────────────────
 * `pageSlice` already clamps a page past the end, so a list that shrinks under
 * the reader lands on the last page rather than on nothing. What clamping
 * cannot do is notice that the rows CHANGED while the count stayed similar —
 * pick a different tab, type in the search, and page four of the old list is
 * page four of an unrelated one. Pass `resetOn` whatever says "these are
 * different rows now" (the search text, the active filter, a joined key) and
 * the reader goes back to the top, which is the same rule the directory and
 * the audit log state in their own words.
 */
export function usePaged<T>(
  /** Namespaces the remembered rows-per-page. One per list, not one per file. */
  screenKey: string,
  rows: T[],
  resetOn?: string | number | boolean,
): { slice: T[]; pager: PagerProps } {
  const [size, setSize] = usePageSize(screenKey);
  const [page, setPage] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetOn IS the trigger
  useEffect(() => {
    setPage(0);
  }, [resetOn]);

  const cut = pageSlice(rows, page, size);

  // `cut.page` is the clamped one, and the render above already used it. This
  // only settles the state behind it, so the next interaction starts from the
  // page the reader is actually looking at rather than from the one that was
  // asked for and silently corrected.
  useEffect(() => {
    if (cut.page !== page) setPage(cut.page);
  }, [cut.page, page]);

  return {
    slice: cut.slice,
    pager: {
      page: cut.page,
      pages: cut.pages,
      total: cut.total,
      size,
      onPage: setPage,
      onSize: setSize,
    },
  };
}
