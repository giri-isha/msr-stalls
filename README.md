# Stall Management

Stalls from request to refund — replacing the four Google
Forms and the spreadsheets around them.

Built standalone, designed to move: every line under `apps/*/src/modules/stalls/`
and `packages/stalls/` is written to be copied into
[`msr-app-replit`](https://github.com/IshaFoundationIT/msr-app-replit) as a
module. Everything else here is a shell that stands in for that host. See
[`docs/migration-to-host.md`](docs/migration-to-host.md).

## What this does

The whole requirement, from stall request to check-in and refund.

**Intake & selection**

- **Three public request forms** (Vendor, Local Welfare, Ashram), one route
  each, transcribed from the 2025 PDFs with the Tamil labels intact, plus
  admin-appended custom fields. The 2025 sheets had a fourth, Ashram Food: it is
  the ashram form answered "Food", so a department is asked whether its stall
  sells food rather than made to declare it by choosing a page.
- **One form per account**: registration asks which of the three the account is
  for, and that is the only form it may fill — enforced on the write, not just
  on the page that offers the tiles. The other two are drawn and locked, because
  a department that registered as a vendor by mistake needs to see that the form
  they want exists and that the fix is a phone call.
- **Vendor capture**: a submission creates an account keyed on email, mints a
  private status link, and emails a receipt. No password, no OTP.
- **Getting back in**: the status page is the vendor's portal — what is
  outstanding, the bank form or FSSAI upload opened straight from it, and what
  they themselves submitted, read back to them. Lost the email? An address or a
  mobile number gets the link sent back to the account's own address, which is
  the whole of "login" here.
- **Backoffice pipeline**: dashboard, request list with filters/search/cards,
  full application detail, flag for follow-up.
- **Planning & Zones**: crowd-driven stall suggestions per zone, a category
  grid, and stall-number generation that never removes an allocated stall.
- **Selection**: shortlist → select onto specific stalls, with a
  database-enforced single occupant per stall.

**Onboarding & money**

- **Communication**: editable letters per edition, bulk or individual send with
  an attachment, and a log of the calls chasing what has not come back. A letter
  goes out once — enforced by a unique constraint, not a flag.
- **Bank, GST and contract**: the vendor's own form, reached from the selection
  email. Documents are presigned and uploaded straight to object storage; the
  API never sees the bytes.
- **Payment details**: the fee itemised exactly as the 2025 payment sheet
  itemises it, frozen at the moment the vendor is told what to pay.
- **Finance**: confirm a credit with its reference, amount and date; prepare a
  refund with the chairs-and-tables deduction and any penalties; record the
  voucher. No money is collected in the app — payment is NEFT, as in 2025.

**Event operations**

- **Electrical & Venue**: the stall-wise plug and appliance sheet, per bay,
  printable on A4.
- **Check-in**: who is here, how many staff registered, how many passes, and
  what is still outstanding. Nothing blocks a check-in.
- **Chairs & tables**: distribute, charge for extras at the counter, print a
  two-part challan, collect, and note what came back broken or short.
- **Staff registration**: a secure per-stall coupon the vendor forwards to their
  own team. Only the last four digits of an Aadhaar are ever stored.
- **FSSAI**: the vendor uploads, the team verifies; a re-upload clears the tick.

Both phases are specified in
[`docs/superpowers/specs/`](docs/superpowers/specs/), and every line of the
requirement is tracked against the code in
[`docs/requirements-traceability.md`](docs/requirements-traceability.md) —
including the four places where what was built differs from what was asked, and
why.

## Run it

Requires Node 22+ and a local PostgreSQL.

```bash
npm install
createdb stalls_dev && createdb stalls_test

cp apps/api/.env.example apps/api/.env            # edit DATABASE_URL
cp apps/api/.env.test.example apps/api/.env.test  # edit DATABASE_URL
# .env sets STALLS_DEV_MEDIA_DIR — without it, document uploads are off and the
# bank and FSSAI forms say so rather than failing silently.

npm run db:migrate                                # dev database
npm run db:test:deploy --workspace=apps/api       # test database
npm run db:seed                                   # Stalls 2027 edition, the backoffice, a full pipeline

npm run dev                                       # api :3000, web :5173
```

Then:

- Public forms: <http://localhost:5173/stalls/apply>
- Backoffice: <http://localhost:5173/m/stalls> — pick a seeded backoffice member to sign
  in (the dev stand-in for Isha SSO). The seed prints who has which role.
- The manual: <http://localhost:5173/m/stalls/docs> — the process end to end, a
  flow chart per stage (including how a stage is derived and which steps apply
  to whom), the vendor's journey, every backoffice screen and how it is used, and the
  reference tables for statuses, stages, roles and money. It is a nav item like any other
  and needs no role, so a volunteer who can only reach the check-in counter can
  still read where that counter sits in the whole thing.

The seed walks one vendor the whole way — letter sent, bank form in, payment
confirmed, certificate verified, staff registered, checked in — and leaves the
others part way, so every screen has both a finished row and an outstanding one.
It prints that vendor's status link and the staff-registration link; the vendor
pages are reachable only through links like those.

## Check it

```bash
npm test                 # @stalls/core (pure), api (against Postgres), web (jsdom)
npm run typecheck
npm run check            # biome
npm run lint:boundaries  # module may import only what the host provides
```

## Layout

```
packages/stalls/            @stalls/core — pure logic and wire contracts   MOVES
apps/api/src/modules/stalls/  the API module                              MOVES
apps/web/src/modules/stalls/  the screens                                 MOVES
apps/api/src/*.ts             Foundation stubs with the host's signatures  shell
apps/web/src/app/             router, layout, dev sign-in                  shell
docs/                         specs, plans, migration checklist
```

## Decisions worth knowing

- **Money is integer paise**, everywhere. Column names end in `Paise`.
- **Chair and table rates differ by requester type** — THREE pairs, because
  2025 quoted three: the ashram form ₹50/chair/day, the local welfare form
  ₹100/chair and ₹300/table, and the bank-details form a vendor fills ₹100 and
  ₹400. All three are configured; none is "the" rate. The ashram pair is never
  billed, because ashram departments are exempt, and it is kept because it is
  what the form quoted.
- **Bays and planning columns are per-edition rows, not constants.** The venue
  is redrawn every edition and the planning sheet's columns are a judgement the
  team makes each year, so both are added and removed from Admin. Nothing in the
  code may hold its own list of either.
- **Rent is per bay × food/non-food × requester scope**, and each rate row
  carries its own refundable advance — the advance is area-wise too, so a bay's
  rent and its deposit are edited together and cannot drift apart.
- **Local welfare is its own scope, not a discounted vendor.** The same ground
  is quoted one figure to a trader and a lower one to a village welfare
  requester, and the two bays closed to TRADE (A3 and B2) are priced for local
  welfare — they carry the traders who pay the most of any local welfare stall.
  "The rent for this zone" cannot be answered without knowing who is asking,
  which is why the public config takes a scope.
- **The stall NUMBER is withheld until check-in.** The bay is told early,
  because the rent depends on it; the number is handed over at the counter,
  where somebody is standing there to have the conversation it starts.
- **The bay a requester ASKED for and the bay they AGREED to are two columns.**
  The team routinely moves a shortlisted applicant to another side, and what
  they settle on is what the stall is priced at — settled before any stall
  number exists, because the payment letter goes out first. `agreedZoneCode` is
  written at selection or on an amendment, and the quote reads it ahead of the
  preference.
- **A request is capped at what one decision can cover.** Two stalls in one
  bay, by default; ground in a second bay is a second request, so the team can
  accept one and decline the other. The number is the edition's, editable in
  Admin, and enforced on the public write.
- **A role may be scoped to a requester type.** The local welfare team files
  inside this application, on behalf of village traders who have no email
  address — which makes them backoffice members holding real `requests:write`, with no
  business in a commercial vendor's bank details. Every list narrows to the
  scope and every request-addressed route checks it (`scope.ts`).
- **A coupon's capacity is the coupon's own** — eight by default, raised case by
  case — and never the vendor's staff-pass answer. A cap of zero admits nobody
  rather than everybody.
- **Status and stage are separate axes.** Status is the selection decision;
  stage is how far a selected request has travelled through onboarding.
- **The whole public API is one file** (`public-routes.ts`). Every route in it
  is gated by a signed link or a staff coupon, except the form's own config and
  the one open write. The credential names the request; nothing in a body ever
  does, which is why no public handler takes a request id.
- **GST applies to the fee, never to the deposit**, and the amount a vendor was
  told to pay is frozen when the payment email goes out. Finance reconciles
  against the figure in the vendor's inbox, not against a live quote.
- **Two deposits, and each deduction comes off its own.** Furniture not
  returned or damaged is charged to the chairs-and-tables deposit; a fine for
  an unclean stall to the stall deposit. An over-run on one is a debt to
  recover, carried as a shortfall — never a quiet raid on the other, which is
  the vendor's money.
- **The first 5A plug point is free.** The request form asks for plugs
  *excluding* it; the electrical sheet prints the total *including* it. One
  function owns that conversion.
- **One function decides what is outstanding** for a stall (`pendingSteps`), and
  the vendor's page, the onboarding table and the check-in counter all call it.
- **A vendor's link is their login.** There is no password to reset, so
  "I lost my link" is answered by the account, not by the caller: the address or
  number names an account, and the link goes to the address already on it.
- **Files never pass through the API.** The browser presigns and PUTs at the
  store; keys are minted from a UUID, never from what the vendor called the
  file.
- **"Backoffice" is the team; "staff" is the vendor's.** One word used to mean
  both — the people running the stalls and the people a vendor registers to
  work at their own stall — which is how a privilege named for one ends up read
  as the other. The team is the BACKOFFICE everywhere: `StallBackofficeRole`,
  `requireBackoffice`, `/api/m/stalls/backoffice`, the Users directory's
  Backoffice tile. "Staff" is left to the vendor alone — the coupon, the staff
  passes, the staff-registration page — and means exactly one thing now.
- **Every write leaves a row the team can read back.** `audit()` is the one
  way the module records that something happened: it writes the module's own
  `stall_audit_event` and forwards the same event to the host's trail. A
  requester's sign-ins and submissions are recorded against their account, not
  against whoever opens the record next; amendments and account edits carry
  before/after per field; every letter out is a row, sent or failed. Reading it
  is `audit.read`, a `sensitive` privilege, on Audit Logs and on each request's
  Activity Log tab. **Reads are deliberately not recorded** — a row per view
  would bury the writes the log exists to answer for.

- **A backoffice desk can set a requester's password, and that is
  TEMPORARY.** It is the only action in the module that hands somebody a way
  into an account rather than causing the account holder to be sent one, which
  is why it holds its own `passwords.write` and not `users.write`: a support
  desk can mail a vendor their link without being able to walk into their
  account. It exists for the village trader with no address and no smartphone,
  and it goes — privilege, route, dialog and all — when the host signs
  requesters in through Isha SSO. See step 3c of
  [`docs/migration-to-host.md`](docs/migration-to-host.md).
