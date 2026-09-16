import type { RequesterSession } from '@stalls/core';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getRequesterSession } from './api';

interface RequesterState {
  requester: RequesterSession | null;
  status: 'loading' | 'ready';
  reload(): void;
}

const RequesterContext = createContext<RequesterState | null>(null);

/** Who is logged in on the PUBLIC side.
 *
 *  ⚠️ Deliberately not `MeProvider`. That one is backoffice and answers `can()`
 *  about roles a requester will never hold; two things called "me" in one
 *  module is how a requester ends up being asked what they are allowed to do.
 *
 *  ⚠️ A missing session is `null`, never an error. The apply page is public and
 *  has to render for someone who has never logged in, so every failure — a 404
 *  from `/public/session`, an expired cookie, a network fault — reads as
 *  "signed out". The API is the boundary; this only decides what to draw.
 *
 *  TEMPORARY only in what fills it: when SSO replaces the password login, this
 *  provider and its one call are what stay. */
export function RequesterProvider({ children }: { children: ReactNode }) {
  const [requester, setRequester] = useState<RequesterSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [tick, setTick] = useState(0);

  // `tick` is not read in here — it IS the signal. `reload()` bumps it, and
  // that is what re-runs this effect; nothing else it touches is reactive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the reload signal
  useEffect(() => {
    let alive = true;
    setStatus('loading');
    getRequesterSession()
      .then((r) => alive && setRequester(r))
      .catch(() => alive && setRequester(null))
      .finally(() => alive && setStatus('ready'));
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return (
    <RequesterContext.Provider value={{ requester, status, reload }}>
      {children}
    </RequesterContext.Provider>
  );
}

export function useRequester(): RequesterState {
  const ctx = useContext(RequesterContext);
  if (!ctx) throw new Error('useRequester must be used inside RequesterProvider');
  return ctx;
}
