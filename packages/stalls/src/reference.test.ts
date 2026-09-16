import { describe, expect, test } from 'vitest';
import { formatReference, parseReference, STALL_REQUEST_TYPES } from './reference';

describe('formatReference', () => {
  test('builds a padded, typed reference', () => {
    expect(formatReference('VENDOR', 2026, 42)).toBe('VEN-2026-0042');
    expect(formatReference('ASHRAM', 2026, 1)).toBe('ASH-2026-0001');
    expect(formatReference('LOCAL_WELFARE', 2026, 130)).toBe('LWS-2026-0130');
  });

  test('does not truncate a sequence past four digits', () => {
    expect(formatReference('VENDOR', 2026, 12345)).toBe('VEN-2026-12345');
  });
});

describe('parseReference', () => {
  test('round-trips', () => {
    expect(parseReference('VEN-2026-0042')).toEqual({
      type: 'VENDOR',
      year: 2026,
      seq: 42,
    });
  });

  /** 🔴 `AFD` was `ASHRAM_FOOD`, which is no longer a request type. The
   *  references it minted are printed on challans and read down the phone, so a
   *  coordinator pasting one into a search box has to land on the request —
   *  never on "no match" because the prefix retired. */
  test('still understands the retired ashram food prefix', () => {
    expect(parseReference('AFD-2026-0007')).toEqual({ type: 'ASHRAM', year: 2026, seq: 7 });
  });

  /** ⚠️ Understood, never minted again: nothing formats an `AFD` reference. */
  test('never issues the retired prefix', () => {
    for (const type of STALL_REQUEST_TYPES) {
      expect(formatReference(type, 2026, 1).startsWith('AFD-')).toBe(false);
    }
  });

  test('returns null for junk rather than throwing', () => {
    expect(parseReference('nonsense')).toBeNull();
    expect(parseReference('XXX-2026-0001')).toBeNull();
    expect(parseReference('')).toBeNull();
  });
});
