import { describe, expect, test } from 'vitest';
import { rupeesToPaise as r } from './money';
import { computeRefund } from './refund';

const base = {
  depositTotalPaise: r(5600),
  chairsMissing: 0,
  chairsDamaged: 0,
  tablesMissing: 0,
  tablesDamaged: 0,
  chairReplacementPaise: r(500),
  tableReplacementPaise: r(1500),
  finesPaise: 0,
};

describe('computeRefund', () => {
  test('nothing missing, no fines: the whole deposit comes back', () => {
    expect(computeRefund(base)).toEqual({
      furnitureDeductionPaise: 0,
      finesPaise: 0,
      deductionsPaise: 0,
      refundablePaise: r(5600),
      shortfallPaise: 0,
    });
  });

  test('missing and damaged items are charged at replacement, damaged the same as missing', () => {
    const out = computeRefund({ ...base, chairsMissing: 1, chairsDamaged: 1, tablesDamaged: 1 });
    expect(out.furnitureDeductionPaise).toBe(r(500 + 500 + 1500));
    expect(out.refundablePaise).toBe(r(5600 - 2500));
  });

  test('an unclean-stall fine comes off the deposit too', () => {
    const out = computeRefund({ ...base, finesPaise: r(500) });
    expect(out.refundablePaise).toBe(r(5100));
  });

  test('deductions beyond the deposit are a shortfall, never a negative refund', () => {
    const out = computeRefund({ ...base, tablesMissing: 4, finesPaise: r(1000) });
    expect(out.deductionsPaise).toBe(r(7000));
    expect(out.refundablePaise).toBe(0);
    expect(out.shortfallPaise).toBe(r(1400));
  });

  test('negative counts are treated as zero rather than as a credit', () => {
    const out = computeRefund({ ...base, chairsMissing: -3 });
    expect(out.furnitureDeductionPaise).toBe(0);
  });
});
