// What a page footer is allowed to be, said once for both halves.

/**
 * The row counts a footer offers, smallest first.
 *
 * 500 is deliberately at the top and deliberately uncomfortable: the tables
 * do not virtualise, so it is the size you pick when you mean it — reading a
 * whole area in one go before an export — not one to sit on.
 */
export const PAGE_SIZES = [25, 50, 75, 100, 200, 300, 400, 500] as const;

/** What a screen shows before anyone chooses. */
export const DEFAULT_PAGE_SIZE = 50;

/**
 * The most rows any list endpoint will return.
 *
 * Tied to the largest size on offer by a test, because the failure when they
 * drift is silent: the select names 500 and the server sends 200.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * The size a list endpoint should actually use, from whatever arrived.
 *
 * Deliberately NOT restricted to `PAGE_SIZES`: the select is one caller, and
 * an endpoint stricter than its callers is a 400 nobody asked for. What it
 * does refuse is a size that cannot describe a page — 0 makes the page count
 * Infinity, and the footer will happily render that.
 */
export function clampPageSize(raw: string | number | undefined | null): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || raw === '' || raw === null || raw === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  const whole = Math.floor(n);
  if (whole < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(whole, MAX_PAGE_SIZE);
}

/** Plural unless there is exactly one. */
function plural(n: number, noun: string): string {
  return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * How the footer names the slice in front of you.
 *
 * A range is only worth printing when there is somewhere else to be: a list
 * that fits on one page reads as a plain count, which is what the footer said
 * before it could page at all.
 */
export function rangeLabel({
  page,
  size,
  total,
  noun,
}: {
  /** Zero-based, as every list endpoint in the module counts pages. */
  page: number;
  size: number;
  total: number;
  /** Singular; an "s" is appended for anything but one. */
  noun: string;
}): string {
  if (total <= size) return plural(total, noun);
  const from = page * size + 1;
  const to = Math.min(from + size - 1, total);
  return `${from.toLocaleString()}–${to.toLocaleString()} of ${plural(total, noun)}`;
}
