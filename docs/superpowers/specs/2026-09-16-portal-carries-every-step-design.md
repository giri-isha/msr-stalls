# The portal carries every step, not just the email

## The problem

A selected requester signs in, sees `Backoffice not fully registered`, and can
do nothing about it. The coupon that would let them act exists only in an email
they may never have received, forwarded, or kept.

The same holds for payment: the amount due and the two virtual accounts reach
them only in `PAYMENT_DETAILS`. And the card's own copy — "Selected. Further
instructions will follow by email." — states the dependency outright.

Against the eleven-stage flow, Stages 4 and 8 are already self-served: both
`BANK_FORM` and `FSSAI` are `isSelfServe`, and `stepLink` gates on
`pendingFor`, which does not ask whether an email went out. The gaps are
Stages 5, 6 and 7.

The three emails stay. They stop being the only route.

## The coupon is the gate

`staffExpected` is `r.coupon?.capacity ?? 0`, so `pendingSteps` emits
`STAFF_REGISTRATION` only once a coupon exists — and a coupon is minted either
by an admin pressing Issue Coupon on Onboarding, or as a side effect of sending
`ONBOARDING_FSSAI_STAFF` (`comms.ts:269`). Until a backoffice person acts, the
step does not exist for the requester at all.

Meanwhile `FlowConfig` records that staff registration "is not toggleable — an
unregistered person cannot be let onto the venue, so it is never skipped". It
always applies.

So the requester asks for the coupon themselves, on a POST, and `ensureCoupon`
— already idempotent, for exactly this reason — answers. Two alternatives were
rejected:

- **Minting inside `statusView`** puts a write behind a GET and issues coupons
  to stalls nobody has looked at yet.
- **Defaulting `staffExpected` to 8** is the shape `facts.ts:44` warns against
  by name, and would have Onboarding chasing stalls with no coupon to register
  against.

## What the portal is told

`PublicRequestStatus` gains two blocks, both `null` unless `SELECTED`:

```ts
staff: { couponCode: string | null; capacity: number; registered: number } | null;
payment: {
  feePaise: number;
  depositPaise: number;
  totalPaise: number;
  virtualAccountRent: string | null;
  virtualAccountDeposit: string | null;
} | null;
```

`statusView` fills both. `factsInclude` already loads `coupon`, `staff` and
`paymentPlan`; the edition's virtual-account prefixes are added to the query and
the numbers come from `virtualAccountFor` — the same call `comms.ts:214` makes
for the email, so the page and the letter cannot name different accounts.

**The payment plan is a second email gate, and it needs the same treatment as
the coupon.** The `StallPaymentPlan` row is written only by `freezePaymentPlan`
when `PAYMENT_DETAILS` goes out, or when Finance records a concession. A vendor
waiting on a letter that never came has no plan, so a portal that read only the
plan would still show them a bare "payment pending".

So the portal picks its quote the way Finance already does at `finance.ts:66`
and `finance.ts:295`: `planToView(plan)` where a letter has frozen one, the live
`toQuoteView(quoteFor(r, ctx))` otherwise. `quotes.ts:143` states the rule
outright — "the frozen figures, where a payment email has gone out, and the live
ones otherwise". The portal is the fourth caller, not a new idea.

`feePaise` is the view's `payableFeePaise`: the concession when one is set, the
quoted total otherwise. `feeTotalPaise` is **not** exposed alongside it. The
requester sees one number — what they owe. The gap between card rate and agreed
rate is the concession, and that is the team's to see.

`payment` is null for an **exempt** stall (an ashram department billed
internally) and for an **unpriced** one (a zone with no rate). Zero is not the
answer to either — on a vendor's own page a zero reads as "free".

## The concession bug this exposes

`paymentConfirmed` (`facts.ts:52`) settles against `feeTotalPaise` and never
calls `payableFeePaise`, which has sat in `quote.ts:241` for exactly this.

A local welfare trader quoted ₹10,000 and agreed down to ₹5,000 pays ₹5,000 and
never clears `PAYMENT`. Today that is invisible, because the portal shows no
figure. The moment it shows one, the page is making a promise: pay this and the
chip clears. So `paymentConfirmed` reads `payableFeePaise` too, and the figure
on the page is the figure in the check.

## Routes

Mirroring the existing `continue` pair, one per credential:

- `POST /public/status/:token/coupon` — the signed link
- `POST /public/requests/coupon` — the session

Body `{ reference }`, response `{ code }`. Both land on one `couponFor` in
`portal.ts`, which scopes the lookup to the account, requires `SELECTED`, and
throws `UnknownAccessLinkError` on a miss — so a reference belonging to somebody
else is indistinguishable from one that never existed, the rule this whole
surface follows.

The activity actor is the request itself, following `bank.ts:140`: the vendor
acted, and attributing it to whichever admin looks next would be a lie.

## On the card

Detail renders inline, under the chip it belongs to.

**Payment.** Fee incl. GST, refundable deposit, total, and the two virtual
accounts with copy buttons — the `PAYMENT_DETAILS` body, on a page. A null
account number says to ask the stall team rather than printing a blank: a vendor
transferring to a half-remembered account is the expensive failure here.

**Staff.** The coupon with a copy button, `3 of 8 registered`, and a Register
Backoffice button to `/stalls/staff/:code`. With no coupon, a single Get Your
Coupon button that POSTs and reveals the rest.

**Placement.** The staff block sits under the `STAFF_REGISTRATION` chip when
`pendingSteps` emits one. Before a coupon exists there is no chip, so it renders
as a trailing item wearing a **neutral** tag reading "Backoffice registration"
rather than a warn-tone one — it must not claim to be outstanding when
`pendingSteps` says nothing is.

`Pending` takes a `staff` prop but still decides nothing about what is
outstanding. `pending` remains the only source for that. The component chooses
placement, not truth.

**Copy.** `STATUS_COPY.SELECTED` loses "Further instructions will follow by
email" and becomes a plain confirmation. What to do next is the list underneath,
which is now actionable.

Both portal pages get all of this at once, because both render `RequestCards`.

## The capacity is a ceiling, not a quota

`pendingSteps` chased staff registration until `staffRegistered` reached
`staffExpected`, so a stall that registered one of the eight its coupon admits
stayed flagged on Onboarding and held at the check-in counter for the whole
edition. Eight is the stall team's own default, not a number the vendor agreed
to fill.

So the step is outstanding only while **nobody** is registered. The label drops
to "Backoffice not registered", `deriveStage` reaches `READY` on the first
person, and `StaffCount` on the Onboarding table goes green on the first person
too — it wanted the coupon filled while `pendingSteps` did not, which is the
table and the chips beside it disagreeing about the same stall.

The requester's card never says "N of 8" either. It reads `Registered 3` and
`Your coupon admits up to 8` — the backoffice already words it that way.

## A stall may hold several coupons

Raising a capacity gives one code more room. It cannot say "this person came in
with the caterer, not with the vendor's own kitchen team", and that is what the
gate needs. So `StallStaffCoupon.requestId` stops being the primary key.

- `id` becomes the key, `requestId` an ordinary indexed foreign key.
- `StallVendorStaff` gains `couponId`, backfilled from the stall's single
  existing coupon — before this migration there could only have been one.
  `ON DELETE SET NULL`, never cascade: retiring a code must not delete people
  who may already be holding wristbands.
- `@@unique([requestId, mobile])` stays. One person, one registration per stall,
  however many codes they were handed.

`ensureCoupon` still returns the first live coupon and is what runs on its own —
a letter going out, a vendor pressing Get Your Coupon — because a second code
minted there would leave staff registering against something nobody counts.
`issueCoupon` always mints and is reached only by a person pressing New Coupon.

Each coupon carries its own cap, checked against its own registrations, so the
first code to fill up cannot spend the second's room. `staffExpected` is the
live coupons' capacity added up. A retired coupon stops lending capacity and
keeps its people.

`setCouponCapacity` takes the request **and** the coupon, and refuses a coupon
belonging to another stall — the route scopes on the request in the path, so the
id would otherwise be a way straight past that check.

## Deliberately unchanged

- The readiness chain in the requirement names ten states where `DerivedStage`
  has eight, under different names. Reconciling them reaches into Onboarding and
  Check-in and is its own piece of work.
- Coupons can be retired in the database but there is no Revoke button. Nobody
  asked for one, and the list reads correctly when a code is retired.

## Tests

- `packages/stalls` — nothing new; `payableFeePaise` is already covered.
- `apps/api` — a concession reaching `PAYMENT_CONFIRMED`; both coupon routes
  minting once and returning the same code twice; another account's reference
  answering as unknown; a non-`SELECTED` request refused; `statusView` carrying
  the payment and staff blocks.
- `apps/web` — `MyRequests.test.tsx` and `StatusPage.test.tsx` both cover
  coupon-absent, coupon-present and payment-due, since `RequestCards` serves
  both pages.
