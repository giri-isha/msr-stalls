import { describe, expect, it } from 'vitest';
import { formatInr, rupeesToPaise } from './money';
import {
  type ChargeRates,
  DEFAULT_5A_PLUGS,
  computeRefund,
  equipmentDeduction,
  payableFeePaise,
  plugs5aIncludingDefault,
  quoteRequest,
} from './quote';
import { DEFAULT_RATE_CARD_2025 } from './rates';

const RATES: ChargeRates = {
  chairRatePaise: rupeesToPaise(50),
  tableRatePaise: rupeesToPaise(150),
  lwChairRatePaise: rupeesToPaise(100),
  lwTableRatePaise: rupeesToPaise(300),
  vendorChairRatePaise: rupeesToPaise(100),
  vendorTableRatePaise: rupeesToPaise(400),
  chairTableDepositPaise: rupeesToPaise(4000),
  plug5aRatePaise: rupeesToPaise(500),
  plug15aRatePaise: rupeesToPaise(1000),
  equipmentDays: 1,
  gstPercent: 18,
};

const base = {
  requestType: 'VENDOR' as const,
  isFood: true,
  zoneCode: 'B3' as const,
  numStalls: 1,
  plugs5a: 0,
  plugs15a: 0,
  chairs: 0,
  tables: 0,
};

describe('plug points', () => {
  it('adds the one free plug when printing the electrical sheet', () => {
    expect(plugs5aIncludingDefault(4)).toBe(5);
    expect(plugs5aIncludingDefault(0)).toBe(DEFAULT_5A_PLUGS);
  });

  it('does not charge for the default plug', () => {
    const q = quoteRequest({ ...base, plugs5a: 0 }, DEFAULT_RATE_CARD_2025, RATES);
    expect(q?.plugFeePaise).toBe(0);
  });
});

describe('quoteRequest', () => {
  it('reproduces the 2025 sheet row for a B3 food vendor', () => {
    // Vendor Stall Payment Details 2025, first row: B3 food stall, 4 × 5A,
    // 5 × 15A, no chairs or tables. Stall fee 18000, plug points 7000.
    const q = quoteRequest({ ...base, plugs5a: 4, plugs15a: 5 }, DEFAULT_RATE_CARD_2025, RATES);
    expect(q).not.toBeNull();
    expect(q?.stallFeePaise).toBe(rupeesToPaise(18_000));
    expect(q?.plugFeePaise).toBe(rupeesToPaise(7_000));
    expect(q?.netPaise).toBe(rupeesToPaise(25_000));
    expect(q?.gstPaise).toBe(rupeesToPaise(4_500));
    expect(q?.feeTotalPaise).toBe(rupeesToPaise(29_500));
  });

  it('keeps GST off the deposit', () => {
    const q = quoteRequest(base, DEFAULT_RATE_CARD_2025, RATES);
    expect(q).not.toBeNull();
    if (!q) return;
    expect(q.stallDepositPaise).toBe(rupeesToPaise(4_000));
    expect(q.depositTotalPaise).toBe(rupeesToPaise(4_000));
    // The deposit is added AFTER the fee is grossed up, never taxed.
    expect(q.grandTotalPaise).toBe(q.feeTotalPaise + q.depositTotalPaise);
  });

  // 🔴 THREE pairs, because 2025 quoted three. The ashram form says Rs.50/chair,
  // the local welfare form Rs.100/chair and Rs.300/table, and the bank-details
  // form a vendor fills says Rs.100/chair and Rs.400/table. A vendor billed off
  // the ashram figure is billed off a form that was never addressed to them —
  // and the ashram pair is the one requester type that is never billed at all.
  it('quotes each requester type from its own chair and table rates', () => {
    const lw = quoteRequest(
      { ...base, requestType: 'LOCAL_WELFARE', chairs: 2, tables: 1 },
      DEFAULT_RATE_CARD_2025,
      RATES,
    );
    const vendor = quoteRequest({ ...base, chairs: 2, tables: 1 }, DEFAULT_RATE_CARD_2025, RATES);
    expect(lw?.equipmentFeePaise).toBe(rupeesToPaise(2 * 100 + 300));
    expect(vendor?.equipmentFeePaise).toBe(rupeesToPaise(2 * 100 + 400));
    // Not the same figure, which is the whole point of keeping both.
    expect(vendor?.equipmentFeePaise).not.toBe(lw?.equipmentFeePaise);
  });

  it('multiplies chairs and tables by the number of days they are held', () => {
    const q = quoteRequest({ ...base, chairs: 4, tables: 2 }, DEFAULT_RATE_CARD_2025, {
      ...RATES,
      equipmentDays: 3,
    });
    expect(q?.equipmentFeePaise).toBe(rupeesToPaise((4 * 100 + 2 * 400) * 3));
  });

  it('charges the furniture deposit only when furniture is taken', () => {
    expect(quoteRequest(base, DEFAULT_RATE_CARD_2025, RATES)?.equipmentDepositPaise).toBe(0);
    expect(
      quoteRequest({ ...base, chairs: 1 }, DEFAULT_RATE_CARD_2025, RATES)?.equipmentDepositPaise,
    ).toBe(rupeesToPaise(4_000));
  });

  it('prices each stall of a multi-stall request', () => {
    const q = quoteRequest({ ...base, numStalls: 3 }, DEFAULT_RATE_CARD_2025, RATES);
    expect(q?.stallFeePaise).toBe(rupeesToPaise(54_000));
    expect(q?.stallDepositPaise).toBe(rupeesToPaise(12_000));
  });

  it('returns null for a bay with no rate at this scope rather than quoting zero', () => {
    // A3 is closed to vendors. Zero would read as a free stall.
    expect(quoteRequest({ ...base, zoneCode: 'A3' }, DEFAULT_RATE_CARD_2025, RATES)).toBeNull();
  });

  // 🔴 The same bay, the same night, two requesters: the vendor cannot stand
  // there and the local welfare trader can. Quoting both off one card is what
  // left the VAP stalls permanently unpriced.
  it('prices a bay closed to trade for a local welfare requester', () => {
    const lw = quoteRequest(
      { ...base, requestType: 'LOCAL_WELFARE', zoneCode: 'A3' },
      DEFAULT_RATE_CARD_2025,
      RATES,
    );
    expect(lw).not.toBeNull();
    expect(lw?.stallFeePaise).toBeGreaterThan(0);
  });

  it('quotes local welfare below trade for the same ground', () => {
    const vendor = quoteRequest(base, DEFAULT_RATE_CARD_2025, RATES);
    const lw = quoteRequest(
      { ...base, requestType: 'LOCAL_WELFARE' },
      DEFAULT_RATE_CARD_2025,
      RATES,
    );
    expect(lw?.stallFeePaise).toBeLessThan(vendor?.stallFeePaise ?? 0);
  });

  // The advance follows the bay, not one figure for the whole venue.
  it('takes the advance from the bay that was quoted', () => {
    const premium = quoteRequest(base, DEFAULT_RATE_CARD_2025, RATES);
    const general = quoteRequest({ ...base, zoneCode: 'C1' }, DEFAULT_RATE_CARD_2025, RATES);
    expect(premium?.stallDepositPaise).toBeGreaterThan(0);
    expect(general?.stallDepositPaise).toBeGreaterThan(0);
  });

  it('exempts ashram departments, and says so', () => {
    const q = quoteRequest(
      { ...base, requestType: 'ASHRAM_FOOD', chairs: 10 },
      DEFAULT_RATE_CARD_2025,
      RATES,
    );
    expect(q?.exempt).toBe(true);
    expect(q?.grandTotalPaise).toBe(0);
  });

  it('prices C-zone non-food at the 2025 rate', () => {
    const q = quoteRequest(
      { ...base, zoneCode: 'C1', isFood: false },
      DEFAULT_RATE_CARD_2025,
      RATES,
    );
    expect(q).not.toBeNull();
    if (!q) return;
    expect(formatInr(q.stallFeePaise)).toBe('₹12,000');
  });
});

describe('the discretionary fee', () => {
  it('is the quoted figure until the team agrees something else', () => {
    expect(payableFeePaise({ feeTotalPaise: 1_000_000, discretionaryFeePaise: null })).toBe(
      1_000_000,
    );
  });

  // 🔴 Without this, a local welfare stall that paid the agreed 5,000 against a
  // 10,000 quote is never "paid in full" — it sits on Finance's list and shows
  // "payment pending" to the requester for the rest of the edition.
  it('is what was agreed, once it is agreed', () => {
    expect(payableFeePaise({ feeTotalPaise: 1_000_000, discretionaryFeePaise: 500_000 })).toBe(
      500_000,
    );
  });

  it('a zero concession is a real figure, not an absence', () => {
    expect(payableFeePaise({ feeTotalPaise: 1_000_000, discretionaryFeePaise: 0 })).toBe(0);
  });
});

describe('refunds', () => {
  it('subtracts both deductions from the deposit', () => {
    const r = computeRefund({
      stallDepositPaise: rupeesToPaise(4_000),
      equipmentDepositPaise: rupeesToPaise(4_000),
      equipmentDeductionPaise: rupeesToPaise(1_200),
      fineDeductionPaise: rupeesToPaise(500),
    });
    expect(r.depositHeldPaise).toBe(rupeesToPaise(8_000));
    expect(r.totalDeductionPaise).toBe(rupeesToPaise(1_700));
    expect(r.refundDuePaise).toBe(rupeesToPaise(6_300));
    expect(r.shortfallPaise).toBe(0);
  });

  it('floors the refund at zero and carries the shortfall separately', () => {
    const r = computeRefund({
      stallDepositPaise: 0,
      equipmentDepositPaise: rupeesToPaise(4_000),
      equipmentDeductionPaise: rupeesToPaise(5_000),
      fineDeductionPaise: 0,
    });
    expect(r.refundDuePaise).toBe(0);
    expect(r.shortfallPaise).toBe(rupeesToPaise(1_000));
  });

  it('charges each deduction to its own deposit', () => {
    // The requirement is explicit: furniture losses come off the chairs-and-
    // tables deposit, fines come off the stall deposit.
    const r = computeRefund({
      stallDepositPaise: rupeesToPaise(4_000),
      equipmentDepositPaise: rupeesToPaise(4_000),
      equipmentDeductionPaise: rupeesToPaise(1_000),
      fineDeductionPaise: rupeesToPaise(500),
    });
    expect(r.equipmentRefundPaise).toBe(rupeesToPaise(3_000));
    expect(r.stallRefundPaise).toBe(rupeesToPaise(3_500));
  });

  it('an over-run on one deposit does not eat the other', () => {
    // ⚠️ The case pooling got wrong. ₹6,000 of furniture lost against a ₹4,000
    // furniture deposit: the stall deposit comes back whole and the ₹2,000 is a
    // debt to chase, not a silently smaller refund.
    const r = computeRefund({
      stallDepositPaise: rupeesToPaise(4_000),
      equipmentDepositPaise: rupeesToPaise(4_000),
      equipmentDeductionPaise: rupeesToPaise(6_000),
      fineDeductionPaise: 0,
    });
    expect(r.equipmentRefundPaise).toBe(0);
    expect(r.equipmentShortfallPaise).toBe(rupeesToPaise(2_000));
    expect(r.stallRefundPaise).toBe(rupeesToPaise(4_000));
    expect(r.stallShortfallPaise).toBe(0);
    expect(r.refundDuePaise).toBe(rupeesToPaise(4_000));
    expect(r.shortfallPaise).toBe(rupeesToPaise(2_000));
  });

  it('both buckets can over-run at once', () => {
    const r = computeRefund({
      stallDepositPaise: rupeesToPaise(1_000),
      equipmentDepositPaise: rupeesToPaise(1_000),
      equipmentDeductionPaise: rupeesToPaise(1_500),
      fineDeductionPaise: rupeesToPaise(2_000),
    });
    expect(r.refundDuePaise).toBe(0);
    expect(r.shortfallPaise).toBe(rupeesToPaise(1_500));
  });

  it('prices missing and damaged furniture', () => {
    const d = equipmentDeduction(
      { missingChairs: 2, missingTables: 1, damaged: true },
      {
        chairReplacementPaise: rupeesToPaise(400),
        tableReplacementPaise: rupeesToPaise(900),
        damagePenaltyPaise: rupeesToPaise(250),
      },
    );
    expect(d).toBe(rupeesToPaise(2 * 400 + 900 + 250));
  });
});
