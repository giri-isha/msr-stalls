import { describe, expect, test } from 'vitest';
import { DEFAULT_RATE_CARD_2025, lookupRate, quoteStall } from './rates';

describe('DEFAULT_RATE_CARD_2025', () => {
  // Transcribed from page 3 of `Vendor Stall Request Form 2025.pdf`:
  //   A3, B2 Stalls - Closed
  //   B3, B4 & A4 Food stalls - Rs 18000 + GST
  //   B3, B4 & A4 Non Food  - Rs 15000 + GST
  //   C Food - Rs 15000 + GST
  //   C Non food - Rs 12000 + GST
  test('matches the printed 2025 form', () => {
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'AB', true)).toBe(1_800_000);
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'AB', false)).toBe(1_500_000);
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'C', true)).toBe(1_500_000);
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'C', false)).toBe(1_200_000);
  });

  test('closed zones have no rate at all', () => {
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'CLOSED', true)).toBeNull();
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'CLOSED', false)).toBeNull();
  });
});

describe('quoteStall', () => {
  test('adds GST to the looked-up rate', () => {
    expect(quoteStall(DEFAULT_RATE_CARD_2025, 'AB', true, 18)).toEqual({
      net: 1_800_000,
      gst: 324_000,
      gross: 2_124_000,
    });
  });

  test('a closed zone cannot be quoted', () => {
    expect(quoteStall(DEFAULT_RATE_CARD_2025, 'CLOSED', true, 18)).toBeNull();
  });
});
