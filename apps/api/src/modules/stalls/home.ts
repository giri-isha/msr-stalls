// The Home page's figures.
//
// One route, one payload, however many cards. The alternative — a fetch per
// card — was tempting because the registry is already per-card, but a home page
// with eight cards would then open eight connections and repaint eight times,
// and six of those queries count rows in the same table.
//
// ⚠️ **Only the cards the caller resolved to are loaded.** A volunteer whose
// home is one card pays for one query set, not for the finance officer's.
import type { WidgetDef } from '@stalls/core';
import type { HomeResponse, HomeWidgetView } from '@stalls/core';
import type { Db } from './editions';
import { type RequestScope, scopeWhere } from './scope';

/** Every card's loader, keyed the way the registry keys the card.
 *
 *  A card with no entry here draws itself from something other than a query —
 *  which is what Quick Links does — and sends `{}`. See `homeFor` on why that is
 *  not `null`. */
type Loader = (
  db: Db,
  editionId: string,
  scope: RequestScope,
) => Promise<Record<string, number | string | null>>;

const LOADERS: Record<string, Loader> = {
  requests_summary: async (db, editionId, scope) => {
    const where = { editionId, ...scopeWhere(scope) };
    const [total, byStatus] = await Promise.all([
      db.stallRequest.count({ where }),
      db.stallRequest.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);
    const at = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    return {
      total,
      submitted: at('SUBMITTED'),
      shortlisted: at('SHORTLISTED'),
      selected: at('SELECTED'),
      backup: at('BACKUP'),
      rejected: at('REJECTED'),
    };
  },

  requests_by_type: async (db, editionId, scope) => {
    const rows = await db.stallRequest.groupBy({
      by: ['requestType'],
      where: { editionId, ...scopeWhere(scope) },
      _count: { _all: true },
    });
    const at = (t: string) => rows.find((r) => r.requestType === t)?._count._all ?? 0;
    return { VENDOR: at('VENDOR'), LOCAL_WELFARE: at('LOCAL_WELFARE'), ASHRAM: at('ASHRAM') };
  },

  follow_ups: async (db, editionId, scope) => ({
    flagged: await db.stallRequest.count({
      where: { editionId, ...scopeWhere(scope), flaggedAt: { not: null } },
    }),
  }),

  // ⚠️ NOT narrowed by the caller's scope. The bays are the venue's ground, not
  // any one requester's — a marshal scoped to A1 still needs to know how much
  // ground exists. Whose stall stands on it is the scoped question, and that is
  // what every other card answers.
  stalls_allocation: async (db, editionId) => {
    const [planned, allocated] = await Promise.all([
      db.stall.count({ where: { zone: { editionId } } }),
      db.stall.count({ where: { zone: { editionId }, status: 'ALLOCATED' } }),
    ]);
    return { planned, allocated };
  },

  onboarding_progress: async (db, editionId, scope) => {
    const selected = { editionId, ...scopeWhere(scope), status: 'SELECTED' as const };
    const [total, bank, payment, fssai, staff] = await Promise.all([
      db.stallRequest.count({ where: selected }),
      db.stallRequest.count({ where: { ...selected, bankDetail: { is: null } } }),
      // A payment that was voided is not a payment. `none` over the live rows
      // rather than `payments: { is: null }`, which would also count a stall
      // whose only record was withdrawn as paid.
      db.stallRequest.count({ where: { ...selected, payments: { none: { voidedAt: null } } } }),
      // Food stalls only — the certificate is not asked of anybody else, so
      // counting every selected stall against it would report a backlog that
      // can never be cleared.
      db.stallRequest.count({ where: { ...selected, stallType: 'FOOD', fssai: { is: null } } }),
      db.stallRequest.count({ where: { ...selected, staff: { none: {} } } }),
    ]);
    return {
      selected: total,
      bankPending: bank,
      paymentPending: payment,
      fssaiPending: fssai,
      staffPending: staff,
    };
  },

  finance_summary: async (db, editionId, scope) => {
    const mine = { editionId, ...scopeWhere(scope) };
    const [quoted, collected] = await Promise.all([
      db.stallPaymentPlan.aggregate({
        where: { request: mine },
        _sum: { feeTotalPaise: true, depositTotalPaise: true },
      }),
      db.stallPaymentRecord.aggregate({
        where: { request: mine, voidedAt: null },
        _sum: { amountPaise: true },
      }),
    ]);
    const quotedPaise = (quoted._sum.feeTotalPaise ?? 0) + (quoted._sum.depositTotalPaise ?? 0);
    const collectedPaise = collected._sum.amountPaise ?? 0;
    return {
      quotedPaise,
      collectedPaise,
      // ⚠️ Floored at zero. An overpayment is a real thing — a vendor pays the
      // round figure — and a negative "outstanding" on a home page reads as a
      // bug rather than as a credit. The refund screen is where a credit is
      // settled, and it says so in words.
      duePaise: Math.max(0, quotedPaise - collectedPaise),
    };
  },

  checkin_status: async (db, editionId, scope) => {
    const selected = { editionId, ...scopeWhere(scope), status: 'SELECTED' as const };
    const [expected, checkedIn] = await Promise.all([
      db.stallRequest.count({ where: selected }),
      db.stallRequest.count({ where: { ...selected, checkIn: { isNot: null } } }),
    ]);
    return { expected, checkedIn, pending: expected - checkedIn };
  },

  equipment_counts: async (db, editionId, scope) => {
    const mine = { editionId, ...scopeWhere(scope) };
    const [distributed, collected, damage] = await Promise.all([
      db.stallEquipmentIssue.count({ where: { request: mine, distributedAt: { not: null } } }),
      db.stallEquipmentIssue.count({ where: { request: mine, collectedAt: { not: null } } }),
      db.stallEquipmentIssue.aggregate({
        where: { request: mine },
        _sum: {
          damagedChairs: true,
          damagedTables: true,
          missingChairs: true,
          missingTables: true,
        },
      }),
    ]);
    return {
      distributed,
      collected,
      damaged: (damage._sum.damagedChairs ?? 0) + (damage._sum.damagedTables ?? 0),
      missing: (damage._sum.missingChairs ?? 0) + (damage._sum.missingTables ?? 0),
    };
  },
};

/**
 * The home page for one caller.
 *
 * ⚠️ A loader that throws takes its own card down, not the page. A card is a
 * reading; a reading the database refused is worth one empty card and seven
 * good ones, never an error screen where somebody's morning used to be.
 */
export async function homeFor(
  db: Db,
  editionId: string,
  editionLabel: string,
  widgets: WidgetDef[],
  scope: RequestScope,
): Promise<HomeResponse> {
  const loaded = await Promise.all(
    widgets.map(async (w): Promise<HomeWidgetView> => {
      const load = LOADERS[w.key];
      const view: HomeWidgetView = {
        key: w.key,
        label: w.label,
        glyph: w.glyph,
        span: w.span,
        ...(w.to ? { to: w.to } : {}),
        // ⚠️ `{}`, not `null`, for a card with no loader — a card that draws
        // itself from something other than a query, which Quick Links is. `null`
        // is reserved for a loader that FAILED, and the client says so in words;
        // a card that never had figures must not wear that sentence.
        data: {},
      };
      if (!load) return view;
      try {
        return { ...view, data: await load(db, editionId, scope) };
      } catch {
        return { ...view, data: null };
      }
    }),
  );

  return { editionLabel, widgets: loaded };
}
