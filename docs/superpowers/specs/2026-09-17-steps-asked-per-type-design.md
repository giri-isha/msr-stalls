# Which steps are asked is a question about the requester type

Date: 2026-09-17
Status: Built

## The problem

The Flow Builder had three switches — bank, payment, FSSAI — and they belonged
to the edition. They could say "this edition does not do FSSAI". They could not
say the thing the stall team actually says: *"sometimes we may not ask FSSAI for
an ashram, or staff registration for a local welfare stall."*

Staff registration had no switch at all. The rule it was exempted by — "an
unregistered person cannot be let onto the venue, so it is never skipped" — is
true of a vendor bringing outside workers through the gate, and false of an
ashram department whose people are already on campus.

`stall_flow_step` already answered a question per (edition, requester type,
step): the stage number saying *when* a step opens. *Whether* it happens was
answered one level up, for everybody at once. That mismatch is the bug.

## The rule

`FlowConfig` gains `asked` and loses the three booleans:

```ts
export type StepsAsked = Record<OnboardingStep, boolean>;
export type FlowAsked = Record<StallRequestType, StepsAsked>;

export interface FlowConfig {
  asked: FlowAsked;
  stages: FlowStages;
}

export function isStepAsked(flow, requestType, step): boolean;
```

`pendingSteps` asks the same three questions per step it always has — is it
asked, could it apply, is it undone — with the first now reading a per-type
answer.

🔴 **Nothing downstream changed.** The gate, the portal tabs, Onboarding,
Check-in and `deriveStage` all ride on `pendingSteps`, and the step-sequencing
design already stated the consequence: *"A step switched off cannot block — the
boolean removes it from `pendingSteps` before the gate ever sees it."* All this
change does is make "switched off" a per-type answer. A step not asked of an
ashram draws no tab, blocks no stage, chases nobody, and lets the next stage
open.

⚠️ `isStepAsked` is the ADMIN'S answer only. Whether a step could apply at all —
bank details of a local welfare stall, FSSAI of a non-food one — stays
`needsBankStep`, `needsPaymentStep` and `isFood`'s to decide, and the new
function never repeats them. The hard-coded rules are kept deliberately: the
2025 bank form says "For selected Vendors only" and ashram departments are
billed internally, so those cells are dashes the admin cannot tick. A mis-tick
can never mail an ashram a bank form.

## The data

`enabled Boolean @default(true)` on `stall_flow_step`, and `stall_flow_config`
is dropped — with its three columns gone it held an id and a foreign key.

⚠️ This folds storage the original design deliberately split. What that split
was protecting is the CONTROL, and the control is still split: two grids on the
panel, never one cell carrying a tick and a number. "Off" and "last" must not
become neighbours, because that is how an admin switches a step off while
meaning to defer it. The two answers share a row because they are now the same
SHAPE — per type, per step — which is a fact about storage and not about the
screen.

🔴 A missing row still reads as asked, at stage 1. That is what lets the table
be sparse, and it let `flowFor` stop writing: it used to upsert
`stall_flow_config` on every call, a write on the hot path of every portal view,
check-in row and letter, because the row had to exist before it could be read.

**Migration.** Insert any rows still missing at stage 1, spread each edition's
three booleans across all three types (an edition that had FSSAI off meant it
for everybody, because it had no way to mean anything else), carry staff over as
asked, then drop the table.

## Off means off, on every way in

Each of these is a way of STARTING a step, and each has a door that does not go
through the portal.

| Path | Change |
|---|---|
| `submitBankDetails` | reads the per-type answer. The one writer both the public form and filing-on-behalf come through, so one refusal covers both doors |
| `submitPaymentClaim` | same, beside its existing request-type check |
| `stepLink` (bank/FSSAI mint) | **unchanged** — an un-asked step is not pending, so it already refuses |
| `ensureCoupon` / `issueCoupon` | refuse, and mint nothing |
| `/staff-registration/:code`, GET and POST | refuse, via `assertStepAvailable` |

🔴 The coupon guard is on the MINTS, not on the five screens above them. A
coupon is its own credential — it is typed into a public form by somebody who
was forwarded it — so a code that exists is a way in whatever produced it, and
guarding each producer is five chances to miss one.

⚠️ It refuses an EXISTING coupon too, not only a new one. A step switched off
mid-edition leaves codes already minted, and those are exactly the ones that
reach the registration form without the portal. That form refuses them as well;
this keeps a screen from handing one out again in the meantime.

🔴 `StepNotOpenError`, not `StepLockedError`. The two are deliberately separate
classes: *there is nothing here and there never will be* against *not yet, and
here is what comes first*. A requester told the wrong one goes looking for a
problem that does not exist, or waits for a turn that never comes.
`assertStepAvailable` checks them in that order.

## The letters

`lockedStepsFor` became `withheldStepsFor`: a step is withheld when this
requester type is not asked for it, **or** when the ordering has not reached it.
Both produce the same instruction to a letter — leave the link or coupon out —
and the existing rule then decides what the letter becomes:

- `SELECTION_ASHRAM` with staff switched off still **sends**, carrying no
  coupon. It is the letter that tells a department it was selected and merely
  happens to carry a code; refusing it would mean nobody is told, in the name of
  not offering a step.
- `ONBOARDING_FSSAI_STAFF` with both its steps off is **refused** — it carries
  nothing else, so it has nothing to say.

⚠️ The letters still check before minting, even though `ensureCoupon` now
refuses on its own. Without that check the mint would throw and the whole letter
would be skipped, for a coupon it was never going to carry.

## The wire, across two deploys

The web and the API deploy separately, so both directions are held:

- **Read.** `flowView` sends `asked` and keeps the three booleans, derived as
  "asked of any type". A step off everywhere reads off; one off for ashram only
  reads on — the truthful summary for a control that cannot say anything finer.
  Nothing in the module reads them.
- **Write.** `FlowInput.asked` is optional and the three booleans are accepted
  when it is absent, spread across all three types. That is not a guess: it is
  the old control's exact semantics, because spreading is all it could ever have
  meant.
- Either half omitted leaves that half alone, the way an omitted `stages`
  already did. A caller flipping one switch must not silently renumber the grid,
  and a caller renumbering must not switch every step back on.

## The admin screen

Two grids, both 4 steps × 3 types.

**Which steps are asked** — a checkbox per cell, replacing the three
edition-wide switches. **When each step opens** — the existing stage numbers,
with its two column presets.

Cells that can never apply are dashes in **both** grids. A cell whose step is
unticked keeps its number in the second grid, disabled and dimmed rather than
blanked: the number is what the ordering returns to if the step is ticked back
on, and a stray click must not cost an edition its numbering. A dash means
never; a greyed number means not this year.

`stall_flow.updated` audits `asked` alongside the stages.

## Tests

`packages/stalls` — a step off for one type with the others still asking; staff
registration switchable at all; a missing answer reading as asked; a step off
for one type not un-blocking another type's ordering.

`apps/api` (15) — the ashram stops being asked for FSSAI while the vendor beside
it still is; staff switchable; an unconfigured edition unchanged; the bank
writer, the payment claim, the coupon mint, Get Your Coupon and both staff
routes refusing; a coupon minted before the switch dying after it;
`SELECTION_ASHRAM` sending with no coupon; `ONBOARDING_FSSAI_STAFF` refused with
both off; the grid written and read per type; half a payload leaving the other
half alone; the legacy booleans spreading; the derived booleans; the audit.

`apps/web` — a step switched off for one type and left on for the others; staff
switchable; a switched-off step keeping a greyed number; dashes in both grids.

## Folded in: a broken migration removed from the tree

`apps/api/prisma/migrations/20260917114112/` was an untracked drift artifact
holding `ALTER TABLE stall_flow_step ALTER COLUMN id DROP DEFAULT` — dated
*before* the migration that creates that table, and contradicting the schema's
`@default(uuid())`. It fails `migrate deploy` on any fresh database. It was
never committed; it is not committed here either.
