import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PLAN_CATEGORIES,
  DEFAULT_ZONES_2025,
  isCategoryKey,
  isZoneCode,
  planTotals,
  suggestStallCount,
} from './zones';

describe('DEFAULT_ZONES_2025', () => {
  test('is the 2025 venue layout in walking order', () => {
    expect(DEFAULT_ZONES_2025.map((z) => z.code)).toEqual([
      'A3',
      'A4',
      'B2',
      'B3',
      'B4',
      'C1',
      'C2',
    ]);
  });

  test('marks the two bays that were closed to trade, and only those', () => {
    const closed = DEFAULT_ZONES_2025.filter((z) => z.isClosedToVendors).map((z) => z.code);
    expect(closed).toEqual(['A3', 'B2']);
  });
});

describe('isZoneCode', () => {
  test('accepts the 2025 codes', () => {
    for (const z of DEFAULT_ZONES_2025) expect(isZoneCode(z.code)).toBe(true);
  });

  // ⚠️ The point of the pattern. A bay added for a future layout has to be
  // accepted by code that shipped before it existed — the venue is redrawn
  // every year, and a closed list would reject a zone the database already
  // held.
  test('accepts a bay the 2025 layout never had', () => {
    expect(isZoneCode('D1')).toBe(true);
    expect(isZoneCode('AA12')).toBe(true);
    expect(isZoneCode('E')).toBe(true);
  });

  test('rejects shapes a stall number could not be built from', () => {
    expect(isZoneCode('')).toBe(false);
    expect(isZoneCode('a4')).toBe(false);
    expect(isZoneCode('A4-1')).toBe(false);
    expect(isZoneCode('A123')).toBe(false);
  });
});

describe('DEFAULT_PLAN_CATEGORIES', () => {
  test('keys are well formed', () => {
    for (const c of DEFAULT_PLAN_CATEGORIES) expect(isCategoryKey(c.key)).toBe(true);
  });

  // The 2025 planning sheet counts these apart from the ashram columns. Folded
  // together, the grid cannot answer the question it exists to answer: how many
  // of each kind of stall is standing in this bay.
  test('sponsor and Adiyogi stalls are countable in their own right', () => {
    const keys = DEFAULT_PLAN_CATEGORIES.map((c) => c.key);
    expect(keys).toContain('SPONSOR_FOOD');
    expect(keys).toContain('SPONSOR_NON_FOOD');
    expect(keys).toContain('ADIYOGI_FOOD');
    expect(keys).toContain('LW_NON_FOOD');
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
  const KEYS = ['VENDOR_FOOD', 'ASHRAM_FOOD', 'LW_FOOD', 'VENDOR_NON_FOOD', 'ASHRAM_NON_FOOD'];

  test('totals each category and the grand total across zones', () => {
    const rows = [
      {
        zoneCode: 'A3',
        counts: { ASHRAM_FOOD: 2, ASHRAM_NON_FOOD: 6 },
      },
      {
        zoneCode: 'A4',
        counts: {
          VENDOR_FOOD: 5,
          ASHRAM_FOOD: 6,
          LW_FOOD: 5,
          VENDOR_NON_FOOD: 2,
          ASHRAM_NON_FOOD: 11,
        },
      },
    ];
    const totals = planTotals(rows, KEYS);
    // The 2025 planning sheet: A3 totalled 8, A4 totalled 29 across these
    // columns.
    expect(totals.byZone.A3).toBe(8);
    expect(totals.byZone.A4).toBe(29);
    expect(totals.byCategory.ASHRAM_NON_FOOD).toBe(17);
    expect(totals.grandTotal).toBe(37);
  });

  // A column an admin added must be counted the moment it is added. Totalling
  // against a fixed list would silently drop it, and the bay it stands in would
  // read as having capacity it does not have.
  test('counts a category the edition configured for itself', () => {
    const totals = planTotals([{ zoneCode: 'D1', counts: { MELA_FOOD: 4 } }], ['MELA_FOOD']);
    expect(totals.byCategory.MELA_FOOD).toBe(4);
    expect(totals.grandTotal).toBe(4);
  });

  test('an empty plan totals zero, not NaN', () => {
    const totals = planTotals([], KEYS);
    expect(totals.grandTotal).toBe(0);
    expect(totals.byCategory.VENDOR_FOOD).toBe(0);
  });
});
