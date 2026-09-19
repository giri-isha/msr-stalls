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
  /** Whether the chair and table rates are daily rates at all — a year the team
   *  charges flat has nowhere else to say so. */
  chairPerDay: boolean;
  tablePerDay: boolean;
  /** 🔴 Three rates. See the note on `StallChargeConfig` — the rent is taxed,
   *  the furniture is taxed only if the team says so this year, and a
   *  refundable deposit is not a supply. Plug points are charged at the ITEMS
   *  rate: they are supplied alongside the stall, like a fan. */
  gstRentPercent: number;
  gstItemsPercent: number;
  gstDepositPercent: number;
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

/**
 * One charged item, as the payment letter prints it.
 *
 * 🔴 `count` and `unitRatePaise` exist because the 2025 letter shows the
 * arithmetic — "15 Amp : 4 × 1000 : ₹4,000.00" — and a vendor querying their
 * bill asks about the multiplication, not the total. A summed line cannot
 * answer "why four thousand?", so the reader has to take it on trust or ring up.
 *
 * ⚠️ `group` is what the letter indents under. Plug points and furniture each
 * print a heading with their items beneath, exactly as the 2025 document does;
 * the stall rent stands alone.
 */
export interface QuoteLine {
  key: 'stall' | 'plugs5a' | 'plugs15a' | 'chairs' | 'tables';
  group: 'stall' | 'plugs' | 'equipment';
  label: string;
  /** How many. `1` for the stall rent when a single stall was allocated. */
  count: number;
  unitRatePaise: number;
  amountPaise: number;
  /** Chairs and tables are charged per DAY; nothing else is. Null where the
   *  multiplication has no day in it, so the letter does not print "× 1 day". */
  days: number | null;
}

export interface Quote {
  lines: QuoteLine[];
  stallFeePaise: number;
  plugFeePaise: number;
  equipmentFeePaise: number;
  /** "Total Before GST" on the 2025 sheet. */
  netPaise: number;
  gstPaise: number;
  /** The three GST rates, applied and kept apart. They sum to `gstPaise`.
   *
   *  ⚠️ `gstDepositPaise` is charged but NOT refundable — it rides in
   *  `feeTotalPaise` rather than in `depositTotalPaise`, so the deposit that
   *  comes back at the end is still the whole deposit that was paid in. */
  gstRentPaise: number;
  gstItemsPaise: number;
  gstDepositPaise: number;
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
/** One line, with its arithmetic intact. */
function line(
  key: QuoteLine['key'],
  group: QuoteLine['group'],
  label: string,
  count: number,
  unitRatePaise: number,
  days: number | null,
): QuoteLine {
  return {
    key,
    group,
    label,
    count,
    unitRatePaise,
    days,
    amountPaise: count * unitRatePaise * (days ?? 1),
  };
}

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
    gstRentPaise: 0,
    gstItemsPaise: 0,
    gstDepositPaise: 0,
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
  // ⚠️ The multiplier is per ROW, not per quote. A chair charged by the day and
  // a table charged flat is a position the team can take, and one `days` over
  // the pair could not express it.
  const chairDays = rates.chairPerDay ? days : null;
  const tableDays = rates.tablePerDay ? days : null;
  const equipmentFeePaise =
    Math.max(0, input.chairs) * chair * (chairDays ?? 1) +
    Math.max(0, input.tables) * table * (tableDays ?? 1);

  const netPaise = stallFeePaise + plugFeePaise + equipmentFeePaise;

  // Area-wise, off the rate row for this bay and scope — not one flat figure
  // for the whole venue.
  const stallDepositPaise = rate.depositPaise * numStalls;
  // A flat deposit against the furniture, charged only when any is taken —
  // the 2025 sheet carries one figure per vendor, not a per-chair amount.
  const equipmentDepositPaise =
    input.chairs > 0 || input.tables > 0 ? rates.chairTableDepositPaise : 0;
  const depositTotalPaise = stallDepositPaise + equipmentDepositPaise;

  // 🔴 Three buckets, each at its own rate, and each ROUNDED on its own. The
  // team's position is not always "GST at one rate on everything" — the rent
  // can be taxed while the chairs are not — and one rate over one net cannot
  // express that. Plugs sit with the furniture: both are things supplied
  // alongside the stall rather than the ground itself.
  const gstRentPaise = addGst(stallFeePaise, rates.gstRentPercent).gst;
  const gstItemsPaise = addGst(plugFeePaise + equipmentFeePaise, rates.gstItemsPercent).gst;
  // ⚠️ Charged on the deposit, but it does NOT join the deposit. GST is not
  // refundable; folding it into `depositTotalPaise` would mean the refund
  // screen handing back tax that was remitted, out of a deposit that was never
  // that large.
  const gstDepositPaise = addGst(depositTotalPaise, rates.gstDepositPercent).gst;
  const gst = gstRentPaise + gstItemsPaise + gstDepositPaise;
  const gross = netPaise + gst;

  return {
    // ⚠️ Every item, including the ones charged nothing. The letter drops the
    // zeroes when it prints; a quote that dropped them here could not tell
    // "asked for none" from "not charged for", and the electrical sheet reads
    // the same rows.
    lines: [
      line('stall', 'stall', 'Rent for the stall', numStalls, unitRate, null),
      line('plugs5a', 'plugs', '5 Amp', Math.max(0, input.plugs5a), rates.plug5aRatePaise, null),
      line(
        'plugs15a',
        'plugs',
        '15 Amp',
        Math.max(0, input.plugs15a),
        rates.plug15aRatePaise,
        null,
      ),
      line('chairs', 'equipment', 'Chair', Math.max(0, input.chairs), chair, chairDays),
      line('tables', 'equipment', 'Table', Math.max(0, input.tables), table, tableDays),
    ],
    stallFeePaise,
    plugFeePaise,
    equipmentFeePaise,
    netPaise,
    gstPaise: gst,
    gstRentPaise,
    gstItemsPaise,
    gstDepositPaise,
    feeTotalPaise: gross,
    stallDepositPaise,
    equipmentDepositPaise,
    depositTotalPaise,
    grandTotalPaise: gross + depositTotalPaise,
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
 *  "payment pending" for the rest of the edition.
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

/**
 * One chargeable thing, as the return counter settles it.
 *
 * 🔴 ONE shape for chairs, tables and anything else the counter lends. Chairs
 * and tables are priced off columns on the charge config and a fan off a row in
 * the item catalogue, but what happens to them at the end is identical — rent
 * for the days nobody paid for, a replacement charge for what never came back,
 * a penalty for what came back broken. Two code paths for one arithmetic is how
 * a fan gets charged a rule the chairs are not.
 */
export interface DeductionLine {
  label: string;
  /** What the counter handed out BEYOND what the payment letter already paid
   *  for: the extra chairs, and the whole count of anything the letter never
   *  knew about. The letter priced the ordered furniture for the days it was
   *  planned to be held, so charging those days again here would bill them
   *  twice. */
  extraCount: number;
  ratePaise: number;
  /** A fan is rented by the day, laying a carpet is charged once. Flat items
   *  took their whole charge in cash at the counter and settle nothing here. */
  perDay: boolean;
  missing: number;
  missingPaise: number;
  damaged: number;
  damagedPaise: number;
}

/**
 * What the vendor owes at the end, off the furniture deposit.
 *
 * Three charges, each itemised rather than summed into one figure: the rent for
 * days beyond the one the counter took cash for, a replacement charge for what
 * never came back, and a penalty for what came back broken.
 *
 * 🔴 Itemised because a vendor disputing a deduction is owed the list. "₹3,400
 * withheld" cannot be argued with; "2 fans × ₹600 not returned" can be, and
 * sometimes should be — the counter's note and the vendor's account differ, and
 * a person settles it.
 *
 * ⚠️ Extra-day rent is charged on the FULL count handed out, including anything
 * missing. They had it for those days and then lost it: the rent and the
 * replacement are different debts, and waiving the first because of the second
 * would make losing an item cheaper than returning it late.
 *
 * ⚠️ `daysHeld` is what the counter read off at collection, not the configured
 * `equipmentDays`. One day is already paid — that is the cash taken when it was
 * handed over — so only the days past the first are settled here.
 */
export function equipmentDeduction(
  lines: DeductionLine[],
  daysHeld: number,
): { totalPaise: number; lines: Array<{ label: string; amountPaise: number }> } {
  const extraDays = Math.max(0, Math.floor(daysHeld) - 1);
  const out: Array<{ label: string; amountPaise: number }> = [];

  for (const l of lines) {
    const rent = l.perDay ? Math.max(0, l.extraCount) * l.ratePaise * extraDays : 0;
    const missing = Math.max(0, l.missing) * l.missingPaise;
    const damaged = Math.max(0, l.damaged) * l.damagedPaise;
    // Zeroes are dropped: a list where every item appears whether or not it
    // was charged buries the two rows that cost the vendor money.
    if (rent > 0) {
      out.push({
        label: `${l.label} — ${extraDays} extra ${extraDays === 1 ? 'day' : 'days'}`,
        amountPaise: rent,
      });
    }
    if (missing > 0) out.push({ label: `${l.label} not returned`, amountPaise: missing });
    if (damaged > 0) out.push({ label: `${l.label} damaged`, amountPaise: damaged });
  }

  return { totalPaise: out.reduce((t, l) => t + l.amountPaise, 0), lines: out };
}
