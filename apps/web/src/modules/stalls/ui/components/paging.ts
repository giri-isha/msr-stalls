/** Paging constants and the range sentence, local to this module. The
 *  volunteering module keeps these in its shared package; here they are one
 *  file so `Pager` ports unchanged. */
export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;

export function rangeLabel({
  page,
  size,
  total,
  noun,
}: {
  page: number;
  size: number;
  total: number;
  noun: string;
}): string {
  if (total === 0) return `No ${noun}s`;
  const from = page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  const word = total === 1 ? noun : `${noun}s`;
  return `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${word}`;
}
