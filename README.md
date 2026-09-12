# MSR Stalls

Stall intake, planning and selection for Maha Shivratri — replacing the four
Google Forms and the spreadsheets around them.

Built standalone, designed to move: every line under `apps/*/src/modules/stalls/`
and `packages/stalls/` is written to be copied into
[`msr-app-replit`](https://github.com/IshaFoundationIT/msr-app-replit) as a
module. Everything else here is a shell that stands in for that host. See
[`docs/migration-to-host.md`](docs/migration-to-host.md).

## Phase 1 — what this does today

- **Four public request forms** (Vendor, Local Welfare, Ashram, Ashram Food),
  transcribed from the 2025 PDFs with the Tamil labels intact, plus
  admin-appended custom fields.
- **Vendor capture**: a submission creates an account keyed on email, mints a
  private status link, and emails a receipt. No password, no OTP.
- **Staff pipeline**: dashboard, request list with filters/search/cards,
  full application detail, flag for follow-up.
- **Planning & Zones**: crowd-driven stall suggestions per zone, a category
  grid, and stall-number generation that never removes an allocated stall.
- **Selection**: shortlist → select onto specific stalls, with a
  database-enforced single occupant per stall.
- **Admin**: zones, rate card, charges and deposits, fine types, custom fields,
  onboarding flow toggles, staff roles, editions.

Phases 2 (onboarding & money) and 3 (event-day ops) are specified in
[`docs/superpowers/specs/`](docs/superpowers/specs/) and not yet built.

## Run it

Requires Node 22+ and a local PostgreSQL.

```bash
npm install
createdb msr_stalls_dev && createdb msr_stalls_test

cp apps/api/.env.example apps/api/.env            # edit DATABASE_URL
cp apps/api/.env.test.example apps/api/.env.test  # edit DATABASE_URL

npm run db:migrate                                # dev database
npm run db:test:deploy --workspace=apps/api       # test database
npm run db:seed                                   # 2026 edition, staff, requests

npm run dev                                       # api :3000, web :5173
```

Then:

- Public forms: <http://localhost:5173/stalls/apply>
- Staff: <http://localhost:5173/m/stalls> — pick a seeded staff member to sign
  in (the dev stand-in for Isha SSO). The seed prints who has which role.

## Check it

```bash
npm test                 # @msr/stalls (pure), api (against Postgres), web (jsdom)
npm run typecheck
npm run check            # biome
npm run lint:boundaries  # module may import only what the host provides
```

## Layout

```
packages/stalls/            @msr/stalls — pure logic and wire contracts   MOVES
apps/api/src/modules/stalls/  the API module                              MOVES
apps/web/src/modules/stalls/  the screens                                 MOVES
apps/api/src/*.ts             Foundation stubs with the host's signatures  shell
apps/web/src/app/             router, layout, dev sign-in                  shell
docs/                         specs, plans, migration checklist
```

## Decisions worth knowing

- **Money is integer paise**, everywhere. Column names end in `Paise`.
- **Chair and table rates differ by requester type** — the 2025 ashram form
  quoted ₹50/chair/day, the local welfare form ₹100/chair and ₹300/table. Both
  are configured; neither is "the" rate.
- **A3 and B2 are closed to vendors** (no rent quoted) but offered to local
  welfare stalls as VIP seating. The zone lists differ per form accordingly.
- **Status and stage are separate axes.** Status is the selection decision;
  stage is how far a selected request has travelled through onboarding.
- **The public API is three routes in one file** (`public-routes.ts`). It is
  the whole unauthenticated surface.
