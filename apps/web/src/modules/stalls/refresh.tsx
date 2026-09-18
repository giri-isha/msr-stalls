// The topbar's refresh, and the wiring that lets one button re-run whatever
// the screen in front of it happens to be loading.
//
// Every screen loads through `useLoad`, which already owns a private counter
// and a `reload()` that bumps it. This is that same signal raised one level: a
// module-wide token that each `useLoad` carries in its effect deps. The button
// bumps the token; 59 call sites refetch; nothing per-screen had to be written.
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface RefreshState {
  /** Bumped by `refresh()`. `useLoad` carries it in its effect deps. */
  token: number;
  /** A refresh is in flight — the button spins and is disabled. */
  refreshing: boolean;
  refresh(): void;
  /** Called by `useLoad` on mount. Returns its unregister. */
  register(): () => void;
  /** Called by `useLoad` around each fetch: +1 in flight, −1 settled. */
  setBusy(delta: number): void;
}

/**
 * ⚠️ A WORKING no-op, not a thrown error, and that is the whole of the "the
 * public screens are untouched" story.
 *
 * `useLoad` is used by the requester's forms and `PublicLayout` as well as the
 * backoffice, and those render outside this provider. They read this value, its
 * `token` never moves, their effect deps never change, and they behave exactly
 * as they did before the button existed. No subscription, no cost, and no
 * `useRefresh must be used inside…` for a screen that legitimately has no
 * refresh button above it.
 */
const IDLE: RefreshState = {
  token: 0,
  refreshing: false,
  refresh: () => {},
  register: () => () => {},
  setBusy: () => {},
};

const RefreshContext = createContext<RefreshState>(IDLE);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(0);
  const [busy, setBusy] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // How many `useLoad`s are mounted under here. A ref rather than state: the
  // provider has no reason to re-render when a screen mounts, only when
  // something is in flight.
  const mounted = useRef(0);

  const register = useCallback(() => {
    mounted.current += 1;
    return () => {
      mounted.current -= 1;
    };
  }, []);

  const bumpBusy = useCallback((delta: number) => {
    setBusy((n) => n + delta);
  }, []);

  const refresh = useCallback(() => {
    // ⚠️ Nothing to refresh means nothing happens — NOT a spinner with no
    // request behind it. This is also what closes the one hole in the rule
    // below: a screen with no loaders would never raise the count, so the
    // spinner would never clear. Refused at the source rather than patched
    // with a timeout.
    if (mounted.current === 0) return;
    setToken((t) => t + 1);
    setRefreshing(true);
  }, []);

  // 🔴 Cleared on a TRANSITION — count was above zero, count is now zero — and
  // not on the level `busy === 0`, which races and always loses.
  //
  // `refresh()` bumps the token; React then runs the loaders' effects and this
  // one in the same pass, and this one reads the count as it was COMMITTED,
  // which is still zero. On the level rule it would clear `refreshing` before a
  // single request had left. The transition cannot fire until something has
  // actually been in flight.
  const prevBusy = useRef(0);
  useEffect(() => {
    if (prevBusy.current > 0 && busy === 0) setRefreshing(false);
    prevBusy.current = busy;
  }, [busy]);

  const value = useMemo<RefreshState>(
    () => ({ token, refreshing, refresh, register, setBusy: bumpBusy }),
    [token, refreshing, refresh, register, bumpBusy],
  );

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefresh(): RefreshState {
  return useContext(RefreshContext);
}
