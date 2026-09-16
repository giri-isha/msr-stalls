# Stall Management — Phases 2 & 3 (Onboarding, Money, Event Ops) Design

Date: 2026-09-13
Status: Built

## Context

Phase 1 delivered intake and selection and stopped at `SELECTED`. This spec
covers the rest of the requirement — everything between "you have a stall" and
"here is your deposit back".

Sources, beyond the Phase 1 set:

- `Copy of Vendor Stall Payment Details - 2025.xlsx` — the authority for the fee
  breakdown, the bank-details field list (with its Tamil), and the shape of a
  confirmed credit. Its column names are used verbatim in `quote.ts`.
- `Copy of Electrical data Stall_bay wise 2025.xlsx` — one sheet per bay; the
  columns are the electrical screen's columns.
- `MSR Vendor Stall App - Standalone.html` — the prototype's Communication,
  Onboarding, Electrical, Check-in, Chairs & Tables and Finance screens.

## Scope

| Area | Requirement line |
|---|---|
| Communication | "email template… bulk send and individally sending… Once the email is sent it should not be sent again" |
| Bank/GST/contract | "The selection confirm email will have the link for Bank details input form… This form is onl for the vendors" |
| Payment details | "Once the vendor enters the bank details the payment details email has to be sent. The calculation should be displayed" |
| Finance confirmation | "confirm the fee and deposit paid… enter the reference number, amount and date" |
| Reminder calls | "Reminder call for people pending entry for bank details" / "…pending payment" |
| Staff registration | "made by secure coupon basis so that registration is done by only the vendor using a key" |
| FSSAI | "The vendor should login and upload the FSSAI Certificate" |
| Electrical & venue | "share stall layout details… format which is printable in A4 sheet" |
| Check-in | "see the vendor name, stall number, number of staff registered… whether Any process is pending" |
| Chairs & tables | "mark as distributed… add more chairs and table and collect appropriate money… mark as collected… note it down… flagged for next action" |
| Refunds | "chairs & tables not returned and damaged… deducted from deposit… Any penalty against unclean stalls" |

## Decisions

These shaped the code and are the ones worth arguing with.

1. **Money is quoted from the rate card, then FROZEN when the vendor is told.**
   `StallPaymentPlan` snapshots the figures the payment email carried. Finance
   reconciles a bank credit against what is in the vendor's inbox, not against a
   live quote that moves when an admin edits a rate in February.

2. **GST applies to the fee, never to the deposit.** Straight from the 2025
   sheet's column layout. A taxed deposit refunds more than was taken.

3. **The first 5A plug is free.** The request form asks for plugs *excluding*
   the default; the electrical sheet prints the total *including* it. One
   function (`plugs5aIncludingDefault`) owns the conversion, so the screen and
   the printout cannot disagree.

4. **"Once sent, never again" is a database constraint,** not a flag. `UNIQUE
   (requestId, templateKey)` on `StallEmailLog`. A bulk send and an individual
   send can race; the loser is reported as a skip, and the whole batch does not
   fail for one row.

5. **Bulk and individual send are one route.** A list of one is an individual
   send. Two paths would be two places for rule 4 to be got wrong.

6. **One function decides what is outstanding.** `pendingSteps` in
   `@stalls/core/onboarding.ts` is called by the vendor's portal, the Onboarding
   table and the check-in counter. Before it existed, each screen decided for
   itself and a vendor could be "all set" on one and blocked on another.

7. **"Not applicable" is a third value, not a kind of "pending".** A local
   welfare stall is never asked for bank details; a non-food stall never needs
   FSSAI. Collapsing the two makes the Onboarding table a list of things that
   will never be ticked off.

8. **`stage` is a cache of `deriveStage`,** kept so the request list can filter
   in the database. It is recomputed after every fact-changing write and is
   never the source of truth. `CHECKED_IN` is the one exception — it records an
   event at a counter, so it is written, not derived.

9. **Nothing blocks a check-in.** The pending chips inform; they do not gate. A
   volunteer who cannot record what happened stops recording anything.

10. **The chairs counter snapshots what was ordered.** `StallEquipmentIssue`
    copies `chairsRequested`/`tablesRequested` when the row opens. The vendor is
    holding a printed challan; if the request were edited that evening, the
    paper and the screen would disagree and the paper is what was signed.

11. **A refund is never negative.** Deductions beyond the deposit floor the
    refund at zero and surface as `shortfallPaise`, which the team chases
    separately. Finance cannot process a negative voucher.

12. **The staff coupon is a credential.** 40 bits of randomness in a
    Crockford-style alphabet, prefixed with three letters of the stall name so a
    volunteer can read one down the phone. The prefix identifies nothing; the
    lookup is on the whole string.

13. **Aadhaar is reduced to its last four digits.** The gate volunteer compares
    four digits against a card. Holding the other eight would make this table
    worth stealing.

14. **Uploads never pass through the API.** The browser presigns, then PUTs at
    the store. Keys are minted from a UUID, never from the vendor's filename,
    and a key sent back must be one this module handed out for that purpose
    (`isOurKey`).

15. **Every public route is gated by a link or a coupon.** The credential names
    the request; nothing in a body ever does. That is why no public handler
    takes a request id.

## Data model additions

Phase 1 modelled the enums; Phase 2 and 3 add behaviour and these tables.

**Money and communication**

- `StallEmailTemplate` — editable subject/body per edition, seeded from
  `DEFAULT_TEMPLATES`, plus one optional attachment (a media key).
- `StallEmailLog` — one row per letter sent. The UNIQUE is decision 4.
- `StallBankDetail` — 1:1 with the request. The module's most sensitive table:
  no card data, no file bytes, only media keys presigned for minutes at a time.
- `StallReminderCall` — a log, not a counter: the question is when someone was
  last called and by whom.
- `StallPaymentPlan` — the frozen quote (decision 1).
- `StallPaymentRecord` — a confirmed credit. UNIQUE on `(requestId,
  referenceNo)`: the same NEFT pasted twice would double-count and shrink the
  refund.

**Event operations**

- `StallStaffCoupon` / `StallVendorStaff` — the coupon and who registered with
  it. UNIQUE on `(requestId, mobile)`, so a refreshed form does not inflate the
  count the counter reads.
- `StallFssaiCertificate` / `StallFssaiFile` — up to five files; a re-upload
  replaces them and clears any verification.
- `StallCheckIn` — the event at the counter.
- `StallEquipmentIssue` — the chairs-and-tables row (decision 10).
- `StallFine` — rows, not a total, so a refund voucher can itemise what was
  withheld. A vendor disputing a deduction is owed the list.
- `StallRefund` — frozen when the team hands it to Finance.

`StallChargeConfig` gains `chairTableDepositPaise`, `equipmentDays`, and the
three replacement/damage rates. The 2025 sheet prints the first; the others are
not printed anywhere and are seeded for an admin to set.

## Surface

**Public** (`/api/m/stalls/public/*`) grows from three routes to ten. All seven
new ones are gated by an access link or a coupon, and they live in the same one
reviewable file. (The addendum below adds two more: one gated by a status link,
one that takes no credential and hands nothing back.)

**Staff** adds `comms/*`, `onboarding/*`, `finance/*`, `electrical`, `checkin/*`
and `equipment/*`. Each checks an action that already existed in `rbac.ts` —
`comms:write`, `finance:read`, `finance:write`, `checkin:write` — which is what
Phase 1's action vocabulary was for.

**Screens.** Six staff screens (Communication, Vendor Onboarding, Finance,
Electrical & Venue, Check-in, Chairs & Tables) and three public pages (bank
form, FSSAI upload, staff registration). The Electrical sheet and the challan
each carry their own `@media print` rules, scoped to the screen rather than
added to the global stylesheet, because they hide the app shell.

## Testing

- `packages/stalls/` — the fee calculation against the 2025 sheet's own numbers,
  refund flooring, coupon shape and normalisation, template rendering,
  `pendingSteps` and `deriveStage` across requester types and flow switches.
- `apps/api/test/` — five new files against Postgres: communication (including
  two senders racing on one request), the bank form, finance and refunds,
  onboarding, and event operations, plus an HTTP file covering who may reach
  what and what a link or coupon alone can do.
- `apps/web/` — the send screen's ticking rules, the template editor's
  placeholder warning, the finance dialogs' arithmetic, the counter's
  commit-on-blur, and the public pages' "this link is not valid".

## Deliberately not built

- **Online payment.** The requirement says payment happens by NEFT to a virtual
  account and that Finance confirms it. No payment gateway, and the Finance
  screen says so in as many words.
- **A contract e-signature.** The 2025 flow collects agreement as a checkbox on
  the bank form; that is what is modelled.
- **A second form engine.** Custom fields still append to the four base forms;
  the bank and FSSAI forms are coded, as the 2025 originals were.

---

## Addendum — the vendor's portal and return access

Date: 2026-09-13. Added after a cross-check of the built system against the full
requirement (`docs/requirements-traceability.md`).

Two lines of the requirement were not met by Phases 1–3 as built:

- "The user has to register & login (SSO) using email or phone number."
- "The vendor should login and upload the FSSAI Certificate."

Both were answered by links in emails, which works until the email is lost —
and then there was no path at all, for the vendor or for the volunteer on the
phone. The status page also showed only a status, so a vendor could not see what
the team was waiting on even though `pendingSteps` already knew.

**What was added**

1. `POST /public/access-link` — an email address or a mobile number. If it
   matches an account, a fresh `STATUS` link is mailed **to the address on the
   account**. Always 202 `{ ok: true }`, whether or not anything matched.
2. `GET /public/status/:token` now carries `pending` per selected request, from
   the same `pendingSteps` every staff screen calls.
3. `POST /public/status/:token/continue` — mints a single-purpose link for one
   outstanding self-serve step (`BANK_FORM`, `FSSAI`) and returns its URL.
4. `/stalls/status` with no token is the "find my requests" page; with a token
   it is the portal.

**Decisions**

16. **"Login" is delivery to the account, not a session.** There is no password
    and no OTP in this module and this does not add one. The contact typed on
    the page is used to FIND an account and is never written to, never echoed,
    and never mailed to; the link goes where the account already says.

    **Superseded 2026-09-15.** A requester login with a password now exists —
    see `2026-09-15-stalls-vendor-login-design.md`. It is a stopgap until the
    host's Isha OIDC, which is why the session is an access link carrying a
    `SESSION` purpose and the password lives in a table of its own: SSO deletes
    the table and the six routes, and mints the same session.

    Decision 17 below is NOT superseded. It is the reason the new register and
    password-reset routes answer 202 to a hit, a miss and a malformed contact
    alike, and the reason a registration has to be confirmed before it can
    start a session.

17. **The response is identical for a hit, a miss and a malformed contact.**
    Anything else makes the route a way of asking whether a particular person
    applied. The page's copy is written to be true when nothing matched, which
    is why it says "if we have a request under that".

18. **Links are minted on the click, not on the render.** Returning step links
    in the status payload would mint a bank-form link on every refresh. The
    button is a POST.

19. **`reference` in the continue body is a selector, not a credential.** The
    status link is the credential; the lookup is scoped to that link's account,
    so another vendor's reference is indistinguishable from a nonexistent one.
    That keeps decision 15 intact — holding one link still cannot reach another
    vendor's record.

20. **PAYMENT and STAFF_REGISTRATION are shown but have no button.** Finance
    moves a payment against a bank credit, and staff register on a coupon the
    vendor forwards to their own team. A button on either would promise
    something the portal cannot do; hiding them would hide what the team is
    waiting for. `isSelfServe` in `@stalls/core/access.ts` is the one place that
    decides.

**Still not built**

- **SMS delivery.** The module has a `Mailer` port and no SMS port, so a mobile
  number finds the account but the link still goes by email. A vendor whose
  email address is itself wrong still needs the team.
- **Host SSO for requesters.** Vendors stay out of the `Person` directory
  (host ADR 0016). Changing that is a host decision.
