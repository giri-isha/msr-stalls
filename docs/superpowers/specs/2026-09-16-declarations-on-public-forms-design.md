# Declarations belong at the bottom of every public form

## The problem

A requester reads the declaration at the top of the form and ticks a box at the
bottom labelled **I Agree**. Between the two are thirty questions. By the time
the tick is in reach, the wording it consents to has been off screen for several
minutes, and nothing on the page connects them.

That is the shape of a consent nobody can defend. The fix is the one every
paper form already uses: the wording and the tick are one thing, and they sit
immediately above the signature.

The second half is narrower and worse. `declarations.ts` exists precisely so
consent wording is versioned, immutable, and reprintable years later — and only
the four request forms can reach it. The bank form, which collects an account
number and a PAN and asks a vendor to accept terms and conditions, has its
consent wording typed into JSX at `BankForm.tsx:352-377` and records agreement
as two bare timestamps, `agreedNeftAt` and `agreedTermsAt`. Those columns record
THAT somebody agreed and never WHAT — the exact failure the declarations table
was built to end, still live on the form where the money is.

So: declarations move to the bottom, and every public form can carry them.

## Scope

In: the four request forms, the bank form, the FSSAI upload, staff registration.

Out: making those three builder-driven (they need a `file` field type that does
not exist, and a built-in-name-to-column map per contract); the vendor-submitted
payment details form; the `PAYMENT_DETAILS` letter rewrite. Each is its own
spec. This one changes where consent is shown and which forms can show it, and
nothing else.

## A declaration is scoped to a form, not to a request type

`StallDeclaration.requestType` is `StallRequestType?`, and that type has four
values. It becomes `formType StallFormType?`, and `STAFF` joins that enum, which
already carries `BANK` and `FSSAI` alongside the four.

The resolution rule does not change. `declarationsFor` picks, per key, the
variant matching this form, falling back to the `NULL` default — so one
`terms_and_conditions` row can cover every form while the bank form carries its
own wording, and a form never shows both. That function is called by the public
page, by the submit validator and by the backoffice preview; widening its
parameter is the whole of the change.

The migration renames `request_type` to `form_type` and widens the type. Every
existing value maps to itself — `VENDOR` is already a form type — so no row
moves. The four partial unique indexes in
`20260915210000_declarations/migration.sql:43-58` are dropped and recreated
against the new column. Two of them are `WHERE request_type IS NULL` and cannot
be altered in place.

⚠️ Those indexes come in pairs because NULLs compare as DISTINCT in Postgres: a
single index over `(edition, key, form_type)` would admit two current defaults.
The pairing is load-bearing and survives the rename unchanged in spirit.

## A consent needs to say which form it was given on

`StallDeclarationConsent` is `@@unique([requestId, declarationId])`. One row per
request per declaration was right while only one form could show one. It breaks
twice as soon as others can:

The same key can be ticked on the request form and again on the bank form. That
is two consents, given months apart, to wording that may have been re-versioned
in between. The unique index admits one, and `recordConsent` passes
`skipDuplicates`, so the second is discarded silently — the worst available
outcome, because the vendor saw a tick and the log has nothing.

Staff registration is worse. Eight people register against one coupon, each
ticking the same declaration, and all eight are the same `requestId`. Seven
consents collapse into the first person's row.

So the consent row gains `formType StallFormType` — which form the tick was on —
and `staffId String?` referencing `StallVendorStaff`. `requestId` stays
required: every public form has a request behind it, staff registration through
its coupon, so the link is never lost. The single unique index becomes two
partial ones:

```sql
-- The requester's own consents, one per declaration per form.
CREATE UNIQUE INDEX "stall_declaration_consent_by_form"
  ON "stalls"."stall_declaration_consent" ("request_id", "form_type", "declaration_id")
  WHERE "staff_id" IS NULL;

-- One staff member's own consent, independent of everyone else on the stall.
CREATE UNIQUE INDEX "stall_declaration_consent_by_staff"
  ON "stalls"."stall_declaration_consent" ("staff_id", "declaration_id")
  WHERE "staff_id" IS NOT NULL;
```

Same NULL-compares-distinct problem, same pair-of-indexes answer the declaration
table already uses. Backfilling existing rows is unambiguous: every consent
written so far came from a request form, so `form_type` takes the request's own
type and `staff_id` stays null.

`consentsFor` grows a `formType` in what it returns. The record page is the
place somebody goes to produce what was agreed, and "which form" is part of the
answer.

## One tick per declaration, immediately above Submit

Today `RequestForm.tsx:415-458` draws the declarations as an information plate
at the top, behind an ℹ️ icon, on the primary tint. Below it the form runs, and
somewhere in the field list is a `checkbox` built-in labelled **I Agree**.

Both go. In their place, directly above the Submit button, one block: for each
declaration the form resolves, a `ChoicePlate` carrying a checkbox on the left
and `DeclarationText` as its label. That is the layout on every paper consent
and the one the team asked for.

🔴 **One tick per declaration, not one tick covering all of them.**
`recordConsent` already writes one row per declaration, so a single tick over
three declarations logs three separate agreements from one gesture — a record
that claims more than the reader did. The bank form makes the case concrete: it
carries two genuinely different consents today, one about NEFT transfer and one
about terms and conditions, and a vendor may reasonably want to read them as two
things. Submit stays disabled until every declaration is ticked.

This lives in a new `components/DeclarationConsent.tsx`, drawn by all four
public forms. It has to be shared rather than inlined in `RequestForm`: the
bank, FSSAI and staff forms have no `renderForm` machinery to hang a field off,
and three copies of a consent block is three places for the wording rules to
drift.

⚠️ `DeclarationText` is reused as-is. It builds elements from
`parseDeclaration` nodes rather than from markup, which is what keeps a paste
from a Word document off the page as HTML, and that property matters more on a
tick's own label than it did in a read-only plate.

## The hardcoded consents are retired

Two places hold wording that should be rows.

**The `agreed` field** (`forms.ts:126`) is a built-in `checkbox` labelled
"I Agree" on all four request forms. It stops being rendered: `seedFieldFrom`
stops emitting it for new editions, and the migration sets `is_active = false`
on every `stall_form_field` row where `name = 'agreed'`. It is not
deleted — `canDeleteField` refuses built-ins, and correctly, because a form that
has been answered still names what it asked. `stall_request.agreed_at` continues
to be stamped on submit once every declaration is ticked, so `facts.ts` and
everything reading that column are untouched.

**`agreeNeft` and `agreeTerms`** on the bank form are `z.literal(true)` in
`SubmitBankDetailsInput` with their text in JSX. Both contract fields are
replaced by `declarationIds: string[]`, which is how `SubmitRequestInput`
already carries consent, and the submit path gains the same
`DeclarationsChangedError` check the request form has: if the live set differs
from what the page displayed, the submission is refused rather than logged
against wording nobody saw. `agreedNeftAt` and `agreedTermsAt` stay and keep
being stamped — they are what the finance screens read.

Their present wording seeds as version 1 of two declarations, `neft_transfer`
and `terms_and_conditions`, both scoped `formType: 'BANK'`. ⚠️ Seeded by
reference from the existing source strings, never retyped, which is the rule
`seedDeclarations` already follows for the four 2025 disclaimers — the moment a
consent string is typed a second time, the two copies can disagree.

FSSAI and staff registration seed nothing. They gain the capability; what they
say is for the team to author on the Declarations screen, and a form that
resolves no declarations renders no block and gates on nothing.

⚠️ All three contracts — `SubmitBankDetailsInput`, `SubmitFssaiInput` and
`RegisterStaffInput` — gain `declarationIds: string[]`, not just the bank one.
A form that can show a declaration must be able to record the consent the day
somebody authors one, and a contract widened later is a deploy where the page
offers a tick the API discards. The list is allowed to be empty, which is what
FSSAI and staff send until the team writes something.

`RegisterStaffInput`'s consent is the one that carries `staffId`: the tick is
the individual's, not the stall's, and it is written in the same transaction
that creates the `StallVendorStaff` row.

## The backoffice screens

`Declarations.tsx:39` and `FormBuilder.tsx:39` each hardcode the same
four-element `FORM_TYPES` list. The Declarations screen's list widens to all
seven so a declaration can be authored against the bank form; the Form Builder's
does not, because this spec does not make those forms builder-driven and a tab
leading to "no form definition yet" is a promise the screen cannot keep.

`TYPE_LABEL` gains entries for `BANK`, `FSSAI` and `STAFF`.

## Testing

`packages/stalls/src/declarations.test.ts` already covers `declarationsFor`;
its cases widen to form types and gain one for a `BANK` variant beating the
`NULL` default — the resolution rule is what stops a form showing the same
consent twice in different words.

New cases:

- Submitting the bank form with a stale `declarationIds` set is refused with
  `DeclarationsChangedError`, the behaviour the request form already has.
- Two staff members registering on one coupon each get their own consent row.
  This is the case the old unique index swallowed, so it is the one that proves
  the new indexes.
- A form resolving no declarations renders no consent block and does not gate
  Submit — the FSSAI and staff case on day one.
- `RequestForm` no longer renders the top plate, and Submit stays disabled until
  every declaration is ticked.

`apps/api/test/phase2-routes.test.ts` covers the bank form submit path and
changes with the contract.

## What this leaves for later

Three follow-on specs, in the order they make sense:

1. The Form Builder driving the bank, FSSAI and staff forms. Needs a `file`
   field type and a built-in-name-to-column map per submit contract.
2. Vendor-submitted payment details with finance verification.
   `StallPaymentRecord` is finance-entered only today — `confirmedBy` is
   required — so a vendor's claim has nowhere to land unverified.
3. The `PAYMENT_DETAILS` letter matching the 2025 template: two separately paid
   amounts, both virtual accounts, itemised charges and the banking notes.
