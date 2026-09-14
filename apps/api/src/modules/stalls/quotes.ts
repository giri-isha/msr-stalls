import type { Prisma } from '@prisma/client';
import {
  type ChargeRates,
  type Quote,
  type QuoteView,
  type ZoneCode,
  payableFeePaise as payableFeePaise_,
  quoteRequest,
} from '@msr/stalls';
import { rateCardFor, chargesFor } from './config';
import type { Db } from './editions';

/** What a selected request costs, computed from the edition's live rate card.
 *
 *  The calculation itself is in `@msr/stalls/quote.ts` and is pure. This file
 *  is only the part that has to talk to the database: fetch the rate card and
 *  the charge config once, then price many requests against them.
 *
 *  The zone that prices a stall is the one it was ALLOCATED, then the one that
 *  was AGREED, and only then the one the vendor asked for — see `pricingZone`,
 *  where the ordering is the whole point. Before any of those, the preferred
 *  zone is used and the figure is a forecast.
 */

export type RequestForQuote = Prisma.StallRequestGetPayload<{
  include: { allocations: { include: { stall: { include: { zone: true } } } } };
}>;

export const quoteInclude = {
  allocations: { where: { releasedAt: null }, include: { stall: { include: { zone: true } } } },
} satisfies Prisma.StallRequestInclude;

export interface QuoteContext {
  card: Awaited<ReturnType<typeof rateCardFor>>;
  rates: ChargeRates;
}

export async function quoteContext(db: Db, editionId: string): Promise<QuoteContext> {
  const [card, charges] = await Promise.all([
    rateCardFor(db, editionId),
    chargesFor(db, editionId),
  ]);
  return {
    card,
    rates: {
      chairRatePaise: charges.chairRatePaise,
      tableRatePaise: charges.tableRatePaise,
      lwChairRatePaise: charges.lwChairRatePaise,
      lwTableRatePaise: charges.lwTableRatePaise,
      chairTableDepositPaise: charges.chairTableDepositPaise,
      plug5aRatePaise: charges.plug5aRatePaise,
      plug15aRatePaise: charges.plug15aRatePaise,
      equipmentDays: charges.equipmentDays,
      gstPercent: charges.gstPercent,
    },
  };
}

/** The bay a request is priced in, most settled answer first.
 *
 *  🔴 The middle term is the one that matters. The team's sequence is: agree the
 *  bay, send the payment letter, allocate a number later — and a request is
 *  routinely moved from the bay it asked for into one that still has room
 *  ("that side is already filled up, why don't you look at this side"). Between
 *  the agreement and the allocation there is no stall yet, and falling straight
 *  back to what the vendor originally ASKED for quotes them for ground they
 *  were never given. Worse in one direction than the other: a request that
 *  asked for a bay closed to trade would price as unpriced for ever, however
 *  clearly the team had agreed somewhere else.
 *
 *  The requested bay stays as the last resort, because a request that has been
 *  neither agreed nor allocated still has to show a figure on the form. */
export function pricingZone(r: {
  preferredZoneCode: string;
  agreedZoneCode?: string | null;
  allocations: Array<{ stall: { zone: { code: string } } }>;
}): ZoneCode {
  return (r.allocations[0]?.stall.zone.code ??
    r.agreedZoneCode ??
    r.preferredZoneCode) as ZoneCode;
}

export function quoteFor(r: RequestForQuote, ctx: QuoteContext): Quote | null {
  return quoteRequest(
    {
      requestType: r.requestType,
      isFood: r.stallType === 'FOOD',
      zoneCode: pricingZone(r),
      // A request for three stalls that was offered one pays for one.
      numStalls: Math.max(1, r.allocations.length || r.numStallsRequested),
      plugs5a: r.plugs5a,
      plugs15a: r.plugs15a,
      chairs: r.chairsNeeded,
      tables: r.tablesNeeded,
    },
    ctx.card,
    ctx.rates,
  );
}

const EMPTY: QuoteView = {
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
  unpriced: false,
  discretionaryFeePaise: null,
  discretionaryReason: null,
  payableFeePaise: 0,
};

/** Null from `quoteRequest` means "this zone has no rate", which the screens
 *  must show as *unpriced* rather than as zero — a zero reads as a free stall.
 *  That distinction is carried across the wire by the `unpriced` flag instead
 *  of by a null object, so no caller has to null-check a money row. */
export function toQuoteView(q: Quote | null): QuoteView {
  if (!q) return { ...EMPTY, exempt: false, unpriced: true };
  return {
    stallFeePaise: q.stallFeePaise,
    plugFeePaise: q.plugFeePaise,
    equipmentFeePaise: q.equipmentFeePaise,
    netPaise: q.netPaise,
    gstPaise: q.gstPaise,
    feeTotalPaise: q.feeTotalPaise,
    stallDepositPaise: q.stallDepositPaise,
    equipmentDepositPaise: q.equipmentDepositPaise,
    depositTotalPaise: q.depositTotalPaise,
    grandTotalPaise: q.grandTotalPaise,
    exempt: q.exempt,
    unpriced: false,
    // A live quote carries no concession: the team agrees one against the
    // FROZEN plan, after the requester has been told a figure.
    discretionaryFeePaise: null,
    discretionaryReason: null,
    payableFeePaise: q.feeTotalPaise,
  };
}

/** The frozen figures, where a payment email has gone out, and the live ones
 *  otherwise. Finance always reconciles against what the vendor was told. */
export function planToView(plan: {
  stallFeePaise: number;
  plugFeePaise: number;
  equipmentFeePaise: number;
  netPaise: number;
  gstPaise: number;
  feeTotalPaise: number;
  stallDepositPaise: number;
  equipmentDepositPaise: number;
  depositTotalPaise: number;
  discretionaryFeePaise?: number | null;
  discretionaryReason?: string | null;
}): QuoteView {
  const payableFeePaise = payableFeePaise_({
    feeTotalPaise: plan.feeTotalPaise,
    discretionaryFeePaise: plan.discretionaryFeePaise ?? null,
  });
  return {
    ...plan,
    // ⚠️ The GRAND total follows the concession; the deposit never does. A
    // deposit is returned in full, so discounting it would mean refunding money
    // that was never taken.
    grandTotalPaise: payableFeePaise + plan.depositTotalPaise,
    exempt: false,
    unpriced: false,
    discretionaryFeePaise: plan.discretionaryFeePaise ?? null,
    discretionaryReason: plan.discretionaryReason ?? null,
    payableFeePaise,
  };
}
