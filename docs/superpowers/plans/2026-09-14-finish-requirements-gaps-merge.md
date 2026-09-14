# Finishing the requirements-gaps merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the merged tree from "compiles except for 23 errors, several write paths unrouted" to "typechecks clean, every suite green, every service write path reachable, documentation current".

**Architecture:** `feat/requirements-gaps-from-transcript` turned two closed unions into per-edition database rows — `ZONE_CODES` became `StallZone` rows and `STALL_CATEGORIES` became `StallPlanCategory` rows — and moved the refundable advance out of the flat charge config onto each rate-card row, so rent and advance are per bay × food/non-food × requester scope. Everything left to do is a consequence of those three moves: code that still reads a constant must read the edition's own data instead, and the admin writes that maintain that data need routes.

**Tech Stack:** TypeScript 7, Fastify + Prisma 7 (Postgres), React 19 + React Router 8, Vitest 4, Zod 4, Biome, dependency-cruiser.

## Global Constraints

- The module boundary is machine-checked. `apps/api/src/modules/stalls/` may import only itself, `@msr/stalls`, and the Foundation files; `apps/web/src/modules/stalls/` may import only itself and `@msr/stalls`. Run `npm run lint:boundaries` before every commit.
- Nothing may reintroduce a closed list of zone codes or category keys. Both are per-edition rows; screens read the columns the payload carries.
- The stall NUMBER stays hidden from a requester until check-in. The allocated ZONE is disclosed early, because the rent depends on it.
- Money is paise, integers, everywhere. GST applies to fees only, never to a deposit.
- A rate row carries its own `depositPaise`. There is no edition-wide deposit field.
- Local welfare is its own `RateScope`, not a discounted vendor.
- Commit after each task with the working tree typechecking.

---

### Task 1: Zone plan rows in the shared package typecheck

**Files:**
- Test: `packages/stalls/src/zones.test.ts`

**Interfaces:**
- Consumes: `ZonePlanRow { zoneCode: ZoneCode; counts: CategoryCounts }` where `CategoryCounts = Record<string, number>`.
- Produces: nothing new.

- [x] **Step 1: Annotate the literal**

A row literal that omits a category infers `VENDOR_FOOD?: undefined`, which `Record<string, number>` rejects. Annotate the array and import the type.

```ts
import { /* … */ suggestStallCount, type ZonePlanRow } from './zones';
// …
const rows: ZonePlanRow[] = [
```

- [x] **Step 2: Verify**

Run: `npm run typecheck --workspace=packages/stalls && npm test --workspace=packages/stalls`
Expected: no errors; 132 tests pass.

---

### Task 2: API test helpers and tests follow the config-as-data schema

**Files:**
- Modify: `apps/api/test/helpers/plan.ts`, `apps/api/test/helpers/onboarding.ts`
- Modify: `apps/api/test/planning.test.ts`, `apps/api/test/comms.test.ts`, `apps/api/test/config.test.ts`

**Interfaces:**
- Consumes: `StallPlanCategory` rows (Prisma), `TestDeps` from the test helpers, `StallMessageLog` (replaces `StallEmailLog`), `RateCardEntry { zoneCode, isFood, scope, amountPaise, depositPaise }`.
- Produces: a `TestDeps` value carrying `whatsapp`, `signer`, `signatureUrl` that every onboarding test reuses.

- [ ] **Step 1: Run the failing typecheck and capture the list**

Run: `npm run typecheck --workspace=apps/api 2>&1 | grep 'error TS'`
Expected: 9 errors across the five files above.

- [ ] **Step 2: `helpers/plan.ts` — categories come from the edition**

`STALL_CATEGORIES` and the Prisma `StallCategory` enum are gone. Seed the edition's categories and read them back, typing the callback parameter so no implicit `any` remains.

- [ ] **Step 3: `planning.test.ts` — a stall carries `categoryId`, not `category`**

Assert against the joined category row, not a scalar enum.

- [ ] **Step 4: `comms.test.ts` — the log is per channel**

`prisma.stallEmailLog` becomes `prisma.stallMessageLog`; a row now carries a channel, so assertions filter by `channel: 'EMAIL'`.

- [ ] **Step 5: `config.test.ts` — a rate row names a bay, not a band**

`zoneGroup` is gone. Assert on `zoneCode` plus `scope`, and assert the row's `depositPaise`.

- [ ] **Step 6: `helpers/onboarding.ts` — TestDeps gains the new ports**

Add the three missing members using the standalone adapters: a recording WhatsApp stub, `createUnconfiguredSigner()`, and a `signatureUrl` builder mirroring the other link builders.

- [ ] **Step 7: Verify and commit**

Run: `npm run typecheck --workspace=apps/api`
Expected: clean.

```bash
git add apps/api/test && git commit -m "test: API helpers follow config-as-data"
```

---

### Task 3: Planning and Electrical read the edition's own columns and bays

**Files:**
- Modify: `apps/web/src/modules/stalls/staff/Planning.tsx`
- Modify: `apps/web/src/modules/stalls/staff/Electrical.tsx`

**Interfaces:**
- Consumes: `ZonePlanView.categories: Array<{ key: string; name: string; isFood: boolean }>` — the grid's columns, sent with the data; `StaffConfig.zones` for the bay filter.
- Produces: nothing new.

- [ ] **Step 1: Planning — drop the `STALL_CATEGORIES` import**

Every use becomes `plan.categories`. The seven call sites are the form seed, the header row, the totals row, the per-row inputs, and the apply dialog. Column labels come from `c.name`, values are keyed by `c.key`.

- [ ] **Step 2: Electrical — the bay filter is loaded, not constant**

Replace `ZONE_CODES.map(...)` with the zones from `getConfig()`, loaded alongside the sheet.

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace=apps/web`
Expected: Planning and Electrical errors gone (Admin and RequestForm remain, Task 4/5).

---

### Task 4: The Admin rate card edits the per-bay matrix

**Files:**
- Modify: `apps/web/src/modules/stalls/staff/Admin.tsx`
- Modify: `apps/web/src/modules/stalls/api.ts` (`StaffConfig.rateCard` type)

**Interfaces:**
- Consumes: `RateCardEntry`, `RATE_SCOPES`, `ChargesInput`.
- Produces: an Admin rent panel that writes `PUT /config/rate-card` with full `{ zoneCode, isFood, scope, amountPaise, depositPaise }` rows.

- [ ] **Step 1: Fix the client's `StaffConfig.rateCard` type**

It still reads `{ zoneGroup: 'AB' | 'C' | 'CLOSED'; isFood; amountPaise }`. Replace with `RateCardEntry[]` imported from `@msr/stalls`.

- [ ] **Step 2: Rewrite the `Rates` panel**

The old panel edits four numbers against two bands. The new one is a row per bay from `c.zones`, each with four inputs: vendor rent, vendor advance, local welfare rent, local welfare advance — food and non-food selected by a toggle, so the grid stays readable at phone width. A bay closed to vendors shows its vendor columns disabled with "closed to trade", and still takes local welfare figures, which is the whole point of the rework.

- [ ] **Step 3: Charges panel loses the deposits, gains what the schema has**

Delete the `vendorDepositPaise` and `localWelfareDepositPaise` inputs — the advance is per rate row now. Add the fields the contract carries but the panel never showed: `vendorChairRatePaise`, `vendorTableRatePaise`, `chairReplacementPaise`, `tableReplacementPaise`, `eventDays`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace=apps/web`
Expected: Admin errors gone.

---

### Task 5: The public form is quoted at its own scope

**Files:**
- Modify: `apps/api/src/modules/stalls/public-routes.ts`
- Modify: `apps/web/src/modules/stalls/api.ts`, `apps/web/src/modules/stalls/public/RequestForm.tsx`
- Modify: `apps/web/src/modules/stalls/components/ZoneSelect.tsx`
- Test: `apps/api/test/phase2-routes.test.ts`, `apps/web/src/modules/stalls/public/RequestForm.test.tsx`

**Interfaces:**
- Consumes: `getPublicConfig(db, scope: RateScope)` — already takes the parameter, nothing passes it.
- Produces: `GET /public/config?scope=VENDOR|LOCAL_WELFARE`; `getPublicConfig(scope?: RateScope)` on the client.

This is a live defect, not only a type error: the route hardcodes the vendor scope, so a local welfare applicant is quoted vendor rents and told A3 and B2 are unavailable when those are exactly the bays they may have.

- [ ] **Step 1: Write the failing API test**

A request to `/public/config?scope=LOCAL_WELFARE` returns a rent for A3; the same request without the parameter does not.

- [ ] **Step 2: Run it, watch it fail**

- [ ] **Step 3: Route reads and validates the query**

Parse `scope` against `RATE_SCOPES`, default `VENDOR`, reject anything else with the module's 400.

- [ ] **Step 4: Client and form pass the scope**

`getPublicConfig(scope?)`; `RequestForm` derives it from the form type — `LOCAL_WELFARE` for the local welfare form, `VENDOR` otherwise — and passes the type as the `useLoad` cache key so switching forms refetches.

- [ ] **Step 5: The advance is shown per bay, not once in the header**

Delete the header's flat `charges.localWelfareDepositPaise`. `ZoneSelect` shows each bay's `depositPaise` beside its rent, and `showRent` becomes true for local welfare too, since they are quoted a rent as well.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm test --workspace=apps/web`

---

### Task 6: Routes for the unreachable write paths

**Files:**
- Modify: `apps/api/src/modules/stalls/routes.ts`
- Modify: `apps/api/src/modules/stalls/quotes.ts` (delete the dead `quoteInclude` export)
- Modify: `apps/web/src/modules/stalls/api.ts`
- Test: `apps/api/test/config.test.ts`, `apps/api/test/onboarding.test.ts`

**Interfaces:**
- Consumes: `createZone`, `deleteZone`, `replacePlanCategories`, `updateEditionSettings` (config.ts); `setCouponCapacity` (onboarding.ts); `readSignature`, `refreshSignature`, `sendForSignature` (signature.ts).
- Produces: eight routes, each behind the same RBAC action its neighbours use.

Eight exported service functions have no HTTP route. Seven of the eight mutate. `ZoneInUseError` and `CategoryInUseError` already exist and already map to a 409 through the module's error handler, so the guards are written — only the doors are missing.

- [ ] **Step 1: Write failing tests**

Creating a bay, deleting an unused one, refusing to delete one in use (409), replacing the planning columns, refusing to drop a column in use (409), editing edition settings, raising a coupon's capacity.

- [ ] **Step 2: Run them, watch them fail with 404**

- [ ] **Step 3: Add the routes**

```
POST   /config/zones                  createZone
DELETE /config/zones/:code            deleteZone
PUT    /config/plan-categories        replacePlanCategories
PATCH  /editions/:id/settings         updateEditionSettings
POST   /requests/:id/coupon/capacity  setCouponCapacity
GET    /requests/:id/signature        readSignature
POST   /requests/:id/signature        sendForSignature
POST   /requests/:id/signature/refresh refreshSignature
```

- [ ] **Step 4: Delete `quoteInclude`**

Nothing references it, in its own file or anywhere else.

- [ ] **Step 5: Client functions for each**

- [ ] **Step 6: Verify and commit**

---

### Task 7: Admin screens for the new writes

**Files:**
- Modify: `apps/web/src/modules/stalls/staff/Admin.tsx`
- Modify: `apps/web/src/modules/stalls/staff/Onboarding.tsx`

- [ ] **Step 1: Zones panel takes add and remove**

An "Add bay" row and a delete on each bay. A 409 surfaces as "this bay has stalls planned or allocated against it" rather than a raw error.

- [ ] **Step 2: A planning-columns panel**

Add, rename, reorder, remove. A column in use cannot be removed — `PlanCategoryView.inUse` says which.

- [ ] **Step 3: Edition settings panel**

Name, the two virtual-account prefixes, and the cap on stalls per request.

- [ ] **Step 4: Coupon capacity on the onboarding screen**

The default is eight; the team raises it case by case. Show the current cap and let a staff member change it.

- [ ] **Step 5: Verify and commit**

---

### Task 8: Databases reset, every suite green

**Files:**
- Modify: `apps/api/prisma/seed.ts` if it drifts from the merged schema.

The dev and test databases still carry `20260912120636_stalls_phase2_3`, a migration this merge deleted. The schema it describes never shipped, so both are reset rather than migrated forward.

- [ ] **Step 1: Reset and migrate both databases**

```bash
npm run db:migrate --workspace=apps/api -- reset --force
npm run db:test:deploy --workspace=apps/api
```

- [ ] **Step 2: Seed and check the seed still matches the schema**

- [ ] **Step 3: Run everything**

```bash
npm run typecheck && npm test && npm run lint:boundaries && npm run check
```

- [ ] **Step 4: Commit**

---

### Task 9: Documentation matches the code

**Files:**
- Modify: `README.md`, `docs/requirements-traceability.md`, `docs/migration-to-host.md`

- [ ] **Step 1: Traceability doc covers the newly routed writes**

Each of the eight routes from Task 6 against the requirement it serves.

- [ ] **Step 2: README's module map drops the superseded files**

`billing.ts`, `contracts-ops.ts`, `coupon.ts`, `refund.ts`, `stages.ts`, `ops.ts`, `payments.ts`, `status.ts`, `links.ts`, `routes-ops.ts` no longer exist.

- [ ] **Step 3: Migration-to-host doc reflects the self-contained web module**

It owns its API client and theme hook; nothing under `src/lib` or `src/components` migrates with it.

- [ ] **Step 4: Commit**
