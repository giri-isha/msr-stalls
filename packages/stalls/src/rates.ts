import { addGst, rupeesToPaise } from './money';
import type { ZoneGroup } from './zones';

export interface RateCardEntry {
  zoneGroup: ZoneGroup;
  isFood: boolean;
  amountPaise: number;
}

/** The rents printed on the 2025 vendor form, page 3, verbatim:
 *
 *    A3, B2 Stalls          Closed
 *    B3, B4 & A4 Food       Rs 18000 + GST
 *    B3, B4 & A4 Non Food   Rs 15000 + GST
 *    C Food                 Rs 15000 + GST
 *    C Non food             Rs 12000 + GST
 *
 *  Seeded into `StallRateCard` when an edition is created, and edited from the
 *  Admin screen after that — an edition's rates are its own, and changing 2026's
 *  must not rewrite what 2025 charged. This constant stays because the public
 *  form has to quote a rent before any edition exists in a fresh database. */
export const DEFAULT_RATE_CARD_2025: RateCardEntry[] = [
  { zoneGroup: 'AB', isFood: true, amountPaise: rupeesToPaise(18000) },
  { zoneGroup: 'AB', isFood: false, amountPaise: rupeesToPaise(15000) },
  { zoneGroup: 'C', isFood: true, amountPaise: rupeesToPaise(15000) },
  { zoneGroup: 'C', isFood: false, amountPaise: rupeesToPaise(12000) },
];

/** Null for a closed zone group — there is no rate, which is different from a
 *  rate of zero. A zero would quote a free stall; null makes the caller decide
 *  what to show, and the form shows "not available this year". */
export function lookupRate(
  card: RateCardEntry[],
  group: ZoneGroup,
  isFood: boolean,
): number | null {
  const hit = card.find((e) => e.zoneGroup === group && e.isFood === isFood);
  return hit?.amountPaise ?? null;
}

export function quoteStall(
  card: RateCardEntry[],
  group: ZoneGroup,
  isFood: boolean,
  gstPercent: number,
): { net: number; gst: number; gross: number } | null {
  const net = lookupRate(card, group, isFood);
  return net === null ? null : addGst(net, gstPercent);
}
