import { addGst, rupeesToPaise } from './money';
import type { ZoneCode } from './zones';

/** Who a rate applies to.
 *
 *  ⚠️ A local welfare stall is NOT a cheap vendor stall — it is its own price
 *  for the same ground. The same pitch in the same bay is quoted at one figure
 *  to an external vendor and a lower one to a local welfare requester, because
 *  the second is a village trader the Foundation wants standing there and the
 *  rent is a contribution rather than a market price. Pricing them off one
 *  number would either overcharge the village or undercharge the trade.
 *
 *  Ashram departments are absent on purpose: they are billed internally and
 *  never quoted at all (`quote.ts`). */
export const RATE_SCOPES = ['VENDOR', 'LOCAL_WELFARE'] as const;
export type RateScope = (typeof RATE_SCOPES)[number];

export interface RateCardEntry {
  /** The zone itself, not a band of zones. The rent genuinely differs bay by
   *  bay — a VIP bay behind Adiyogi against a general-seating bay is a
   *  different proposition — and banding them meant two bays that happened to
   *  share a letter could never be priced apart. */
  zoneCode: ZoneCode;
  isFood: boolean;
  scope: RateScope;
  /** Rent, before GST. */
  amountPaise: number;
  /** The refundable advance for this bay, at this scope.
   *
   *  ⚠️ Area-wise, not one flat figure: "keep the advance also area wise — it
   *  might be 3000, and for the free area it might be only 2000". It rides on
   *  the rate row rather than sitting in the charge config so a bay's rent and
   *  its advance are edited together and cannot drift apart. */
  depositPaise: number;
}

/** The rents printed on the 2025 vendor form, page 3, verbatim:
 *
 *    A3, B2 Stalls          Closed
 *    B3, B4 & A4 Food       Rs 18000 + GST
 *    B3, B4 & A4 Non Food   Rs 15000 + GST
 *    C Food                 Rs 15000 + GST
 *    C Non food             Rs 12000 + GST
 *
 *  ⚠️ "Closed" on that page means closed TO VENDORS. A3 and B2 carried ashram
 *  and local welfare stalls in 2025 — including the VAP traders who pay the
 *  most of any local welfare stall — so they are priced here at the local
 *  welfare scope and omitted only at the vendor one.
 *
 *  Local welfare figures are seeded from the vendor rent of the same bay,
 *  because that is the relationship the team describes (the same stall, quoted
 *  lower). They are a starting point for the Admin screen, not a policy: the
 *  team sets each bay's figure, and `discretionaryFeePaise` on the payment plan
 *  carries the case-by-case call on top of it. */
const VENDOR_RENT_2025: Array<{ zones: ZoneCode[]; food: number; nonFood: number }> = [
  { zones: ['A4', 'B3', 'B4'], food: 18000, nonFood: 15000 },
  { zones: ['C1', 'C2'], food: 15000, nonFood: 12000 },
];

const LW_RENT_2025: Array<{ zones: ZoneCode[]; food: number; nonFood: number }> = [
  // The VIP bays: closed to trade, and the most sought-after local welfare
  // pitches on the ground.
  { zones: ['A3', 'B2'], food: 12000, nonFood: 10000 },
  { zones: ['A4', 'B3', 'B4'], food: 12000, nonFood: 10000 },
  { zones: ['C1', 'C2'], food: 10000, nonFood: 8000 },
];

/** The 2025 advance, by scope. The local welfare form prints Rs.4000; the
 *  vendor advance is not printed on the request form and is seeded at the same
 *  figure for an admin to set per bay. */
const DEPOSIT_2025: Record<RateScope, number> = { VENDOR: 4000, LOCAL_WELFARE: 4000 };

function expand(
  table: Array<{ zones: ZoneCode[]; food: number; nonFood: number }>,
  scope: RateScope,
): RateCardEntry[] {
  const out: RateCardEntry[] = [];
  for (const band of table) {
    for (const zoneCode of band.zones) {
      for (const isFood of [true, false]) {
        out.push({
          zoneCode,
          isFood,
          scope,
          amountPaise: rupeesToPaise(isFood ? band.food : band.nonFood),
          depositPaise: rupeesToPaise(DEPOSIT_2025[scope]),
        });
      }
    }
  }
  return out;
}

/** Seeded into `StallRateCard` when an edition is created, and edited from the
 *  Admin screen after that — an edition's rates are its own, and changing
 *  2026's must not rewrite what 2025 charged. This constant stays because the
 *  public form has to quote a rent before any edition exists in a fresh
 *  database. */
export const DEFAULT_RATE_CARD_2025: RateCardEntry[] = [
  ...expand(VENDOR_RENT_2025, 'VENDOR'),
  ...expand(LW_RENT_2025, 'LOCAL_WELFARE'),
];

/** Null where this bay is not priced at this scope — a vendor asking after A3,
 *  or any bay an admin has not given a figure yet. Different from a rate of
 *  zero, which would quote a free stall; null makes the caller decide what to
 *  show, and the form shows "not available this year". */
export function lookupRate(
  card: RateCardEntry[],
  zoneCode: ZoneCode,
  isFood: boolean,
  scope: RateScope,
): RateCardEntry | null {
  return (
    card.find((e) => e.zoneCode === zoneCode && e.isFood === isFood && e.scope === scope) ?? null
  );
}

export function quoteStall(
  card: RateCardEntry[],
  zoneCode: ZoneCode,
  isFood: boolean,
  scope: RateScope,
  gstPercent: number,
): { net: number; gst: number; gross: number } | null {
  const hit = lookupRate(card, zoneCode, isFood, scope);
  return hit === null ? null : addGst(hit.amountPaise, gstPercent);
}
