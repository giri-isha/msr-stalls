import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from './paging';
import { useCallback, useState } from 'react';

/**
 * Per-screen storage key.
 *
 * Namespaced because the module shares an origin with the rest of the
 * platform now — a bare `rows` would be the platform's to claim as much as
 * this module's.
 */
const keyFor = (screenKey: string) => `msrs:rows-${screenKey}`;

/**
 * A size is only honoured if the select could show it.
 *
 * ⚠️ Deliberately STRICTER than the server's `clampPageSize`. The server
 * takes any sane number because a caller is not the select; a stored
 * preference IS the select, so a value it cannot display would leave the
 * footer naming a size nobody chose and no option highlighted.
 */
function readStored(screenKey: string): number {
  if (typeof window === 'undefined') return DEFAULT_PAGE_SIZE;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(keyFor(screenKey));
  } catch {
    // Private mode, or storage disabled. A remembered page size is a
    // convenience; losing it is not worth a crashed screen.
    return DEFAULT_PAGE_SIZE;
  }
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/**
 * The rows-per-page choice for one screen, remembered across visits.
 *
 * Keyed per screen rather than once for the module: the volunteer list at 500
 * and the users table at 500 are not the same request, and someone who wants
 * a whole area in one page rarely wants the same of every other table.
 */
export function usePageSize(screenKey: string): [number, (n: number) => void] {
  const [size, set] = useState(() => readStored(screenKey));
  const choose = useCallback(
    (n: number) => {
      set(n);
      try {
        window.localStorage.setItem(keyFor(screenKey), String(n));
      } catch {
        // Same trade as the read: the choice still applies to this visit.
      }
    },
    [screenKey],
  );
  return [size, choose];
}
