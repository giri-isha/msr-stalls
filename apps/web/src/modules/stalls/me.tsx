import type { MeResponse, StallPrivilege } from '@msr/stalls';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError } from './api-client';
import { getMe } from './api';

interface MeState {
  me: MeResponse | null;
  status: 'loading' | 'ready';
  reload(): void;
  can(action: StallPrivilege): boolean;
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
  const can = useCallback(
    (action: StallPrivilege) => me?.privileges.includes(action) ?? false,
    [me],
  );

  return <MeContext.Provider value={{ me, status, reload, can }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe must be used inside MeProvider');
  return ctx;
}
