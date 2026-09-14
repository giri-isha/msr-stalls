import type { MeResponse, StallAction } from '@msr/stalls';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError } from './api-client';
import { getMe } from './api';

interface MeState {
  me: MeResponse | null;
  status: 'loading' | 'ready';
  reload(): void;
  can(action: StallAction): boolean;
}

const MeContext = createContext<MeState | null>(null);

/** Who is signed in and what the stalls module lets them do. The screens read
 *  `can()` to show or hide an action; the API enforces it regardless — the UI
 *  is never the boundary. */
export function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [tick, setTick] = useState(0);

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
  const can = useCallback((action: StallAction) => me?.actions.includes(action) ?? false, [me]);

  return <MeContext.Provider value={{ me, status, reload, can }}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe must be used inside MeProvider');
  return ctx;
}
