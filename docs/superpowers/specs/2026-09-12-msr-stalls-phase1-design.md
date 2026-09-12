# MSR Stalls — Phase 1 (Intake & Selection) Design

Date: 2026-09-12
Status: Approved (Section 1 approved in conversation; user directed implementation to begin)

## Context

The MSR stalls team currently runs stall intake on four Google Forms plus a set of
spreadsheets. This project replaces that with a web application. It is built
standalone, but every line of it is written to be moved into
`msr-app-replit` (the "Sahayaka" host) as a module named `stalls`.

Sources this design is drawn from:

- `MSR 2026 Stalls Requirements.xlsx - Requirements.pdf` — 13 functional areas.
- `MSR Vendor Stall App - Standalone.html` — a working UX prototype with 11 staff
  screens, a public portal, and realistic seed data (7 zones, ~145 stalls).
- `stalls_forms/` — the 2025 Google Forms as PDFs, plus the 2025 planning,
  payment and electrical spreadsheets.
- `msr-app-replit` itself — the host whose conventions this repo mirrors.

## Scope

The full requirement spans 13 areas. It is decomposed into three phases along the
event timeline. **This spec covers Phase 1 only.**

| Phase | Contents |
|---|---|
| **1 — Intake & Selection** | 4 request forms, vendor signup/capture, request pipeline, planning & zones, selection + stall allocation, admin config (zones, rates, custom fields, staff users) |
| **2 — Onboarding & Money** | Email templates + bulk/individual send, bank/GST/contract collection, payment details screen, finance confirmation of offline payment |
| **3 — Event Ops** | Staff registration coupons, FSSAI upload, electrical/venue A4 sheets, check-in, chairs & tables distribution and collection, fines and refund voucher |

Phase 1 models the full status/stage enum so later phases add behaviour, not
migrations that rewrite history. It drives that enum only as far as `SELECTED`.

## Decisions

These were settled in the brainstorming conversation and are not open.

1. **Decomposition** — three phases by event timeline, as above.
2. **Repo shape** — mirror the host monorepo; stalls code lives in
   `apps/*/src/modules/stalls/` and `packages/stalls/` from day one.
3. **Vendor identity** — module-owned. Vendors never enter the host `Person`
   directory. RBAC lives in the module (host ADR 0016).
4. **Form configurability** — the 4 base forms are coded from the 2025 PDFs.
   Admins may *append* custom fields per form type. Flow Builder reduces to
   three booleans (bank step / payment step / FSSAI step). No form engine.
5. **Bilingual** — public forms carry English and Tamil labels inline, as the
   2025 Google Forms do. Staff screens are English. No i18n framework.
6. **Signup verification** — none. Submitting captures email and phone and
   creates an account. This matches the 2025 Google Form exactly.
7. **Return access** — the submission receipt email carries a long unguessable
   signed link to that vendor's own status page. Typing an email address alone
   grants nothing. The same mechanism serves Phase 2's bank form and Phase 3's
   FSSAI upload.
8. **Module seam** — the host's own hybrid, not a single mechanism (see below).

## Section 1 — Architecture & the migration seam

### Repo shape

```
stalls/
├── apps/api/
│   ├── prisma/schema.prisma          # only Stall* models — merges into host schema
│   └── src/
│       ├── app.ts auth.ts prisma.ts errors.ts        ← FOUNDATION STUBS
│       ├── zod-validation.ts activity.ts email.ts       (discarded on migration)
│       ├── storage/                                     (same interface as host)
│       └── modules/stalls/          ← MOVES VERBATIM
├── apps/web/src/
│   ├── app/ components/ui/ lib/      ← SHELL (discarded, except components+lib)
│   └── modules/stalls/              ← MOVES VERBATIM
├── packages/stalls/                 ← MOVES as @msr/stalls
└── .dependency-cruiser.cjs biome.json tsconfig.base.json   ← copied verbatim
```

### How the module gets what it does not own

The host does not use one mechanism; it uses two, and this repo copies both.

**Foundation infrastructure is imported by relative path.** The host's
`modules/cycle-management/routes.ts` imports `../../auth`, `../../prisma`,
`../../errors`, `../../zod-validation`, `../../activity` directly. This repo
provides files at those exact paths whose exported signatures are copied from
the host:

| Path | Export this repo must match |
|---|---|
| `src/auth.ts` | `getCurrentPerson(req, client): Promise<Person \| null>` |
| `src/prisma.ts` | `prisma` — one shared client, `PrismaPg` adapter |
| `src/errors.ts` | `NotAuthorizedError`, `ValidationFailedError`, … |
| `src/zod-validation.ts` | `ZodTypeProvider`, `useZodValidation(app)` |
| `src/activity.ts` | `recordActivity(client, event)` |
| `src/storage/media-namespace.ts` | `MediaStore` interface, namespace boundary |

On migration these imports resolve unchanged to the host's real files.

**Cross-module contracts are injected.** The host's pattern is
`registerCycleManagementRoutes(app, deps)` with a typed `Deps` interface, so a
module never imports another module. This repo does the same:

```ts
export interface StallsDeps {
  files: MediaStore;   // S3 in the host, disk in standalone
}
export function registerStallsRoutes(app: FastifyInstance, deps: StallsDeps): void
```

**RBAC lives in the module.** `modules/stalls/roles.ts` exports
`MODULE_KEY = 'stalls'` and `ROLES`. Per host ADR 0016 the Foundation stores only
a module's key and name; roles resolve in-process.

**Routes** mount at `/api/m/stalls/*`, web at `/m/stalls/*`, matching the host's
`/m/{key}` convention. Public, unauthenticated routes are isolated in
`public-routes.ts` under `/api/m/stalls/public/*` so the auth boundary is one
reviewable file.

**The boundary is machine-checked.** `.dependency-cruiser.cjs` carries the host's
two rules plus two migration guards: `modules/stalls/` may import only itself,
`@msr/stalls`, node_modules, and the Foundation files listed above. A stalls file
that reaches into the standalone shell fails the build here, not at migration.

### Known gap

The host's `Person` model and Isha OIDC SSO are not replicated. Staff auth in
this repo is a dev sign-in stub exposing the host's exact `getCurrentPerson`
signature. Staff login is therefore the one thing that cannot be exercised
against the real implementation until migration. Everything else moves untouched.

## Section 2 — Data model

All models are prefixed `Stall` so they merge into the host's 2,500-line
`schema.prisma` without collision. Prisma 7 with the `PrismaPg` driver adapter,
matching the host.

### Configuration

- **`StallEdition`** — `year`, `name`, `isActive`. The host has an edition concept;
  every request, zone plan, rate and allocation hangs off one. Without this, 2027
  reuses 2026's data.
- **`StallZone`** — `editionId`, `code` (A3, A4, B2, B3, B4, C1, C2), `name`,
  `expectedCrowd`, `isClosed`. 2025 had A3 and B2 closed.
- **`StallZonePlan`** — `zoneId`, `category`, `plannedCount`. Category is the
  enum below. This is the Planning screen's grid.
- **`Stall`** — `zoneId`, `number` (A4-17), `category`, `status`
  (`AVAILABLE | ALLOCATED | BLOCKED`). The allocatable unit. Generated from the
  zone plan, editable by an admin.
- **`StallRateCard`** — `editionId`, `zoneGroup`, `foodType`, `amountPaise`.
  The 2025 rents: A3/B2 closed; A4/B3/B4 food ₹18,000; A4/B3/B4 non-food ₹15,000;
  C food ₹15,000; C non-food ₹12,000 — all plus GST.
- **`StallChargeConfig`** — `editionId`, `chairRatePaise` (₹50/day),
  `tableRatePaise` (₹150/day), `vendorDepositPaise`, `localWelfareDepositPaise`,
  `plug5aRatePaise` (₹500), `plug15aRatePaise` (₹1,000).
- **`StallFineType`** — `editionId`, `reason`, `defaultAmountPaise`. Phase 3 uses
  these; Phase 1 only configures them.
- **`StallCustomField`** — `editionId`, `formType`, `label`, `labelTa`,
  `fieldType`, `isRequired`, `sortOrder`. The Form Builder's whole surface.
- **`StallFlowConfig`** — `editionId`, `bankStepEnabled`, `paymentStepEnabled`,
  `fssaiStepEnabled`. The Flow Builder's whole surface.

> **Money is stored in paise as integers.** Never floats. The host's own
> convention and the only safe one for amounts that get summed and refunded.

### Identity and access

- **`StallAccount`** — `email`, `phone`, `displayName`. The external requester.
  Created on first submission; no password, no verification (decision 6).
  Unique on normalised email; phone is captured but not a login key.
- **`StallAccessLink`** — `tokenHash`, `accountId`, `requestId?`, `purpose`
  (`STATUS | BANK_FORM | FSSAI_UPLOAD | STAFF_REGISTRATION`), `expiresAt`,
  `usedAt?`, `revokedAt?`. The return-access mechanism (decision 7). Only the
  **hash** is stored, so a database leak does not hand out live links.
- **`StallStaffRole`** — `personRef`, `roleKey`. Module-owned RBAC (decision 3).
  `personRef` is the host's `person_id` after migration; a stub id before it.

### Requests

One core table rather than four. The four forms overlap by roughly 70%, and a
single table is what the pipeline, search and export screens all read.

- **`StallRequest`** — the core:
  - identity: `editionId`, `accountId`, `reference` (e.g. `VEN-2026-0042`)
  - kind: `requestType` (`ASHRAM | ASHRAM_FOOD | LOCAL_WELFARE | VENDOR`),
    `category` (`FOOD | NON_FOOD`)
  - who: `stallName`, `requesterName`, `contactNumber`, `email`, `address`
  - what: `itemsSelling`, `stallTypeOther`, `numStallsRequested`,
    `preferredZoneCode`, `remarks`
  - electrical: `plugs5a`, `plugs15a`, `gasStoves`
  - logistics: `tablesNeeded`, `chairsNeeded`, `passes2w`, `passes4w`,
    `passesStaff`
  - consent: `agreedAt`, `depositAcknowledgedAt`
  - lifecycle: `status`, `stage`, `submittedAt`, `flaggedAt`, `flagReason`
- **`StallRequestAshramDetail`** — the ashram-only block, 1:1 optional:
  `departmentHead`, `departmentHeadContact`, `department`, `requestedBy`,
  `requesterContact`, `creditCardNeeded`, `usage`, `usageOther`, `wantsThembu`.
- **`StallRequestAppliance`** — `requestId`, `name`, `watts`, `sortOrder`.
  Child rows, not four nullable column pairs: the 2025 forms cap at 4 but the
  2025 *data* shows stalls listing more, and Phase 3's electrical load sheet
  sums them.
- **`StallCustomFieldValue`** — `requestId`, `customFieldId`, `value`.
- **`StallAllocation`** — `requestId`, `stallId`, `allocatedAt`, `allocatedBy`.
  Separate from `StallRequest` because a request for 3 stalls yields 3 rows, and
  because re-allocation must leave a trail.

### Enums

```
StallRequestType   ASHRAM | ASHRAM_FOOD | LOCAL_WELFARE | VENDOR
StallCategory      FOOD | NON_FOOD | HELP_DESK | BACKUP
StallRequestStatus SUBMITTED | SHORTLISTED | SELECTED | BACKUP | REJECTED | CANCELLED
StallStage         NEW | BANK_FORM_SENT | BANK_FORM_FILLED | PAYMENT_SENT
                 | PAYMENT_CONFIRMED | FSSAI_PENDING | READY | CHECKED_IN
StallStatus        AVAILABLE | ALLOCATED | BLOCKED
StallFormType      ASHRAM | ASHRAM_FOOD | LOCAL_WELFARE | VENDOR | BANK | FSSAI
```

`status` and `stage` are deliberately separate axes. Status is the selection
decision; stage is how far through onboarding a selected request has travelled.
Collapsing them into one enum is what makes these systems unqueryable by year two.

## Section 3 — Surface, errors, testing

### Public API — `/api/m/stalls/public/*`, unauthenticated

| Route | Purpose |
|---|---|
| `GET  /config` | Active edition, open form types, zones with rents, custom fields, bilingual labels |
| `POST /requests` | Submit a request. Creates or matches `StallAccount`, writes the request, mints a `STATUS` access link, sends the receipt |
| `GET  /status/:token` | That vendor's own requests. The only read path into vendor data |

Rate-limited (`@fastify/rate-limit`, already a host dependency). `POST /requests`
is the one unauthenticated write in the system and is treated as such:
strict Zod schemas, a per-IP and per-email cap, and no field that maps to
`status`, `stage`, or any money column.

### Staff API — `/api/m/stalls/*`, authenticated

`requests` (list/filter/search/detail/flag), `planning` (zone plan read/write,
crowd divisor, stall generation), `selection` (shortlist, select with zone +
stall number, reject, backup), `config` (zones, rates, charges, custom fields,
flow toggles, fines), `users` (staff roles).

### Screens — `apps/web/src/modules/stalls/`

Public: form picker → the four forms (bilingual, with appended custom fields) →
submitted confirmation → status page reached by signed link.

Staff, following the prototype's nav: Dashboard · Stall Requests · All Requests ·
Planning & Zones · Admin. The remaining six nav entries (Communication,
Onboarding, Electrical & Venue, Check-in, Chairs & Tables, Finance) are Phase 2
and 3; they are not stubbed in Phase 1.

### Error handling

The host's convention exactly: handlers stay thin — authenticate, call the
domain seam, map a thrown domain error to a status. Domain errors are classes in
`modules/stalls/errors.ts` (`ZoneCapacityExceededError`,
`StallAlreadyAllocatedError`, `EditionClosedError`, `UnknownAccessLinkError`).
Request-shape problems are Zod's and never reach the domain. `ValidationFailedError`
carries the host's `FieldViolation` shape so the web client renders field-level
errors the same way the host's forms do.

### Testing

TDD throughout, vitest, matching the host's split:

- **`packages/stalls/src/*.test.ts`** — pure logic, no I/O: zone-plan computation
  from crowd ÷ divisor, stall-number generation, reference-number formatting,
  rate lookup, RBAC predicates, bilingual label resolution.
- **`apps/api/test/*.test.ts`** — route and domain tests against a real Postgres
  test database, the host's `db:test:deploy` approach.
- **`apps/web/src/modules/stalls/*.test.tsx`** — Testing Library, on the forms'
  validation and the selection flow.

The allocation path gets the heaviest coverage: it is the one place where two
staff acting at once can double-allocate a stall. `StallAllocation` carries a
unique constraint on `stallId` and the route relies on it rather than on a
read-then-write check.

## Out of scope for Phase 1

Email templates and bulk send; bank/GST/contract collection; payment and finance
confirmation; FSSAI upload; electrical A4 sheets; check-in; chairs and tables;
fines and refunds. All are Phase 2 and 3 and each gets its own spec.
