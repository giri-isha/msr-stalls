# Declarations On Every Public Form — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope consent declarations to a form rather than a request type, and draw one tick per declaration immediately above Submit on every public form.

**Architecture:** `StallDeclaration.requestType` widens to `formType`, so the bank, FSSAI and staff forms can carry wording the same versioned way the four request forms already do. `StallDeclarationConsent` gains `formType` and a nullable `staffId` so one request can hold consents from several forms and several people. A new shared `DeclarationConsent` component draws the block; the hardcoded `agreed`, `agreeNeft` and `agreeTerms` consents retire.

**Tech Stack:** TypeScript, Prisma + Postgres, Fastify, Zod, React 19 + React Router, Vitest, Biome.

## Global Constraints

- Declaration bodies are **plain text with three markers** (`**bold**`, `[label](https://…)`, blank-line paragraphs). Never HTML, never sanitised on the way out. Render via `DeclarationText`, never `dangerouslySetInnerHTML`.
- A declaration's **wording is immutable**. Editing `body`/`bodyTa` writes a new version; `needsNewVersion` is the rule.
- A consent row points at the **version**, never the key.
- `declarationsFor` is the single resolution rule, shared by the public page, the submit validator and the backoffice preview. Never reimplement it.
- Seeded wording is read **by reference** from existing source strings, never retyped.
- Postgres **NULLs compare as DISTINCT** in unique indexes — any uniqueness over a nullable column needs a partial-index pair.
- Migration files are `apps/api/prisma/migrations/<timestamp>_<name>/migration.sql`, hand-written SQL with comments explaining *why*.
- Commands: `npm test --workspace=packages/stalls`, `npm test --workspace=apps/api`, `npm test --workspace=apps/web`, `npm run typecheck`, `npm run check` (Biome).

---

### Task 1: Widen the declaration type from request type to form type

**Files:**
- Modify: `packages/stalls/src/reference.ts`
- Modify: `packages/stalls/src/declarations.ts:28-47` (the `Declaration` interface), `:66-82` (`declarationsFor`)
- Test: `packages/stalls/src/declarations.test.ts:11-22` (the `d()` factory), `:24-48`

**Interfaces:**
- Consumes: nothing.
- Produces: `StallFormType = StallRequestType | 'BANK' | 'FSSAI' | 'STAFF'`, `STALL_FORM_TYPES: readonly StallFormType[]`, `Declaration.formType: StallFormType | null`, `declarationsFor(all: readonly Declaration[], formType: StallFormType): Declaration[]`.

- [ ] **Step 1: Write the failing test**

In `packages/stalls/src/declarations.test.ts`, change the factory's `requestType: null` to `formType: null`, rename `requestType` to `formType` in the four existing cases that reference it, and add this case to the `describe('which declarations a form shows')` block:

```ts
  /** The bank form is not a request type. Before declarations were scoped by
   *  FORM, the only wording it could show was the default — which is how a
   *  consent about NEFT transfer ended up typed into JSX instead. */
  test('a form that is not a request type gets its own variant', () => {
    const all = [d(), d({ formType: 'BANK', body: 'Transfer by NEFT only.' })];
    expect(declarationsFor(all, 'BANK')).toHaveLength(1);
    expect(declarationsFor(all, 'BANK')[0]?.body).toBe('Transfer by NEFT only.');
    expect(declarationsFor(all, 'VENDOR')[0]?.formType).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/stalls -- declarations`
Expected: FAIL — TypeScript rejects `formType` as an unknown property on `Declaration`.

- [ ] **Step 3: Add the form-type union**

Append to `packages/stalls/src/reference.ts`:

```ts
/**
 * Every form an edition serves, request and otherwise.
 *
 * 🔴 A superset of `StallRequestType`, and the distinction is real: a request
 * type is what somebody APPLIED as, and it names a row in `stall_request`. A
 * form type is a page that asks questions — the four application forms plus the
 * bank details form, the FSSAI upload and staff registration, none of which is
 * an application and all of which ask somebody to agree to something.
 *
 * ⚠️ The four shared names are deliberately identical strings. A declaration
 * scoped to `VENDOR` means the vendor application form, and the migration that
 * widened `stall_declaration` relies on every existing value mapping to itself.
 */
export type StallFormType = StallRequestType | 'BANK' | 'FSSAI' | 'STAFF';

export const STALL_FORM_TYPES: readonly StallFormType[] = [
  ...STALL_REQUEST_TYPES,
  'BANK',
  'FSSAI',
  'STAFF',
];
```

- [ ] **Step 4: Rename the field in the package**

In `packages/stalls/src/declarations.ts`, change the import on line 1 to `import type { StallFormType } from './reference';` and replace the `requestType` member of `Declaration`:

```ts
  /** Which form this wording is for. `null` is the default, shown by any form
   *  with no variant of its own. */
  formType: StallFormType | null;
```

Then rewrite `declarationsFor`:

```ts
export function declarationsFor(
  all: readonly Declaration[],
  formType: StallFormType,
): Declaration[] {
  const live = all.filter((d) => d.isCurrent && d.isActive);
  const keys = [...new Set(live.map((d) => d.key))].sort();
  return keys
    .map(
      (key) =>
        live.find((d) => d.key === key && d.formType === formType) ??
        live.find((d) => d.key === key && d.formType === null),
    )
    .filter((d): d is Declaration => d !== undefined);
}
```

Update its doc comment: "A vendor form carrying a vendor-specific `request_submission`" still reads correctly; change the parameter name in the prose from "request type" to "form".

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --workspace=packages/stalls -- declarations`
Expected: PASS, including the new `'a form that is not a request type gets its own variant'`.

- [ ] **Step 6: Commit**

```bash
git add packages/stalls/src/reference.ts packages/stalls/src/declarations.ts packages/stalls/src/declarations.test.ts
git commit -m "refactor(stalls): a declaration is scoped to a form, not a request type"
```

---

### Task 2: Widen the contracts

**Files:**
- Modify: `packages/stalls/src/contracts.ts:39-46` (`FormType`), `:915-927` (`DeclarationInput`), `:937-949` (`DeclarationRow`), `:1458-1499` (`SubmitBankDetailsInput`), `:1676-1685` (`RegisterStaffInput`), `:1720-1730` (`SubmitFssaiInput`)
- Test: `packages/stalls/src/contracts.test.ts`

**Interfaces:**
- Consumes: `StallFormType` from Task 1.
- Produces: `FormType` zod enum including `'STAFF'`; `DeclarationInput.formType`; `DeclarationRow.formType`; `declarationIds?: string[]` on `SubmitBankDetailsInput`, `RegisterStaffInput`, `SubmitFssaiInput`; `SubmitBankDetailsInput` no longer has `agreeNeft`/`agreeTerms`.

- [ ] **Step 1: Write the failing test**

Append to `packages/stalls/src/contracts.test.ts`:

```ts
describe('consent travels with every public form submission', () => {
  const bank = {
    email: 'a@b.com',
    invoiceName: 'Green Leaf',
    accountHolder: 'Green Leaf',
    mobile: '9876543210',
    address: '1 Main Street',
    pincode: '641114',
    bankName: 'HDFC',
    branch: 'Kanjurmarg',
    accountNumber: '12345678',
    ifsc: 'HDFC0004989',
    panNumber: 'ABCDE1234F',
    gstNumber: 'NONE',
    chequeKey: 'k/cheque.pdf',
    panKey: 'k/pan.pdf',
    plugs5a: 1,
    plugs15a: 0,
    gasStoves: 0,
    tablesNeeded: 0,
    chairsNeeded: 0,
    passes2w: 0,
    passes4w: 0,
    passesStaff: 0,
  };

  /** 🔴 The bank form's two consents were `z.literal(true)` with their wording
   *  in JSX. A tick that carries no version records THAT somebody agreed and
   *  never WHAT — the failure the declarations table exists to end. */
  test('the bank form posts declaration ids, not bare agreement flags', () => {
    const parsed = SubmitBankDetailsInput.parse({ ...bank, declarationIds: ['d1', 'd2'] });
    expect(parsed.declarationIds).toEqual(['d1', 'd2']);
    expect('agreeNeft' in parsed).toBe(false);
    expect('agreeTerms' in parsed).toBe(false);
  });

  /** ⚠️ Undefined is not a claim and must pass — a server-side caller has not
   *  said what it displayed. See `sameDeclarations`. */
  test('omitting the list is allowed; an empty list is a claim', () => {
    expect(SubmitBankDetailsInput.parse(bank).declarationIds).toBeUndefined();
    expect(SubmitBankDetailsInput.parse({ ...bank, declarationIds: [] }).declarationIds).toEqual([]);
  });

  test('staff registration and the FSSAI upload carry consent too', () => {
    const staff = RegisterStaffInput.parse({
      couponCode: 'ABCD1234',
      name: 'R Kumar',
      mobile: '9876543210',
      idType: 'AADHAAR',
      idNumber: '1234',
      declarationIds: ['d1'],
    });
    expect(staff.declarationIds).toEqual(['d1']);

    const fssai = SubmitFssaiInput.parse({
      stallName: 'Green Leaf',
      files: [{ key: 'k/cert.pdf', name: 'cert.pdf' }],
      declarationIds: [],
    });
    expect(fssai.declarationIds).toEqual([]);
  });

  test('a declaration is authored against any form, including the bank form', () => {
    expect(DeclarationInput.parse({ key: 'neft_transfer', formType: 'BANK', title: 'NEFT', body: 'x' }).formType).toBe('BANK');
    expect(DeclarationInput.parse({ key: 'terms', title: 'T', body: 'x' }).formType).toBeNull();
  });
});
```

Add `SubmitBankDetailsInput`, `RegisterStaffInput`, `SubmitFssaiInput` and `DeclarationInput` to that file's imports from `./contracts`, and ensure `describe`/`expect`/`test` come from `vitest`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=packages/stalls -- contracts`
Expected: FAIL — `declarationIds` is stripped as an unknown key, and `formType` is not a property of `DeclarationInput`.

- [ ] **Step 3: Widen the contracts**

In `packages/stalls/src/contracts.ts`:

Add `'STAFF'` to the `FormType` enum (line 39):

```ts
export const FormType = z.enum([
  'ASHRAM',
  'ASHRAM_FOOD',
  'LOCAL_WELFARE',
  'VENDOR',
  'BANK',
  'FSSAI',
  'STAFF',
]);
```

Replace `requestType` in `DeclarationInput` (line 918):

```ts
  /** `null` is the default, shown by any form with no variant of its own. */
  formType: FormType.nullable().default(null),
```

Rename `requestType` to `formType` on `DeclarationRow` (line 940). Update `DeclarationPatch`'s omit and its comment to say `formType`:

```ts
export const DeclarationPatch = DeclarationInput.omit({ key: true, formType: true });
```

Define the shared consent field once, above `SubmitRequestInput`, and reuse it:

```ts
/**
 * What the page displayed, so the API can refuse a stale one.
 *
 * ⚠️ OPTIONAL by design. Defaulted, "I displayed no declarations" and "I have
 * never heard of declarations" arrive as the same value, and the staleness
 * check cannot tell a browser holding week-old wording from a seed script that
 * never rendered anything. Undefined is not a claim; an empty array is.
 */
const DeclarationIds = z.array(z.string().trim().min(1)).max(20).optional();
```

Add `declarationIds: DeclarationIds,` to `SubmitBankDetailsInput`, `RegisterStaffInput` and `SubmitFssaiInput`. Delete `agreeNeft` and `agreeTerms` from `SubmitBankDetailsInput`. Point `SubmitRequestInput`'s existing `declarationIds` at the same `DeclarationIds` constant so there is one definition.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=packages/stalls`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/stalls/src/contracts.ts packages/stalls/src/contracts.test.ts
git commit -m "feat(stalls): every public form submission carries the declarations it displayed"
```

---

### Task 3: The migration

**Files:**
- Create: `apps/api/prisma/migrations/20260916115900_staff_form_type/migration.sql`
- Create: `apps/api/prisma/migrations/20260916120000_declarations_per_form/migration.sql`
- Modify: `apps/api/prisma/schema.prisma:161-170` (`StallFormType`), `:448-499` (`StallDeclaration`), `:505-518` (`StallDeclarationConsent`), `StallVendorStaff` (add the back-relation)

**Interfaces:**
- Consumes: nothing.
- Produces: `stall_declaration.form_type`; `stall_declaration_consent.form_type` and `.staff_id`; `StallVendorStaff.consents`; every `stall_form_field` row named `agreed` set inactive.

- [ ] **Step 1: Add the enum value in its own migration**

🔴 `ALTER TYPE … ADD VALUE` must be the only thing its migration does. Prisma
wraps each migration in a transaction, and Postgres refuses to let a newly added
enum value be *used* in the same transaction that added it. Nothing in the next
migration writes the literal `'STAFF'` today, so one file would probably work —
but "probably" is not what you want from the migration that has to run against
production, and the moment somebody adds a `WHERE form_type = 'STAFF'` to it, it
fails on their machine and nowhere else.

Create `apps/api/prisma/migrations/20260916115900_staff_form_type/migration.sql`:

```sql
-- Staff registration is a form. It asks questions and it asks somebody to agree
-- to something, which is all a form type has ever meant here — `BANK` and
-- `FSSAI` were already in this enum for the same reason.
--
-- ⚠️ ALONE in its own migration. Postgres will not let a new enum value be used
-- in the transaction that added it, and Prisma runs each migration in one.
ALTER TYPE "stalls"."StallFormType" ADD VALUE IF NOT EXISTS 'STAFF';
```

- [ ] **Step 2: Write the main migration**

Create `apps/api/prisma/migrations/20260916120000_declarations_per_form/migration.sql`:

```sql
-- Declarations belong to a FORM, not to a request type.
--
-- 🔴 Only the four request forms could carry versioned wording. The bank form —
-- which collects an account number and a PAN and asks a vendor to accept terms
-- and conditions — had its consent text typed into JSX and recorded agreement
-- as two bare timestamps. That records THAT somebody agreed and never WHAT,
-- which is the exact failure this table was created to end.

-- ── The declaration's variant ───────────────────────────────────────────────
--
-- ⚠️ Every existing value maps to ITSELF: the four request-type names are
-- already form-type names, so this is a widening and no row moves. The USING
-- clause is a text round-trip because Postgres will not cast between two
-- unrelated enums directly.
ALTER TABLE "stalls"."stall_declaration"
  ALTER COLUMN "request_type" TYPE "stalls"."StallFormType"
  USING "request_type"::TEXT::"stalls"."StallFormType";

ALTER TABLE "stalls"."stall_declaration"
  RENAME COLUMN "request_type" TO "form_type";

-- The four partial indexes are rebuilt rather than altered: two of them carry
-- `WHERE request_type IS NULL` in their predicate, which a rename does not
-- follow. Their pairing is load-bearing — NULLs compare as DISTINCT in a unique
-- index, so the second of each pair covers exactly the rows the first cannot
-- see, and dropping one would admit two current defaults.
DROP INDEX "stalls"."stall_declaration_one_current";
DROP INDEX "stalls"."stall_declaration_one_current_default";
DROP INDEX "stalls"."stall_declaration_version";
DROP INDEX "stalls"."stall_declaration_version_default";

CREATE UNIQUE INDEX "stall_declaration_one_current"
  ON "stalls"."stall_declaration" ("edition_id", "key", "form_type")
  WHERE "is_current";

CREATE UNIQUE INDEX "stall_declaration_one_current_default"
  ON "stalls"."stall_declaration" ("edition_id", "key")
  WHERE "is_current" AND "form_type" IS NULL;

CREATE UNIQUE INDEX "stall_declaration_version"
  ON "stalls"."stall_declaration" ("edition_id", "key", "form_type", "version");

CREATE UNIQUE INDEX "stall_declaration_version_default"
  ON "stalls"."stall_declaration" ("edition_id", "key", "version")
  WHERE "form_type" IS NULL;

-- ── A consent says which form it was given on, and by whom ──────────────────
--
-- 🔴 The old unique index was (request_id, declaration_id). One row per request
-- per declaration was right while only one form could show one. It breaks twice
-- now:
--
--   (1) The same key can be ticked on the request form and again on the bank
--       form, months apart, against wording that may have been re-versioned in
--       between. `recordConsent` passes `skipDuplicates`, so the second consent
--       would be discarded SILENTLY — the vendor saw a tick and the log has
--       nothing.
--
--   (2) Eight staff register against one coupon and share one request_id. Seven
--       of their consents would collapse into the first person's row.
ALTER TABLE "stalls"."stall_declaration_consent"
  ADD COLUMN "form_type" "stalls"."StallFormType",
  ADD COLUMN "staff_id"  UUID;

-- Every consent written so far came from a request form, so the backfill is
-- unambiguous: the request's own type, and no staff member.
UPDATE "stalls"."stall_declaration_consent" c
   SET "form_type" = r."request_type"::TEXT::"stalls"."StallFormType"
  FROM "stalls"."stall_request" r
 WHERE r."id" = c."request_id";

ALTER TABLE "stalls"."stall_declaration_consent"
  ALTER COLUMN "form_type" SET NOT NULL;

ALTER TABLE "stalls"."stall_declaration_consent"
  ADD CONSTRAINT "stall_declaration_consent_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "stalls"."stall_vendor_staff"("id") ON DELETE CASCADE;

DROP INDEX "stalls"."stall_declaration_consent_request_id_declaration_id_key";

-- ⚠️ A PAIR again, and for the same Postgres reason: a single index over
-- (request_id, form_type, staff_id, declaration_id) would admit unlimited
-- duplicate rows for the requester's own consents, because staff_id is NULL on
-- every one of them and NULLs compare as DISTINCT.
CREATE UNIQUE INDEX "stall_declaration_consent_by_form"
  ON "stalls"."stall_declaration_consent" ("request_id", "form_type", "declaration_id")
  WHERE "staff_id" IS NULL;

CREATE UNIQUE INDEX "stall_declaration_consent_by_staff"
  ON "stalls"."stall_declaration_consent" ("staff_id", "declaration_id")
  WHERE "staff_id" IS NOT NULL;

CREATE INDEX "stall_declaration_consent_staff_id_idx"
  ON "stalls"."stall_declaration_consent" ("staff_id");

-- ── The "I Agree" field retires ─────────────────────────────────────────────
--
-- Its wording is a row now, and the tick is drawn beside that wording above
-- Submit. Switched OFF rather than deleted: a form that has been answered still
-- names what it asked, and `canDeleteField` refuses built-ins for that reason.
UPDATE "stalls"."stall_form_field" SET "is_active" = false WHERE "name" = 'agreed';
```

- [ ] **Step 3: Update the Prisma schema to match**

In `apps/api/prisma/schema.prisma`, add `STAFF` to `enum StallFormType`. In `StallDeclaration`, replace the `requestType` field with:

```prisma
  /// Which form this wording is for, or NULL for "any form without one of its
  /// own". The specific one wins, the default catches the rest.
  ///
  /// ⚠️ A FORM type, not a request type. The bank form, the FSSAI upload and
  /// staff registration all ask somebody to agree to something and none of them
  /// is an application.
  formType StallFormType? @map("form_type")
```

and update the `@@unique` map to `[editionId, key, formType, version]`. In `StallDeclarationConsent` add:

```prisma
  /// WHICH form the tick was on. The same key can be ticked on the request form
  /// and again on the bank form — two consents, given months apart, possibly to
  /// different versions.
  formType StallFormType @map("form_type")

  /// Set when the consent is an individual staff member's rather than the
  /// requester's. Eight people register against one coupon and share a request;
  /// without this they would share one consent row.
  staffId  String?       @map("staff_id") @db.Uuid

  staff    StallVendorStaff? @relation(fields: [staffId], references: [id], onDelete: Cascade)
```

Replace its `@@unique([requestId, declarationId])` with `@@index([requestId, formType])` — the two real constraints are partial indexes Prisma cannot express, exactly as `StallDeclaration`'s already are. Add a comment saying so. Add `consents StallDeclarationConsent[]` to `StallVendorStaff`.

- [ ] **Step 4: Apply and verify**

Run: `npm run db:migrate --workspace=apps/api`
Expected: the migration applies, and `npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --exit-code` reports no drift.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/migrations apps/api/prisma/schema.prisma
git commit -m "feat(stalls): declarations scope to a form, consents name the form and the person"
```

---

### Task 4: The API resolves and records consent per form

**Files:**
- Modify: `apps/api/src/modules/stalls/declarations.ts` — `SELECT`, `declarationsForForm`, `DeclarationInput`, `createDeclaration`, `recordConsent`, `consentsFor`, `seedDeclarations`
- Modify: `apps/api/src/modules/stalls/routes.ts:132-145` (`declarationRow`)
- Test: `apps/api/test/declarations.test.ts` — **exists already** (12.1K, with `describe` blocks for seeding, writing, editing, the consent log, and stale wording). Add the cases below to its `describe('the consent log')` block and rename `requestType` to `formType` throughout the file. Do not create a new file.

**Interfaces:**
- Consumes: `StallFormType`, `declarationsFor` (Task 1); `DeclarationInput.formType` (Task 2); the migrated columns (Task 3).
- Produces: `declarationsForForm(db, editionId, formType: StallFormType)`; `recordConsent(db, where: { requestId: string; formType: StallFormType; staffId?: string | null }, declarations: readonly { id: string }[])`; `consentsFor` returning `formType` per row; `BANK_KEYS = { neft: 'neft_transfer', terms: 'terms_and_conditions' }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/declarations.test.ts` (follow the harness `apps/api/test/phase2-routes.test.ts` uses for a seeded edition and request):

```ts
/** 🔴 The case the old unique index swallowed. Eight people register against
 *  one coupon and share a request id; under (request_id, declaration_id) seven
 *  of their consents were discarded by `skipDuplicates` and the log said one
 *  person had agreed. */
test('two staff members on one coupon each get their own consent row', async () => {
  const d = await createDeclaration(prisma, editionId,
    { key: 'staff_terms', formType: 'STAFF', title: 'Staff', body: 'I will carry photo ID.', bodyTa: null, isActive: true },
    'test');

  const a = await prisma.stallVendorStaff.create({ data: { requestId, name: 'A', mobile: '9000000001', idType: 'AADHAAR', idNumber: '1111' } });
  const b = await prisma.stallVendorStaff.create({ data: { requestId, name: 'B', mobile: '9000000002', idType: 'AADHAAR', idNumber: '2222' } });

  await recordConsent(prisma, { requestId, formType: 'STAFF', staffId: a.id }, [d]);
  await recordConsent(prisma, { requestId, formType: 'STAFF', staffId: b.id }, [d]);

  expect(await prisma.stallDeclarationConsent.count({ where: { declarationId: d.id } })).toBe(2);
});

/** The same key, ticked on two different forms, is two consents. */
test('a consent on the request form does not swallow one on the bank form', async () => {
  const shared = await createDeclaration(prisma, editionId,
    { key: 'shared_terms', formType: null, title: 'Shared', body: 'Shared wording.', bodyTa: null, isActive: true },
    'test');

  await recordConsent(prisma, { requestId, formType: 'VENDOR' }, [shared]);
  await recordConsent(prisma, { requestId, formType: 'BANK' }, [shared]);

  const rows = await prisma.stallDeclarationConsent.findMany({ where: { declarationId: shared.id } });
  expect(rows.map((r) => r.formType).sort()).toEqual(['BANK', 'VENDOR']);
});

/** Re-posting the same form is idempotent — the partial index is what enforces
 *  it, not `skipDuplicates` alone. */
test('the same form ticked twice is still one consent', async () => {
  const d = await createDeclaration(prisma, editionId,
    { key: 'once_only', formType: 'BANK', title: 'Once', body: 'Once.', bodyTa: null, isActive: true },
    'test');
  await recordConsent(prisma, { requestId, formType: 'BANK' }, [d]);
  await recordConsent(prisma, { requestId, formType: 'BANK' }, [d]);
  expect(await prisma.stallDeclarationConsent.count({ where: { declarationId: d.id } })).toBe(1);
});

test('the bank form resolves its seeded wording, not the default', async () => {
  const shown = await declarationsForForm(prisma, editionId, 'BANK');
  expect(shown.map((d) => d.key)).toContain('neft_transfer');
  expect(shown.map((d) => d.key)).toContain('terms_and_conditions');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=apps/api -- declarations`
Expected: FAIL — `recordConsent` takes `(db, requestId, declarations)` and rejects the object form.

- [ ] **Step 3: Rewrite the module's consent surface**

In `apps/api/src/modules/stalls/declarations.ts`, rename `requestType` to `formType` in `SELECT`, in `DeclarationInput`, in `createDeclaration`'s clash lookup, in `updateDeclaration`'s new-version create, and in `listDeclarations`'s `orderBy`. Change the `StallRequestType` import to `StallFormType`. Then:

```ts
export async function declarationsForForm(
  db: Db,
  editionId: string,
  formType: StallFormType,
): Promise<Declaration[]> {
  const rows = await db.stallDeclaration.findMany({
    where: { editionId, isCurrent: true, isActive: true },
    select: SELECT,
  });
  return declarationsFor(rows as Declaration[], formType);
}

/** Which consent this is: whose, and on which form.
 *
 *  ⚠️ `staffId` is what separates eight people registering against one coupon.
 *  They share a `requestId`, so without it seven of their consents collapse
 *  into the first person's row — see the partial indexes on the table. */
export interface ConsentWhere {
  requestId: string;
  formType: StallFormType;
  staffId?: string | null;
}

export async function recordConsent(
  db: Db,
  where: ConsentWhere,
  declarations: readonly { id: string }[],
): Promise<void> {
  if (declarations.length === 0) return;
  await db.stallDeclarationConsent.createMany({
    data: declarations.map((d) => ({
      requestId: where.requestId,
      formType: where.formType,
      staffId: where.staffId ?? null,
      declarationId: d.id,
    })),
    skipDuplicates: true,
  });
}
```

Add `formType: true` to `consentsFor`'s select and to what it maps out — the record page is where somebody produces what was agreed, and which form is part of that answer.

- [ ] **Step 4: Seed the bank form's two consents**

Still in that file, add below `seedDeclarations`:

```ts
/** The bank form's consents, which were `z.literal(true)` in the contract with
 *  their wording in JSX.
 *
 *  ⚠️ The strings are the ones vendors have actually been agreeing to, lifted
 *  from `BankForm.tsx` rather than rewritten. Restoring the 2025 Google Form's
 *  original three-agreement wording would change what the consent SAYS, and
 *  that is an authoring decision for the team on the Declarations screen — a
 *  seed is not the place to make it.
 */
export const BANK_KEYS = { neft: 'neft_transfer', terms: 'terms_and_conditions' } as const;

export async function seedBankDeclarations(db: Db, editionId: string): Promise<number> {
  const existing = await db.stallDeclaration.count({
    where: { editionId, key: { in: [BANK_KEYS.neft, BANK_KEYS.terms] } },
  });
  if (existing > 0) return 0;

  for (const [key, title, body] of [
    [BANK_KEYS.neft, 'NEFT transfer', BANK_NEFT_BODY],
    [BANK_KEYS.terms, 'Terms and conditions', BANK_TERMS_BODY],
  ] as const) {
    await db.stallDeclaration.create({
      data: { editionId, key, formType: 'BANK', version: 1, title, body, bodyTa: null, isActive: true, isCurrent: true },
    });
  }
  return 2;
}
```

Define `BANK_NEFT_BODY` and `BANK_TERMS_BODY` as module constants holding the exact strings currently rendered at `BankForm.tsx:352-377`. Read them out of the file; do not paraphrase.

Call `seedBankDeclarations` beside `seedDeclarations` in `apps/api/src/modules/stalls/config.ts:126`.

- [ ] **Step 5: Update the wire row**

In `apps/api/src/modules/stalls/routes.ts`, rename `requestType` to `formType` in `declarationRow` and its parameter type.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test --workspace=apps/api -- declarations`
Expected: PASS, all four cases.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/stalls/declarations.ts apps/api/src/modules/stalls/config.ts apps/api/src/modules/stalls/routes.ts apps/api/test/declarations.test.ts
git commit -m "feat(stalls): consent records which form it was given on and by whom"
```

---

### Task 5: Every public submit path checks and records consent

**Files:**
- Modify: `apps/api/src/modules/stalls/submit.ts:264-266`
- Modify: `apps/api/src/modules/stalls/bank.ts:58-105`
- Modify: `apps/api/src/modules/stalls/onboarding.ts:214-260` (`registerStaff`), and `submitFssai`
- Modify: `apps/api/src/modules/stalls/form-builder.ts:47-90` (`seedFormDefinitions`)
- Test: `apps/api/test/bank.test.ts` (the bank cases — this is the bank form's own suite), `apps/api/test/onboarding.test.ts` (the staff and FSSAI cases), `apps/api/test/phase2-routes.test.ts` (strip `agreeNeft`/`agreeTerms` from any payload it builds)

**Interfaces:**
- Consumes: `recordConsent(db, ConsentWhere, decls)`, `declarationsForForm` (Task 4); `declarationIds` on the three contracts (Task 2).
- Produces: no new exports. `sameDeclarations` moves from `submit.ts` into `declarations.ts` and is exported so all four paths share one staleness rule.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/bank.test.ts`:

```ts
/** 🔴 The same refusal the request form has. Wording that moved while the form
 *  sat open must not be agreed to on the vendor's behalf. */
test('the bank form refuses a stale declaration set', async () => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/stalls/public/bank/${bankToken}`,
    payload: { ...validBankPayload, declarationIds: ['not-a-live-one'] },
  });
  expect(res.statusCode).toBe(409);
  expect(res.json().error).toBe('DECLARATIONS_CHANGED');
});

test('the bank form records a consent per live declaration', async () => {
  const live = await declarationsForForm(prisma, editionId, 'BANK');
  const res = await app.inject({
    method: 'POST',
    url: `/api/stalls/public/bank/${bankToken}`,
    payload: { ...validBankPayload, declarationIds: live.map((d) => d.id) },
  });
  expect(res.statusCode).toBe(204);

  const rows = await prisma.stallDeclarationConsent.findMany({
    where: { requestId, formType: 'BANK' },
  });
  expect(rows).toHaveLength(live.length);
});
```

Remove `agreeNeft` / `agreeTerms` from `validBankPayload` wherever the file builds a bank payload.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=apps/api -- bank`
Expected: FAIL — the bank route accepts the stale set and writes no consent rows.

- [ ] **Step 3: Share the staleness rule**

Move `sameDeclarations` out of `apps/api/src/modules/stalls/submit.ts` into `declarations.ts`, exported, with its doc comment intact (the note about `undefined` not being a claim is the part that matters). Import it back into `submit.ts`, and change that file's `recordConsent` call to the object form:

```ts
    const live = await declarationsForForm(tx, edition.id, input.requestType);
    if (!sameDeclarations(live, input.declarationIds)) throw new DeclarationsChangedError();
    await recordConsent(tx, { requestId: request.id, formType: input.requestType }, live);
```

- [ ] **Step 4: Wire the three other paths**

In `bank.ts`, inside the existing `db.$transaction`, before the `stallBankDetail.create`:

```ts
    // The same check the request form makes, for the same reason: if the page
    // displayed a different set from the one live now, the wording moved while
    // the form sat open. `agreedNeftAt` and `agreedTermsAt` below still record
    // WHEN — these rows are what record WHAT.
    const live = await declarationsForForm(tx, r.editionId, 'BANK');
    if (!sameDeclarations(live, input.declarationIds)) throw new DeclarationsChangedError();
    await recordConsent(tx, { requestId, formType: 'BANK' }, live);
```

Leave `agreedNeftAt: now` and `agreedTermsAt: now` exactly as they are — the finance screens read those columns.

In `onboarding.ts`, `registerStaff` becomes a transaction so the staff row and its consent are written together:

```ts
  const staff = await db.$transaction(async (tx) => {
    const row = await tx.stallVendorStaff.upsert({ /* unchanged */ });
    const live = await declarationsForForm(tx, request.editionId, 'STAFF');
    if (!sameDeclarations(live, input.declarationIds)) throw new DeclarationsChangedError();
    // ⚠️ `staffId` is this person's own. Eight people on one coupon share a
    // request, and the consent is the individual's, not the stall's.
    await recordConsent(tx, { requestId: request.id, formType: 'STAFF', staffId: row.id }, live);
    return row;
  });
```

Apply the same three lines to `submitFssai` with `formType: 'FSSAI'` and no `staffId`.

- [ ] **Step 5: Stop seeding the `agreed` field**

In `apps/api/src/modules/stalls/form-builder.ts`, where `seedFormDefinitions` maps `source.fields` into rows, skip the retired one:

```ts
    // ⚠️ `agreed` is not a question any more. Its wording is a declaration row
    // and its tick is drawn beside that wording above Submit — a field here too
    // would be the same consent asked twice, once with real words and once as
    // a bare "I Agree". Existing editions are switched off by the migration.
    for (const [i, field] of source.fields.filter((f) => f.name !== 'agreed').entries()) {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test --workspace=apps/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/stalls apps/api/test
git commit -m "feat(stalls): the bank, FSSAI and staff forms record consent by version"
```

---

### Task 6: The shared consent block

**Files:**
- Create: `apps/web/src/modules/stalls/components/DeclarationConsent.tsx`
- Test: `apps/web/src/modules/stalls/components/DeclarationConsent.test.tsx`

**Interfaces:**
- Consumes: `Declaration` (Task 1); `DeclarationText` from `./DeclarationText`; `ChoicePlate`, `Checkbox`, `FieldError` from `../ui`.
- Produces:
  ```ts
  export function DeclarationConsent(props: {
    declarations: readonly Declaration[];
    ticked: ReadonlySet<string>;
    onToggle: (id: string, on: boolean) => void;
    error?: string | null;
  }): JSX.Element | null;
  export function allTicked(declarations: readonly Declaration[], ticked: ReadonlySet<string>): boolean;
  ```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/modules/stalls/components/DeclarationConsent.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { DeclarationConsent, allTicked } from './DeclarationConsent';

const d = (id: string, body: string) => ({
  id, key: id, formType: null, version: 1, title: id,
  body, bodyTa: null, isActive: true, isCurrent: true,
});

describe('the consent block', () => {
  /** 🔴 One tick PER declaration. `recordConsent` writes a row each, so a single
   *  tick over three would log three agreements from one gesture — a record
   *  that claims more than the reader did. */
  test('draws one tick per declaration, each labelled by its own wording', () => {
    render(<DeclarationConsent declarations={[d('a', 'First wording.'), d('b', 'Second wording.')]} ticked={new Set()} onToggle={() => {}} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByText('First wording.')).toBeInTheDocument();
    expect(screen.getByText('Second wording.')).toBeInTheDocument();
  });

  test('reports the id that was ticked', async () => {
    const onToggle = vi.fn();
    render(<DeclarationConsent declarations={[d('a', 'Wording.')]} ticked={new Set()} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith('a', true);
  });

  /** A form with nothing to agree to renders nothing and gates nothing — the
   *  FSSAI and staff case until the team authors wording. */
  test('renders nothing when there are no declarations', () => {
    const { container } = render(<DeclarationConsent declarations={[]} ticked={new Set()} onToggle={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(allTicked([], new Set())).toBe(true);
  });

  test('allTicked is false until every one is ticked', () => {
    const all = [d('a', 'A.'), d('b', 'B.')];
    expect(allTicked(all, new Set(['a']))).toBe(false);
    expect(allTicked(all, new Set(['a', 'b']))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=apps/web -- DeclarationConsent`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `apps/web/src/modules/stalls/components/DeclarationConsent.tsx`:

```tsx
import type { Declaration } from '@stalls/core';
import { ChoicePlate, Checkbox, FieldError } from '../ui';
import { DeclarationText } from './DeclarationText';

/**
 * The consents a form asks for, drawn immediately above its Submit button.
 *
 * 🔴 The wording used to sit at the TOP of the request form behind an ℹ️ icon,
 * and the tick that consented to it sat thirty questions below labelled just
 * "I Agree". By the time the tick was in reach the words had been off screen
 * for minutes. Consent and wording are one thing, and they belong together at
 * the point of signature — which is what every paper form already does.
 *
 * 🔴 ONE TICK PER DECLARATION, never one tick covering all of them.
 * `recordConsent` writes a row per declaration, so a single tick over three
 * logs three agreements from one gesture — a record claiming more than the
 * reader did. The bank form makes it concrete: its NEFT terms and its terms and
 * conditions are two different things to agree to.
 *
 * ⚠️ Shared by all four public forms rather than inlined in `RequestForm`. The
 * bank, FSSAI and staff forms have no `renderForm` machinery to hang a field
 * off, and three copies of a consent block is three places for these rules to
 * drift apart.
 */
export function DeclarationConsent({
  declarations,
  ticked,
  onToggle,
  error,
}: {
  declarations: readonly Declaration[];
  ticked: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
  error?: string | null;
}) {
  // A form with nothing to agree to draws nothing — not an empty plate, which
  // reads as something that failed to load.
  if (declarations.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
      {declarations.map((d) => {
        const id = `declaration-${d.id}`;
        const on = ticked.has(d.id);
        return (
          <ChoicePlate key={d.id} htmlFor={id} selected={on}>
            <Checkbox
              id={id}
              checked={on}
              onChange={(e) => onToggle(d.id, e.target.checked)}
              aria-invalid={error ? true : undefined}
              style={{ marginTop: 1 }}
            />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.65 }}>
              {/* ⚠️ Nodes, never markup. This is authored by somebody pasting
                  from a Word document onto the page that records what they
                  agreed to — see `DeclarationText`. */}
              <DeclarationText body={d.body} />
              {d.bodyTa && (
                <span className='stalls-tamil' lang='ta' style={{ display: 'block', marginTop: 7 }}>
                  <DeclarationText body={d.bodyTa} />
                </span>
              )}
            </span>
          </ChoicePlate>
        );
      })}
      <FieldError of={error ?? undefined} />
    </div>
  );
}

/** Whether Submit may proceed. Vacuously true when a form asks for none. */
export function allTicked(
  declarations: readonly Declaration[],
  ticked: ReadonlySet<string>,
): boolean {
  return declarations.every((d) => ticked.has(d.id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=apps/web -- DeclarationConsent`
Expected: PASS, all four cases.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/stalls/components/DeclarationConsent.tsx apps/web/src/modules/stalls/components/DeclarationConsent.test.tsx
git commit -m "feat(stalls): one consent plate per declaration, for every public form"
```

---

### Task 7: The request form draws its consent at the bottom

**Files:**
- Modify: `apps/web/src/modules/stalls/public/RequestForm.tsx:263-268` (state), `:414-458` (delete the top plate), `:520-545` (the Submit gate), `:592-626` (the `checkbox` branch)
- Test: `apps/web/src/modules/stalls/public/RequestForm.test.tsx`

**Interfaces:**
- Consumes: `DeclarationConsent`, `allTicked` (Task 6).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/modules/stalls/public/RequestForm.test.tsx`:

```tsx
/** The wording is no longer a note at the top. It is the label on the tick. */
test('the declaration is not drawn above the questions', async () => {
  renderForm();
  const wording = await screen.findByText(/sole discretion/i);
  const ticks = screen.getAllByRole('checkbox');
  // The consent plate owns the wording, so the text sits inside a checkbox's label.
  expect(ticks.some((t) => t.closest('label')?.contains(wording))).toBe(true);
});

test('submit stays disabled until the declaration is ticked', async () => {
  renderForm();
  const submit = await screen.findByRole('button', { name: /submit/i });
  expect(submit).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox'));
  expect(submit).toBeEnabled();
});

test('there is no bare "I Agree" field left', async () => {
  renderForm();
  await screen.findByRole('button', { name: /submit/i });
  expect(screen.queryByText(/^I Agree$/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=apps/web -- RequestForm`
Expected: FAIL — the wording is in the top plate, not in a label.

- [ ] **Step 3: Replace the top plate with the bottom block**

In `apps/web/src/modules/stalls/public/RequestForm.tsx`:

Delete the whole declarations plate (the `<div>` at lines 414-458 and its `{/* The terms, on the primary tint… */}` comment).

Add consent state beside `shown`:

```ts
  const shown = declarationsFor(config.data?.declarations ?? [], type);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
```

Immediately above the Submit button, render:

```tsx
      <DeclarationConsent
        declarations={shown}
        ticked={ticked}
        onToggle={toggle}
        error={errors.declarationIds}
      />
```

Replace every `values.agreed !== true` in the Submit button's `disabled`, `className`, `cursor` and `opacity` with `!allTicked(shown, ticked)`. In the payload builder at line 92, replace `agreed: values.agreed === true` with `agreed: allTicked(shown, ticked)` and keep `declarationIds` as `shown.map((d) => d.id)`.

⚠️ **Leave the `f.type === 'checkbox'` branch at lines 592-626 alone.** `agreed` is not the only checkbox field: `forms.ts:347` is the required **Refundable Caution Deposit** tick on the vendor form, which is a real question with its own help text and is not a declaration. That branch is still the right rendering for it and for any checkbox the Form Builder authors. Only the comment above it needs amending — it currently says "The consent question is a PLATE", and consent no longer comes through here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=apps/web -- RequestForm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/stalls/public/RequestForm.tsx apps/web/src/modules/stalls/public/RequestForm.test.tsx
git commit -m "feat(stalls): the request form's consent sits above Submit, labelled by its wording"
```

---

### Task 8: The bank, FSSAI and staff forms draw their consent

**Files:**
- Modify: `apps/web/src/modules/stalls/public/BankForm.tsx:105-106`, `:200-202`, `:227`, `:345-399`
- Modify: `apps/web/src/modules/stalls/public/FssaiForm.tsx`
- Modify: `apps/web/src/modules/stalls/public/StaffRegistration.tsx`
- Modify: `apps/api/src/modules/stalls/bank.ts` (`BankFormView`), `onboarding.ts` (coupon and FSSAI views), `packages/stalls/src/contracts.ts` (`BankFormView`, `CouponView`, the FSSAI view)
- Test: `apps/web/src/modules/stalls/public/RequestForm.test.tsx` neighbours — add `BankForm.test.tsx` cases

**Interfaces:**
- Consumes: `DeclarationConsent`, `allTicked` (Task 6); `declarationsForForm` (Task 4).
- Produces: `declarations: Declaration[]` on `BankFormView`, `CouponView` and the FSSAI view.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/modules/stalls/public/BankForm.test.tsx`:

```tsx
test('the bank form draws a tick per declaration and gates submit on all of them', async () => {
  renderBankForm({ declarations: [decl('neft_transfer', 'Transfer by NEFT only.'), decl('terms_and_conditions', 'I accept the terms.')] });
  const submit = await screen.findByRole('button', { name: /submit/i });
  expect(screen.getByText('Transfer by NEFT only.')).toBeInTheDocument();
  expect(screen.getByText('I accept the terms.')).toBeInTheDocument();

  await fillRequiredBankFields();
  expect(submit).toBeDisabled();
  for (const tick of screen.getAllByRole('checkbox')) await userEvent.click(tick);
  expect(submit).toBeEnabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=apps/web -- BankForm`
Expected: FAIL — the form renders its two hardcoded ticks, not the declarations.

- [ ] **Step 3: Serve the declarations with each form's view**

Add `declarations: Declaration[]` to `BankFormView`, `CouponView` and the FSSAI view in `packages/stalls/src/contracts.ts`. In `apps/api/src/modules/stalls/bank.ts`'s `getBankForm`, populate it with `await declarationsForForm(db, r.editionId, 'BANK')`; likewise `'STAFF'` in `toCouponView`'s caller and `'FSSAI'` in the FSSAI view builder.

- [ ] **Step 4: Draw the block on each form**

In `BankForm.tsx`, delete the `agreeNeft` / `agreeTerms` state (lines 105-106), the two hardcoded `ChoicePlate`s and their `FieldError` (lines 345-399), and drop both from the submit payload (lines 200-202). Add:

```tsx
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setTicked((was) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
```

Render `<DeclarationConsent declarations={data.declarations} ticked={ticked} onToggle={toggle} error={errors.declarationIds} />` immediately above the Submit button, send `declarationIds: data.declarations.map((d) => d.id)` in the payload, and change line 227 to:

```ts
  const ready = allTicked(data.declarations, ticked) && files.BANK_CHEQUE && files.BANK_PAN;
```

Apply the same four changes to `FssaiForm.tsx` and `StaffRegistration.tsx`, each gating its own submit button. Both render nothing until the team authors wording, so their buttons behave exactly as they do today.

- [ ] **Step 5: Run the full suite**

Run: `npm run typecheck && npm test && npm run check`
Expected: PASS throughout.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/stalls/public apps/api/src/modules/stalls packages/stalls/src/contracts.ts
git commit -m "feat(stalls): the bank, FSSAI and staff forms draw their declarations above Submit"
```

---

### Task 9: The Declarations screen can author against any form

**Files:**
- Modify: `apps/web/src/modules/stalls/backoffice/Declarations.tsx:39-47`, `:188`, `:397-399`
- Modify: `apps/web/src/modules/stalls/components/StatusPill.tsx:48-53` (`TYPE_LABEL`)
- Test: `apps/web/src/modules/stalls/backoffice/Declarations.test.tsx`

**Interfaces:**
- Consumes: `STALL_FORM_TYPES` (Task 1); `DeclarationRow.formType` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```tsx
test('a declaration can be authored against the bank form', async () => {
  renderDeclarations();
  await userEvent.click(await screen.findByRole('button', { name: /new declaration/i }));
  expect(screen.getByRole('button', { name: 'Bank Details' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'FSSAI' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Staff Registration' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --workspace=apps/web -- Declarations`
Expected: FAIL — only the four request-form buttons render.

- [ ] **Step 3: Widen the screen**

In `StatusPill.tsx`, add to `TYPE_LABEL`:

```ts
  BANK: 'Bank Details',
  FSSAI: 'FSSAI',
  STAFF: 'Staff Registration',
```

In `Declarations.tsx`, replace the local `FORM_TYPES` with `STALL_FORM_TYPES` imported from `@stalls/core`, rename the `FormType` local alias to use `StallFormType`, and rename every `requestType` reference to `formType` (lines 47, 188, 397-399, plus the create form's state and payload).

⚠️ Leave `FormBuilder.tsx:39` alone. This spec does not make the bank, FSSAI or staff forms builder-driven, and a tab that leads to "This edition has no form definition yet" is a promise the screen cannot keep.

- [ ] **Step 4: Run the full suite**

Run: `npm run typecheck && npm test && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/stalls
git commit -m "feat(stalls): declarations are authored against any public form"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: form-type scoping → Tasks 1-3; consent home → Tasks 3-4; one tick above Submit → Tasks 6-8; retiring `agreed` → Tasks 3 (migration) and 5 (seed); retiring `agreeNeft`/`agreeTerms` → Tasks 2, 5, 8; seeding the bank wording → Task 4; the `declarationIds` widening across all three contracts → Tasks 2 and 5; the backoffice screen → Task 9; every listed test case has a home.

**Naming.** `formType` throughout (never `requestType` after Task 1); `recordConsent(db, ConsentWhere, decls)` defined in Task 4 and used in that shape in Task 5; `allTicked` defined in Task 6 and used in Tasks 7-8; `STALL_FORM_TYPES` defined in Task 1 and used in Task 9.

**Two test files must be created, not modified.** Neither exists today:

- `apps/web/src/modules/stalls/public/BankForm.test.tsx` (Task 8). Its first step is building the harness — `renderBankForm`, `decl`, `fillRequiredBankFields` — modelled on `RequestForm.test.tsx` and the shared `test-utils.tsx`. Worth doing regardless: the bank form is where the account numbers are and it has no component test at all.
- `apps/web/src/modules/stalls/backoffice/Declarations.test.tsx` (Task 9), with a `renderDeclarations` harness modelled on `Onboarding.test.tsx`.

**Verified against the tree.** `apps/api/test/declarations.test.ts` and `apps/api/test/bank.test.ts` both exist and are modified rather than created. `forms.ts` has two `checkbox` fields, not one — `agreed` at :130 and Refundable Caution Deposit at :347 — so Task 7 retires only the first and the rendering branch stays.
