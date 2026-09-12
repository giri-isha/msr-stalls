/** The venue's stall areas, in the order a visitor walks them — which is the
 *  order the Planning screen shows, the order the selection dropdown offers, and
 *  the order the printed electrical sheet is collated in. */
export const ZONE_CODES = ['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2'] as const;
export type ZoneCode = (typeof ZONE_CODES)[number];

/** Rent is priced per group, not per zone.
 *
 *  `CLOSED` is a real group and not an absence: A3 and B2 existed in 2025 with
 *  ashram stalls standing in them — they were simply not sold to vendors.
 *  Modelling that as "no group" or as a missing zone would lose the ashram
 *  stalls that were really there, and the electrical sheet has to print them. */
export type ZoneGroup = 'AB' | 'C' | 'CLOSED';

const CLOSED_ZONES = new Set<ZoneCode>(['A3', 'B2']);

export function zoneGroupOf(code: ZoneCode): ZoneGroup {
  if (CLOSED_ZONES.has(code)) return 'CLOSED';
  return code.startsWith('C') ? 'C' : 'AB';
}

/** Every kind of thing that can occupy a stall position.
 *
 *  `BACKUP` is a planned category, not a status: the 2025 planning sheet
 *  reserves positions for vendors who are likely but unconfirmed, and those
 *  positions have to be counted against a zone's capacity from the start. */
export const STALL_CATEGORIES = [
  'VENDOR_FOOD',
  'ASHRAM_FOOD',
  'LW_FOOD',
  'VENDOR_NON_FOOD',
  'ASHRAM_NON_FOOD',
  'HELP_DESK',
  'BACKUP',
] as const;
export type StallCategory = (typeof STALL_CATEGORIES)[number];

export type CategoryCounts = Record<StallCategory, number>;

export interface ZonePlanRow {
  zoneCode: ZoneCode;
  counts: CategoryCounts;
}

export interface PlanTotals {
  byZone: Partial<Record<ZoneCode, number>>;
  byCategory: CategoryCounts;
  grandTotal: number;
}

/** The coordinator's starting point, not the answer.
 *
 *  From the requirements: "Number of food stalls in each zone is commuted based
 *  on the crowd in each bay." They enter the expected crowd for a bay and a
 *  people-per-stall divisor, and then adjust the suggestion by hand against
 *  what the bay physically fits.
 *
 *  Rounded UP: under-provisioning a food bay means queues at an event where the
 *  crowd cannot easily walk to another one. */
export function suggestStallCount(crowd: number, crowdPerStall: number): number {
  if (crowdPerStall <= 0) return 0;
  return Math.ceil(crowd / crowdPerStall);
}

function zeroCounts(): CategoryCounts {
  return Object.fromEntries(STALL_CATEGORIES.map((c) => [c, 0])) as CategoryCounts;
}

export function planTotals(rows: ZonePlanRow[]): PlanTotals {
  const byCategory = zeroCounts();
  const byZone: Partial<Record<ZoneCode, number>> = {};
  let grandTotal = 0;

  for (const row of rows) {
    let zoneTotal = 0;
    for (const category of STALL_CATEGORIES) {
      const n = row.counts[category] ?? 0;
      byCategory[category] += n;
      zoneTotal += n;
    }
    byZone[row.zoneCode] = (byZone[row.zoneCode] ?? 0) + zoneTotal;
    grandTotal += zoneTotal;
  }

  return { byZone, byCategory, grandTotal };
}
