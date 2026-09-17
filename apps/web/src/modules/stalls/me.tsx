import { can as grants, defaultNav } from '@stalls/core';
import type { MeResponse, ResolvedNavGroup, StallPrivilege } from '@stalls/core';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError } from './api-client';
import { getMe } from './api';

interface MeState {
  me: MeResponse | null;
  status: 'loading' | 'ready';
  reload(): void;
  can(action: StallPrivilege): boolean;
  /** The caller's sidebar, resolved. */
  nav: ResolvedNavGroup[];
}

const MeContext = createContext<MeState | null>(null);

/** Who is signed in and what the stalls module lets them do. The screens read
 *  `can()` to show or hide an action; the API enforces it regardless — the UI
 *  is never the boundary. */
export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [tick, setTick] = useState(0);

  // `tick` is not read in here — it IS the signal. `reload()` bumps it, and
  // that is what re-runs this effect; nothing else it touches is reactive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the reload signal
  useEffect(() => {
    let alive = true;
    setStatus('loading');
    getMe()
      .then((m) => alive && setMe(m))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setMe(null);
        else throw e;
      })
      .finally(() => alive && setStatus('ready'));
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  /** 🔴 Answered by the SHARED rule, not by `privileges.includes(action)`.
   *
   *  This was a second implementation of `can`, which is the one thing the
   *  shared one exists to prevent — and it went wrong the moment the rule
   *  stopped being a plain membership test. A write implies its read (see
   *  `IMPLIED_READ` in `@stalls/core`), so a volunteer holding `checkin.write`
   *  reaches `checkin.read`; the API agreed and this screen did not, which
   *  shows up as a nav item missing from the one person it is for. */
  const can = useCallback((action: StallPrivilege) => grants(me?.privileges ?? [], action), [me]);

  /**
   * The sidebar the API resolved for this caller — the registry narrowed by
   * their privileges and then arranged by whatever an admin set for their roles.
   *
   * ⚠️ Falls back to the REGISTRY DEFAULTS when the response carries no nav.
   * That is not defensive padding: this module is written to be mounted in a
   * host, and a host serving an older `/me` would otherwise render a shell with
   * no navigation in it at all. The default is exactly the sidebar the module
   * had before any of it was configurable.
   */
  const nav = useMemo(() => (me?.nav?.length ? me.nav : defaultNav(can)), [me, can]);

  return (
    <MeContext.Provider value={{ me, status, reload, can, nav }}>{children}</MeContext.Provider>
  );
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe must be used inside MeProvider');
  return ctx;
}
