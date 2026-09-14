import { useSyncExternalStore } from 'react';

export type BP = 'mobile' | 'tablet' | 'desktop';

/** mobile <720 · tablet 720–1023 · desktop ≥1024 */
const TABLET_MIN = 720;
const DESKTOP_MIN = 1024;

const QUERY = `(min-width: ${DESKTOP_MIN}px), (min-width: ${TABLET_MIN}px)`;

function read(): BP {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia(`(min-width: ${DESKTOP_MIN}px)`).matches) return 'desktop';
  if (window.matchMedia(`(min-width: ${TABLET_MIN}px)`).matches) return 'tablet';
  return 'mobile';
}

/**
 * One store, two listeners, however many subscribers.
 *
 * A `resize` listener per component would re-render the whole tree on every
 * frame of a window drag; `matchMedia` fires only when a threshold is actually
 * crossed, and sharing the store means it fires twice, not fifty times.
 */
let current: BP = read();
const subscribers = new Set<() => void>();
let wired = false;

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  const onChange = () => {
    const next = read();
    if (next === current) return; // both queries fire on one crossing
    current = next;
    for (const cb of subscribers) cb();
  };
  for (const q of QUERY.split(', ')) window.matchMedia(q).addEventListener('change', onChange);
}

function subscribe(cb: () => void) {
  wire();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * The current breakpoint.
 *
 * Read through `useSyncExternalStore` rather than `useState` in an effect so
 * the FIRST paint already knows the width — a phone should never flash the
 * desktop layout before an effect corrects it.
 */
export function useBreakpoint(): BP {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'desktop' as BP,
  );
}

/** True below 720px, where a table has to become cards and a dialog a sheet. */
export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}

/** True below 1024px, where the sidebar has to become a drawer. */
export function useIsNarrow(): boolean {
  return useBreakpoint() !== 'desktop';
}
