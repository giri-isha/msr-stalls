import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { type ColumnDef, useColumns } from './useColumns';

const DEFS: ColumnDef[] = [
  { key: 'reference', label: 'Reference', locked: true },
  { key: 'stall', label: 'Stall' },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Notes', optional: true },
];

beforeEach(() => localStorage.clear());

describe('useColumns', () => {
  test('shows everything except the columns that ship hidden', () => {
    const { result } = renderHook(() => useColumns('list', DEFS));
    expect(result.current.shown('reference')).toBe(true);
    expect(result.current.shown('stall')).toBe(true);
    expect(result.current.shown('notes')).toBe(false);
    expect(result.current.hiddenCount).toBe(1);
    expect(result.current.customised).toBe(false);
  });

  test('hiding one sticks, and comes back on the next visit', () => {
    const { result } = renderHook(() => useColumns('list', DEFS));
    act(() => result.current.toggle('status'));
    expect(result.current.shown('status')).toBe(false);
    expect(result.current.customised).toBe(true);

    expect(renderHook(() => useColumns('list', DEFS)).result.current.shown('status')).toBe(false);
  });

  /** ⚠️ The column that says WHICH ROW THIS IS. A table with it hidden is rows
   *  of statuses belonging to nobody, and the way back is a picker the reader
   *  has to find first. */
  test('a locked column cannot be hidden, even by asking directly', () => {
    const { result } = renderHook(() => useColumns('list', DEFS));
    act(() => result.current.toggle('reference'));
    expect(result.current.shown('reference')).toBe(true);
    expect(result.current.hiddenCount).toBe(1); // still just `notes`
  });

  test('reset goes back to the defaults, not to everything shown', () => {
    const { result } = renderHook(() => useColumns('list', DEFS));
    act(() => result.current.toggle('status'));
    act(() => result.current.toggle('notes'));
    act(() => result.current.reset());

    expect(result.current.shown('status')).toBe(true);
    // `notes` ships hidden, so "reset" must put it back to hidden rather than
    // treating the default as "all of them".
    expect(result.current.shown('notes')).toBe(false);
    expect(result.current.customised).toBe(false);
  });

  test('the choice is per screen, not once for the module', () => {
    const list = renderHook(() => useColumns('list', DEFS));
    act(() => list.result.current.toggle('status'));

    expect(renderHook(() => useColumns('other', DEFS)).result.current.shown('status')).toBe(true);
  });

  /** 🔴 The reason storage holds what is HIDDEN rather than what is shown. */
  test('a column added in a later release is visible to an existing reader', () => {
    const before = renderHook(() => useColumns('list', DEFS));
    act(() => before.result.current.toggle('status'));

    const AFTER: ColumnDef[] = [...DEFS, { key: 'zone', label: 'Zone' }];
    const after = renderHook(() => useColumns('list', AFTER));
    expect(after.result.current.shown('zone')).toBe(true);
    // And the choice they made survives the release.
    expect(after.result.current.shown('status')).toBe(false);
  });

  /** A column that LEAVES is forgotten rather than cleaned up, so rolling a
   *  deploy back does not lose what the reader had chosen. */
  test('a hidden column that no longer exists is ignored, not counted', () => {
    const before = renderHook(() => useColumns('list', DEFS));
    act(() => before.result.current.toggle('status'));

    const SHRUNK: ColumnDef[] = DEFS.filter((d) => d.key !== 'status');
    expect(renderHook(() => useColumns('list', SHRUNK)).result.current.hiddenCount).toBe(1);

    // Back again on the next deploy, still hidden.
    expect(renderHook(() => useColumns('list', DEFS)).result.current.shown('status')).toBe(false);
  });

  test('a storage that throws costs the preference, never the table', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    try {
      const { result } = renderHook(() => useColumns('list', DEFS));
      expect(result.current.shown('stall')).toBe(true);
      act(() => result.current.toggle('stall'));
      expect(result.current.shown('stall')).toBe(false);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
