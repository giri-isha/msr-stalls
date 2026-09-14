import { addGst } from './money';
import { lookupRate, type RateCardEntry, type RateScope } from './rates';
import type { StallRequestType } from './reference';
import type { ZoneCode } from './zones';

/** What a selected stall costs, itemised exactly as the 2025 payment sheet
 *  itemises it.
 *
 *  The columns of `Vendor Stall Payment Details - 2025` are the specification
 *  for this file, and the names below are theirs:
 *
 *      Stall Fee + Plug Points Fee + Chair and table Fee = Total Before GST
 *      Total Before GST + 18% GST                        = Fee Total
 *      Stall Deposit + Chair and table Deposit           = Refundable Deposit Total
 *
 *  Two things follow from that sheet and are easy to get wrong:
 *
 *  1. **GST applies to the fee, never to the deposit.** A deposit is refunded
 *     in full; taxing it would mean refunding more than was taken, or less than
 *     the vendor paid. The sheet keeps the two totals in separate columns and
 *     so does this.
 *  2. **The first 5A plug is free.** The request form asks for plugs
 *     "excluding default" and the electrical sheet prints "total 5 amp plug
 *     (including 1 default)". The same number therefore means two different
 *     things on the two sheets, and the conversion lives in one place — here
 *     and `plugs5aIncludingDefault` below — rather than at each call site.
 */

/** The free 5A plug point every stall gets. See note 2 above. */
export const DEFAULT_5A_PLUGS = 1;

/** What the electrical and venue-prep sheet prints, given what the vendor
 *  asked for on the form. */
export function plugs5aIncludingDefault(requested: number): number {
  return Math.max(0, requested) + DEFAULT_5A_PLUGS;
}

/** The subset of `StallChargeConfig` the calculation reads. A plain interface
 *  rather than the Prisma row so this stays pure and the web can quote a total
 *  without a round trip. */
export interface ChargeRates {
  chairRatePaise: number;
  tableRatePaise: number;
  lwChairRatePaise: number;
  lwTableRatePaise: number;
  vendorChairRatePaise: number;
  vendorTableRatePaise: number;
  chairTableDepositPaise: number;
  plug5aRatePaise: number;
  plug15aRatePaise: number;
  equipmentDays: number;
  gstPercent: number;
}

/** Which rate card column a requester is quoted from. Ashram types never reach
 *  this — they are exempt and return before it is called. */
export function scopeOf(requestType: StallRequestType): RateScope {
  return requestType === 'LOCAL_WELFARE' ? 'LOCAL_WELFARE' : 'VENDOR';
}

export interface QuoteInput {
  requestType: StallRequestType;
  /** FOOD or NON_FOOD — what the stall sells, which is what the rate card
   *  prices. */
  isFood: boolean;
  /** The zone the stall will actually stand in — see `pricingZone` in the API,
   *  which reads the allocated bay, then the AGREED one, then the requested
   *  one. Quoting the requested bay for a request that was negotiated into a
   *  different one is how a vendor ends up billed for ground they were never
   *  given. */
  zoneCode: ZoneCode;
  numStalls: number;
  plugs5a: number;
  plugs15a: number;
  chairs: number;
  tables: number;
}

export interface QuoteLine {
  key: 'stall' | 'plugs' | 'equipment';
  label: string;
  amountPaise: number;
}

export interface Quote {
  lines: QuoteLine[];
  stallFeePaise: number;
  plugFeePaise: number;
  equipmentFeePaise: number;
  /** "Total Before GST" on the 2025 sheet. */
  netPaise: number;
  gstPaise: number;
  /** "Fee Total". */
  feeTotalPaise: number;
  stallDepositPaise: number;
  equipmentDepositPaise: number;
  /** "Refundable Deposit Total". */
  depositTotalPaise: number;
  /** What the vendor transfers: fee total plus the refundable deposit. */
  grandTotalPaise: number;
  /** True when this requester type is not charged at all — an ashram
   *  department is billed internally, not through this system. The quote is
   *  still returned, all zeros, so a caller never has to special-case null. */
  exempt: boolean;
}

/** Ashram departments do not pay rent, a deposit, or for chairs. The 2025
 *  payment sheet contains vendors and local welfare stalls only. */
const CHARGEABLE = new Set<StallRequestType>(['VENDOR', 'LOCAL_WELFARE']);

/** Three pairs, one per requester type, because 2025 quoted three.
 *
 *  The ashram form says Rs.50/chair/day, the local welfare form Rs.300/table
 *  and Rs.100/chair, and the bank-details form a vendor fills says Rs.100/chair
 *  and Rs.400/table. None of them is "the" rate — see the note in `forms.ts`.
 *
 *  ⚠️ The ashram pair is unreachable from here and that is correct, not dead
 *  code waiting to be deleted: ashram departments are exempt and return above,
 *  billed internally instead. It is kept because it is what the 2025 form
 *  quoted and the figure has to live somewhere. What is NOT correct is letting
 *  a vendor fall through to it, which is what happened while the vendor pair
 *  did not exist — the one requester type that is never billed was setting the
 *  price for the one that always is. */
function chairTableRates(
  requestType: StallRequestType,
  rates: ChargeRates,
): { chair: number; table: number } {
  switch (requestType) {
    case 'VENDOR':
      return { chair: rates.vendorChairRatePaise, table: rates.vendorTableRatePaise };
    case 'LOCAL_WELFARE':
      return { chair: rates.lwChairRatePaise, table: rates.lwTableRatePaise };
    default:
      return { chair: rates.chairRatePaise, table: rates.tableRatePaise };
  }
}

/** Returns `null` when this bay carries no rate at this requester's scope, so
 *  the caller can say "not priced" rather than "free". A zero would read as a
 *  stall given away. */
export function quoteRequest(
  input: QuoteInput,
  card: RateCardEntry[],
  rates: ChargeRates,
): Quote | null {
  const zero: Quote = {
    lines: [],
    stallFeePaise: 0,
    plugFeePaise: 0,
    equipmentFeePaise: 0,
    netPaise: 0,
    gstPaise: 0,
    feeTotalPaise: 0,
    stallDepositPaise: 0,
    equipmentDepositPaise: 0,
    depositTotalPaise: 0,
    grandTotalPaise: 0,
    exempt: true,
  };
  if (!CHARGEABLE.has(input.requestType)) return zero;

  const rate = lookupRate(card, input.zoneCode, input.isFood, scopeOf(input.requestType));
  if (rate === null) return null;
  const unitRate = rate.amountPaise;

  const numStalls = Math.max(1, input.numStalls);
  const days = Math.max(1, rates.equipmentDays);
  const { chair, table } = chairTableRates(input.requestType, rates);

  const stallFeePaise = unitRate * numStalls;
  const plugFeePaise =
    Math.max(0, input.plugs5a) * rates.plug5aRatePaise +
    Math.max(0, input.plugs15a) * rates.plug15aRatePaise;
  const equipmentFeePaise =
    (Math.max(0, input.chairs) * chair + Math.max(0, input.tables) * table) * days;

  const netPaise = stallFeePaise + plugFeePaise + equipmentFeePaise;
  const { gst, gross } = addGst(netPaise, rates.gstPercent);

  // Area-wise, off the rate row for this bay and scope — not one flat figure
  // for the whole venue.
  const stallDepositPaise = rate.depositPaise * numStalls;
  // A flat deposit against the furniture, charged only when any is taken —
  // the 2025 sheet carries one figure per vendor, not a per-chair amount.
  const equipmentDepositPaise =
    input.chairs > 0 || input.tables > 0 ? rates.chairTableDepositPaise : 0;

  return {
    lines: [
      {
        key: 'stall',
        label: `Stall rent × ${numStalls}`,
        amountPaise: stallFeePaise,
      },
      {
        key: 'plugs',
        label: `Plug points (${input.plugs5a} × 5A, ${input.plugs15a} × 15A)`,
        amountPaise: plugFeePaise,
      },
      {
        key: 'equipment',
        label: `Chairs and tables (${input.chairs} chairs, ${input.tables} tables${days > 1 ? `, ${days} days` : ''})`,
        amountPaise: equipmentFeePaise,
      },
    ],
    stallFeePaise,
    plugFeePaise,
    equipmentFeePaise,
    netPaise,
    gstPaise: gst,
    feeTotalPaise: gross,
    stallDepositPaise,
    equipmentDepositPaise,
    depositTotalPaise: stallDepositPaise + equipmentDepositPaise,
    grandTotalPaise: gross + stallDepositPaise + equipmentDepositPaise,
    exempt: false,
  };
}

// ── The discretionary fee ───────────────────────────────────────────────────

/** What a request actually has to pay, which is not always what it was quoted.
 *
 *  🔴 A local welfare stall is priced off the rate card and then settled at
 *  whatever the local welfare team judged the trader could give: "for A3 the
 *  cost is 10,000 — for the coconut wala, probably we will give that stall at
 *  5,000". The call is theirs, it is made per stall, and it is made after the
 *  quote exists. Without somewhere to record it, the quoted figure is the only
 *  figure the system knows, a stall that paid the agreed 5,000 against a
 *  10,000 quote never counts as settled, and it sits on the Finance list and in
 *  "payment pending" for the rest of the season.
 *
 *  So: `feeTotalPaise` stays as quoted and is never rewritten — it is what the
 *  vendor was told — and `discretionaryFeePaise`, when present, is what is
 *  owed. Both are kept, because the gap between them is the concession, and the
 *  team is entitled to see it.
 *
 *  ⚠️ This replaces the FEE only. The refundable deposit is not discretionary:
 *  it comes back in full, so discounting it would mean refunding money that was
 *  never taken. */
export function payableFeePaise(plan: {
  feeTotalPaise: number;
  discretionaryFeePaise: number | null;
}): number {
  return plan.discretionaryFeePaise ?? plan.feeTotalPaise;
}

// ── Refunds ─────────────────────────────────────────────────────────────────

/** 🔴 TWO deposits, not one, and each deduction comes off its own.
 *
 *  The requirement is explicit about which is which: "the chairs & tables not
 *  returned and damaged ... will be deducted from deposit against chairs and
 *  tables", and "any penalty against unclean stalls ... will be deducted from
 *  stall deposit". The 2025 payment sheet carries both columns — Stall Deposit
 *  and Chair and table Deposit — and the quote has always computed them apart.
 *
 *  Pooling them is not a rounding difference. A stall that loses ₹6,000 of
 *  furniture against a ₹4,000 furniture deposit would eat ₹2,000 of the stall
 *  deposit, which under the rule above the vendor is owed back, and would
 *  report no shortfall — so nobody would chase the ₹2,000 either. */
export interface RefundInput {
  /** Held against the stall. Fines come off this one. */
  stallDepositPaise: number;
  /** Held against the chairs and tables. Furniture losses come off this one. */
  equipmentDepositPaise: number;
  /** Chairs and tables not returned or returned damaged. */
  equipmentDeductionPaise: number;
  /** Unclean stall and any other fine. */
  fineDeductionPaise: number;
}

export interface Refund extends RefundInput {
  /** The two deposits, summed — what the vendor actually paid in. */
  depositHeldPaise: number;
  totalDeductionPaise: number;
  /** What comes back out of each deposit, each floored at zero. */
  stallRefundPaise: number;
  equipmentRefundPaise: number;
  refundDuePaise: number;
  /** Deductions that exceeded the deposit they are charged against. The refund
   *  is floored at zero and these say by how much, because the team chases that
   *  separately rather than issuing a negative voucher.
   *
   *  ⚠️ Per bucket. An over-run on furniture is NOT quietly taken out of the
   *  stall deposit — that money is the vendor's, and the excess is a debt to
   *  recover, which is a different conversation from a smaller refund. */
  stallShortfallPaise: number;
  equipmentShortfallPaise: number;
  shortfallPaise: number;
}

/** Never returns a negative refund. A voucher for a negative amount is not a
 *  thing Finance can process; an unrecovered balance is, and it is carried in
 *  the shortfall figures so it stays visible instead of being rounded away. */
export function computeRefund(input: RefundInput): Refund {
  const bucket = (heldPaise: number, deductionPaise: number) => {
    const deduction = Math.max(0, deductionPaise);
    const raw = Math.max(0, heldPaise) - deduction;
    return { deduction, refund: Math.max(0, raw), shortfall: raw < 0 ? -raw : 0 };
  };
  const stall = bucket(input.stallDepositPaise, input.fineDeductionPaise);
  const equipment = bucket(input.equipmentDepositPaise, input.equipmentDeductionPaise);
  return {
    ...input,
    depositHeldPaise:
      Math.max(0, input.stallDepositPaise) + Math.max(0, input.equipmentDepositPaise),
    totalDeductionPaise: stall.deduction + equipment.deduction,
    stallRefundPaise: stall.refund,
    equipmentRefundPaise: equipment.refund,
    refundDuePaise: stall.refund + equipment.refund,
    stallShortfallPaise: stall.shortfall,
    equipmentShortfallPaise: equipment.shortfall,
    shortfallPaise: stall.shortfall + equipment.shortfall,
  };
}

/** What the team owes for furniture that did not come back. Missing items are
 *  charged at the replacement rate an admin configures; "damaged" is a flag on
 *  the row rather than a count, so it carries a single configured penalty. */
export function equipmentDeduction(
  input: { missingChairs: number; missingTables: number; damaged: boolean },
  rates: {
    chairReplacementPaise: number;
    tableReplacementPaise: number;
    damagePenaltyPaise: number;
  },
): number {
  return (
    Math.max(0, input.missingChairs) * rates.chairReplacementPaise +
    Math.max(0, input.missingTables) * rates.tableReplacementPaise +
    (input.damaged ? rates.damagePenaltyPaise : 0)
  );
}
