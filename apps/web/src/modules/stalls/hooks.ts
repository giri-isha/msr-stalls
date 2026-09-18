import { useCallback, useEffect, useState } from 'react';
import { useRefresh } from './refresh';

/** Load-on-mount with reload. Small on purpose: the screens need "data,
 *  loading, error, try again" and nothing that a query library would add.
 *
 *  Also answers the shell's refresh button, through `useRefresh().token` in the
 *  deps below — which is why no screen had to be changed to gain one. Outside
 *  the backoffice there is no provider, the token never moves, and this is the
 *  same hook it has always been. See `refresh.tsx`. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const { token, register, setBusy } = useRefresh();

  useEffect(() => register(), [register]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are the caller's cache key
  useEffect(() => {
    let alive = true;
    // ⚠️ Decremented from EITHER the settle or the cleanup, whichever comes
    // first, and exactly once. A deps change mid-flight tears this effect down
    // before the promise resolves, and a count left behind is a spinner in the
    // topbar that never stops.
    let counted = true;
    const settle = () => {
      if (!counted) return;
      counted = false;
      setBusy(-1);
    };
    setBusy(1);
    setLoading(true);
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e as Error))
      .finally(() => {
        settle();
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      settle();
    };
  }, [tick, token, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A value that settles before anything acts on it.
 *
 * For a search box whose every keystroke would otherwise be a request. The
 * pipeline's own search does fire per key — it filters a list already held —
 * but the users directory asks the server each time, and a directory search is
 * typed a name at a time rather than a reference at a time.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
