/** The venue's stall areas.
 *
 *  ⚠️ A zone code is a STRING, not a union of the seven codes 2025 happened to
 *  use. The venue layout is redrawn every year — an area gains a row, a bay is
 *  dropped, the numbering shifts — and the codes live in `StallZone`, which an
 *  admin edits. A closed union here would mean a code change and a redeploy
 *  every time the ground plan moved, and would silently reject a 2027 code that
 *  the database was perfectly happy to hold.
 *
 *  `DEFAULT_ZONES_2025` below is a SEED, not a schema: it is what a fresh
 *  edition starts with, and it stops being the truth the moment an admin adds
 *  a zone.
 */
export type ZoneCode = string;

/** What a code may look like: one or two letters, then up to two digits — `A4`,
 *  `B12`, `VIP`… no. Two letters and two digits is the widest shape the stall
 *  number grammar (`<zone>-<n>`) can carry unambiguously, because the hyphen is
 *  the separator and a digit run after it is the stall index. */
export const ZONE_CODE_PATTERN = /^[A-Z]{1,2}\d{0,2}$/;

export function isZoneCode(s: string): boolean {
  return ZONE_CODE_PATTERN.test(s);
}

export interface ZoneSeed {
  code: ZoneCode;
  name: string;
  /** The bay's expected crowd, which the Planning screen divides to suggest a
   *  stall count. */
  expectedCrowd: number;
  /** Closed to VENDORS only. Ashram and local welfare stalls stand in these —
   *  2025's A3 and B2 held exactly that — so this suppresses the vendor rent
   *  and the vendor form's option, and nothing else. It is NOT "this zone does
   *  not exist" and it is NOT "this zone cannot be priced". */
  isClosedToVendors: boolean;
  sortOrder: number;
}

/** The 2025 ground plan, in the order a visitor walks it. Seeded into
 *  `StallZone` when an edition is created; edited, added to and removed from
 *  the Admin screen after that. */
export const DEFAULT_ZONES_2025: ZoneSeed[] = [
  {
    code: 'A3',
    name: 'A3 — Behind Adiyogi, Snake side (VIP seating)',
    expectedCrowd: 4200,
    isClosedToVendors: true,
    sortOrder: 0,
  },
  {
    code: 'A4',
    name: 'A4 — Snake side (Paid seating)',
    expectedCrowd: 25000,
    isClosedToVendors: false,
    sortOrder: 1,
  },
  {
    code: 'B2',
    name: 'B2 — Behind Adiyogi, Moon side (VIP seating)',
    expectedCrowd: 4200,
    isClosedToVendors: true,
    sortOrder: 2,
  },
  {
    code: 'B3',
    name: 'B3 — Behind Adiyogi, Moon side (Paid seating)',
    expectedCrowd: 12500,
    isClosedToVendors: false,
    sortOrder: 3,
  },
  {
    code: 'B4',
    name: 'B4 — Moon side (Paid seating)',
    expectedCrowd: 27500,
    isClosedToVendors: false,
    sortOrder: 4,
  },
  {
    code: 'C1',
    name: 'C1 — Moon side (General seating)',
    expectedCrowd: 20000,
    isClosedToVendors: false,
    sortOrder: 5,
  },
  {
    code: 'C2',
    name: 'C2 — Moon side (General seating)',
    expectedCrowd: 15000,
    isClosedToVendors: false,
    sortOrder: 6,
  },
];

/** The seating description each 2025 zone carried on the printed request form,
 *  which is what a vendor is really choosing between. Looked up by code and
 *  absent for a zone an admin added, where the zone's own name is shown
 *  instead. */
export const ZONE_BLURB_2025: Record<string, string> = {
  A3: 'Category A3 Behind Adiyogi - Snake side : For VIP Seating',
  B2: 'Category B2 Behind Adiyogi - Moon side : For VIP Seating',
  A4: 'Category A4 - Snake side : For Paid Seating',
  B3: 'Category B3 Behind Adiyogi - Moon Side : For Paid Seating',
  B4: 'Category B4 - Moon Side : For Paid Seating',
  C1: 'Category C1 - Moon side : For General Seating',
  C2: 'Category C2 - Moon side : For General Seating',
};

// ── Planning categories ─────────────────────────────────────────────────────

/** What can occupy a stall position — the Planning grid's columns.
 *
 *  ⚠️ Also DATA, and for the same reason as the zones: the planning sheet is
 *  redrawn every year, and which columns it carries is a judgement the stall
 *  team makes each edition, not a fact about the software. These live in
 *  `StallPlanCategory`; the list below seeds a new edition.
 *
 *  `BACKUP` is a planned category, not a status: the sheet reserves positions
 *  for vendors who are likely but unconfirmed, and those positions have to be
 *  counted against a bay's capacity from the start. `SPONSOR_*` and
 *  `ADIYOGI_FOOD` are their own columns rather than being folded into the
 *  ashram ones — a sponsor stall is an ashram stall operationally, but the
 *  whole purpose of the grid is to see how many of each are standing in a bay,
 *  and a column that cannot be counted separately cannot be planned against.
 */
export const DEFAULT_PLAN_CATEGORIES: Array<{
  key: string;
  name: string;
  isFood: boolean;
  sortOrder: number;
}> = [
  { key: 'VENDOR_FOOD', name: 'Vendor food', isFood: true, sortOrder: 0 },
  { key: 'ASHRAM_FOOD', name: 'Ashram food', isFood: true, sortOrder: 1 },
  { key: 'ADIYOGI_FOOD', name: 'Adiyogi food', isFood: true, sortOrder: 2 },
  { key: 'SPONSOR_FOOD', name: 'Sponsor food', isFood: true, sortOrder: 3 },
  { key: 'LW_FOOD', name: 'Local welfare food', isFood: true, sortOrder: 4 },
  { key: 'VENDOR_NON_FOOD', name: 'Vendor non-food', isFood: false, sortOrder: 5 },
  { key: 'ASHRAM_NON_FOOD', name: 'Ashram non-food', isFood: false, sortOrder: 6 },
  { key: 'SPONSOR_NON_FOOD', name: 'Sponsor non-food', isFood: false, sortOrder: 7 },
  { key: 'LW_NON_FOOD', name: 'Local welfare non-food', isFood: false, sortOrder: 8 },
  { key: 'HELP_DESK', name: 'Help desk', isFood: false, sortOrder: 9 },
  { key: 'BACKUP', name: 'Backup', isFood: false, sortOrder: 10 },
];

/** Same grammar as a zone code, plus underscores: these are keys an admin
 *  types once and the grid then carries as a column heading. */
export const CATEGORY_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/;

export function isCategoryKey(s: string): boolean {
  return CATEGORY_KEY_PATTERN.test(s);
}

export type CategoryCounts = Record<string, number>;

export interface ZonePlanRow {
  zoneCode: ZoneCode;
  counts: CategoryCounts;
}

export interface PlanTotals {
  byZone: Record<string, number>;
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

/** Totals down the columns and across the rows.
 *
 *  ⚠️ `categoryKeys` is passed in rather than read from a constant: the columns
 *  are whatever the edition configured, and a total that silently dropped a
 *  category an admin added would under-count the bay it stands in. */
export function planTotals(rows: ZonePlanRow[], categoryKeys: string[]): PlanTotals {
  const byCategory: CategoryCounts = Object.fromEntries(categoryKeys.map((c) => [c, 0]));
  const byZone: Record<string, number> = {};
  let grandTotal = 0;

  for (const row of rows) {
    let zoneTotal = 0;
    for (const category of categoryKeys) {
      const n = row.counts[category] ?? 0;
      byCategory[category] += n;
      zoneTotal += n;
    }
    byZone[row.zoneCode] = (byZone[row.zoneCode] ?? 0) + zoneTotal;
    grandTotal += zoneTotal;
  }

  return { byZone, byCategory, grandTotal };
}
