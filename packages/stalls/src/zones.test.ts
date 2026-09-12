import { describe, expect, test } from 'vitest';
import { ZONE_CODES, planTotals, suggestStallCount, zoneGroupOf } from './zones';

describe('ZONE_CODES', () => {
  test('is the 2025 venue layout in walking order', () => {
    expect(ZONE_CODES).toEqual(['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2']);
  });
});

describe('zoneGroupOf', () => {
  test('maps A and B zones to the premium group and C to the general group', () => {
    expect(zoneGroupOf('A4')).toBe('AB');
    expect(zoneGroupOf('B3')).toBe('AB');
    expect(zoneGroupOf('B4')).toBe('AB');
    expect(zoneGroupOf('C1')).toBe('C');
    expect(zoneGroupOf('C2')).toBe('C');
  });

  test('A3 and B2 are their own group — they were closed to vendors in 2025', () => {
    expect(zoneGroupOf('A3')).toBe('CLOSED');
    expect(zoneGroupOf('B2')).toBe('CLOSED');
  });
});

describe('suggestStallCount', () => {
  test('divides crowd by the per-stall divisor and rounds up', () => {
    expect(suggestStallCount(25000, 1000)).toBe(25);
    expect(suggestStallCount(4200, 1000)).toBe(5);
    expect(suggestStallCount(0, 1000)).toBe(0);
  });

  test('a zero or negative divisor yields zero rather than Infinity', () => {
    expect(suggestStallCount(25000, 0)).toBe(0);
    expect(suggestStallCount(25000, -5)).toBe(0);
  });
});

describe('planTotals', () => {
  test('totals each category and the grand total across zones', () => {
    const rows = [
      {
        zoneCode: 'A3' as const,
        counts: {
          VENDOR_FOOD: 0,
          ASHRAM_FOOD: 2,
          LW_FOOD: 0,
          VENDOR_NON_FOOD: 0,
          ASHRAM_NON_FOOD: 6,
          HELP_DESK: 0,
          BACKUP: 0,
        },
      },
      {
        zoneCode: 'A4' as const,
        counts: {
          VENDOR_FOOD: 5,
          ASHRAM_FOOD: 6,
          LW_FOOD: 5,
          VENDOR_NON_FOOD: 2,
          ASHRAM_NON_FOOD: 11,
          HELP_DESK: 0,
          BACKUP: 1,
        },
      },
    ];
    const totals = planTotals(rows);
    // The 2025 planning sheet: A3 totalled 8, A4 totalled 30.
    expect(totals.byZone.A3).toBe(8);
    expect(totals.byZone.A4).toBe(30);
    expect(totals.byCategory.ASHRAM_NON_FOOD).toBe(17);
    expect(totals.grandTotal).toBe(38);
  });

  test('an empty plan totals zero, not NaN', () => {
    const totals = planTotals([]);
    expect(totals.grandTotal).toBe(0);
    expect(totals.byCategory.VENDOR_FOOD).toBe(0);
  });
});
