import { describe, expect, test } from 'vitest';
import { DEFAULT_RATE_CARD_2025, lookupRate, quoteStall } from './rates';

const rent = (zone: string, isFood: boolean, scope: 'VENDOR' | 'LOCAL_WELFARE') =>
  lookupRate(DEFAULT_RATE_CARD_2025, zone, isFood, scope)?.amountPaise ?? null;

describe('DEFAULT_RATE_CARD_2025', () => {
  // Transcribed from page 3 of `Vendor Stall Request Form 2025.pdf`:
  //   A3, B2 Stalls - Closed
  //   B3, B4 & A4 Food stalls - Rs 18000 + GST
  //   B3, B4 & A4 Non Food  - Rs 15000 + GST
  //   C Food - Rs 15000 + GST
  //   C Non food - Rs 12000 + GST
  test('matches the printed 2025 form, bay by bay', () => {
    for (const zone of ['A4', 'B3', 'B4']) {
      expect(rent(zone, true, 'VENDOR')).toBe(1_800_000);
      expect(rent(zone, false, 'VENDOR')).toBe(1_500_000);
    }
    for (const zone of ['C1', 'C2']) {
      expect(rent(zone, true, 'VENDOR')).toBe(1_500_000);
      expect(rent(zone, false, 'VENDOR')).toBe(1_200_000);
    }
  });

  test('the bays closed to trade carry no VENDOR rate', () => {
    expect(rent('A3', true, 'VENDOR')).toBeNull();
    expect(rent('B2', false, 'VENDOR')).toBeNull();
  });

  // 🔴 The bug this shape exists to prevent. "Closed" on the 2025 form meant
  // closed to VENDORS; A3 and B2 carried local welfare stalls all along, and
  // the VAP traders standing in them pay more than any other local welfare
  // stall. Pricing every requester off one card meant those stalls could not be
  // quoted at all, so they could never be marked settled either.
  test('the same bays ARE priced for local welfare', () => {
    expect(rent('A3', true, 'LOCAL_WELFARE')).toBe(1_200_000);
    expect(rent('B2', false, 'LOCAL_WELFARE')).toBe(1_000_000);
  });

  test('local welfare is quoted below trade for the same ground', () => {
    for (const zone of ['A4', 'C1']) {
      for (const isFood of [true, false]) {
        const vendor = rent(zone, isFood, 'VENDOR');
        const lw = rent(zone, isFood, 'LOCAL_WELFARE');
        expect(vendor).not.toBeNull();
        expect(lw).not.toBeNull();
        expect(lw as number).toBeLessThan(vendor as number);
      }
    }
  });

  test('every row carries its own advance, so the deposit is area-wise too', () => {
    for (const entry of DEFAULT_RATE_CARD_2025) {
      expect(entry.depositPaise).toBeGreaterThan(0);
    }
  });
});

describe('quoteStall', () => {
  test('adds GST to the looked-up rate', () => {
    expect(quoteStall(DEFAULT_RATE_CARD_2025, 'A4', true, 'VENDOR', 18)).toEqual({
      net: 1_800_000,
      gst: 324_000,
      gross: 2_124_000,
    });
  });

  test('a bay with no rate at this scope cannot be quoted', () => {
    expect(quoteStall(DEFAULT_RATE_CARD_2025, 'A3', true, 'VENDOR', 18)).toBeNull();
  });
});
