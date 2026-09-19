import { describe, expect, test } from 'vitest';
import { chargeLines, depositLines } from './quote-letter';
import type { Quote, QuoteLine } from './quote';

const line = (over: Partial<QuoteLine>): QuoteLine => ({
  key: 'stall',
  group: 'stall',
  label: 'Rent for the stall',
  count: 1,
  unitRatePaise: 1_500_000,
  amountPaise: 1_500_000,
  days: null,
  ...over,
});

const quote = (over: Partial<Quote> = {}): Quote => ({
  lines: [],
  stallFeePaise: 0,
  plugFeePaise: 0,
  equipmentFeePaise: 0,
  netPaise: 0,
  gstPaise: 0,
  gstRentPaise: 0,
  gstItemsPaise: 0,
  gstDepositPaise: 0,
  feeTotalPaise: 0,
  stallDepositPaise: 400_000,
  equipmentDepositPaise: 0,
  depositTotalPaise: 400_000,
  grandTotalPaise: 0,
  exempt: false,
  ...over,
});

describe('the charges, as the letter prints them', () => {
  /** 🔴 The multiplication is the point. A vendor querying their bill asks
   *  "why four thousand?", and a summed line cannot answer it. */
  test('shows the count and the unit rate for each item', () => {
    const out = chargeLines(
      quote({
        lines: [
          line({}),
          line({
            key: 'plugs15a',
            group: 'plugs',
            label: '15 Amp',
            count: 4,
            unitRatePaise: 100_000,
            amountPaise: 400_000,
          }),
        ],
        gstPaise: 342_000,
        feeTotalPaise: 2_242_000,
      }),
    );
    expect(out).toContain('15 Amp : 4 × 1000');
    expect(out).toContain('Cost of additional plug points');
    expect(out).toContain('Rent for the stall');
  });

  /** ⚠️ A stall that took no chairs must not read a line charging it nothing —
   *  that looks like a mistake, and a reader deciding whether ₹0.00 is a bug is
   *  a reader who rings the office. */
  test('drops the items charged nothing', () => {
    const out = chargeLines(
      quote({
        lines: [
          line({}),
          line({ key: 'chairs', group: 'equipment', label: 'Chair', count: 0, amountPaise: 0 }),
        ],
        feeTotalPaise: 1_500_000,
      }),
    );
    expect(out).not.toContain('Chair');
    expect(out).not.toContain('Rent for chairs and tables');
  });

  /** Chairs and tables are charged per day; nothing else is, so nothing else
   *  should print a day count. */
  test('says the day count only where the charge has one', () => {
    const out = chargeLines(
      quote({
        lines: [
          line({
            key: 'chairs',
            group: 'equipment',
            label: 'Chair',
            count: 2,
            unitRatePaise: 10_000,
            days: 3,
            amountPaise: 60_000,
          }),
        ],
        feeTotalPaise: 60_000,
      }),
    );
    expect(out).toContain('Chair : 2 × 100 × 3 days');
    expect(chargeLines(quote({ lines: [line({})], feeTotalPaise: 1_500_000 }))).not.toContain(
      'days',
    );
  });

  test('a single stall prints no multiplication, several do', () => {
    expect(chargeLines(quote({ lines: [line({})] }))).not.toContain('1 × ');
    expect(chargeLines(quote({ lines: [line({ count: 3, amountPaise: 4_500_000 })] }))).toContain(
      'Rent for the stall : 3 × 15000',
    );
  });

  test('carries the GST and the fee total', () => {
    const out = chargeLines(
      quote({ lines: [line({})], gstPaise: 270_000, feeTotalPaise: 1_770_000 }),
    );
    expect(out).toContain('GST');
    expect(out).toContain('Total');
  });
});

describe('the caution deposit', () => {
  test('splits stall from furniture, with a total', () => {
    const out = depositLines(
      quote({
        stallDepositPaise: 400_000,
        equipmentDepositPaise: 360_000,
        depositTotalPaise: 760_000,
      }),
    );
    expect(out).toContain('Caution deposit — stall');
    expect(out).toContain('Caution deposit — chairs and tables');
    expect(out).toContain('Total caution deposit');
  });

  /** ⚠️ A vendor who took no furniture must not read a furniture deposit line,
   *  nor a "total" that restates the only figure above it. */
  test('names only the stall when no furniture was taken', () => {
    const out = depositLines(quote());
    expect(out).toContain('Caution deposit — stall');
    expect(out).not.toContain('chairs and tables');
    expect(out).not.toContain('Total caution deposit');
  });
});
