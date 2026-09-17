# The steps open in an order the edition chooses

Date: 2026-09-17
Status: Built

## The problem

A selected vendor is handed everything at once. Bank details, payment, FSSAI
and staff registration all become outstanding the moment `SELECTED` is written,
and the portal draws a tab for each. `pendingSteps` has always emitted the whole
list, because applicability was the only question it was ever asked: does this
step apply to this requester type, and is it still undone.

The stall team wants the other question answered too. "We open only once the
previous step is complete" — no coupon until the money is in, no FSSAI upload
until the bank details are on file — and sometimes two together and the rest
after. That is *ordering*, and nothing in the module records it.

`StallFlowConfig` holds three booleans. They say whether a step happens. They
cannot say when.

## What is being added

A stage number per step, per requester type, per edition. Twelve integers. The
lowest stage still outstanding is the one that is open; everything numbered
above it is locked until it clears.

Set all twelve to `1` and nothing is ever locked — today's behaviour, exactly,
which is why `1` is the default and why no existing edition changes. Number them
`1,2,3,4` and the steps open strictly one at a time. Number them `1,1,2,2` and
two open together and the other two follow. The three cases the team described
are three numberings, not three code paths.

## The gate does not touch what the team sees

🔴 `pendingSteps` is unchanged, and this is the load-bearing decision.

Onboarding, Check-in, `deriveStage` and the Communication screen all read it,
and the module's oldest rule is that they must never disagree about a stall.
If the gate hid locked steps from `pendingSteps`, a stall waiting behind an
unpaid step would read as "nothing else outstanding" on the Onboarding table and
at the check-in counter, and `READY` would quietly come to mean "done so far".
The team would lose the only view that says what a stall still owes in total.

So the gate is a second function beside the first, and the team's picture of a
stall is exactly what it was:

```ts
export interface GatedStep extends PendingStep {
  stage: number;
  open: boolean;
  /** The steps being waited on. Empty when `open`. */
  blockedBy: OnboardingStep[];
}

export function gatedSteps(facts: OnboardingFacts, flow: FlowConfig): GatedStep[];
```

`FlowConfig` gains `stages: Record<StallRequestType, Record<OnboardingStep, number>>`.
It is per-edition and already loaded once per request, so carrying all three
types costs nothing; `gatedSteps` picks the row by `facts.requestType`.

The rule is one sentence: **the lowest stage present in `pendingSteps` is open,
and every higher stage is locked.**

## What falls out of that rule

⚠️ These are not special cases in the code. They are consequences of gating on
the pending list rather than on a step's existence, and they are the reason the
rule is worth stating that way.

- **A step that does not apply cannot block.** Local welfare has no bank step,
  so a bank stage of `1` is an empty stage and payment opens immediately. The
  difference in step sets between the three types is already decided by
  `needsBankStep` and `needsPaymentStep`; the numbering rides on top and never
  repeats it.
- **A step switched off cannot block.** Same reason: the boolean removes it from
  `pendingSteps` before the gate ever sees it.
- **A step already done cannot block.** It leaves the pending list, its stage
  empties, and the next stage opens. That is the whole mechanism.
- **Staff before a coupon exists cannot block.** `pendingSteps` stays silent
  about `STAFF_REGISTRATION` until a coupon is issued, because nobody can
  register against a code that does not exist. So a stage-1 staff step on a
  stall with no coupon does not wedge the flow shut — it is simply empty, and
  the next stage opens. The gate only ever waits on something a requester can
  actually act on.
- **Stage numbers need not be contiguous.** `1` and `3` with nothing at `2`
  behaves as `1` then `3`. Nothing validates contiguity, because nothing has to.

## What the requester sees

`PublicRequestStatus.pending` carries `open` and `blockedBy` on each entry.

**A tab is drawn only for an open step.** Locked steps have no tab at all —
a door that is not yet a door. They appear in the Overview's *Still to do* list,
greyed, with a lock marker in place of the amber one and a sentence built from
`blockedBy` ("Opens once your payment is confirmed"), and no action button. The
Overview is the road; the tabs are the doors that are actually unlocked.

This keeps the portal's existing rule intact: which tabs exist is read off the
API and never decided on the page. The API now says one more thing about each
step, and the page still only draws what it is told.

## Asking about the stage, not about the list

⚠️ Found while building, and it is the one place the "lowest pending stage"
rule is not enough on its own.

`STAFF_REGISTRATION` is absent from `pendingSteps` until a coupon has been
issued — nobody can register against a code that does not exist. So a check that
asked "is this step in the gated list, and is it locked" would answer **not
locked** for exactly the request whose Get Your Coupon button is about to mint
that coupon, and the ordering would be walked straight past by the one button
that starts the step.

So there are two questions, and the callers are split between them:

- `isStepOpen` — is this step outstanding AND unlocked. What the bank and FSSAI
  form mint asks, because a step already satisfied is not a thing to do again.
- `isStepLocked` — is this step's STAGE above the open stage, whether or not the
  step is currently in the pending list. What the coupon route, the staff
  registration route and the letters ask, because each of them is a way of
  STARTING a step rather than continuing one.

Both are built on `openStage` (the lowest stage still outstanding, or null) and
`blockingSteps` (the outstanding steps of that stage). `isStepLocked` is false
when nothing at all is outstanding — there is nothing left to wait for.

## Hiding is not refusing

🔴 Three server paths refuse a locked step, because a hidden button is a
suggestion and every one of these has another way in.

- `stepLink` — the bank and FSSAI form mint. Already gates on `pendingFor` and
  `isSelfServe`; it gains `&& open`.
- `couponFor` — Get Your Coupon. Refuses while `STAFF_REGISTRATION` is locked,
  so a vendor cannot mint the coupon that would let them past the next check.
- **The staff registration route**, `/stalls/staff/:code`. This one is the
  reason the others are not enough: the coupon code is its own credential, so a
  code forwarded from an email sent months ago reaches the form without the
  portal being involved at all. It refuses while the step is locked.

All three raise `StepNotOpenYetError`, which names the step being waited on.

## The letters drop their links

The team asked for the mails to be locked too, and the shape that survives
contact with the three templates is: **a letter still sends; each link or coupon
inside it is dropped when its step is locked; a letter whose every step is
locked is refused.**

The alternative — block the whole letter — fails on `SELECTION_VENDOR`, which
*is* the letter that tells a vendor they were selected and merely happens to
carry the bank-form link. Blocking it would mean a selected vendor is never told
they were selected, in the name of not showing them a form.

Concretely, in `templateVars`:

- `SELECTION_VENDOR` — no `bankFormUrl` while `BANK_FORM` is locked. The letter
  goes out; the placeholder renders empty, the way `signatureUrl` already does
  when no provider is configured.
- `PAYMENT_DETAILS` — refused while `PAYMENT` is locked. It carries nothing but
  the payment, so every step in it is locked and the rule refuses it.
- `ONBOARDING_FSSAI_STAFF` — carries two steps. A locked `FSSAI` drops
  `fssaiUrl`; a locked `STAFF_REGISTRATION` drops the coupon **and does not mint
  one**, which matters because `ensureCoupon` is a write and minting would hand
  the vendor the credential the route is about to refuse. Locked on both, the
  letter is refused.
- `SELECTION_ASHRAM` — same treatment as `ONBOARDING_FSSAI_STAFF` for the
  coupon it mints, and it still sends, for the same reason `SELECTION_VENDOR`
  does.

## The data

A new table rather than twelve columns:

```prisma
enum StallOnboardingStep { BANK_FORM PAYMENT FSSAI STAFF_REGISTRATION }

model StallFlowStep {
  id          String              @id @default(uuid()) @db.Uuid
  editionId   String              @map("edition_id") @db.Uuid
  requestType StallRequestType    @map("request_type")
  step        StallOnboardingStep
  stage       Int                 @default(1)

  edition StallEdition @relation(fields: [editionId], references: [id], onDelete: Cascade)

  @@unique([editionId, requestType, step])
  @@map("stall_flow_step")
  @@schema("stalls")
}
```

⚠️ An enum, not a string. A typo in a step name would otherwise be a row that
silently gates nothing, and the module keeps enums for every other closed set it
has — `StallStage`, `StallFormType`, `StallTemplateKey`.

The three on/off switches stay on `stall_flow_config`. Whether a step happens
and when it happens are different questions and they keep different homes;
folding them together would make "off" and "last" neighbours in the same
control, which is how an admin switches a step off while meaning to defer it.

`flowFor` reads both and returns one `FlowConfig`. Rows missing for an edition
read as `1`, so the table can be sparse and an edition created before this
change behaves exactly as it did.

## The admin screen

The Onboarding Flow panel keeps its three checkboxes and gains a grid beneath
them: rows Bank / Payment / FSSAI / Staff, columns Vendor / Local Welfare /
Ashram, each cell a `1`–`4` number input. Two buttons per column — **All at
once** and **One at a time** — fill it in, because those are the two answers
anybody actually wants and typing `1,1,1,1` by hand invites a slip.

Cells that cannot apply are drawn **disabled with a dash**, not hidden: Bank for
Local Welfare and Ashram, Payment for Ashram. A gap in the grid would read as a
mistake; a dash says the step does not exist for that type, which is a fact the
screen should teach rather than conceal.

Saving writes through `updateFlow`, which already audits as
`stall_flow.updated`; the detail gains the stages.

## Folded in: the local welfare form is missing a question

The 2025 local welfare sheet asks "Number of Stall Staff Pass". The seed has
`passes2w` and `passes4w` and stops. Vendor (by way of the bank form) and Ashram
both ask it. `passesStaff` is already a real column on `stall_request` and is
already in the contracts — the question is simply absent from one form.

So it is added to `LOCAL_WELFARE_FIELDS`, after `passes4w`, required with a
floor of zero like its neighbours.

⚠️ A test asserted the opposite — *"asks for vehicle passes but not staff
passes — the 2025 form did not"* — on a transcription that had missed the
question. The printed sheet asks it, between the vehicle passes and the caution
deposit. The test is corrected along with the seed, and carries why.

⚠️ The seed reaches no existing edition — `seedFormDefinitions` skips a form
definition that already exists, which is the whole point of forms being rows.
So the migration also inserts the field into every existing local welfare
definition, in the position it would have been seeded into, the way the
`declarations_per_form` migration edited editions that already existed.

Deliberately not done:

- **Stall Name on the FSSAI form.** The 2025 sheet asked it; the upload link is
  scoped to one request, so the stall is already known and asking invites an
  answer that contradicts the record.
- **The local welfare deposit Tamil.** The code already carries a `TO-VERIFY`
  saying the 2025 Tamil names a flat ₹4000 where the deposit is now area-wise.
  That sentence says money will be withheld, and it needs the stalls team's own
  revised wording, not a translation written here.

## Folded in: the concession, at selection

`setDiscretionaryFee` is reachable from the Selection screen as well as from
Finance. The same function, the same audit action, the same requirement that a
concession says why it was given — one writer, two doors. Two paths that each
wrote the plan would be two figures that can disagree.

⚠️ It runs **after** the select, not before. The plan is built from the live
quote, which reads the agreed bay and the stall count the same dialog writes;
conceding first would discount a figure the selection is about to change. Its
failure does not fail the selection, which has already happened — an exempt or
unpriced stall is refused by the API, and reporting that as "something went
wrong" would have the reader redo a selection that stands.

🔴 **The field is drawn only for `finance.write`,** which is what the route
requires — showing a control that 403s on submit is worse than not showing it.
The **Lead role does not hold `finance.write`** (it holds `finance.read`), so a
lead doing the selection will not see the field. Whether leads should be granted
`finance.write`, or the concession route should also accept `selection.write`,
is a privileges decision rather than a matter for this change, and it is left as
it stands.

## Tests

`packages/stalls` — `gatedSteps`: all-`1` opens everything; `1,2,3,4` opens one
at a time and advances as each clears; `1,1,2,2` opens two then two; an
inapplicable step does not block; a disabled step does not block; staff without
a coupon does not block; non-contiguous numbering behaves as its order.

`apps/api` — `stepLink` refused for a locked step; `couponFor` refused for a
locked staff step; the staff registration route refused for a locked code;
`PAYMENT_DETAILS` refused while payment is locked; `SELECTION_VENDOR` sent with
an empty `bankFormUrl` while bank is locked; `ONBOARDING_FSSAI_STAFF` minting no
coupon while staff is locked; `statusView` carrying `open` and `blockedBy`;
`updateFlow` writing and auditing the stages; a local welfare submission
carrying `passesStaff`.

`apps/web` — the Flow grid saving stages and the two presets filling a column;
a disabled cell where a step does not apply; a locked step drawing no tab and a
greyed Overview row with its reason; an open step unchanged; the agreed fee
reaching `setDiscretionaryFee` after the select, absent when left blank, refused
without a reason, and not offered to a lead.

⚠️ The portal reads `open !== false` rather than `open`, and the Admin grid
falls back to all-at-once when `stages` is absent. The web and the API deploy
separately, so a page served ahead of an API that does not send these fields
must keep behaving as it did rather than locking everything or failing to
render. The existing portal fixtures deliberately omit `open` and are what holds
that.
