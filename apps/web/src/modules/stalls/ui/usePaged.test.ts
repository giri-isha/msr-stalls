import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE } from './paging';
import { usePaged } from './usePaged';

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

beforeEach(() => {
  localStorage.clear();
});

describe('usePaged', () => {
  test('opens on the default size, which is 25', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(25);
    const { result } = renderHook(() => usePaged('x', rows(60)));
    expect(result.current.slice).toHaveLength(25);
    expect(result.current.slice[0]).toBe(0);
    expect(result.current.pager).toMatchObject({ page: 0, pages: 3, total: 60, size: 25 });
  });

  test('a list that fits is one page, and the footer still counts it', () => {
    const { result } = renderHook(() => usePaged('x', rows(9)));
    expect(result.current.slice).toHaveLength(9);
    expect(result.current.pager).toMatchObject({ page: 0, pages: 1, total: 9 });
  });

  test('turning a page moves the window, not the list', () => {
    const { result } = renderHook(() => usePaged('x', rows(60)));
    act(() => result.current.pager.onPage(2));
    expect(result.current.slice).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
  });

  test('the size is remembered for the next visit, per screen', () => {
    const { result } = renderHook(() => usePaged('equipment', rows(600)));
    act(() => result.current.pager.onSize(500));
    expect(result.current.slice).toHaveLength(500);

    expect(renderHook(() => usePaged('equipment', rows(600))).result.current.slice).toHaveLength(
      500,
    );
    // Another screen is another question, and keeps the default.
    expect(renderHook(() => usePaged('finance-due', rows(600))).result.current.slice).toHaveLength(
      25,
    );
  });

  /** ⚠️ The trap `Pager` and the directory both write down: a page past the end
   *  under a working filter reads as lost rows, not as a paging slip. */
  test('a list that shrinks under the reader lands on the last page, never on nothing', () => {
    const { result, rerender } = renderHook(({ n }) => usePaged('x', rows(n)), {
      initialProps: { n: 200 },
    });
    act(() => result.current.pager.onPage(7));
    expect(result.current.pager.page).toBe(7);

    rerender({ n: 30 });
    expect(result.current.pager).toMatchObject({ page: 1, pages: 2 });
    expect(result.current.slice).toHaveLength(5);
  });

  test('a narrowing returns to the first page when the screen says these are different rows', () => {
    const { result, rerender } = renderHook(({ term }) => usePaged('x', rows(200), term), {
      initialProps: { term: '' },
    });
    act(() => result.current.pager.onPage(4));
    expect(result.current.pager.page).toBe(4);

    rerender({ term: 'green' });
    expect(result.current.pager.page).toBe(0);
  });

  test('an empty list is one page rather than zero', () => {
    const { result } = renderHook(() => usePaged('x', []));
    expect(result.current.pager).toMatchObject({ page: 0, pages: 1, total: 0 });
    expect(result.current.slice).toEqual([]);
  });

  test('a storage that throws costs the preference, never the list', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    try {
      const { result } = renderHook(() => usePaged('x', rows(60)));
      expect(result.current.slice).toHaveLength(25);
    } finally {
      getItem.mockRestore();
    }
  });
});
