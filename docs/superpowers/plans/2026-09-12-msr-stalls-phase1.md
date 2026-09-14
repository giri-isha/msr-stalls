# MSR Stalls Phase 1 (Intake & Selection) Implementation Plan

> **DELIVERED.** Phase 1 shipped in commits `f402f6f`…`3b85be5`. The unticked
> boxes below were never ticked as the work went in; they are not outstanding
> work. Kept as the record of how it was built.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four MSR stall-request Google Forms and their spreadsheets with a web application covering intake, the request pipeline, zone planning, and stall selection/allocation.

**Architecture:** An npm-workspaces monorepo that mirrors `msr-app-replit` exactly. All domain code lives in `apps/api/src/modules/stalls/`, `apps/web/src/modules/stalls/` and `packages/stalls/` — those three migrate verbatim. Everything else is a Foundation stub that is thrown away at migration, so stubs expose the host's signatures rather than convenient ones. Pure logic goes in `@msr/stalls` where it is testable without a database.

**Tech Stack:** Node 22+, Fastify 5, Prisma 7 (`PrismaPg` adapter), PostgreSQL, Zod 4, React 19, Vite 8, Tailwind 4, react-router 8, vitest 4, biome 2.5.5, dependency-cruiser 18.

## Global Constraints

- Node `>=22`. The repo runs on Node 24; do not use APIs newer than Node 22.
- Dependency versions match `msr-app-replit` exactly. A version drift means the module will not install cleanly in the host.
- **Money is stored as integer paise.** Never a float, never a decimal string. Column names end in `Paise`.
- All Prisma models and enums are prefixed `Stall` — they merge into the host's 2,500-line `schema.prisma` without collision.
- `apps/api/src/modules/stalls/` may import only: its own folder, `@msr/stalls`, node_modules, and `../../{auth,prisma,errors,zod-validation,activity}` / `../../storage/media-namespace`. Enforced by `npm run lint:boundaries`.
- `apps/web/src/modules/stalls/` may import only: its own folder, `@msr/stalls`, node_modules, `../../components/`, `../../lib/`.
- Staff API mounts at `/api/m/stalls/*`. Public API mounts at `/api/m/stalls/public/*` and lives **only** in `public-routes.ts`.
- Public form labels carry English and Tamil. Staff screens are English.
- Handlers stay thin: authenticate → call a domain seam → map a domain error to a status. No Prisma calls in a route handler body.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `chore:`).

---

## File Structure

### `packages/stalls/` — `@msr/stalls`, pure logic, no I/O

| File | Responsibility |
|---|---|
| `src/index.ts` | Public barrel |
| `src/money.ts` | Paise arithmetic, GST, formatting |
| `src/reference.ts` | Request reference numbers (`VEN-2026-0042`) |
| `src/zones.ts` | Zone codes, zone groups, crowd→stall-count planning |
| `src/rates.ts` | Rate lookup by zone group × category |
| `src/rbac.ts` | `MODULE_KEY`, `ROLES`, permission predicates |
| `src/forms.ts` | The four form definitions: fields, types, bilingual labels, validation rules |
| `src/contracts.ts` | Zod wire contracts shared by api and web |
| `src/stall-numbers.ts` | Stall number generation and parsing |

### `apps/api/src/` — Foundation stubs (discarded at migration)

`prisma.ts`, `errors.ts`, `zod-validation.ts`, `auth.ts`, `activity.ts`, `email.ts`, `storage/media-namespace.ts`, `storage/disk-media-store.ts`, `app.ts`, `index.ts`, `dev-signin.ts`

### `apps/api/src/modules/stalls/` — migrates verbatim

| File | Responsibility |
|---|---|
| `index.ts` | `StallsDeps`, `registerStallsModule(app, deps)` |
| `roles.ts` | `MODULE_KEY`, `ROLES`, `requireStallsRole` |
| `errors.ts` | Domain error classes |
| `editions.ts` | Active-edition resolution |
| `accounts.ts` | `StallAccount` find-or-create, access-link mint/verify |
| `submit.ts` | The submission seam — the one write the public can reach |
| `requests.ts` | List, filter, search, detail, flag |
| `planning.ts` | Zone plan read/write, stall generation |
| `selection.ts` | Shortlist, select, allocate, reject, backup |
| `config.ts` | Zones, rates, charges, custom fields, flow toggles, fines |
| `staff.ts` | Staff role grants |
| `routes.ts` | Staff HTTP surface |
| `public-routes.ts` | Public HTTP surface — the whole unauthenticated boundary |

### `apps/web/src/modules/stalls/` — migrates verbatim

`index.ts` (route tree), `api.ts` (typed fetch client), `public/` (form picker, four forms, confirmation, status page), `staff/` (dashboard, requests, all-requests, planning, selection, admin), `components/` (shared bits: `RequestStatusPill`, `ZoneSelect`, `ApplianceRows`, `BilingualLabel`).

---

## Task 1: Shared package and toolchain

**Files:**
- Create: `packages/stalls/package.json`, `packages/stalls/tsconfig.json`, `packages/stalls/vitest.config.ts`
- Create: `packages/stalls/src/reference.ts`, `packages/stalls/src/reference.test.ts`, `packages/stalls/src/index.ts`

**Interfaces:**
- Produces: `formatReference(type: StallRequestType, year: number, seq: number): string`, `parseReference(ref: string): { type, year, seq } | null`

- [ ] **Step 1: Create the package manifest**

`packages/stalls/package.json` — copy `@msr/volunteering`'s shape exactly:

```json
{
  "name": "@msr/stalls",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "zod": "^4.5.4" },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

`packages/stalls/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "lib": ["ES2022"] },
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/stalls/src/reference.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { formatReference, parseReference } from './reference';

describe('formatReference', () => {
  test('builds a padded, typed reference', () => {
    expect(formatReference('VENDOR', 2026, 42)).toBe('VEN-2026-0042');
    expect(formatReference('ASHRAM', 2026, 1)).toBe('ASH-2026-0001');
    expect(formatReference('ASHRAM_FOOD', 2026, 7)).toBe('AFD-2026-0007');
    expect(formatReference('LOCAL_WELFARE', 2026, 130)).toBe('LWS-2026-0130');
  });

  test('does not truncate a sequence past four digits', () => {
    expect(formatReference('VENDOR', 2026, 12345)).toBe('VEN-2026-12345');
  });
});

describe('parseReference', () => {
  test('round-trips', () => {
    expect(parseReference('VEN-2026-0042')).toEqual({
      type: 'VENDOR', year: 2026, seq: 42,
    });
  });

  test('returns null for junk rather than throwing', () => {
    expect(parseReference('nonsense')).toBeNull();
    expect(parseReference('XXX-2026-0001')).toBeNull();
    expect(parseReference('')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test --workspace=packages/stalls`
Expected: FAIL — `Failed to resolve import "./reference"`

- [ ] **Step 4: Implement**

`packages/stalls/src/reference.ts`:

```ts
/** A request's human-facing handle. Staff read these aloud on the phone, so the
 *  prefix has to say what kind of request it is without a lookup. */
export type StallRequestType = 'ASHRAM' | 'ASHRAM_FOOD' | 'LOCAL_WELFARE' | 'VENDOR';

const PREFIX: Record<StallRequestType, string> = {
  ASHRAM: 'ASH',
  ASHRAM_FOOD: 'AFD',
  LOCAL_WELFARE: 'LWS',
  VENDOR: 'VEN',
};

const BY_PREFIX = new Map<string, StallRequestType>(
  Object.entries(PREFIX).map(([type, prefix]) => [prefix, type as StallRequestType]),
);

/** `padStart` and not a fixed slice: a 5-digit year would silently become a
 *  different request's reference, and 2025 already ran to ~700 requests. */
export function formatReference(type: StallRequestType, year: number, seq: number): string {
  return `${PREFIX[type]}-${year}-${String(seq).padStart(4, '0')}`;
}

export function parseReference(
  ref: string,
): { type: StallRequestType; year: number; seq: number } | null {
  const match = /^([A-Z]{3})-(\d{4})-(\d{4,})$/.exec(ref);
  if (!match) return null;
  const type = BY_PREFIX.get(match[1]);
  if (!type) return null;
  return { type, year: Number(match[2]), seq: Number(match[3]) };
}
```

`packages/stalls/src/index.ts`:

```ts
export * from './reference';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npm test --workspace=packages/stalls`
Expected: PASS, 4 tests

- [ ] **Step 6: Commit**

```bash
git add packages/stalls
git commit -m "feat: @msr/stalls package with request reference numbers"
```

---

## Task 2: Money in paise

**Files:**
- Create: `packages/stalls/src/money.ts`, `packages/stalls/src/money.test.ts`
- Modify: `packages/stalls/src/index.ts`

**Interfaces:**
- Produces: `rupeesToPaise(r: number): number`, `paiseToRupees(p: number): number`, `formatInr(paise: number): string`, `addGst(paise: number, ratePercent: number): { net, gst, gross }`

- [ ] **Step 1: Write the failing test**

`packages/stalls/src/money.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { addGst, formatInr, paiseToRupees, rupeesToPaise } from './money';

describe('rupeesToPaise', () => {
  test('converts without float drift', () => {
    expect(rupeesToPaise(18000)).toBe(1_800_000);
    expect(rupeesToPaise(0.1)).toBe(10);
    // 19.99 * 100 is 1998.9999999999998 in IEEE754. Rounding is the whole point.
    expect(rupeesToPaise(19.99)).toBe(1999);
  });

  test('refuses a non-finite amount', () => {
    expect(() => rupeesToPaise(Number.NaN)).toThrow(/finite/i);
    expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(/finite/i);
  });
});

describe('formatInr', () => {
  test('groups in the Indian system and drops empty paise', () => {
    expect(formatInr(1_800_000)).toBe('₹18,000');
    expect(formatInr(150_000_00)).toBe('₹1,50,000');
    expect(formatInr(1999)).toBe('₹19.99');
  });
});

describe('addGst', () => {
  test('splits net, gst and gross at 18%', () => {
    expect(addGst(1_800_000, 18)).toEqual({
      net: 1_800_000, gst: 324_000, gross: 2_124_000,
    });
  });

  test('rounds gst to whole paise', () => {
    expect(addGst(101, 18)).toEqual({ net: 101, gst: 18, gross: 119 });
  });
});

describe('paiseToRupees', () => {
  test('is the inverse of rupeesToPaise', () => {
    expect(paiseToRupees(1_800_000)).toBe(18000);
    expect(paiseToRupees(1999)).toBe(19.99);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test --workspace=packages/stalls -- money`
Expected: FAIL — cannot resolve `./money`

- [ ] **Step 3: Implement**

`packages/stalls/src/money.ts`:

```ts
/** Money is integer paise everywhere in this module — in the database, over the
 *  wire, and in every calculation. Rupees exist only at the two edges: what a
 *  human types, and what a human reads.
 *
 *  This is not fussiness. Stall rent is summed across ~700 requests, GST is
 *  applied, a deposit is held, fines are deducted and the remainder refunded.
 *  Float cents accumulate error across exactly that chain. */

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new RangeError('amount must be finite');
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** en-IN gives the 2,00,000 grouping the team expects. `maximumFractionDigits:2`
 *  with `minimumFractionDigits:0` shows paise only when there are any. */
export function formatInr(paise: number): string {
  return INR.format(paiseToRupees(paise));
}

export function addGst(
  netPaise: number,
  ratePercent: number,
): { net: number; gst: number; gross: number } {
  const gst = Math.round((netPaise * ratePercent) / 100);
  return { net: netPaise, gst, gross: netPaise + gst };
}
```

Add `export * from './money';` to `packages/stalls/src/index.ts`.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test --workspace=packages/stalls`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add packages/stalls
git commit -m "feat: paise-based money helpers with GST"
```

---

## Task 3: Zones and the planning computation

**Files:**
- Create: `packages/stalls/src/zones.ts`, `packages/stalls/src/zones.test.ts`
- Modify: `packages/stalls/src/index.ts`

**Interfaces:**
- Produces: `ZONE_CODES`, `type ZoneCode`, `zoneGroupOf(code: ZoneCode): ZoneGroup`, `type StallCategory`, `suggestStallCount(crowd: number, crowdPerStall: number): number`, `planTotals(rows: ZonePlanRow[]): PlanTotals`

**Context for the implementer:** The Planning screen's rule, from the requirements PDF: *"Number of food stalls in each zone is commuted based on the crowd in each bay."* The 2025 numbers in the prototype are the check — zone A4 with a crowd of 25,000 at 1,000 people per stall planned 30 stalls in total.

- [ ] **Step 1: Write the failing test**

`packages/stalls/src/zones.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { planTotals, suggestStallCount, zoneGroupOf, ZONE_CODES } from './zones';

describe('ZONE_CODES', () => {
  test('is the 2025 venue layout in walking order', () => {
    expect(ZONE_CODES).toEqual(['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2']);
  });
});

describe('zoneGroupOf', () => {
  test('maps A and B zones to the premium group and C to the general group', () => {
    expect(zoneGroupOf('A4')).toBe('AB');
    expect(zoneGroupOf('B3')).toBe('AB');
    expect(zoneGroupOf('B4')).toBe('AB');
    expect(zoneGroupOf('C1')).toBe('C');
    expect(zoneGroupOf('C2')).toBe('C');
  });

  test('A3 and B2 are their own group — they were closed in 2025', () => {
    expect(zoneGroupOf('A3')).toBe('CLOSED');
    expect(zoneGroupOf('B2')).toBe('CLOSED');
  });
});

describe('suggestStallCount', () => {
  test('divides crowd by the per-stall divisor and rounds up', () => {
    expect(suggestStallCount(25000, 1000)).toBe(25);
    expect(suggestStallCount(4200, 1000)).toBe(5);
    expect(suggestStallCount(0, 1000)).toBe(0);
  });

  test('a zero or negative divisor yields zero rather than Infinity', () => {
    expect(suggestStallCount(25000, 0)).toBe(0);
    expect(suggestStallCount(25000, -5)).toBe(0);
  });
});

describe('planTotals', () => {
  test('totals each category and the grand total across zones', () => {
    const rows = [
      { zoneCode: 'A3' as const, counts: { VENDOR_FOOD: 0, ASHRAM_FOOD: 2, LW_FOOD: 0,
        VENDOR_NON_FOOD: 0, ASHRAM_NON_FOOD: 6, HELP_DESK: 0, BACKUP: 0 } },
      { zoneCode: 'A4' as const, counts: { VENDOR_FOOD: 5, ASHRAM_FOOD: 6, LW_FOOD: 5,
        VENDOR_NON_FOOD: 2, ASHRAM_NON_FOOD: 11, HELP_DESK: 0, BACKUP: 1 } },
    ];
    const totals = planTotals(rows);
    expect(totals.byZone.A3).toBe(8);
    expect(totals.byZone.A4).toBe(30);
    expect(totals.byCategory.ASHRAM_NON_FOOD).toBe(17);
    expect(totals.grandTotal).toBe(38);
  });

  test('an empty plan totals zero, not NaN', () => {
    const totals = planTotals([]);
    expect(totals.grandTotal).toBe(0);
    expect(totals.byCategory.VENDOR_FOOD).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test --workspace=packages/stalls -- zones`
Expected: FAIL — cannot resolve `./zones`

- [ ] **Step 3: Implement**

`packages/stalls/src/zones.ts`:

```ts
/** The venue's stall areas, in the order a visitor walks them — which is the
 *  order the Planning screen shows and the order the printed electrical sheet
 *  is collated in. */
export const ZONE_CODES = ['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2'] as const;
export type ZoneCode = (typeof ZONE_CODES)[number];

/** Rent is priced per group, not per zone. `CLOSED` is a real group and not an
 *  absence: A3 and B2 existed in 2025 with ashram stalls in them, they were just
 *  not sold to vendors. Treating them as "no group" loses that. */
export type ZoneGroup = 'AB' | 'C' | 'CLOSED';

const CLOSED_ZONES = new Set<ZoneCode>(['A3', 'B2']);

export function zoneGroupOf(code: ZoneCode): ZoneGroup {
  if (CLOSED_ZONES.has(code)) return 'CLOSED';
  return code.startsWith('C') ? 'C' : 'AB';
}

/** Every kind of thing that can occupy a stall position. `BACKUP` is a real
 *  planned category — the 2025 sheet reserves positions for vendors who are
 *  likely but not confirmed. */
export const STALL_CATEGORIES = [
  'VENDOR_FOOD', 'ASHRAM_FOOD', 'LW_FOOD',
  'VENDOR_NON_FOOD', 'ASHRAM_NON_FOOD', 'HELP_DESK', 'BACKUP',
] as const;
export type StallCategory = (typeof STALL_CATEGORIES)[number];

export type CategoryCounts = Record<StallCategory, number>;
export interface ZonePlanRow { zoneCode: ZoneCode; counts: CategoryCounts }
export interface PlanTotals {
  byZone: Partial<Record<ZoneCode, number>>;
  byCategory: CategoryCounts;
  grandTotal: number;
}

/** The coordinator's starting point, not the answer: they enter the expected
 *  crowd for a bay and a people-per-stall divisor, and adjust the suggestion by
 *  hand. Rounded UP — under-provisioning a food bay means queues. */
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
```

Add `export * from './zones';` to the barrel.

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test --workspace=packages/stalls`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/stalls
git commit -m "feat: zone codes, groups and the crowd-based planning computation"
```

---

## Task 4: Stall numbering

**Files:**
- Create: `packages/stalls/src/stall-numbers.ts`, `packages/stalls/src/stall-numbers.test.ts`
- Modify: `packages/stalls/src/index.ts`

**Interfaces:**
- Consumes: `ZoneCode` from `./zones`
- Produces: `formatStallNumber(zone: ZoneCode, n: number): string`, `parseStallNumber(s: string): { zone: ZoneCode; n: number } | null`, `generateStallNumbers(zone: ZoneCode, count: number): string[]`

**Context:** The prototype's seed data uses `A4-17`, `C2-30`, `B3-12` — zone code, hyphen, 1-based index. It also carries `A-12` and `F-03` for a couple of ashram stalls, which is 2025 legacy data entered by hand; the new system generates only the `ZONE-N` form and accepts the legacy form on read.

- [ ] **Step 1: Write the failing test**

`packages/stalls/src/stall-numbers.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { formatStallNumber, generateStallNumbers, parseStallNumber } from './stall-numbers';

describe('formatStallNumber', () => {
  test('is zone code, hyphen, one-based index', () => {
    expect(formatStallNumber('A4', 17)).toBe('A4-17');
    expect(formatStallNumber('C2', 1)).toBe('C2-1');
  });

  test('refuses a non-positive index', () => {
    expect(() => formatStallNumber('A4', 0)).toThrow(/positive/i);
    expect(() => formatStallNumber('A4', -1)).toThrow(/positive/i);
  });
});

describe('parseStallNumber', () => {
  test('round-trips a generated number', () => {
    expect(parseStallNumber('A4-17')).toEqual({ zone: 'A4', n: 17 });
  });

  test('rejects an unknown zone', () => {
    expect(parseStallNumber('Z9-1')).toBeNull();
  });

  test('rejects junk', () => {
    expect(parseStallNumber('A4')).toBeNull();
    expect(parseStallNumber('')).toBeNull();
    expect(parseStallNumber('A4-0')).toBeNull();
  });
});

describe('generateStallNumbers', () => {
  test('produces a contiguous one-based run', () => {
    expect(generateStallNumbers('B2', 3)).toEqual(['B2-1', 'B2-2', 'B2-3']);
  });

  test('a count of zero produces nothing', () => {
    expect(generateStallNumbers('B2', 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test --workspace=packages/stalls -- stall-numbers`
Expected: FAIL

- [ ] **Step 3: Implement**

`packages/stalls/src/stall-numbers.ts`:

```ts
import { ZONE_CODES, type ZoneCode } from './zones';

const ZONE_SET = new Set<string>(ZONE_CODES);

export function formatStallNumber(zone: ZoneCode, n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError('stall index must be a positive integer');
  }
  return `${zone}-${n}`;
}

/** Returns null rather than throwing: this parses data that came from a
 *  spreadsheet or a 2025 import, where a junk value is expected and should show
 *  as "unparsed", not crash an import of 700 rows. */
export function parseStallNumber(s: string): { zone: ZoneCode; n: number } | null {
  const match = /^([A-Z][0-9])-([1-9]\d*)$/.exec(s);
  if (!match || !ZONE_SET.has(match[1])) return null;
  return { zone: match[1] as ZoneCode, n: Number(match[2]) };
}

export function generateStallNumbers(zone: ZoneCode, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => formatStallNumber(zone, i + 1));
}
```

Add to the barrel.

- [ ] **Step 4: Run and watch it pass**

Run: `npm test --workspace=packages/stalls`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/stalls
git commit -m "feat: stall number generation and parsing"
```

---

## Task 5: Rates

**Files:**
- Create: `packages/stalls/src/rates.ts`, `packages/stalls/src/rates.test.ts`
- Modify: `packages/stalls/src/index.ts`

**Interfaces:**
- Consumes: `ZoneGroup` from `./zones`, `rupeesToPaise`/`addGst` from `./money`
- Produces: `DEFAULT_RATE_CARD_2025: RateCardEntry[]`, `lookupRate(card, group, isFood): number | null`, `quoteStall(card, group, isFood, gstPercent)`

**Context:** From page 3 of `Vendor Stall Request Form 2025.pdf`, verbatim:
`A3, B2 Stalls - Closed` · `B3, B4 & A4 Food stalls - Rs 18000 + GST` · `B3, B4 & A4 Non Food - Rs 15000 + GST` · `C Food - Rs 15000 + GST` · `C Non food - Rs 12000 + GST`

- [ ] **Step 1: Write the failing test**

`packages/stalls/src/rates.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { DEFAULT_RATE_CARD_2025, lookupRate, quoteStall } from './rates';

describe('DEFAULT_RATE_CARD_2025', () => {
  test('matches the printed 2025 form', () => {
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'AB', true)).toBe(1_800_000);
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'AB', false)).toBe(1_500_000);
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'C', true)).toBe(1_500_000);
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'C', false)).toBe(1_200_000);
  });

  test('closed zones have no rate at all', () => {
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'CLOSED', true)).toBeNull();
    expect(lookupRate(DEFAULT_RATE_CARD_2025, 'CLOSED', false)).toBeNull();
  });
});

describe('quoteStall', () => {
  test('adds GST to the looked-up rate', () => {
    expect(quoteStall(DEFAULT_RATE_CARD_2025, 'AB', true, 18)).toEqual({
      net: 1_800_000, gst: 324_000, gross: 2_124_000,
    });
  });

  test('a closed zone cannot be quoted', () => {
    expect(quoteStall(DEFAULT_RATE_CARD_2025, 'CLOSED', true, 18)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test --workspace=packages/stalls -- rates`

- [ ] **Step 3: Implement**

`packages/stalls/src/rates.ts`:

```ts
import { addGst, rupeesToPaise } from './money';
import type { ZoneGroup } from './zones';

export interface RateCardEntry {
  zoneGroup: ZoneGroup;
  isFood: boolean;
  amountPaise: number;
}

/** The rents printed on the 2025 vendor form. Seeded into `StallRateCard` for a
 *  new edition; an admin edits them from there. Kept here as well because the
 *  public form must quote a rent before any edition exists in a fresh database. */
export const DEFAULT_RATE_CARD_2025: RateCardEntry[] = [
  { zoneGroup: 'AB', isFood: true, amountPaise: rupeesToPaise(18000) },
  { zoneGroup: 'AB', isFood: false, amountPaise: rupeesToPaise(15000) },
  { zoneGroup: 'C', isFood: true, amountPaise: rupeesToPaise(15000) },
  { zoneGroup: 'C', isFood: false, amountPaise: rupeesToPaise(12000) },
];

export function lookupRate(
  card: RateCardEntry[], group: ZoneGroup, isFood: boolean,
): number | null {
  const hit = card.find((e) => e.zoneGroup === group && e.isFood === isFood);
  return hit?.amountPaise ?? null;
}

export function quoteStall(
  card: RateCardEntry[], group: ZoneGroup, isFood: boolean, gstPercent: number,
): { net: number; gst: number; gross: number } | null {
  const net = lookupRate(card, group, isFood);
  return net === null ? null : addGst(net, gstPercent);
}
```

Add to the barrel.

- [ ] **Step 4: Run and watch it pass**

Run: `npm test --workspace=packages/stalls`

- [ ] **Step 5: Commit**

```bash
git add packages/stalls
git commit -m "feat: 2025 rate card and stall quoting"
```

---

## Task 6: Module RBAC

**Files:**
- Create: `packages/stalls/src/rbac.ts`, `packages/stalls/src/rbac.test.ts`
- Modify: `packages/stalls/src/index.ts`

**Interfaces:**
- Produces: `MODULE_KEY = 'stalls'`, `ROLES: StallRole[]`, `type StallRoleKey`, `can(roleKeys: string[], action: StallAction): boolean`

**Context:** The requirements PDF lists the user types: External vendors, Local welfare vendors, Ashram stall vendors, Admin, Volunteer, Lead. The prototype's Admin screen shows the staff-side access matrix: Public forms only · Full access incl. Admin config · Check-in, Chairs & Tables · Planning, Selection, Communication, Finance. Host ADR 0016: the Foundation stores only a module key and name; roles resolve inside the module.

- [ ] **Step 1: Write the failing test**

`packages/stalls/src/rbac.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { can, MODULE_KEY, ROLES } from './rbac';

describe('MODULE_KEY', () => {
  test('is the key the host registry will store', () => {
    expect(MODULE_KEY).toBe('stalls');
  });
});

describe('ROLES', () => {
  test('declares the four staff roles from the requirements', () => {
    expect(ROLES.map((r) => r.roleKey).sort()).toEqual(
      ['stalls_admin', 'stalls_finance', 'stalls_lead', 'stalls_volunteer'],
    );
  });

  test('every role carries a human label for the admin screen', () => {
    for (const role of ROLES) expect(role.name.length).toBeGreaterThan(0);
  });
});

describe('can', () => {
  test('admin can do everything, including configuring the module', () => {
    expect(can(['stalls_admin'], 'config:write')).toBe(true);
    expect(can(['stalls_admin'], 'selection:write')).toBe(true);
    expect(can(['stalls_admin'], 'checkin:write')).toBe(true);
  });

  test('lead runs planning and selection but cannot change configuration', () => {
    expect(can(['stalls_lead'], 'planning:write')).toBe(true);
    expect(can(['stalls_lead'], 'selection:write')).toBe(true);
    expect(can(['stalls_lead'], 'config:write')).toBe(false);
  });

  test('volunteer is check-in and chairs only, and cannot see money', () => {
    expect(can(['stalls_volunteer'], 'checkin:write')).toBe(true);
    expect(can(['stalls_volunteer'], 'selection:write')).toBe(false);
    expect(can(['stalls_volunteer'], 'finance:read')).toBe(false);
  });

  test('finance reads requests and owns payment confirmation', () => {
    expect(can(['stalls_finance'], 'finance:write')).toBe(true);
    expect(can(['stalls_finance'], 'requests:read')).toBe(true);
    expect(can(['stalls_finance'], 'selection:write')).toBe(false);
  });

  test('holding several roles grants the union', () => {
    expect(can(['stalls_volunteer', 'stalls_finance'], 'finance:write')).toBe(true);
  });

  test('no roles grants nothing, and an unknown role is not an error', () => {
    expect(can([], 'requests:read')).toBe(false);
    expect(can(['not_a_role'], 'requests:read')).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test --workspace=packages/stalls -- rbac`

- [ ] **Step 3: Implement**

`packages/stalls/src/rbac.ts`:

```ts
/** This module's own access control. Host ADR 0016: the Foundation records only
 *  THAT a person uses this module; which role they hold is this module's fact,
 *  granted on this module's own Users screen against its own table. Nothing here
 *  is stored by the host, so nothing here can go stale against it. */
export const MODULE_KEY = 'stalls';

export const STALL_ACTIONS = [
  'requests:read', 'requests:write',
  'planning:read', 'planning:write',
  'selection:read', 'selection:write',
  'comms:write',
  'finance:read', 'finance:write',
  'checkin:write',
  'config:read', 'config:write',
  'users:write',
] as const;
export type StallAction = (typeof STALL_ACTIONS)[number];

export interface StallRole {
  roleKey: string;
  name: string;
  description: string;
  actions: readonly StallAction[];
}

const LEAD_ACTIONS = [
  'requests:read', 'requests:write',
  'planning:read', 'planning:write',
  'selection:read', 'selection:write',
  'comms:write', 'finance:read', 'config:read',
] as const;

export const ROLES: StallRole[] = [
  {
    roleKey: 'stalls_admin',
    name: 'Admin',
    description: 'Full access, including module configuration',
    actions: STALL_ACTIONS,
  },
  {
    roleKey: 'stalls_lead',
    name: 'Lead (Stall Coordinator)',
    description: 'Planning, selection, communication and finance visibility',
    actions: LEAD_ACTIONS,
  },
  {
    roleKey: 'stalls_volunteer',
    name: 'Volunteer',
    description: 'Check-in, chairs and tables',
    actions: ['requests:read', 'checkin:write'],
  },
  {
    roleKey: 'stalls_finance',
    name: 'Finance',
    description: 'Payment confirmation and refunds',
    actions: ['requests:read', 'finance:read', 'finance:write'],
  },
];

const BY_KEY = new Map(ROLES.map((r) => [r.roleKey, r]));

/** An unknown role key grants nothing rather than throwing: grants are data an
 *  admin edits, and a stale key in a session must read as "no access", never as
 *  a 500 on every request that person makes. */
export function can(roleKeys: string[], action: StallAction): boolean {
  return roleKeys.some((key) => BY_KEY.get(key)?.actions.includes(action) ?? false);
}
```

Add to the barrel.

- [ ] **Step 4: Run and watch it pass**

Run: `npm test --workspace=packages/stalls`

- [ ] **Step 5: Commit**

```bash
git add packages/stalls
git commit -m "feat: module-owned RBAC for stalls"
```

---

## Task 7: Form definitions with bilingual labels

**Files:**
- Create: `packages/stalls/src/forms.ts`, `packages/stalls/src/forms.test.ts`
- Modify: `packages/stalls/src/index.ts`

**Interfaces:**
- Produces: `FORM_DEFINITIONS: Record<StallRequestType, FormDefinition>`, `type FormField`, `fieldsFor(type): FormField[]`

**Context:** Transcribe the fields from the 2025 PDFs. The Tamil strings must be copied exactly from `Vendor Stall Request Form 2025.pdf` — do not machine-translate. Where the 2025 form had no Tamil (the Ashram form is English-only, as ashram departments work in English), `labelTa` is `null`.

Field inventory, per form:

- **VENDOR** — email·`Email`, agree·`I Agree / நான் ஒப்புக்கொள்கிறேன்`, stallName·`Stall Name/ஸ்டால் பெயர்`, vendorName·`Vendor Name`, address·`Address/முகவரி`, contactNumber·`Contact Number/தொடர்பு எண்`, stallType·`Type of stall/ஸ்டால் வகை`, preferredZone (category list with rents), itemsSelling·`What items are you selling? (Cannot change the items listed here)`, numStalls·`Number of stalls required (Stall size is 10x20 Feet)`, remarks·`Any additional remarks/ ஏதேனும் கூடுதல் கருத்துகள்`
- **LOCAL_WELFARE** — the vendor fields plus the electrical block (5A plugs, 15A plugs, gas stoves, 4× appliance+wattage), tables, chairs, 2-wheeler/4-wheeler/staff passes, and `depositAcknowledged`
- **ASHRAM** / **ASHRAM_FOOD** — departmentHead, departmentHeadContact, department, requestedBy, requesterContact, creditCardNeeded, usage (5 options + other), itemsSelling, preferredZone, numStalls, wantsThembu (`Do you want a stall during 11 Days of Tamil Thembu?`), 5A plugs (`One 5 Amp plug comes with the stall, each additional plug Rs.500`), 15A plugs (`Rs. 1000 each`), gas stoves (0/1/2), 4× appliance+wattage, tables, chairs (`Each Chair : Rs.50/day`), passes, remarks, agree

- [ ] **Step 1: Write the failing test**

`packages/stalls/src/forms.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { fieldsFor, FORM_DEFINITIONS } from './forms';

describe('FORM_DEFINITIONS', () => {
  test('covers all four request types', () => {
    expect(Object.keys(FORM_DEFINITIONS).sort()).toEqual(
      ['ASHRAM', 'ASHRAM_FOOD', 'LOCAL_WELFARE', 'VENDOR'],
    );
  });
});

describe('fieldsFor VENDOR', () => {
  const fields = fieldsFor('VENDOR');
  const byName = new Map(fields.map((f) => [f.name, f]));

  test('carries the Tamil label printed on the 2025 form', () => {
    expect(byName.get('stallName')?.labelTa).toBe('ஸ்டால் பெயர்');
    expect(byName.get('address')?.labelTa).toBe('முகவரி');
    expect(byName.get('contactNumber')?.labelTa).toBe('தொடர்பு எண்');
  });

  test('requires the allocation disclaimer', () => {
    expect(byName.get('agreed')?.required).toBe(true);
  });

  test('does not ask a vendor for electrical details — that comes after selection', () => {
    expect(byName.has('plugs5a')).toBe(false);
    expect(byName.has('gasStoves')).toBe(false);
  });
});

describe('fieldsFor LOCAL_WELFARE', () => {
  const byName = new Map(fieldsFor('LOCAL_WELFARE').map((f) => [f.name, f]));

  test('asks for electrical and logistics up front', () => {
    expect(byName.has('plugs5a')).toBe(true);
    expect(byName.has('plugs15a')).toBe(true);
    expect(byName.has('gasStoves')).toBe(true);
    expect(byName.has('chairsNeeded')).toBe(true);
  });

  test('requires the security deposit acknowledgement', () => {
    expect(byName.get('depositAcknowledged')?.required).toBe(true);
  });
});

describe('fieldsFor ASHRAM', () => {
  const byName = new Map(fieldsFor('ASHRAM').map((f) => [f.name, f]));

  test('asks the department questions', () => {
    expect(byName.has('departmentHead')).toBe(true);
    expect(byName.has('department')).toBe(true);
    expect(byName.has('creditCardNeeded')).toBe(true);
    expect(byName.get('usage')?.options?.length).toBe(5);
  });

  test('asks about the 11 days of Tamil Thembu', () => {
    expect(byName.has('wantsThembu')).toBe(true);
  });

  test('is English-only, as the 2025 ashram form was', () => {
    for (const field of fieldsFor('ASHRAM')) expect(field.labelTa).toBeNull();
  });
});

describe('every form', () => {
  test('has unique field names', () => {
    for (const type of Object.keys(FORM_DEFINITIONS) as (keyof typeof FORM_DEFINITIONS)[]) {
      const names = fieldsFor(type).map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test('every select field offers options', () => {
    for (const type of Object.keys(FORM_DEFINITIONS) as (keyof typeof FORM_DEFINITIONS)[]) {
      for (const field of fieldsFor(type)) {
        if (field.type === 'select' || field.type === 'radio') {
          expect(field.options?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test --workspace=packages/stalls -- forms`

- [ ] **Step 3: Implement**

Write `packages/stalls/src/forms.ts` with this shape, then fill in every field from the inventory above:

```ts
import type { StallRequestType } from './reference';

export type FieldType =
  | 'text' | 'textarea' | 'email' | 'tel' | 'number'
  | 'select' | 'radio' | 'checkbox' | 'appliances';

export interface FieldOption { value: string; label: string; labelTa: string | null }

export interface FormField {
  name: string;
  label: string;
  /** The Tamil label printed beside the English one on the 2025 Google Form.
   *  `null` where the 2025 form had none — the ashram forms are English-only
   *  because ashram departments work in English. Never machine-translated. */
  labelTa: string | null;
  help?: string;
  type: FieldType;
  required: boolean;
  options?: FieldOption[];
  max?: number;
}

export interface FormDefinition {
  type: StallRequestType;
  title: string;
  titleTa: string | null;
  intro: string;
  introTa: string | null;
  fields: FormField[];
}

export const FORM_DEFINITIONS: Record<StallRequestType, FormDefinition> = { /* … */ };

export function fieldsFor(type: StallRequestType): FormField[] {
  return FORM_DEFINITIONS[type].fields;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npm test --workspace=packages/stalls`

- [ ] **Step 5: Verify the Tamil survived encoding**

Run: `node -e "const {fieldsFor}=await import('./packages/stalls/src/forms.ts')" --experimental-strip-types` or simply re-read the file and confirm the Tamil renders as Tamil, not as `???` or mojibake. Files are UTF-8.

- [ ] **Step 6: Commit**

```bash
git add packages/stalls
git commit -m "feat: the four 2025 form definitions with bilingual labels"
```

---

## Task 8: Wire contracts

**Files:**
- Create: `packages/stalls/src/contracts.ts`, `packages/stalls/src/contracts.test.ts`
- Modify: `packages/stalls/src/index.ts`

**Interfaces:**
- Produces: `SubmitRequestInput` (Zod schema + inferred type), `PublicConfigResponse`, `RequestSummary`, `RequestDetail`, `SelectRequestInput`, `ZonePlanInput`

**Context:** These are the shapes that cross the network, shared by api and web so a rename breaks the build rather than production. Host convention: `@msr/shared` publishes wire contracts; `@msr/volunteering` does the same for one module. This is that, for stalls.

- [ ] **Step 1: Write the failing test**

`packages/stalls/src/contracts.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { SubmitRequestInput } from './contracts';

describe('SubmitRequestInput', () => {
  const valid = {
    requestType: 'VENDOR' as const,
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    email: 'priya@greenleaf.example',
    contactNumber: '9840012345',
    address: '12 Mettupalayam Road, Coimbatore',
    stallType: 'FOOD' as const,
    preferredZoneCode: 'C1' as const,
    itemsSelling: 'Organic spices, cold-pressed oils, honey',
    numStallsRequested: 1,
    agreed: true,
    customFields: {},
  };

  test('accepts a well-formed vendor submission', () => {
    expect(SubmitRequestInput.safeParse(valid).success).toBe(true);
  });

  test('refuses a submission that has not agreed to the disclaimer', () => {
    const r = SubmitRequestInput.safeParse({ ...valid, agreed: false });
    expect(r.success).toBe(false);
  });

  test('refuses a contact number that is not 10 Indian digits', () => {
    expect(SubmitRequestInput.safeParse({ ...valid, contactNumber: '12345' }).success).toBe(false);
    expect(SubmitRequestInput.safeParse({ ...valid, contactNumber: '0840012345' }).success).toBe(false);
  });

  test('accepts a contact number written with +91 or spaces', () => {
    expect(SubmitRequestInput.safeParse({ ...valid, contactNumber: '+91 98400 12345' }).success).toBe(true);
  });

  test('caps the number of stalls a single request may ask for', () => {
    expect(SubmitRequestInput.safeParse({ ...valid, numStallsRequested: 0 }).success).toBe(false);
    expect(SubmitRequestInput.safeParse({ ...valid, numStallsRequested: 99 }).success).toBe(false);
  });

  test('refuses any attempt to set status, stage or money from the public form', () => {
    const r = SubmitRequestInput.safeParse({ ...valid, status: 'SELECTED', stallNumber: 'A4-1' });
    // Unknown keys are stripped, never honoured.
    if (r.success) {
      expect('status' in r.data).toBe(false);
      expect('stallNumber' in r.data).toBe(false);
    }
  });

  test('requires the deposit acknowledgement for a local welfare request', () => {
    const lw = { ...valid, requestType: 'LOCAL_WELFARE' as const, depositAcknowledged: false };
    expect(SubmitRequestInput.safeParse(lw).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test --workspace=packages/stalls -- contracts`

- [ ] **Step 3: Implement**

`packages/stalls/src/contracts.ts` — the load-bearing part is the phone rule and the discriminated refinement:

```ts
import { z } from 'zod';
import { ZONE_CODES } from './zones';

/** Indian mobile numbers: 10 digits starting 6–9, optionally carrying a +91 and
 *  any amount of human spacing. Stored normalised to the bare 10 digits. */
export const IndianMobile = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^\+?91/, ''))
  .refine((s) => /^[6-9]\d{9}$/.test(s), 'expected a 10-digit Indian mobile number');

export const SubmitRequestInput = z
  .object({
    requestType: z.enum(['ASHRAM', 'ASHRAM_FOOD', 'LOCAL_WELFARE', 'VENDOR']),
    stallName: z.string().trim().min(1).max(200),
    requesterName: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    contactNumber: IndianMobile,
    address: z.string().trim().max(1000).optional(),
    stallType: z.enum(['FOOD', 'NON_FOOD']),
    preferredZoneCode: z.enum(ZONE_CODES),
    itemsSelling: z.string().trim().min(1).max(2000),
    numStallsRequested: z.number().int().min(1).max(10),
    remarks: z.string().trim().max(2000).optional(),
    agreed: z.literal(true),
    depositAcknowledged: z.boolean().optional(),
    plugs5a: z.number().int().min(0).max(50).optional(),
    plugs15a: z.number().int().min(0).max(50).optional(),
    gasStoves: z.number().int().min(0).max(10).optional(),
    appliances: z.array(z.object({
      name: z.string().trim().min(1).max(200),
      watts: z.number().int().min(0).max(50_000),
    })).max(20).optional(),
    tablesNeeded: z.number().int().min(0).max(50).optional(),
    chairsNeeded: z.number().int().min(0).max(200).optional(),
    passes2w: z.number().int().min(0).max(50).optional(),
    passes4w: z.number().int().min(0).max(50).optional(),
    passesStaff: z.number().int().min(0).max(200).optional(),
    ashram: z.object({ /* department block — see forms.ts */ }).optional(),
    customFields: z.record(z.string(), z.string().max(2000)).default({}),
  })
  // `.strict()` is deliberately NOT used — unknown keys are stripped silently so
  // a stale client does not 400, but nothing outside this schema is ever read.
  .refine(
    (v) => v.requestType !== 'LOCAL_WELFARE' || v.depositAcknowledged === true,
    { path: ['depositAcknowledged'], message: 'the security deposit must be acknowledged' },
  );

export type SubmitRequestInput = z.infer<typeof SubmitRequestInput>;
```

Then add `PublicConfigResponse`, `RequestSummary`, `RequestDetail`, `SelectRequestInput`, `ZonePlanInput` in the same file.

- [ ] **Step 4: Run and watch it pass**

Run: `npm test --workspace=packages/stalls`

- [ ] **Step 5: Commit**

```bash
git add packages/stalls
git commit -m "feat: shared wire contracts for the stalls module"
```

---

## Task 9: API app, Foundation stubs and the test-database harness

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/prisma.config.ts`, `apps/api/.env.example`, `apps/api/.env.test.example`
- Create: `apps/api/src/{prisma,errors,zod-validation,auth,activity,email,app,index}.ts`
- Create: `apps/api/src/storage/{media-namespace,disk-media-store}.ts`
- Create: `apps/api/test/setup/test-env.ts`, `apps/api/test/helpers/test-database.ts`, `apps/api/scripts/deploy-test-db.ts`
- Create: `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: `prisma`, `getCurrentPerson(req, client)`, `NotAuthorizedError`, `ValidationFailedError`, `ZodTypeProvider`, `useZodValidation(app)`, `recordActivity(client, event)`, `MediaStore`, `buildApp(deps): FastifyInstance`

**Critical:** every signature here is copied from `msr-app-replit`. Read the host file before writing the stub. A stub that invents a nicer signature is a migration bug planted on purpose.

- [ ] **Step 1: Write the manifest and configs**

`apps/api/package.json` dependencies pinned to the host's: `fastify@^5.12.3`, `@fastify/cookie@^11.1.2`, `@fastify/cors@^10.0.2`, `@fastify/helmet@^13.1.1`, `@fastify/rate-limit@^11.2.0`, `@prisma/client@^7.8.0`, `@prisma/adapter-pg@^7.8.0`, `zod@^4.5.4`, `dotenv@^16.4.7`, `pino-pretty@^13.1.3`, `@msr/stalls@*`; dev: `prisma@^7.8.0`, `tsx@^4.23.0`, `typescript@^7.0.2`, `vitest@^4.1.10`, `@types/node@^26.1.1`.

Scripts: `dev`, `start`, `typecheck`, `test`, `db:generate`, `db:migrate`, `db:deploy`, `db:test:deploy`, `db:seed`, `dev:signin`.

- [ ] **Step 2: Write the test-database guard first**

`apps/api/test/helpers/test-database.ts` — mirrors the host's R1 rule. The suite must refuse to run against anything whose database name does not end in `_test`:

```ts
export function assertTestDatabase(url: string | undefined): asserts url is string {
  if (!url) throw new Error('DATABASE_URL is not set — tests need .env.test');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `refusing to run tests against "${name}": the test database name must end in _test. ` +
        'This guard exists because the suite TRUNCATEs every table between tests.',
    );
  }
}
```

`apps/api/test/setup/test-env.ts` loads `.env.test`, calls `assertTestDatabase`, and exposes a `resetDatabase()` that truncates every `stall%` table with `CASCADE`.

- [ ] **Step 3: Write the failing health test**

`apps/api/test/health.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /health', () => {
  test('reports ok', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
    await app.close();
  });
});

describe('the stalls module is mounted', () => {
  test('its public config route answers', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `npm test --workspace=apps/api`
Expected: FAIL — cannot resolve `../src/app`

- [ ] **Step 5: Write the Foundation stubs and `buildApp`**

`src/prisma.ts` is the host's file verbatim. `src/errors.ts` carries `NotAuthorizedError` and `ValidationFailedError` with the host's `FieldViolation` shape. `src/zod-validation.ts` carries the host's `ZodTypeProvider` and `useZodValidation`. `src/auth.ts` exports `getCurrentPerson(req, client)` reading a dev session cookie. `src/storage/media-namespace.ts` is the host's `MediaStore` interface verbatim; `disk-media-store.ts` implements it against a directory.

`src/app.ts` registers helmet, cors, cookie, rate-limit, `useZodValidation`, the health route, and `registerStallsModule(app, { files })`.

- [ ] **Step 6: Run and watch it pass**

Run: `createdb msr_stalls_dev && createdb msr_stalls_test` then `npm run db:migrate --workspace=apps/api` and `npm test --workspace=apps/api`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat: api app with host-shaped Foundation stubs and a test-db guard"
```

---

## Task 10: Prisma schema — configuration models

**Files:**
- Create: `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`
- Create: `apps/api/src/modules/stalls/{roles,errors,editions,config}.ts`
- Create: `apps/api/test/config.test.ts`

**Interfaces:**
- Produces: `activeEdition(db): Promise<StallEdition>`, `listZones(db, editionId)`, `upsertZonePlan(db, input)`, `rateCardFor(db, editionId)`, `generateStalls(db, editionId, zoneCode, plan)`

Models: `StallEdition`, `StallZone`, `StallZonePlan`, `Stall`, `StallRateCard`, `StallChargeConfig`, `StallFineType`, `StallCustomField`, `StallFlowConfig`, plus the enums from the spec.

Tests cover: active-edition resolution when none is marked active (throws `NoActiveEditionError`, never picks one at random); seeding the 2025 zones and rates; `generateStalls` being idempotent (running it twice does not duplicate `A4-1`); a zone plan write rejecting a negative count.

- [ ] Step 1: Write `apps/api/test/config.test.ts` with the cases above
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Write the schema, run `npm run db:migrate --workspace=apps/api -- --name stalls_config`
- [ ] Step 4: Implement `editions.ts` and `config.ts`
- [ ] Step 5: Run — PASS
- [ ] Step 6: `git commit -m "feat: stalls configuration models, zones, rates and stall generation"`

---

## Task 11: Prisma schema — accounts and access links

**Files:**
- Create: `apps/api/src/modules/stalls/accounts.ts`
- Create: `apps/api/test/accounts.test.ts`
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Produces: `findOrCreateAccount(db, { email, phone, displayName })`, `mintAccessLink(db, { accountId, requestId, purpose, ttlDays }): Promise<{ token: string }>`, `resolveAccessLink(db, token): Promise<StallAccessLink>`

**Critical behaviours the tests must pin:**

- The token is 32 random bytes, base64url. Only its SHA-256 hash is stored — assert the raw token appears nowhere in the row.
- `resolveAccessLink` throws `UnknownAccessLinkError` for a bad token, an expired one, and a revoked one — and the error is the **same class** in all three cases, so the response cannot be used to distinguish "wrong" from "expired".
- Token comparison is by hash lookup, not a string scan.
- `findOrCreateAccount` matches on normalised email (lowercased, trimmed), so `Priya@X` and `priya@x ` are one account.

- [ ] Step 1: Write `apps/api/test/accounts.test.ts`
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Add `StallAccount` and `StallAccessLink` to the schema, migrate
- [ ] Step 4: Implement `accounts.ts`
- [ ] Step 5: Run — PASS
- [ ] Step 6: `git commit -m "feat: vendor accounts and hashed access links"`

---

## Task 12: Prisma schema — requests, and the submission seam

**Files:**
- Create: `apps/api/src/modules/stalls/submit.ts`
- Create: `apps/api/test/submit.test.ts`
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**
- Consumes: `findOrCreateAccount`, `mintAccessLink`, `activeEdition`
- Produces: `submitRequest(db, input: SubmitRequestInput): Promise<{ reference: string; statusToken: string }>`

Models: `StallRequest`, `StallRequestAshramDetail`, `StallRequestAppliance`, `StallCustomFieldValue`, `StallAllocation`.

**Critical behaviours:**

- The reference sequence is per edition **and** per type, allocated inside the same transaction as the insert, so two concurrent submissions cannot both take `VEN-2026-0042`. Test this by firing ten `submitRequest` calls with `Promise.all` and asserting ten distinct references.
- A submission always lands with `status: SUBMITTED`, `stage: NEW`. Test that an input carrying `status: 'SELECTED'` produces a `SUBMITTED` row.
- Appliances write as child rows in order.
- Custom field values write only for fields belonging to that form type — a value for another form's field is dropped, not stored.
- Submitting twice with the same email creates two requests against **one** account.

- [ ] Step 1: Write `apps/api/test/submit.test.ts`
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Add the request models, migrate
- [ ] Step 4: Implement `submit.ts`
- [ ] Step 5: Run — PASS
- [ ] Step 6: `git commit -m "feat: request models and the submission seam"`

---

## Task 13: Public routes

**Files:**
- Create: `apps/api/src/modules/stalls/public-routes.ts`, `apps/api/src/modules/stalls/index.ts`
- Create: `apps/api/test/public-routes.test.ts`

**Interfaces:**
- Produces: `StallsDeps`, `registerStallsModule(app, deps)`
- Routes: `GET /api/m/stalls/public/config`, `POST /api/m/stalls/public/requests`, `GET /api/m/stalls/public/status/:token`

**Critical behaviours:**

- `GET /config` returns open form types, zones with their rents (closed zones marked, no rent), custom fields and bilingual labels — and **no** staff data.
- `POST /requests` with a malformed body returns 400 with `FieldViolation[]`, not a 500.
- `GET /status/:token` with a wrong token returns **404**, not 403 — a 403 confirms the token exists.
- `GET /status/:token` returns only that account's requests. Test with two accounts and assert account A's token cannot see account B's request.
- The response for a `SUBMITTED` request does not leak internal notes or the flag reason.

- [ ] Step 1: Write `apps/api/test/public-routes.test.ts`
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement `public-routes.ts` and `index.ts`
- [ ] Step 4: Run — PASS
- [ ] Step 5: Run `npm run lint:boundaries` — expect no violations
- [ ] Step 6: `git commit -m "feat: public stalls API — config, submit, status"`

---

## Task 14: Staff request pipeline

**Files:**
- Create: `apps/api/src/modules/stalls/requests.ts`, `apps/api/src/modules/stalls/routes.ts`
- Create: `apps/api/test/requests.test.ts`

**Interfaces:**
- Produces: `listRequests(db, query): Promise<Page<RequestSummary>>`, `getRequest(db, id): Promise<RequestDetail>`, `flagRequest(db, id, reason, by)`, `unflagRequest(db, id, by)`
- Routes: `GET /api/m/stalls/requests`, `GET /api/m/stalls/requests/:id`, `POST /api/m/stalls/requests/:id/flag`, `DELETE /api/m/stalls/requests/:id/flag`

Filters: `requestType`, `status`, `stage`, `zoneCode`, free-text `q` across stall name, requester name, reference, email and phone. Cursor-paginated.

**Critical behaviours:** an unauthenticated caller gets 401; a `stalls_volunteer` can read but `POST /flag` returns 403; free-text search matches on reference exactly and on names case-insensitively; the list is stably ordered (`submittedAt DESC, id DESC`) so pagination cannot repeat or skip a row.

- [ ] Step 1: Write `apps/api/test/requests.test.ts`
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement `requests.ts` and the staff `routes.ts`
- [ ] Step 4: Run — PASS
- [ ] Step 5: `git commit -m "feat: staff request pipeline with filters and search"`

---

## Task 15: Planning

**Files:**
- Create: `apps/api/src/modules/stalls/planning.ts`
- Create: `apps/api/test/planning.test.ts`
- Modify: `apps/api/src/modules/stalls/routes.ts`

**Interfaces:**
- Consumes: `suggestStallCount`, `planTotals`, `generateStallNumbers` from `@msr/stalls`
- Produces: `readPlan(db, editionId)`, `writePlan(db, editionId, rows, by)`, `applyPlan(db, editionId, by)`
- Routes: `GET /api/m/stalls/planning`, `PUT /api/m/stalls/planning`, `POST /api/m/stalls/planning/apply`

**Critical behaviour — the one that matters:** `applyPlan` turns the plan into `Stall` rows. It must **never delete a stall that is already allocated**. Test: plan A4 for 30, apply, allocate `A4-5`, reduce the plan to 3, apply again — `A4-5` survives and the call reports which stalls it could not remove.

- [ ] Step 1: Write `apps/api/test/planning.test.ts` including the shrink-with-allocation case
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement `planning.ts`
- [ ] Step 4: Run — PASS
- [ ] Step 5: `git commit -m "feat: zone planning and stall generation that never orphans an allocation"`

---

## Task 16: Selection and allocation

**Files:**
- Create: `apps/api/src/modules/stalls/selection.ts`
- Create: `apps/api/test/selection.test.ts`
- Modify: `apps/api/src/modules/stalls/routes.ts`

**Interfaces:**
- Produces: `shortlist(db, id, by)`, `selectRequest(db, { requestId, stallNumbers }, by)`, `rejectRequest(db, id, reason, by)`, `backupRequest(db, id, by)`, `releaseAllocation(db, allocationId, by)`
- Routes: `POST /api/m/stalls/requests/:id/{shortlist,select,reject,backup}`, `DELETE /api/m/stalls/allocations/:id`

**Critical behaviours:**

- `StallAllocation` has a **unique constraint on `stallId`** (where not released). The route relies on the constraint, not on a read-then-write check. Test concurrency: two `selectRequest` calls for the same stall via `Promise.all` — exactly one succeeds, the other throws `StallAlreadyAllocatedError`, and the database holds one allocation.
- Selecting fewer stalls than requested is allowed; selecting more is rejected.
- A stall in a `BLOCKED` state cannot be allocated.
- Rejecting a selected request releases its allocations.
- Every transition writes an activity trail entry via `recordActivity`.

- [ ] Step 1: Write `apps/api/test/selection.test.ts` with the concurrency case first
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Add the unique constraint, migrate, implement `selection.ts`
- [ ] Step 4: Run — PASS
- [ ] Step 5: `git commit -m "feat: selection and allocation with a database-enforced single occupant"`

---

## Task 17: Admin configuration routes

**Files:**
- Create: `apps/api/src/modules/stalls/staff.ts`
- Create: `apps/api/test/admin.test.ts`
- Modify: `apps/api/src/modules/stalls/{config,routes}.ts`

Routes for zones, rate card, charge config, fine types, custom fields, flow toggles, and staff role grants. All require `config:write` except the reads, which require `config:read`. Staff grants require `users:write`.

**Critical behaviours:** a `stalls_lead` gets 403 on every write here; removing the last `stalls_admin` is refused (`LastAdminError`) so nobody can lock the team out; a custom field cannot be deleted once it has values, only deactivated.

- [ ] Step 1: Write `apps/api/test/admin.test.ts`
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement
- [ ] Step 4: Run — PASS
- [ ] Step 5: `git commit -m "feat: admin configuration and staff role grants"`

---

## Task 18: Web shell

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`
- Create: `apps/web/src/main.tsx`, `src/app/router.tsx`, `src/app/layout.tsx`, `src/app/dev-signin.tsx`
- Create: `apps/web/src/lib/{cn,api-client}.ts`, `src/components/ui/*` (button, input, select, checkbox, table, dialog, badge, card — shadcn, same as host)
- Create: `apps/web/src/index.css` (Tailwind 4)

Dependencies pinned to the host's: `react@^19.2.0`, `react-dom@^19.2.0`, `react-router@^8.2.0`, `tailwindcss@^4.3.2`, `@tailwindcss/vite@^4.3.2`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, `sonner`, `@msr/stalls@*`; dev: `vite@^8.1.4`, `@vitejs/plugin-react@^6.0.3`, `vitest@^4.1.10`, `@testing-library/react@^16.3.2`, `jsdom@^30.0.0`.

Vite proxies `/api` to `http://localhost:3000`.

- [ ] Step 1: Scaffold, write a smoke test that renders the layout and asserts the nav is present
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement
- [ ] Step 4: Run — PASS; also `npm run dev` and confirm the page loads
- [ ] Step 5: `git commit -m "feat: web shell with router, layout and UI primitives"`

---

## Task 19: Public forms

**Files:**
- Create: `apps/web/src/modules/stalls/api.ts`
- Create: `apps/web/src/modules/stalls/public/{FormPicker,RequestForm,Submitted,StatusPage}.tsx`
- Create: `apps/web/src/modules/stalls/components/{BilingualLabel,ApplianceRows,ZoneSelect}.tsx`
- Create: `apps/web/src/modules/stalls/public/RequestForm.test.tsx`

The form renders from `FORM_DEFINITIONS` plus the custom fields returned by `/config` — one component driving all four forms, not four components.

**Critical behaviours the tests pin:** the Tamil label renders beside the English one; submit is disabled until the disclaimer is ticked; a local welfare form additionally requires the deposit acknowledgement; a server `FieldViolation` renders against the right field; the zone select shows the rent for each open zone and marks closed zones as unavailable.

- [ ] Step 1: Write `RequestForm.test.tsx`
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement
- [ ] Step 4: Run — PASS
- [ ] Step 5: `git commit -m "feat: bilingual public request forms"`

---

## Task 20: Status page

**Files:**
- Create: `apps/web/src/modules/stalls/public/StatusPage.test.tsx`
- Modify: `apps/web/src/modules/stalls/public/StatusPage.tsx`

Reached at `/stalls/status/:token`. Shows the vendor's requests with a status pill, the reference, and — once selected — the zone and stall number. An unknown token renders a plain "this link is not valid" page with no detail.

- [ ] Step 1: Write the test
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement
- [ ] Step 4: Run — PASS
- [ ] Step 5: `git commit -m "feat: vendor status page behind a signed link"`

---

## Task 21: Staff dashboard and request screens

**Files:**
- Create: `apps/web/src/modules/stalls/staff/{Dashboard,Requests,AllRequests,RequestDetail}.tsx`
- Create: `apps/web/src/modules/stalls/staff/Requests.test.tsx`

Dashboard tiles from the prototype: total requests, by type, pending selection, pending bank details, FSSAI pending, stalls not checked in (the last three read zero in Phase 1 and are labelled as such rather than hidden). Requests screen carries the prototype's card/table toggle, the type/status/stage filters and the search box. Detail is a drawer with an Application Details tab showing every submitted field including appliances and custom fields.

- [ ] Step 1: Write `Requests.test.tsx` — filters narrow the list, search matches a reference, the toggle switches view
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement
- [ ] Step 4: Run — PASS
- [ ] Step 5: `git commit -m "feat: staff dashboard and request screens"`

---

## Task 22: Planning, selection and admin screens

**Files:**
- Create: `apps/web/src/modules/stalls/staff/{Planning,Selection,Admin}.tsx`
- Create: `apps/web/src/modules/stalls/staff/Planning.test.tsx`, `Selection.test.tsx`

Planning is the prototype's grid: a row per zone, a column per category, an editable crowd figure and a crowd-per-stall divisor, live totals, and an Apply button that warns before removing stalls. Selection is shortlist → select with a zone and stall-number picker that shows only free stalls. Admin carries the settings tabs: zones, rates, charges, fines, custom fields, flow toggles, users.

- [ ] Step 1: Write both tests — editing a crowd figure updates the suggestion and the totals; the stall picker excludes an allocated stall
- [ ] Step 2: Run — FAIL
- [ ] Step 3: Implement
- [ ] Step 4: Run — PASS
- [ ] Step 5: `git commit -m "feat: planning, selection and admin screens"`

---

## Task 23: Seed, migration rehearsal and the README

**Files:**
- Create: `apps/api/prisma/seed.ts` (2026 edition, 2025 zones/crowds/rates, a handful of requests)
- Create: `docs/migration-to-host.md`
- Create: `README.md`

`docs/migration-to-host.md` is the checklist that makes the promise concrete: copy `apps/api/src/modules/stalls/` and `apps/web/src/modules/stalls/` and `packages/stalls/`; append the `Stall*` models to the host's `schema.prisma` and generate one migration; add `registerStallsModule(app, { files: mediaStore })` to the host's `app.ts`; add `stalls` to the host's `MODULE_ROLE_KEYS` reading `ROLES` from `modules/stalls/roles`; add the route subtree to the host's web router; delete the shell.

- [ ] Step 1: Write the seed, run `npm run db:seed --workspace=apps/api`, confirm the app shows realistic data
- [ ] Step 2: Write `docs/migration-to-host.md` and `README.md`
- [ ] Step 3: Run the full gate: `npm run check && npm run typecheck && npm run lint:boundaries && npm test`
- [ ] Step 4: `git commit -m "chore: seed data, migration checklist and README"`

---

## Self-Review

**Spec coverage.** Every Phase 1 item in the design maps to a task: the four forms → 7, 19; vendor capture and return links → 11, 13, 20; request pipeline → 12, 14, 21; planning → 3, 15, 22; selection and allocation → 16, 22; admin config → 10, 17, 22; module seam and boundary enforcement → 9, 13, 23; bilingual labels → 7, 19; money in paise → 2, 5; RBAC → 6, 14, 17.

**Deliberate gaps, carried forward.** Phase 2 and 3 areas are out of scope by decision, and `StallStage` values beyond `NEW` are modelled but unused — stated in the spec.

**Type consistency.** `StallRequestType` is defined once in `reference.ts` and imported by `forms.ts` and `contracts.ts`. `ZoneCode` is defined once in `zones.ts` and imported by `stall-numbers.ts`, `rates.ts` (via `ZoneGroup`) and `contracts.ts`. `StallCategory` lives in `zones.ts` and is used by `planning.ts`. `MediaStore` is defined in `storage/media-namespace.ts` and consumed as `StallsDeps.files`.

**Known risk, accepted.** Tasks 10 and 12 build the Prisma schema incrementally across three migrations. That is deliberate — a single 500-line schema commit is unreviewable — but it means the schema must be re-read before each addition rather than written from memory.
