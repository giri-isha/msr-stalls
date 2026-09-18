import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { useLoad } from './hooks';
import { RefreshProvider, useRefresh } from './refresh';

const wrap = ({ children }: { children: ReactNode }) => (
  <RefreshProvider>{children}</RefreshProvider>
);

/** A fetch a test can hold open, so "in flight" is a state rather than a race. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Both halves at once: what the button drives, and what it reads back. */
function useBoth<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  return { load: useLoad(fn, deps), refresh: useRefresh() };
}

describe('the shell refresh', () => {
  test('re-runs a mounted load, and the button reports it', async () => {
    let calls = 0;
    const gate = [deferred<string>(), deferred<string>()];
    const fn = vi.fn(() => gate[calls++].promise);

    const { result } = renderHook(() => useBoth(fn), { wrapper: wrap });

    await act(async () => gate[0].resolve('first'));
    await waitFor(() => expect(result.current.load.data).toBe('first'));
    expect(result.current.refresh.refreshing).toBe(false);

    act(() => result.current.refresh.refresh());
    await waitFor(() => expect(result.current.refresh.refreshing).toBe(true));
    expect(fn).toHaveBeenCalledTimes(2);
    // The point of the whole design: the old answer stays on screen while the
    // new one is fetched, so the screen does not blink back to a spinner.
    expect(result.current.load.data).toBe('first');

    await act(async () => gate[1].resolve('second'));
    await waitFor(() => expect(result.current.load.data).toBe('second'));
    expect(result.current.refresh.refreshing).toBe(false);
  });

  test('every mounted load answers one press', async () => {
    const a = vi.fn(() => Promise.resolve('a'));
    const b = vi.fn(() => Promise.resolve('b'));

    const { result } = renderHook(
      () => {
        useLoad(a);
        useLoad(b);
        return useRefresh();
      },
      { wrapper: wrap },
    );

    await waitFor(() => expect(a).toHaveBeenCalledTimes(1));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  test('a press with nothing mounted does not start a spinner', async () => {
    const { result } = renderHook(() => useRefresh(), { wrapper: wrap });

    act(() => result.current.refresh());

    expect(result.current.refreshing).toBe(false);
    expect(result.current.token).toBe(0);
  });

  test('a load that fails still settles the spinner', async () => {
    const gate = [deferred<string>(), deferred<string>()];
    let calls = 0;
    const fn = vi.fn(() => gate[calls++].promise);

    const { result } = renderHook(() => useBoth(fn), { wrapper: wrap });
    await act(async () => gate[0].resolve('first'));
    await waitFor(() => expect(result.current.load.data).toBe('first'));

    act(() => result.current.refresh.refresh());
    await waitFor(() => expect(result.current.refresh.refreshing).toBe(true));

    await act(async () => {
      gate[1].reject(new Error('nope'));
      await gate[1].promise.catch(() => {});
    });
    await waitFor(() => expect(result.current.refresh.refreshing).toBe(false));
    expect(result.current.load.error?.message).toBe('nope');
  });

  test('a screen unmounted mid-flight does not strand the spinner', async () => {
    const gate = deferred<string>();
    const held = vi.fn(() => gate.promise);

    // Two hooks, one of which goes away while its request is still out. The
    // count it added has to come back with it, or `refreshing` never clears.
    const { result } = renderHook(
      ({ show }: { show: boolean }) => {
        const quick = useLoad(() => Promise.resolve('quick'));
        return { quick, refresh: useRefresh(), show };
      },
      { wrapper: wrap, initialProps: { show: true } },
    );

    const holder = renderHook(() => useLoad(held), { wrapper: wrap });
    await waitFor(() => expect(held).toHaveBeenCalled());
    holder.unmount();

    await waitFor(() => expect(result.current.refresh.refreshing).toBe(false));
    await act(async () => gate.resolve('late'));
  });
});

describe('outside the backoffice', () => {
  test('a load with no provider above it is the hook it always was', async () => {
    const fn = vi.fn(() => Promise.resolve('public'));

    // No wrapper: this is `PublicLayout` and the requester's forms.
    const { result } = renderHook(() => useBoth(fn));
    await waitFor(() => expect(result.current.load.data).toBe('public'));

    // The idle context: a refresh it cannot see, and a token that never moves.
    act(() => result.current.refresh.refresh());
    expect(result.current.refresh.token).toBe(0);
    expect(result.current.refresh.refreshing).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);

    // Its own reload still works — that is the part that must not regress.
    await act(async () => result.current.load.reload());
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});
