import { describe, expect, test } from 'vitest';
import { formatReference, parseReference } from './reference';

describe('formatReference', () => {
  test('builds a padded, typed reference', () => {
    expect(formatReference('VENDOR', 2026, 42)).toBe('VEN-2026-0042');
    expect(formatReference('ASHRAM', 2026, 1)).toBe('ASH-2026-0001');
    expect(formatReference('ASHRAM_FOOD', 2026, 7)).toBe('AFD-2026-0007');
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

  test('returns null for junk rather than throwing', () => {
    expect(parseReference('nonsense')).toBeNull();
    expect(parseReference('XXX-2026-0001')).toBeNull();
    expect(parseReference('')).toBeNull();
  });
});
