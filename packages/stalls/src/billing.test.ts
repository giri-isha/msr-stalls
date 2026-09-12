import { describe, expect, test } from 'vitest';
import { type BillingCharges, computeBill, furnitureRates } from './billing';
import { rupeesToPaise as r } from './money';

const charges: BillingCharges = {
  chairRatePaise: r(50),
  tableRatePaise: r(150),
  lwChairRatePaise: r(100),
  lwTableRatePaise: r(300),
  vendorChairRatePaise: r(100),
  vendorTableRatePaise: r(400),
  vendorDepositPaise: r(4000),
  localWelfareDepositPaise: r(4000),
  plug5aRatePaise: r(500),
  plug15aRatePaise: r(1000),
  gstPercent: 18,
  eventDays: 2,
};

describe('furnitureRates', () => {
  test('picks the pair the requester type was quoted', () => {
    expect(furnitureRates('VENDOR', charges)).toEqual({ chairPaise: r(100), tablePaise: r(400) });
    expect(furnitureRates('LOCAL_WELFARE', charges)).toEqual({
      chairPaise: r(100),
      tablePaise: r(300),
    });
    expect(furnitureRates('ASHRAM', charges)).toEqual({ chairPaise: r(50), tablePaise: r(150) });
    expect(furnitureRates('ASHRAM_FOOD', charges)).toEqual({
      chairPaise: r(50),
      tablePaise: r(150),
    });
  });
});

describe('computeBill — vendor', () => {
  const vendor = {
    requestType: 'VENDOR' as const,
    numStallsRequested: 1,
    plugs5a: 2,
    plugs15a: 1,
    chairsNeeded: 4,
    tablesNeeded: 1,
  };

  test('rent × stalls, extra plug points, furniture by day, GST on the fees only', () => {
    const b = computeBill(vendor, charges, r(18000));
    expect(b.stallFeePaise).toBe(r(18000));
    // 2 requested, 1 included → 1 extra 5 A at 500, plus 1 × 15 A at 1000
    expect(b.plugPointsFeePaise).toBe(r(1500));
    // (4 × 100 + 1 × 400) × 2 days
    expect(b.furnitureFeePaise).toBe(r(1600));
    expect(b.netPaise).toBe(r(21100));
    expect(b.gstPaise).toBe(r(3798));
    expect(b.grossPaise).toBe(r(24898));
    expect(b.stallDepositPaise).toBe(r(4000));
    expect(b.furnitureDepositPaise).toBe(r(1600));
    expect(b.depositTotalPaise).toBe(r(5600));
    expect(b.totalPayablePaise).toBe(r(30498));
  });

  test('two stalls include two 5 A points and double the rent', () => {
    const b = computeBill({ ...vendor, numStallsRequested: 2, plugs5a: 2 }, charges, r(18000));
    expect(b.stallFeePaise).toBe(r(36000));
    expect(b.plugPointsFeePaise).toBe(r(1000)); // only the 15 A point
  });

  test('a closed zone bills zero rent rather than failing', () => {
    const b = computeBill(vendor, charges, null);
    expect(b.stallFeePaise).toBe(0);
    expect(b.totalPayablePaise).toBeGreaterThan(0);
  });

  test('every figure is an integer', () => {
    const b = computeBill(
      { ...vendor, chairsNeeded: 3 },
      { ...charges, gstPercent: 18 },
      1_234_567,
    );
    for (const [k, v] of Object.entries(b))
      if (typeof v === 'number') expect(Number.isInteger(v), k).toBe(true);
  });

  test('itemises the lines the payment email prints', () => {
    const b = computeBill(vendor, charges, r(18000));
    expect(b.lines.map((l) => l.label)).toEqual([
      'Stall rent × 1',
      'Extra 5 A plug points × 1',
      '15 A plug points × 1',
      'Chairs × 4 × 2 days',
      'Tables × 1 × 2 days',
      'GST 18%',
      'Security deposit (refundable)',
      'Chairs & tables advance (refundable)',
    ]);
    expect(b.lines.reduce((n, l) => n + l.amountPaise, 0)).toBe(b.totalPayablePaise);
  });
});

describe('computeBill — local welfare', () => {
  test('no rent; deposit, plugs and furniture at the LW rates', () => {
    const b = computeBill(
      {
        requestType: 'LOCAL_WELFARE',
        numStallsRequested: 1,
        plugs5a: 1,
        plugs15a: 0,
        chairsNeeded: 2,
        tablesNeeded: 1,
      },
      charges,
      null,
    );
    expect(b.stallFeePaise).toBe(0);
    expect(b.plugPointsFeePaise).toBe(0);
    expect(b.furnitureFeePaise).toBe(r((2 * 100 + 300) * 2));
    expect(b.stallDepositPaise).toBe(r(4000));
  });
});

describe('computeBill — ashram', () => {
  test('no rent and no security deposit; furniture at the ashram rate', () => {
    const b = computeBill(
      {
        requestType: 'ASHRAM',
        numStallsRequested: 1,
        plugs5a: 3,
        plugs15a: 0,
        chairsNeeded: 4,
        tablesNeeded: 2,
      },
      charges,
      r(18000),
    );
    expect(b.stallFeePaise).toBe(0);
    expect(b.plugPointsFeePaise).toBe(r(1000));
    expect(b.furnitureFeePaise).toBe(r((4 * 50 + 2 * 150) * 2));
    expect(b.stallDepositPaise).toBe(0);
  });
});
