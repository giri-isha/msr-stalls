# Browsing another edition's configuration, and copying it into this one

## Why

Every Admin screen writes to the **active** edition, and a new edition is seeded
from constants frozen at 2025: `ensureEditionDefaults` upserts
`DEFAULT_ZONES_2025`, `DEFAULT_PLAN_CATEGORIES`, `DEFAULT_RATE_CARD_2025`,
`CHARGES_2025`, `FINES_2025`, the declarations and the four form definitions.

So the second time the team opens an edition, the seed is already a year stale
and the work they did last year — the bays as the venue was actually redrawn,
the rates as Finance actually set them, the labels as the forms were actually
fixed — is sitting in the previous edition's rows with no way to reach it. The
only route today is to retype it, comparing against a screen that can only show
the active edition.

Two things are needed, and the second depends on the first:

1. **See any edition's configuration**, not only the active one.
2. **Copy a section of it into this year's edition.**

## What this is not

Nothing transactional is ever copied — requests, allocations, accounts,
payments, consents, check-ins, stalls. This is configuration only, and only the
seven sections the Admin screen owns.

`ensureEditionDefaults` and the 2025 constants are untouched. A brand-new
edition is still seeded from them; copying is what an admin does afterwards.

## 1 · An edition selector in Admin

`GET /config`, `GET /config/forms` and `GET /config/declarations` take an
optional `editionId`. It resolves through one new helper beside the existing
two in `editions.ts`:

```ts
export async function editionFor(db, caller, editionId?): Promise<StallEdition>
```

which falls back to the active edition when none is given, and applies
`requireEditionReach` either way — so grant-level edition scope stays enforced
in one place rather than at each route, which is the reason `activeEditionFor`
exists at all.

`Admin.tsx` holds an `editionId` beside its `tab`, with a picker next to the
title. Choosing a past edition re-reads the config and forces `writable` false;
the header tag reads *past edition · read only* in place of *you can edit*.

**No write route changes.** Every write still resolves the active edition
through `activeEditionFor`, so there is no path by which a stale selector edits
a closed year.

## 2 · Copying a section

A new module, `apps/api/src/modules/stalls/edition-copy.ts`.

One pure function per section compares source rows against target rows and
returns a plan:

```ts
type CopyPlan = {
  create: Array<{ key: string; label: string; after: Record<string, unknown> }>;
  overwrite: Array<{ key: string; label: string; changes: Change[] }>;
  skip: Array<{ key: string; label: string; reason: string }>;
  unchanged: number;
};
type Change = { field: string; before: unknown; after: unknown };
```

The preview and the apply call **the same** function. What the dialog promises
cannot drift from what gets written, because there is only one answer to the
question.

- `POST /config/copy/preview` — `config.read`, returns the plan
- `POST /config/copy` — `config.write`, body `{ fromEditionId, section }`,
  applies the plan in one transaction and records `stall_edition.copied` on the
  activity trail with the section and the counts

The **target is always the active edition**, resolved through
`activeEditionFor`; the source is resolved through `editionFor`, so a caller
whose grants do not reach the source edition is refused.

### Merge rule

Match on the natural key. A matching row is overwritten with the source's
values, a missing one is created, and a row this edition has that the source
does not is **left alone**. Nothing is ever deleted, so nothing in use can be
lost.

| Section | Key | Copied |
|---|---|---|
| Bays | `code` | `name`, `expectedCrowd`, `isClosedToVendors`, `sortOrder` |
| Planning columns | `key` | `name`, `isFood`, `sortOrder` |
| Rates | `zoneCode` + `isFood` + `scope` | `amountPaise`, `depositPaise` |
| Charges | singleton | the rate/percent fields only |
| Fines | `reason` | `defaultAmountPaise`, `isActive` |
| Forms | `formType`, then field | below |
| Declarations | `key` + `requestType` | below |

### The three sections that need a rule, not a column list

**Rates.** A rate row keyed on a `zoneCode` this edition has no bay for is
listed under *Skipped* with its reason — copy Bays first, and the dialog says
so. Writing it anyway would put a rate in the table that `lookupRate` can never
be asked for.

**Charges** is one row per edition, so the plan is field-by-field rather than
row-by-row: one `overwrite` entry whose `changes` are the differing fields. The
edition's *own* settings — name, the two virtual-account prefixes, `termsUrl`,
`maxStallsPerRequest` — are never copied. A virtual account belongs to the year
Finance issued it for, and a terms document to the year the legal team wrote it.

**Forms.** Built-in fields match on `name`, which is stable and locked.
Appended fields carry `name = null` — their id is their key — so they match on
`(formType, label)` within the form, and an unmatched one is created. The copy
writes only what the Form Builder itself can write: `label`, `labelTa`, `help`,
`helpTa`, `isRequired`, `sortOrder`, `isActive`, `options`, `min`, `max`, and
the section. It never writes `name` or `fieldType` on a built-in — renaming one
posts an answer the submit path has nowhere to put, and retyping one posts a
string into an integer column. Sections match on `heading` and are created when
missing.

**Declarations** are versioned and a consent points at a *version*, which is the
entire reason they stopped being a constant. So a copy never edits wording in
place. Where the source's current wording differs from this edition's current
version it creates a **new version and makes it current**, archiving the one it
replaces in the same transaction — exactly what `updateDeclaration` does, and
for the same reason. Identical wording is a no-op; a key absent here is created
at version 1. A title-only difference edits the row, since `needsNewVersion`
says a title change is not a change to what anybody agreed to.

## 3 · The dialog

One shared `CopyFromDialog`, parameterised by section, used by all seven
panels from a *Copy from…* button in each panel's `actions` — disabled unless
`writable`, which also covers viewing a past edition and a read-only role.

Pick the source edition; the dialog loads the preview and renders three groups:
**New**, **Overwritten** with *before → after* per changed field, and
**Skipped** with its reason. Unchanged is a count. Confirm reads
*Copy 11 changes into MSR 2026* and is disabled at zero.

## 4 · Tests

- Unit tests on each section's plan function: create, overwrite, unchanged,
  skip.
- API tests over two seeded editions. The important one: **applying twice is
  idempotent** — the second preview is empty. That is the test that catches an
  appended form field duplicating on every copy.
- Declarations: one apply adds one version and leaves consents pointing where
  they pointed; a second adds none.
- Guards: `config.read` for preview, `config.write` for apply, and a source
  edition outside the caller's reach refused.
- `Admin.test.tsx`: the selector switches edition and disables the writes; the
  dialog lists the changes and calls apply.
