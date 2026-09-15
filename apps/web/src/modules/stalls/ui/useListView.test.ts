import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { BP } from './useBreakpoint';

/**
 * The width, as a value a test can set.
 *
 * ⚠️ The real `useBreakpoint` reads the viewport once at MODULE scope and keeps
 * it in a shared store — deliberately, so the first paint already knows whether
 * it is on a phone. That makes `window.innerWidth = 390` in a test a width the
 * hook never sees. The other way out is `vi.resetModules()` and a dynamic
 * import, and that is worse here: it would hand the hook a second copy of React
 * while `renderHook` holds the first, and the failure is "invalid hook call"
 * rather than anything about breakpoints.
 */
const h = vi.hoisted(() => ({ bp: 'desktop' as BP }));
vi.mock('./useBreakpoint', () => ({ useBreakpoint: () => h.bp }));

const { useListView } = await import('./useListView');

beforeEach(() => {
  h.bp = 'desktop';
  localStorage.clear();
});

describe('useListView', () => {
  test('rows on a laptop, tiles on a phone', () => {
    expect(renderHook(() => useListView('requests')).result.current[0]).toBe('table');

    h.bp = 'mobile';
    expect(renderHook(() => useListView('requests')).result.current[0]).toBe('cards');
  });

  test('a tablet reads as a laptop — it has the width for a table', () => {
    h.bp = 'tablet';
    expect(renderHook(() => useListView('requests')).result.current[0]).toBe('table');
  });

  test('a choice outranks the width, and survives the next visit', () => {
    h.bp = 'mobile';
    const { result } = renderHook(() => useListView('requests'));
    expect(result.current[0]).toBe('cards');

    act(() => result.current[1]('table'));
    expect(result.current[0]).toBe('table');

    // A fresh mount is the next visit: the preference comes back off storage.
    expect(renderHook(() => useListView('requests')).result.current[0]).toBe('table');
  });

  /** ⚠️ The whole reason the guess is not stored on first render. */
  test('an untouched list re-shapes when the window does', () => {
    const { result, rerender } = renderHook(() => useListView('requests'));
    expect(result.current[0]).toBe('table');

    h.bp = 'mobile';
    rerender();
    expect(result.current[0]).toBe('cards');
  });

  test('a chosen list does NOT re-shape when the window does', () => {
    const { result, rerender } = renderHook(() => useListView('requests'));
    act(() => result.current[1]('table'));

    h.bp = 'mobile';
    rerender();
    expect(result.current[0]).toBe('table');
  });

  test('the choice is remembered per screen, not once for the module', () => {
    const requests = renderHook(() => useListView('requests'));
    act(() => requests.result.current[1]('cards'));

    expect(renderHook(() => useListView('onboarding')).result.current[0]).toBe('table');
  });

  test('a storage that throws costs the preference, never the list', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    try {
      const { result } = renderHook(() => useListView('requests'));
      expect(result.current[0]).toBe('table');
      // Still honoured for this session — `chosen` is state; storage only
      // carries it to the next one.
      act(() => result.current[1]('cards'));
      expect(result.current[0]).toBe('cards');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
