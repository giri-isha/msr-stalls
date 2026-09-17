# Filing on Behalf of a Requester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A backoffice member holding the right privilege can file any of the five requester forms — the stall request, the bank form, the FSSAI upload, a staff registration and a payment claim — for a requester who cannot, with every such filing recorded as the member acting on behalf of that account.

**Architecture:** The five public submit functions gain a `Filing` (who acted, for whom) and stay the single validation path. Five new backoffice routes plus a requester lookup call them; each is gated on its own `filing.*` privilege and on requester-type scope. On the web, each public form splits into a body component (config + submit function in, no routing) and its existing public wrapper; the backoffice reuses the bodies inside a new File-a-request page and inside dialogs on the request detail.

**Tech Stack:** TypeScript, Fastify 5 + Zod 4, Prisma 8 / PostgreSQL, React 19 + react-router 8, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-filing-on-behalf-and-audit-log-design.md`, decisions 1–10. **Depends on** `2026-09-17-audit-log.md` being fully landed: `audit()`, `AuditActor`, `requesterActor`, the `onBehalfOfAccountId` column, and the `actor` parameter on `submitFssai` / `registerStaff` / `submitPaymentClaim`.

## Global Constraints

- Module boundary (`npm run lint:boundaries`) stays green; migrations are Prisma-named (`cd apps/api && npx prisma migrate dev --name <name>`).
- Privileges: `filing.request`, `filing.bank`, `filing.fssai`, `filing.staff`, `filing.claim`, all kind `action`, category `filing` named **Filing on behalf**. Seeded: Lead holds all five; Local Welfare holds request, fssai, staff, claim (never bank); Finance, Volunteer, Electrical hold none.
- Accounts follow the registration convention, no schema change: email-only → `phone: ''`; phone-only → email `mobile+<digits>@stalls.invalid` (`PLACEHOLDER_EMAIL_DOMAIN`). Contacts resolve through `findAccountByContact`.
- A filing route returns the reference and the request id, **never** a token or a link.
- Every on-behalf write records `onBehalfOfAccountId` = the requester's account and the actor = the member; a consent recorded on behalf carries `attestedBy` = the member's `person_id`.
- Copy: the submit button on an on-behalf form reads **File on Their Behalf**; headings name the requester ("Filing for Kumar Stores"). The attestation tick reads: *I read these declarations to the requester and they agreed.*
- Commit after every task; messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/stalls/src/rbac.ts`, `rbac.test.ts` | Five privileges, one category, seeds. |
| `packages/stalls/src/filing.ts` (new) | Wire contracts: `FileRequestInput/Response`, `RequesterLookupQuery/Response`, `FileBankInput`, `FileFssaiInput`, `FileStaffInput`, `FileClaimInput`, `Attested`. |
| `packages/stalls/src/contracts.ts` | `MeResponse.requestTypeScope`. |
| `apps/api/prisma/schema.prisma` + migration | `StallDeclarationConsent.attestedBy`. |
| `apps/api/src/modules/stalls/audit.ts` | `Filing`, `byRequester`, `onBehalfOf`, `attestedByOf`. |
| `apps/api/src/modules/stalls/declarations.ts` | `recordConsent(…, attestedBy?)`. |
| `apps/api/src/modules/stalls/submit.ts`, `bank.ts`, `onboarding.ts`, `payment-claims.ts` | Take a `Filing`; record on-behalf-of. |
| `apps/api/src/modules/stalls/filing.ts` (new) | `lookupRequester`, `resolveFilingAccount`, `fileRequest`, `fssaiFormView`, `staffFormView`. |
| `apps/api/src/modules/stalls/errors.ts`, `http-errors.ts` | `AmbiguousRequesterError` → 409. |
| `apps/api/src/modules/stalls/routes.ts` | Lookup, five filing routes, three form-view routes, `/me` scope, upload privilege by purpose. |
| `apps/api/src/modules/stalls/public-routes.ts` | Pass `byRequester(...)`; FSSAI view moves to `fssaiFormView`. |
| `apps/api/test/filing.test.ts` (new) | Route tests. |
| `apps/web/src/modules/stalls/api.ts` | Client calls. |
| `apps/web/src/modules/stalls/components/Attestation.tsx` (new) | The attestation tick. |
| `apps/web/src/modules/stalls/public/RequestForm.tsx`, `BankForm.tsx`, `FssaiForm.tsx`, `StaffRegistration.tsx`, `PaymentClaim.tsx` | Body + wrapper split. |
| `apps/web/src/modules/stalls/backoffice/FileRequest.tsx` (new) | The three-step page. |
| `apps/web/src/modules/stalls/backoffice/FileForRequester.tsx` (new) | The four on-behalf dialogs used by `RequestDetail`. |
| `apps/web/src/modules/stalls/backoffice/RequestDetail.tsx`, `Requests.tsx`, `index.tsx` | Actions, button, route. |
| `apps/web/src/modules/stalls/backoffice/FileRequest.test.tsx` (new), `Requests.test.tsx` | Tests. |
| `README.md`, `docs/requirements-traceability.md`, the spec | Words. |

---

### Task 1: The five privileges

**Files:**
- Modify: `packages/stalls/src/rbac.ts`, `packages/stalls/src/rbac.test.ts`

- [ ] **Step 1: Failing test**

In `rbac.test.ts`, `SHIPPED_HOLDINGS`: add to `stalls_lead` (after `'audit.read'`):

```ts
    // Files any of the five forms for a requester who cannot.
    'filing.request',
    'filing.bank',
    'filing.fssai',
    'filing.staff',
    'filing.claim',
```

and to `stalls_local_welfare` (last):

```ts
    // Files for village traders who have no email address — the reason the
    // role exists. Never `filing.bank`: a local welfare stall is not asked for
    // bank details.
    'filing.request',
    'filing.fssai',
    'filing.staff',
    'filing.claim',
```

Add a test in the same file:

```ts
test('the filing privileges are their own category, and Local Welfare never files a bank form', () => {
  const filing = PRIVILEGE_CATEGORIES.find((c) => c.key === 'filing');
  expect(filing?.items.map((i) => i.code).sort()).toEqual(
    ['filing.bank', 'filing.claim', 'filing.fssai', 'filing.request', 'filing.staff'],
  );
  const lw = SEED_ROLES.find((r) => r.roleKey === 'stalls_local_welfare');
  expect(lw?.privileges).not.toContain('filing.bank');
  expect(lw?.privileges).toContain('filing.request');
});
```

Run: `npm test --workspace=packages/stalls -- rbac`
Expected: FAIL.

- [ ] **Step 2: Add them**

In `STALL_PRIVILEGES`, after `'audit.read'`:

```ts
  'filing.request',
  'filing.bank',
  'filing.fssai',
  'filing.staff',
  'filing.claim',
```

Append a category to `PRIVILEGE_CATEGORIES` (before `audit` so the editor reads Requests … Filing … Access … Audit; order is cosmetic):

```ts
  {
    /** 🔴 Its own category, never five more items under Requests.
     *
     *  A category is the unit a role is granted whole, and these hand a
     *  backoffice member the power to speak FOR a requester — to file the
     *  form, tick the declarations on their word, upload their documents.
     *  Bundled with "amend a request" they would arrive with every role that
     *  corrects a phone number. */
    key: 'filing',
    name: 'Filing on behalf',
    items: [
      {
        code: 'filing.request',
        label: 'File a request for a requester',
        kind: 'action',
        description:
          'Enter a stall request on behalf of a vendor, department or trader, creating their account if they have none.',
      },
      {
        code: 'filing.bank',
        label: 'Enter a bank form for a requester',
        kind: 'action',
        description: 'Fill in the bank, GST and contract form and upload its documents on their behalf.',
      },
      {
        code: 'filing.fssai',
        label: 'Upload an FSSAI certificate for a requester',
        kind: 'action',
        description: 'Upload the food licence a vendor sent by other means.',
      },
      {
        code: 'filing.staff',
        label: 'Register staff for a stall',
        kind: 'action',
        description: 'Register the people working a stall, against its own coupon.',
      },
      {
        code: 'filing.claim',
        label: 'Record a transfer a requester reported',
        kind: 'action',
        description: 'Record a payment a requester reported by phone, for Finance to verify.',
      },
    ],
  },
```

Change `requests.write`'s description to `'Amend a request after it was filed, and flag one for follow-up.'` and its label to `'Amend requests'`.

Add to `LEAD_PRIVILEGES` (last): `'filing.request', 'filing.bank', 'filing.fssai', 'filing.staff', 'filing.claim'`. In `SEED_ROLES`, `stalls_local_welfare.privileges` gains `'filing.request', 'filing.fssai', 'filing.staff', 'filing.claim'`.

Run: `npm test --workspace=packages/stalls`
Expected: PASS. Run `npm test --workspace=apps/web -- Documentation` — the privilege table test reads the constant and passes.

- [ ] **Step 3: Commit**

```bash
git add packages/stalls/src/rbac.ts packages/stalls/src/rbac.test.ts
git commit -m "feat(stalls): five filing privileges, a category of their own

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The wire

**Files:**
- Create: `packages/stalls/src/filing.ts`
- Create: `packages/stalls/src/filing.test.ts`
- Modify: `packages/stalls/src/index.ts`, `packages/stalls/src/contracts.ts` (`MeResponse`)

**Interfaces:**
- Produces:
  ```ts
  export const Attested = z.object({ attestation: z.literal(true) });
  export const FilingRequester = z.object({ displayName, email?, phone? }) // at least one contact
  export const FileRequestInput = z.object({ requester: FilingRequester, request: SubmitRequestInput, attestation: z.literal(true) });
  export interface FileRequestResponse { requestId: string; reference: string; accountId: string; accountCreated: boolean }
  export const RequesterLookupQuery = z.object({ contact: z.string().trim().min(1).max(254) });
  export interface RequesterLookupResponse { match: { accountId; displayName; email; phone; requesterType: string | null; requestCount: number } | null }
  export const FileBankInput = SubmitBankDetailsInput.extend({ attestation: z.literal(true) });
  export const FileFssaiInput = SubmitFssaiInput.extend({ attestation: z.literal(true) });
  export const FileStaffInput = RegisterStaffInput.omit({ couponCode: true }).extend({ attestation: z.literal(true) });
  export const FileClaimInput = SubmitPaymentClaimInput.omit({ reference: true });
  ```
  and `MeResponse.requestTypeScope: string[] | null`.

- [ ] **Step 1: Failing test**

```ts
// packages/stalls/src/filing.test.ts
import { describe, expect, test } from 'vitest';
import { FileRequestInput, FileStaffInput, FilingRequester, RequesterLookupQuery } from './filing';

describe('FilingRequester', () => {
  test('needs a name and at least one contact', () => {
    expect(FilingRequester.safeParse({ displayName: 'Kumar' }).success).toBe(false);
    expect(FilingRequester.safeParse({ displayName: 'Kumar', phone: '9840012345' }).success).toBe(true);
    expect(FilingRequester.safeParse({ displayName: 'Kumar', email: 'k@example.org' }).success).toBe(true);
  });

  test('normalises the phone to ten digits and the email to lower case', () => {
    const p = FilingRequester.parse({ displayName: 'K', phone: '+91 98400 12345', email: 'K@Example.org' });
    expect(p.phone).toBe('9840012345');
    expect(p.email).toBe('k@example.org');
  });
});

describe('FileRequestInput', () => {
  test('requires the attestation', () => {
    const body = { requester: { displayName: 'K', phone: '9840012345' }, request: {} };
    expect(FileRequestInput.safeParse(body).success).toBe(false);
    expect(FileRequestInput.safeParse({ ...body, attestation: false }).success).toBe(false);
  });
});

describe('FileStaffInput', () => {
  test('has no coupon code — the request in the path names the stall', () => {
    expect(FileStaffInput.safeParse({ couponCode: 'X', mobile: '9840012345', declarationIds: [], attestation: true }).success).toBe(false);
    expect(FileStaffInput.safeParse({ mobile: '9840012345', declarationIds: [], attestation: true }).success).toBe(true);
  });
});

describe('RequesterLookupQuery', () => {
  test('trims and bounds the contact', () => {
    expect(RequesterLookupQuery.parse({ contact: '  k@example.org ' }).contact).toBe('k@example.org');
    expect(RequesterLookupQuery.safeParse({ contact: '' }).success).toBe(false);
  });
});
```

Run: `npm test --workspace=packages/stalls -- filing`
Expected: FAIL.

- [ ] **Step 2: Write it**

```ts
// packages/stalls/src/filing.ts
// Filing a requester's forms FROM the backoffice: the bodies the five filing
// routes take, and the lookup that precedes the first of them.
//
// ⚠️ Each body is the PUBLIC contract plus an attestation, never a copy of it.
// The rules — shape here, required-ness in the edition's field rows — are the
// same rules the requester meets, enforced by the same function.
import { z } from 'zod';
import { IndianMobile } from './contracts';
import {
  RegisterStaffInput,
  SubmitBankDetailsInput,
  SubmitFssaiInput,
  SubmitPaymentClaimInput,
  SubmitRequestInput,
} from './contracts';

/** The filer's word that the declarations were read out and agreed to. */
export const Attested = z.object({ attestation: z.literal(true) });

/** Who the form is for. A name and at least one contact; the account is found
 *  by the contact or created with it, following the registration convention
 *  (a phone-only account carries a placeholder address). */
export const FilingRequester = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    email: z.email().max(320).trim().toLowerCase().optional().or(z.literal('')),
    phone: IndianMobile.optional().or(z.literal('')),
  })
  .transform((v) => ({
    displayName: v.displayName,
    email: v.email || undefined,
    phone: v.phone || undefined,
  }))
  .refine((v) => !!v.email || !!v.phone, {
    message: 'an email address or a mobile number is needed to file for somebody',
    path: ['phone'],
  });
export type FilingRequester = z.infer<typeof FilingRequester>;

export const FileRequestInput = z.object({
  requester: FilingRequester,
  request: SubmitRequestInput,
  attestation: z.literal(true),
});
export type FileRequestInput = z.infer<typeof FileRequestInput>;

/** ⚠️ No token, no link. The receipt goes to the ACCOUNT's contact; the
 *  filer learns the reference and where the record is. */
export interface FileRequestResponse {
  requestId: string;
  reference: string;
  accountId: string;
  /** True when this filing created the account rather than attaching to one. */
  accountCreated: boolean;
}

export const RequesterLookupQuery = z.object({ contact: z.string().trim().min(1).max(254) });
export type RequesterLookupQuery = z.infer<typeof RequesterLookupQuery>;

export interface RequesterLookupResponse {
  match: {
    accountId: string;
    displayName: string;
    /** '' for a placeholder address. */
    email: string;
    phone: string;
    requesterType: string | null;
    /** In the active edition. */
    requestCount: number;
  } | null;
}

export const FileBankInput = SubmitBankDetailsInput.extend({ attestation: z.literal(true) });
export type FileBankInput = z.infer<typeof FileBankInput>;

export const FileFssaiInput = SubmitFssaiInput.extend({ attestation: z.literal(true) });
export type FileFssaiInput = z.infer<typeof FileFssaiInput>;

/** The request in the path names the stall; the coupon is the stall's own,
 *  found or issued by the route. */
export const FileStaffInput = RegisterStaffInput.omit({ couponCode: true }).extend({
  attestation: z.literal(true),
});
export type FileStaffInput = z.infer<typeof FileStaffInput>;

/** No attestation: a claim carries no declarations. No `reference`: the path
 *  names the request. */
export const FileClaimInput = SubmitPaymentClaimInput.omit({ reference: true });
export type FileClaimInput = z.infer<typeof FileClaimInput>;
```

⚠️ `IndianMobile` must be exported from `contracts.ts`; check with `grep -n "export const IndianMobile" packages/stalls/src/contracts.ts`. If it is not exported, export it (it is a `z.string()` transform to ten digits). If `.trim().toLowerCase()` are not available on `z.email()` in this Zod version, write the email as `z.string().trim().toLowerCase().pipe(z.email().max(320))`.

Add `export * from './filing';` to `index.ts`. In `contracts.ts`, `MeResponse` gains:

```ts
  /** The requester types the caller's roles reach, or null for all. The
   *  filing page offers only the forms inside it, so a Local Welfare member
   *  is never shown a vendor form the API would refuse. */
  requestTypeScope: string[] | null;
```

Run: `npm test --workspace=packages/stalls && npm run typecheck`
Expected: core PASS; the API typecheck now fails on `/me` (missing field) — fixed in Task 5. The web's `ME_LEAD` fixture needs `requestTypeScope: null` — add it in `test-utils.tsx` to `ME_LEAD` and `ME_ADMIN` (and `ME_VOLUNTEER` if present).

- [ ] **Step 3: Commit**

```bash
git add packages/stalls/src apps/web/src/modules/stalls/test-utils.tsx
git commit -m "feat(stalls): the wire for filing on behalf — public bodies plus an attestation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Consent attested by a member

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (+ migration `consent_attested_by`)
- Modify: `apps/api/src/modules/stalls/declarations.ts` (`recordConsent`)
- Modify: `apps/api/test/declarations.test.ts`

- [ ] **Step 1: Failing test**

In `apps/api/test/declarations.test.ts`, add:

```ts
test('a consent recorded on behalf carries who attested it', async () => {
  const e = await seedEdition();
  const { requestId } = await selected(['C1-1']);
  const live = await declarationsForForm(prisma, e.id, 'BANK');
  await recordConsent(prisma, { requestId, formType: 'BANK' }, live, 'p-desk');
  const rows = await prisma.stallDeclarationConsent.findMany({ where: { requestId, formType: 'BANK' } });
  expect(rows.length).toBe(live.length);
  expect(rows.every((r) => r.attestedBy === 'p-desk')).toBe(true);
});
```

(Import `declarationsForForm`, `recordConsent` from `../src/modules/stalls/declarations` and `selected` from `./helpers/onboarding`; if the BANK form seeds no declarations in this edition, use `'VENDOR'` and a fresh `submitRequest` — the point is the column.)

Run: `npm test --workspace=apps/api -- declarations`
Expected: FAIL — `attestedBy` unknown.

- [ ] **Step 2: Column and seam**

In `StallDeclarationConsent`, after `staffId`:

```prisma
  /// Set when a BACKOFFICE member ticked this on the requester's word — filing
  /// the form for somebody who could not. The requester did not tick it
  /// themselves; this is who says they agreed. A `person_id`, no FK: Person is
  /// another module's.
  attestedBy String? @map("attested_by")
```

Run: `cd apps/api && npx prisma migrate dev --name consent_attested_by && cd ../.. && npm run db:test:deploy --workspace=apps/api`.

`recordConsent(db, where, declarations, attestedBy?: string)`: add `attestedBy: attestedBy ?? null` to each row in `createMany`.

Run: `npm test --workspace=apps/api -- declarations`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma apps/api/src/modules/stalls/declarations.ts apps/api/test/declarations.test.ts
git commit -m "feat(stalls): a consent can record who attested it on the requester’s behalf

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The seams take a `Filing`

**Files:**
- Modify: `apps/api/src/modules/stalls/audit.ts`, `submit.ts`, `bank.ts`, `onboarding.ts`, `payment-claims.ts`, `public-routes.ts`, `portal.ts`
- Modify: `apps/api/test/audit.test.ts` and any test calling the four seams

**Interfaces:**
- Produces, in `audit.ts`:
  ```ts
  export interface Filing { actor: AuditActor; onBehalfOfAccountId?: string }
  export function byRequester(accountId: string, name?: string): Filing;
  export function onBehalfOf(caller: { personId: string; displayName: string }, accountId: string): Filing;
  /** The member's person id when filed on behalf; undefined when the requester acted. */
  export function attestedByOf(f: Filing): string | undefined;
  ```
- Changes: `submitRequest(db, input, deps, accountId, filing?: Filing)`; `submitBankDetails(db, requestId, input, filing: Filing)`; `submitFssai(db, requestId, input, filing: Filing)`; `registerStaff(db, input, filing: Filing)`; `submitPaymentClaim(db, requestId, input: Omit<SubmitPaymentClaimInput, 'reference'>, filing: Filing)`.

- [ ] **Step 1: Failing tests**

Append to `apps/api/test/audit.test.ts`:

```ts
import { onBehalfOf } from '../src/modules/stalls/audit';
import { submitBankDetails } from '../src/modules/stalls/bank';

describe('a form filed on behalf names both people', () => {
  test('the bank form: actor is the member, onBehalfOf is the account, consent is attested', async () => {
    const e = await seedEdition();
    const { requestId } = await selected(['C1-1']);
    const r = await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } });
    const lead = await seedBackoffice(['stalls_lead']);
    const { declarationsForForm } = await import('../src/modules/stalls/declarations');
    const live = await declarationsForForm(prisma, e.id, 'BANK');

    await submitBankDetails(
      prisma,
      requestId,
      {
        email: 'v@example.org', invoiceName: 'V', accountHolder: 'V', mobile: '9840012345', address: 'x', pincode: '641114',
        bankName: 'SBI', branch: 'Main', accountNumber: '123456789012', ifsc: 'SBIN0000001', micr: '', panNumber: 'ABCDE1234F',
        gstNumber: 'NONE', chequeKey: '', panKey: '', gstKey: '', declarationIds: live.map((d) => d.id), customFields: {},
        plugs5a: 0, plugs15a: 0, gasStoves: 0, appliances: [], tablesNeeded: 0, chairsNeeded: 0, passes2w: 0, passes4w: 0, passesStaff: 0,
      },
      onBehalfOf({ personId: lead.personId, displayName: 'Deepa' }, r.accountId),
    );

    const [row] = await prisma.stallAuditEvent.findMany({ where: { action: 'stall_bank_detail.submitted' } });
    expect(row.actorKind).toBe('BACKOFFICE');
    expect(row.actorRef).toBe(lead.personId);
    expect(row.onBehalfOfAccountId).toBe(r.accountId);
    const consents = await prisma.stallDeclarationConsent.findMany({ where: { requestId, formType: 'BANK' } });
    expect(consents.every((c) => c.attestedBy === lead.personId)).toBe(true);
  });
});
```

(If the bank form's field rows require the cheque and PAN uploads, mint keys with `presignUpload(fakeStore(), …)` as `bank.test.ts` does and pass them; copy that test's body-building helper rather than fighting the validator.)

Run: `npm test --workspace=apps/api -- audit.test`
Expected: FAIL — `onBehalfOf` not exported; the signature does not take a `Filing`.

- [ ] **Step 2: `Filing` in `audit.ts`**

Append:

```ts
/** Who is filing a form, and for whom.
 *
 *  The requester filing their own is `byRequester(accountId)`. A backoffice
 *  member filing for them is `onBehalfOf(caller, accountId)`: the member is the
 *  actor, the account is whose request it is, and both land on the row. */
export interface Filing {
  actor: AuditActor;
  onBehalfOfAccountId?: string;
}

export function byRequester(accountId: string, name?: string): Filing {
  return { actor: requesterActor(accountId, name) };
}

export function onBehalfOf(
  caller: { personId: string; displayName: string },
  accountId: string,
): Filing {
  return {
    actor: { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName },
    onBehalfOfAccountId: accountId,
  };
}

/** The member who attested a consent, when one did. */
export function attestedByOf(f: Filing): string | undefined {
  return f.onBehalfOfAccountId && f.actor.kind === 'BACKOFFICE' ? f.actor.personId : undefined;
}
```

- [ ] **Step 3: Thread it through the four seams and `submitRequest`**

In each seam: replace the `actor: AuditActor` parameter with `filing: Filing`; in its `audit()` call use `actor: filing.actor, onBehalfOfAccountId: filing.onBehalfOfAccountId ?? null`; in its `recordConsent(...)` call pass `attestedByOf(filing)` as the fourth argument.

- `bank.ts` `submitBankDetails(db, requestId, input, filing: Filing)`: the audit call written in Phase 1 (`actor: requesterActor(r.accountId)`) becomes `actor: filing.actor, onBehalfOfAccountId: filing.onBehalfOfAccountId ?? null`.
- `onboarding.ts` `submitFssai(…, filing)`, `registerStaff(db, input, filing)`.
- `payment-claims.ts` `submitPaymentClaim(db, requestId, input: Omit<SubmitPaymentClaimInput, 'reference'>, filing)`. The function never read `reference`; the type narrows to say so.
- `submit.ts` `submitRequest(db, input, deps, accountId, filing: Filing = byRequester(accountId))`: the `stall_request.filed` audit call uses `filing.actor` and `filing.onBehalfOfAccountId ?? null`; `recordConsent(...)` gets `attestedByOf(filing)`. Add `detail.filedBy: filing.onBehalfOfAccountId ? 'BACKOFFICE' : 'REQUESTER'`.

In `public-routes.ts`: `/bank/:token` → `submitBankDetails(prisma, link.requestId, req.body, byRequester(link.accountId))`; `/fssai/:token` → `byRequester(link.accountId)`; `/staff-registration` → `byRequester(request.accountId)`; `/requests/payment-claim` → `submitPaymentClaim(prisma, request.id, req.body, byRequester(account.id))`. Replace the `requesterActor` import with `byRequester`.

Update every direct caller in tests (`grep -rn "requesterActor(" apps/api/test`) to `byRequester(...)`, and the `selected()` helper in `test/helpers/onboarding.ts` is unaffected (it passes `accountId` as the 4th argument).

- [ ] **Step 4: Run**

Run: `npm test --workspace=apps/api && npm run typecheck --workspace=apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api/src apps/api/test
git commit -m "refactor(stalls): every requester form takes a Filing — who acted, and for whom

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The filing seam and its routes

**Files:**
- Create: `apps/api/src/modules/stalls/filing.ts`
- Modify: `apps/api/src/modules/stalls/errors.ts`, `http-errors.ts`, `routes.ts`, `public-routes.ts` (FSSAI view moves), `onboarding.ts` (nothing new; `fssaiFormView` lives in `filing.ts`)
- Create: `apps/api/test/filing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function lookupRequester(db, editionId, contact): Promise<RequesterLookupResponse>;
  export async function resolveFilingAccount(db, requester: FilingRequester, requestType): Promise<{ account: StallAccount; created: boolean }>;
  export async function fileRequest(db, deps: SubmitDeps, caller: BackofficeCaller, input: FileRequestInput): Promise<FileRequestResponse>;
  export async function fssaiFormView(db, requestId): Promise<FssaiFormView>;
  export async function staffFormView(db, requestId, by: AuditActor): Promise<CouponView & { couponCode: string }>;
  ```
  Routes: `GET /requests/file/lookup?contact=`, `POST /requests/file`, `GET /requests/:id/bank-form`, `POST /requests/:id/bank`, `GET /requests/:id/fssai-form`, `POST /requests/:id/fssai`, `GET /requests/:id/staff-form`, `POST /requests/:id/staff`, `POST /requests/:id/payment-claim`. `GET /me` gains `requestTypeScope`. `POST /uploads` gates by purpose.
  Error: `AmbiguousRequesterError` → 409.

- [ ] **Step 1: Failing tests**

```ts
// apps/api/test/filing.test.ts
import type { FastifyInstance } from 'fastify';
import type { StallEdition } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import {
  type Backoffice,
  LogMailer,
  prisma,
  resetDatabase,
  seedBackoffice,
  seedEdition,
  vendorBody,
} from './helpers/db';
import { fakeStore, recordingWhatsApp, selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let app: FastifyInstance;
let edition: StallEdition;
let lead: Backoffice;
let lw: Backoffice;
let finance: Backoffice;
let mail: LogMailer;
let whatsapp: ReturnType<typeof recordingWhatsApp>;

beforeAll(async () => {
  mail = new LogMailer();
  whatsapp = recordingWhatsApp();
  app = await buildApp({ logger: false, mail, whatsapp, files: fakeStore() });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  mail.sent.length = 0;
  whatsapp.sent.length = 0;
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
  await makeStalls(edition.id, 'A3', { LOCAL_WELFARE: 3 });
  lead = await seedBackoffice(['stalls_lead'], 'lead@example.org');
  lw = await seedBackoffice(['stalls_local_welfare'], 'lw@example.org');
  finance = await seedBackoffice(['stalls_finance'], 'finance@example.org');
});

const get = (url: string, who: Backoffice) =>
  app.inject({ method: 'GET', url: `/api/m/stalls${url}`, headers: who.headers });
const post = (url: string, payload: unknown, who: Backoffice) =>
  app.inject({ method: 'POST', url: `/api/m/stalls${url}`, headers: who.headers, payload });

const lwRequest = (over: Record<string, unknown> = {}) =>
  vendorBody({ requestType: 'LOCAL_WELFARE', depositAcknowledged: true, preferredZoneCode: 'A3', ...over });

describe('POST /requests/file', () => {
  test('a finance member holds no filing privilege', async () => {
    const res = await post('/requests/file', { requester: { displayName: 'K', phone: '9840012345' }, request: vendorBody(), attestation: true }, finance);
    expect(res.statusCode).toBe(403);
  });

  test('a local welfare member may file a local welfare form and not a vendor one', async () => {
    const no = await post('/requests/file', { requester: { displayName: 'K', phone: '9840012345' }, request: vendorBody(), attestation: true }, lw);
    expect(no.statusCode).toBe(403);
    const yes = await post('/requests/file', { requester: { displayName: 'Kumar', phone: '9840012345' }, request: lwRequest(), attestation: true }, lw);
    expect(yes.statusCode).toBe(201);
    expect(yes.json()).toMatchObject({ reference: expect.stringMatching(/^LWS-2026-/), accountCreated: true });
    expect(yes.json()).not.toHaveProperty('statusToken');
  });

  test('a phone-only requester gets a placeholder address, a WhatsApp receipt and no email', async () => {
    const res = await post('/requests/file', { requester: { displayName: 'Kumar', phone: '9840012345' }, request: lwRequest(), attestation: true }, lw);
    expect(res.statusCode).toBe(201);
    const account = await prisma.stallAccount.findUniqueOrThrow({ where: { id: res.json().accountId } });
    expect(account.email).toBe('mobile+9840012345@stalls.invalid');
    expect(account.phone).toBe('9840012345');
    expect(account.requesterType).toBe('LOCAL_WELFARE');
    expect(mail.sent).toHaveLength(0);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].text).toContain(res.json().reference);
  });

  test('an email requester gets the receipt by mail, and a second filing attaches to the same account', async () => {
    const a = await post('/requests/file', { requester: { displayName: 'Priya', email: 'Priya@GreenLeaf.example' }, request: vendorBody(), attestation: true }, lead);
    expect(a.statusCode).toBe(201);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('priya@greenleaf.example');
    const b = await post('/requests/file', { requester: { displayName: 'Priya', email: 'priya@greenleaf.example' }, request: vendorBody({ stallName: 'Second' }), attestation: true }, lead);
    expect(b.json().accountId).toBe(a.json().accountId);
    expect(b.json().accountCreated).toBe(false);
    expect(await prisma.stallAccount.count()).toBe(1);
  });

  test('two contacts naming two different accounts is refused with both names', async () => {
    await post('/requests/file', { requester: { displayName: 'Alpha', email: 'alpha@example.org' }, request: vendorBody(), attestation: true }, lead);
    await post('/requests/file', { requester: { displayName: 'Beta', phone: '9840099999' }, request: vendorBody({ stallName: 'B' }), attestation: true }, lead);
    const res = await post('/requests/file', { requester: { displayName: 'Gamma', email: 'alpha@example.org', phone: '9840099999' }, request: vendorBody({ stallName: 'C' }), attestation: true }, lead);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Alpha/);
    expect(res.json().error).toMatch(/Beta/);
  });

  test('an account registered for another form is refused exactly as the public write refuses it', async () => {
    await post('/requests/file', { requester: { displayName: 'Priya', email: 'priya@example.org' }, request: vendorBody(), attestation: true }, lead);
    const res = await post('/requests/file', { requester: { displayName: 'Priya', email: 'priya@example.org' }, request: lwRequest(), attestation: true }, lead);
    expect(res.statusCode).toBe(403);
  });

  test('the audit row names the member as actor and the account as on-behalf-of, and the consent is attested', async () => {
    const res = await post('/requests/file', { requester: { displayName: 'Kumar', phone: '9840012345' }, request: lwRequest(), attestation: true }, lw);
    const row = await prisma.stallAuditEvent.findFirstOrThrow({ where: { action: 'stall_request.filed' } });
    expect(row.actorRef).toBe(lw.personId);
    expect(row.onBehalfOfAccountId).toBe(res.json().accountId);
    expect(row.channel).toBe('BACKOFFICE');
    const consents = await prisma.stallDeclarationConsent.findMany({ where: { requestId: res.json().requestId } });
    expect(consents.length).toBeGreaterThan(0);
    expect(consents.every((c) => c.attestedBy === lw.personId)).toBe(true);
  });

  test('a receipt that fails to send does not fail the filing', async () => {
    const failing = await buildApp({ logger: false, mail: { send: async () => { throw new Error('smtp down'); } }, files: fakeStore() });
    try {
      const res = await failing.inject({ method: 'POST', url: '/api/m/stalls/requests/file', headers: lead.headers, payload: { requester: { displayName: 'P', email: 'p@example.org' }, request: vendorBody(), attestation: true } });
      expect(res.statusCode).toBe(201);
      expect(await prisma.stallAuditEvent.count({ where: { action: 'stall_email.failed' } })).toBe(1);
    } finally {
      await failing.close();
    }
  });
});

describe('GET /requests/file/lookup', () => {
  test('resolves a contact to an account, or to nothing, on filing.request', async () => {
    expect((await get('/requests/file/lookup?contact=k@example.org', finance)).statusCode).toBe(403);
    expect((await get('/requests/file/lookup?contact=k@example.org', lw)).json()).toEqual({ match: null });
    const filed = await post('/requests/file', { requester: { displayName: 'Kumar', phone: '9840012345' }, request: lwRequest(), attestation: true }, lw);
    const hit = (await get('/requests/file/lookup?contact=98400%2012345', lw)).json();
    expect(hit.match).toMatchObject({ accountId: filed.json().accountId, displayName: 'Kumar', email: '', phone: '9840012345', requesterType: 'LOCAL_WELFARE', requestCount: 1 });
  });
});

describe('the four request-addressed filings', () => {
  test('bank: filing.bank, scope, and the form view to draw it from', async () => {
    const { requestId } = await selected(['C1-1']);
    expect((await get(`/requests/${requestId}/bank-form`, lw)).statusCode).toBe(403); // no filing.bank
    expect((await get(`/requests/${requestId}/bank-form`, finance)).statusCode).toBe(403);
    const view = await get(`/requests/${requestId}/bank-form`, lead);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ reference: expect.stringMatching(/^VEN-/), submittedAt: null });
  });

  test('fssai: the view and the write, on behalf', async () => {
    const { requestId } = await selected(['C1-1']);
    const view = await get(`/requests/${requestId}/fssai-form`, lead);
    expect(view.statusCode).toBe(200);
    expect(view.json().uploadedAt).toBeNull();
    const res = await post(`/requests/${requestId}/fssai`, {
      stallName: 'Green Leaf Organics',
      files: [{ key: 'stalls/fssai/00000000-0000-4000-8000-000000000000.pdf', name: 'c.pdf' }],
      declarationIds: view.json().declarations.map((d: { id: string }) => d.id),
      attestation: true,
    }, lead);
    expect(res.statusCode).toBe(204);
    const row = await prisma.stallAuditEvent.findFirstOrThrow({ where: { action: 'stall_fssai.submitted' } });
    expect(row.actorRef).toBe(lead.personId);
    expect(row.onBehalfOfAccountId).not.toBeNull();
  });

  test('staff: the stall’s own coupon is found or issued, capacity still holds', async () => {
    const { requestId } = await selected(['C1-1']);
    const view = await get(`/requests/${requestId}/staff-form`, lead);
    expect(view.statusCode).toBe(200);
    expect(view.json().couponCode).toMatch(/^GRE-2026-/);
    const res = await post(`/requests/${requestId}/staff`, {
      name: 'Arun', mobile: '9840099999', idType: 'AADHAAR', idNumber: '1234', declarationIds: view.json().declarations.map((d: { id: string }) => d.id), attestation: true,
    }, lead);
    expect(res.statusCode).toBe(201);
    expect(res.json().registered).toBe(1);
    const again = await get(`/requests/${requestId}/staff-form`, lead);
    expect(again.json().couponCode).toBe(view.json().couponCode);
    const row = await prisma.stallAuditEvent.findFirstOrThrow({ where: { action: 'stall_vendor_staff.registered' } });
    expect(row.onBehalfOfAccountId).not.toBeNull();
  });

  test('claim: recorded PENDING, for Finance, with the member as actor', async () => {
    const { requestId } = await selected(['C1-1']);
    expect((await post(`/requests/${requestId}/payment-claim`, { purpose: 'RENT', referenceNo: 'UTR1', amountPaise: 100, paidOn: '2026-09-01' }, finance)).statusCode).toBe(403);
    const res = await post(`/requests/${requestId}/payment-claim`, { purpose: 'RENT', referenceNo: 'UTR1', amountPaise: 100, paidOn: '2026-09-01' }, lead);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('PENDING');
    const row = await prisma.stallAuditEvent.findFirstOrThrow({ where: { action: 'stall_payment_claim.submitted' } });
    expect(row.actorRef).toBe(lead.personId);
  });

  test('scope: a local welfare member cannot file for a vendor’s request', async () => {
    const { requestId } = await selected(['C1-1']);
    expect((await post(`/requests/${requestId}/payment-claim`, { purpose: 'RENT', referenceNo: 'UTR1', amountPaise: 100, paidOn: '2026-09-01' }, lw)).statusCode).toBe(403);
  });
});

describe('uploads for filing', () => {
  test('a bank document presigns on filing.bank, a certificate on filing.fssai', async () => {
    const body = { purpose: 'BANK_CHEQUE', fileName: 'c.pdf', contentType: 'application/pdf', bytes: 10 };
    expect((await post('/uploads', body, lw)).statusCode).toBe(403);
    expect((await post('/uploads', body, lead)).statusCode).toBe(200);
    expect((await post('/uploads', { ...body, purpose: 'FSSAI' }, lw)).statusCode).toBe(200);
  });
});

describe('GET /me', () => {
  test('carries the requester-type scope', async () => {
    expect((await get('/me', lw)).json().requestTypeScope).toEqual(['LOCAL_WELFARE']);
    expect((await get('/me', lead)).json().requestTypeScope).toBeNull();
  });
});
```

(`recordingWhatsApp` is in `test/helpers/onboarding.ts`; `buildApp` accepts `whatsapp`. The coupon code prefix is the first three letters of the stall name upper-cased — `formatCouponCode` in `@stalls/core`; adjust the regex if the stall name in `vendorBody` differs.)

Run: `npm test --workspace=apps/api -- filing`
Expected: FAIL — 404 on every route.

- [ ] **Step 2: The error**

`errors.ts`, after `WrongRequesterTypeError`:

```ts
/** Two contacts on a filing name two different accounts. Mapped to 409, with
 *  both names in the message: the filer can see both rows and chooses which
 *  contact to file under. Merging them on a desk's guess is not undoable. */
export class AmbiguousRequesterError extends Error {
  constructor(
    readonly byEmail: string,
    readonly byPhone: string,
  ) {
    super(
      `that email address belongs to ${byEmail} and that mobile number to ${byPhone} — ` +
        'file with one contact or the other',
    );
    this.name = 'AmbiguousRequesterError';
  }
}
```

`http-errors.ts`: import it and add `err instanceof AmbiguousRequesterError ||` to the 409 list.

- [ ] **Step 3: The seam**

```ts
// apps/api/src/modules/stalls/filing.ts
// Filing a requester's forms from the backoffice.
//
// 🔴 The same functions the requester's own routes call, with a `Filing` that
// says a member acted and for whom. Nothing here validates a form: `submit.ts`,
// `bank.ts`, `onboarding.ts` and `payment-claims.ts` do, once, for both sides.
// What this file owns is the ACCOUNT question — whose request is this — and
// the three read-side views a backoffice form needs to draw itself.
import type { PrismaClient, StallAccount, StallRequestType } from '@prisma/client';
import {
  type CouponView,
  type FileRequestInput,
  type FileRequestResponse,
  type FilingRequester,
  type FssaiFormView,
  PLACEHOLDER_EMAIL_DOMAIN,
  type RequesterLookupResponse,
  canReach,
  isPlaceholderEmail,
} from '@stalls/core';
import { findAccountByContact, normalizeEmail, resolveRequesterType } from './accounts';
import { type AuditActor, onBehalfOf } from './audit';
import { declarationsForForm } from './declarations';
import type { Db } from './editions';
import { AmbiguousRequesterError, RequestTypeForbiddenError, UnknownRequestError } from './errors';
import { publicFormFor } from './form-builder';
import { ensureCoupon, toCouponView } from './onboarding';
import type { BackofficeCaller } from './roles';
import { type SubmitDeps, submitRequest } from './submit';

/** What the requester step of the filing page shows once a contact is typed. */
export async function lookupRequester(
  db: Db,
  editionId: string,
  contact: string,
): Promise<RequesterLookupResponse> {
  const account = await findAccountByContact(db, contact);
  if (!account) return { match: null };
  const requestCount = await db.stallRequest.count({ where: { accountId: account.id, editionId } });
  return {
    match: {
      accountId: account.id,
      displayName: account.displayName,
      email: isPlaceholderEmail(account.email) ? '' : account.email,
      phone: account.phone,
      requesterType: await resolveRequesterType(db, account),
      requestCount,
    },
  };
}

/**
 * The account a filing lands on.
 *
 * Each contact given is looked up. One account, or the same account twice:
 * attach. Two different accounts: refuse with both names — the desk can see
 * both rows and picks a contact. None: create, following `register`'s
 * convention so a phone-only account carries the placeholder address that
 * keeps it out of every send.
 */
export async function resolveFilingAccount(
  db: Db,
  requester: FilingRequester,
  requestType: StallRequestType,
): Promise<{ account: StallAccount; created: boolean }> {
  const byEmail = requester.email ? await findAccountByContact(db, requester.email) : null;
  const byPhone = requester.phone ? await findAccountByContact(db, requester.phone) : null;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    throw new AmbiguousRequesterError(byEmail.displayName, byPhone.displayName);
  }
  const existing = byEmail ?? byPhone;
  if (existing) return { account: existing, created: false };

  const account = await db.stallAccount.create({
    data: {
      email: requester.email
        ? normalizeEmail(requester.email)
        : `mobile+${requester.phone}@${PLACEHOLDER_EMAIL_DOMAIN}`,
      phone: requester.phone ?? '',
      displayName: requester.displayName,
      requesterType: requestType,
    },
  });
  return { account, created: true };
}

/** A member files a request. Scope first — a Local Welfare member may not
 *  file a vendor form — then the account, then the ONE write the public has,
 *  with the member as actor. The token the write mints is dropped here: the
 *  receipt carries it to the requester, and the filer never sees it. */
export async function fileRequest(
  db: PrismaClient,
  deps: SubmitDeps,
  caller: BackofficeCaller,
  input: FileRequestInput,
): Promise<FileRequestResponse> {
  if (!canReach(caller.requestTypeScope, input.request.requestType)) {
    throw new RequestTypeForbiddenError(input.request.requestType);
  }
  const { account, created } = await resolveFilingAccount(db, input.requester, input.request.requestType);
  const result = await submitRequest(
    db,
    input.request,
    deps,
    account.id,
    onBehalfOf({ personId: caller.personId, displayName: caller.displayName }, account.id),
  );
  return { requestId: result.requestId, reference: result.reference, accountId: account.id, accountCreated: created };
}

/** The FSSAI form as the page draws it. Moved here from the public route so
 *  the backoffice can draw the same form; the public route calls this. */
export async function fssaiFormView(db: Db, requestId: string): Promise<FssaiFormView> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: { fssai: { include: { files: true } } },
  });
  if (!r) throw new UnknownRequestError(requestId);
  const [form, declarations] = await Promise.all([
    publicFormFor(db, r.editionId, 'FSSAI'),
    declarationsForForm(db, r.editionId, 'FSSAI'),
  ]);
  return {
    form,
    declarations,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    uploadedAt: r.fssai?.submittedAt.toISOString() ?? null,
    verifiedAt: r.fssai?.verifiedAt?.toISOString() ?? null,
    files: (r.fssai?.files ?? []).map((f) => ({ name: f.fileName, uploadedAt: f.uploadedAt.toISOString() })),
  };
}

/** The staff form for a stall, on its own coupon — found, or issued now. */
export async function staffFormView(
  db: PrismaClient,
  requestId: string,
  by: AuditActor,
): Promise<CouponView & { couponCode: string }> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: { edition: { select: { year: true } } },
  });
  if (!r) throw new UnknownRequestError(requestId);
  const coupon = await ensureCoupon(db, r.id, r.stallName, r.edition.year, by);
  const { resolveCoupon } = await import('./onboarding');
  const { request } = await resolveCoupon(db, coupon.code);
  return { ...(await toCouponView(db, request, coupon)), couponCode: coupon.code };
}
```

(`ensureCoupon` accepts `string | AuditActor` since Phase 1 Task 4. Replace the dynamic `import('./onboarding')` with a static import of `resolveCoupon` — it is written inline above only to keep the snippet self-contained.)

In `public-routes.ts`, the `GET /fssai/:token` handler body becomes `return fssaiFormView(prisma, link.requestId);` (import from `./filing`; drop the now-unused `publicFormFor`/`declarationsForForm` imports if nothing else uses them).

- [ ] **Step 4: Routes**

In `routes.ts`:

- `/me`: add `requestTypeScope: caller.requestTypeScope` to the returned object.
- `/uploads`: replace the single `requirePrivilege` line with:

```ts
    // The privilege follows the PURPOSE. A display block's picture is part of
    // a form; a template attachment is part of an email; a cheque, PAN, GST or
    // FSSAI document is part of a form filed FOR a requester; an admin-added
    // file question can sit on any of the five filed forms.
    const p = req.body.purpose;
    if (p === 'FORM_NOTE') requirePrivilege(caller, 'config.write');
    else if (p === 'TEMPLATE_ATTACHMENT') requirePrivilege(caller, 'comms.write');
    else if (p === 'FSSAI') requirePrivilege(caller, 'filing.fssai');
    else if (p === 'FORM_FIELD')
      requireAnyPrivilege(caller, ['filing.request', 'filing.bank', 'filing.fssai', 'filing.staff']);
    else requirePrivilege(caller, 'filing.bank');
```

- After the `GET /requests/:id/audit` route, add the filing block:

```ts
  // ── Filing on behalf of a requester ──────────────────────────────────────
  // The same five writes the requester has, with a member as actor. Each is
  // gated on its own privilege, then on scope; the SEAM validates, once.
  //
  // ⚠️ `/requests/file/lookup` is declared before `/requests/:id/*` would
  // swallow it — Fastify matches static segments first, but keep them together.

  zod.get('/requests/file/lookup', { schema: { querystring: RequesterLookupQuery } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.request');
    const edition = await activeEditionFor(prisma, caller);
    return lookupRequester(prisma, edition.id, req.query.contact);
  });

  zod.post('/requests/file', { schema: { body: FileRequestInput } }, async (req, reply): Promise<FileRequestResponse> => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.request');
    await activeEditionFor(prisma, caller);
    reply.status(201);
    return fileRequest(prisma, { mail: deps.mail, whatsapp: deps.whatsapp, statusUrl: deps.statusUrl }, caller, req.body);
  });

  const filingFor = (caller: Parameters<typeof onBehalfOf>[0], accountId: string) =>
    onBehalfOf({ personId: caller.personId, displayName: caller.displayName }, accountId);

  /** The request's account, for `onBehalfOf`. 404 through the same error the
   *  route's own lookup would raise. */
  const accountOf = async (id: string) => {
    const r = await prisma.stallRequest.findUnique({ where: { id }, select: { accountId: true } });
    if (!r) throw new UnknownRequestError(id);
    return r.accountId;
  };

  zod.get('/requests/:id/bank-form', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.bank');
    await requireRequestScope(caller, prisma, req.params.id);
    return getBankForm(prisma, req.params.id);
  });

  zod.post('/requests/:id/bank', { schema: { params: IdParams, body: FileBankInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.bank');
    await requireRequestScope(caller, prisma, req.params.id);
    const { attestation: _, ...body } = req.body;
    await submitBankDetails(prisma, req.params.id, body, filingFor(caller, await accountOf(req.params.id)));
    reply.status(204);
  });

  zod.get('/requests/:id/fssai-form', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.fssai');
    await requireRequestScope(caller, prisma, req.params.id);
    return fssaiFormView(prisma, req.params.id);
  });

  zod.post('/requests/:id/fssai', { schema: { params: IdParams, body: FileFssaiInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.fssai');
    await requireRequestScope(caller, prisma, req.params.id);
    if (!req.body.files.every((f) => isOurKey(f.key, 'FSSAI'))) throw new UnknownAccessLinkError();
    const { attestation: _, ...body } = req.body;
    await onboarding.submitFssai(prisma, req.params.id, body, filingFor(caller, await accountOf(req.params.id)));
    reply.status(204);
  });

  zod.get('/requests/:id/staff-form', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.staff');
    await requireRequestScope(caller, prisma, req.params.id);
    return staffFormView(prisma, req.params.id, { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName });
  });

  zod.post('/requests/:id/staff', { schema: { params: IdParams, body: FileStaffInput } }, async (req, reply): Promise<CouponView> => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.staff');
    await requireRequestScope(caller, prisma, req.params.id);
    const accountId = await accountOf(req.params.id);
    const { couponCode } = await staffFormView(prisma, req.params.id, { kind: 'BACKOFFICE', personId: caller.personId, name: caller.displayName });
    const { attestation: _, ...body } = req.body;
    reply.status(201);
    return onboarding.registerStaff(prisma, { ...body, couponCode }, filingFor(caller, accountId));
  });

  zod.post('/requests/:id/payment-claim', { schema: { params: IdParams, body: FileClaimInput } }, async (req, reply): Promise<PaymentClaimView> => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.claim');
    await requireRequestScope(caller, prisma, req.params.id);
    reply.status(201);
    return paymentClaims.submitPaymentClaim(prisma, req.params.id, req.body, filingFor(caller, await accountOf(req.params.id)));
  });
```

Imports to add in `routes.ts`: `FileBankInput, FileClaimInput, FileFssaiInput, FileRequestInput, type FileRequestResponse, RequesterLookupQuery, type CouponView, type PaymentClaimView` from `@stalls/core`; `onBehalfOf` from `./audit`; `getBankForm, submitBankDetails` from `./bank`; `fileRequest, fssaiFormView, lookupRequester, staffFormView` from `./filing`; `isOurKey` from `./uploads`; `UnknownAccessLinkError` from `./errors`.

- [ ] **Step 5: Run**

Run: `npm test --workspace=apps/api -- filing public-forms phase2-routes onboarding`
Expected: PASS. Then `npm test --workspace=apps/api && npm run typecheck && npm run lint:boundaries`.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api/src apps/api/test
git commit -m "feat(stalls): a member files any of the five forms for a requester, on their own privilege

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The forms split into a body and a wrapper

**Files:**
- Modify: `apps/web/src/modules/stalls/api.ts`
- Create: `apps/web/src/modules/stalls/components/Attestation.tsx`
- Modify: `apps/web/src/modules/stalls/public/RequestForm.tsx`, `BankForm.tsx`, `FssaiForm.tsx`, `StaffRegistration.tsx`, `PaymentClaim.tsx`

**Interfaces:**
- Produces (web `api.ts`): `lookupRequester(contact)`, `fileRequest(body)`, `getBankFormFor(id)`, `fileBank(id, body)`, `getFssaiFormFor(id)`, `fileFssai(id, body)`, `getStaffFormFor(id)`, `fileStaff(id, body)`, `fileClaim(id, body)`.
- Produces (components):
  ```tsx
  // RequestForm.tsx
  export function RequestFormBody(props: {
    type: StallRequestType;
    requester: { displayName: string; email: string; phone: string };
    /** Receives the parsed SubmitRequestInput; throw an ApiError to put field errors back. */
    submit: (input: SubmitRequestInput) => Promise<void>;
    submitLabel?: string;            // default 'Submit request'
    /** Drawn above the submit rail, beside the declarations — the attestation. */
    beforeSubmit?: ReactNode;
    /** When false the submit is disabled even with every declaration ticked. */
    ready?: boolean;                 // default true
  }): JSX.Element;
  // BankForm.tsx
  export function BankFormBody(props: { data: BankFormView; presign: (i: PresignUploadInput) => Promise<PresignUploadResponse>; submit: (body: SubmitBankDetailsInput) => Promise<void>; submitLabel?: string; beforeSubmit?: ReactNode; ready?: boolean; onDone?: () => void }): JSX.Element;
  // FssaiForm.tsx
  export function FssaiFormBody(props: { data: FssaiFormView; presign; submit: (body: SubmitFssaiInput) => Promise<void>; submitLabel?; beforeSubmit?; ready?; onDone? }): JSX.Element;
  // StaffRegistration.tsx
  export function StaffFormBody(props: { coupon: CouponView; submit: (body: Omit<RegisterStaffInput, 'couponCode'>) => Promise<CouponView>; submitLabel?; beforeSubmit?; ready?; onRegistered?: (next: CouponView) => void }): JSX.Element;
  // PaymentClaim.tsx
  PaymentClaimDialog gains `submit?: (input: Omit<SubmitPaymentClaimInput, 'reference'>) => Promise<unknown>` and `title?`, `submitLabel?`.
  // components/Attestation.tsx
  export function Attestation({ checked, onChange, requesterName }: { checked: boolean; onChange: (v: boolean) => void; requesterName: string }): JSX.Element;
  ```

- [ ] **Step 1: API client**

In `api.ts` add (imports from `@stalls/core`: `FileBankInput, FileClaimInput, FileFssaiInput, FileRequestInput, FileRequestResponse, FileStaffInput, RequesterLookupResponse`):

```ts
// ── Backoffice: filing on behalf of a requester ─────────────────────────────
//
// The same five writes the requester has, from the backoffice. Each answers
// with what the requester's own call answers, minus anything that is a way
// in: `fileRequest` returns a reference and never a token.

export const lookupRequester = (contact: string) =>
  apiFetch<RequesterLookupResponse>(`${BASE}/requests/file/lookup${qs({ contact })}`);
export const fileRequest = (body: FileRequestInput) =>
  apiFetch<FileRequestResponse>(`${BASE}/requests/file`, { method: 'POST', json: body });
export const getBankFormFor = (id: string) => apiFetch<BankFormView>(`${BASE}/requests/${id}/bank-form`);
export const fileBank = (id: string, body: FileBankInput) =>
  apiFetch<void>(`${BASE}/requests/${id}/bank`, { method: 'POST', json: body });
export const getFssaiFormFor = (id: string) => apiFetch<FssaiFormView>(`${BASE}/requests/${id}/fssai-form`);
export const fileFssai = (id: string, body: FileFssaiInput) =>
  apiFetch<void>(`${BASE}/requests/${id}/fssai`, { method: 'POST', json: body });
export const getStaffFormFor = (id: string) =>
  apiFetch<CouponView & { couponCode: string }>(`${BASE}/requests/${id}/staff-form`);
export const fileStaff = (id: string, body: FileStaffInput) =>
  apiFetch<CouponView>(`${BASE}/requests/${id}/staff`, { method: 'POST', json: body });
export const fileClaim = (id: string, body: FileClaimInput) =>
  apiFetch<PaymentClaimView>(`${BASE}/requests/${id}/payment-claim`, { method: 'POST', json: body });
```

- [ ] **Step 2: The attestation**

```tsx
// apps/web/src/modules/stalls/components/Attestation.tsx
import { Checkbox } from '../ui';

/**
 * The filer's word, in place of the requester's tick.
 *
 * 🔴 Declarations are never skipped on a form filed for somebody. The member
 * sees the same wording the requester would and attests to having read it
 * out; the consent rows then carry `attestedBy`, and the request's record
 * says a desk ticked them. One box, one sentence, always the same sentence.
 */
export function Attestation({
  checked,
  onChange,
  requesterName,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  requesterName: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
        padding: '12px 14px',
        borderRadius: 'var(--r2)',
        border: '1px solid var(--warn-b)',
        background: 'var(--warn-t)',
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>Filing for {requesterName}</div>
      <Checkbox
        id='attestation'
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        label='I read these declarations to the requester and they agreed.'
      />
    </div>
  );
}
```

(Check `Checkbox`'s props in `ui/components/Form.tsx` — it takes `label`, `checked`, `onChange`; if it takes `onChange(v: boolean)` instead, pass `onChange` straight through.)

- [ ] **Step 3: `RequestForm.tsx`**

Rename the inner `Form` to `RequestFormBody`, export it, and change its props from `{ type, requester: RequesterSession }` to the interface above. Inside:
- `requester.displayName / email / phone` are read exactly as before (the session had the same three fields).
- Replace `const r = await submitRequest(parsed.data); navigate('/stalls/submitted', …)` with `await submit(parsed.data);` — the wrapper navigates.
- The submit button reads `submitLabel ?? 'Submit request'` and is disabled when `submitting || !consented || ready === false`.
- Render `beforeSubmit` inside the `<div style={{ padding: '0 18px' }}>` that holds `DeclarationConsent`, after it.

The public wrapper keeps its guards and becomes:

```tsx
export function RequestForm({ type }: { type: StallRequestType }) {
  const { requester, status } = useRequester();
  const navigate = useNavigate();
  if (status === 'loading') return <Loading />;
  if (!requester) return <Navigate to='/stalls/apply' replace />;
  if (requester.requesterType && requester.requesterType !== type) {
    return <Navigate to='/stalls/apply' replace />;
  }
  return (
    <RequestFormBody
      type={type}
      requester={requester}
      submit={async (input) => {
        const r = await submitRequest(input);
        navigate('/stalls/submitted', { state: { ...r, type }, replace: true });
      }}
    />
  );
}
```

`useNavigate` moves from the body to the wrapper. Run `npm test --workspace=apps/web -- RequestForm` — the existing tests drive the wrapper and must still pass unchanged.

- [ ] **Step 4: `BankForm.tsx`**

Split at the data boundary. `BankForm()` keeps: `useParams`, `useLoad(getBankForm)`, the loading/error/`submittedAt` states, and renders `<BankFormBody data={data} presign={presignPublicUpload(token)} submit={(body) => submitBankDetails(token, body)} onDone={() => setDone(true)} />` — with the "Thank you" card shown when `done || data.submittedAt`, as today. Everything from `const [values, setValues]` down to the closing of the return moves into `BankFormBody({ data, presign, submit, submitLabel = 'Submit', beforeSubmit, ready: readyProp = true, onDone })`; its `submit` handler calls `await submit({...body})` then `onDone?.()`; its `Btn` reads `submitLabel` and is disabled when `!ready || readyProp === false || busy`; `beforeSubmit` renders inside the last `Card` above the `Btn`. `reload` on a non-field error is dropped from the body (the wrapper owns loading); leave `toast.fail(e)`.

- [ ] **Step 5: `FssaiForm.tsx`**

Same split: `FssaiForm()` keeps `useParams`, `useLoad(getFssaiForm)`, loading/error, the H1, and the `done` card; `FssaiFormBody({ data, presign, submit, submitLabel = 'Submit', beforeSubmit, ready = true, onDone })` owns the fields, the file list, the appended fields, the declarations and the button. The wrapper passes `submit={(body) => submitFssai(token, body)}` and `onDone={() => { setDone(true); reload(); }}`.

- [ ] **Step 6: `StaffRegistration.tsx`**

Extract the `<Card>` that holds the name/mobile/ID/role/appended/declarations/Register button into `StaffFormBody({ coupon, submit, submitLabel = 'Register', beforeSubmit, ready = true, onRegistered })`. Its `submit` handler builds the body WITHOUT `couponCode`, calls `const next = await submit(body)`, clears the fields exactly as today, and calls `onRegistered?.(next)`. The page renders `<StaffFormBody coupon={coupon} submit={(body) => registerStaff({ ...body, couponCode: code.trim() })} onRegistered={setCoupon} />` in place of the extracted card, and keeps the `full` check outside it.

- [ ] **Step 7: `PaymentClaim.tsx`**

`PaymentClaimDialog` gains `submit?`, `title?`, `submitLabel?`. Its internal `submit` calls `(submitProp ?? ((input) => submitPaymentClaim({ reference, ...input })))(input)`, where `input` no longer carries `reference`. `title ?? 'Report a transfer'`, `submitLabel ?? 'Report It'`. `reference` stays a prop for the default path.

- [ ] **Step 8: Run**

Run: `npm test --workspace=apps/web && npm run typecheck --workspace=apps/web && npm run check`
Expected: PASS — the public tests exercise the wrappers and see no change.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/src/modules/stalls
git commit -m "refactor(stalls): each requester form is a body the backoffice can draw too, behind its public wrapper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: File a request

**Files:**
- Create: `apps/web/src/modules/stalls/backoffice/FileRequest.tsx`
- Create: `apps/web/src/modules/stalls/backoffice/FileRequest.test.tsx`
- Modify: `apps/web/src/modules/stalls/backoffice/Requests.tsx`, `apps/web/src/modules/stalls/index.tsx`

- [ ] **Step 1: Failing tests**

```tsx
// apps/web/src/modules/stalls/backoffice/FileRequest.test.tsx
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installFetch, ME_LEAD, PUBLIC_CONFIG, renderAt } from '../test-utils';
import { FileRequest } from './FileRequest';
import { RequestDetail } from './RequestDetail';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = [
  { path: '/m/stalls/requests/new', element: <FileRequest /> },
  { path: '/m/stalls/requests/:id', element: <RequestDetail /> },
];

const ME_LW = {
  ...ME_LEAD,
  privileges: ['requests.read', 'filing.request', 'filing.staff'],
  requestTypeScope: ['LOCAL_WELFARE'],
};

const base = (me = ME_LEAD) =>
  [
    ['GET', /\/me$/, () => me],
    ['GET', /\/public\/config$/, () => PUBLIC_CONFIG],
    [
      'GET',
      /\/requests\/file\/lookup$/,
      (url: URL) =>
        url.searchParams.get('contact') === '9840012345'
          ? { match: { accountId: 'acc-1', displayName: 'Kumar Stores', email: '', phone: '9840012345', requesterType: 'LOCAL_WELFARE', requestCount: 2 } }
          : { match: null },
    ],
    ['POST', /\/requests\/file$/, () => [201, { requestId: '22222222-2222-4222-8222-222222222222', reference: 'LWS-2026-0009', accountId: 'acc-1', accountCreated: false }]],
    ['GET', /\/requests\/[^/]+$/, () => ({})],
    ['GET', /\/onboarding\/[^/]+$/, () => ({})],
  ] as Array<[string, RegExp, (url: URL) => unknown]>;

describe('FileRequest', () => {
  test('offers only the forms inside the caller’s scope', async () => {
    installFetch(base(ME_LW));
    renderAt('/m/stalls/requests/new', routes, { me: true });
    expect(await screen.findByRole('button', { name: /Local Welfare/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /External food and retail vendors/ })).not.toBeInTheDocument();
  });

  test('a known contact names the account and its requests before the form opens', async () => {
    installFetch(base(ME_LW));
    const user = userEvent.setup();
    renderAt('/m/stalls/requests/new', routes, { me: true });
    await user.click(await screen.findByRole('button', { name: /Local Welfare/ }));
    await user.type(screen.getByLabelText('Mobile Number'), '9840012345');
    expect(await screen.findByText(/Kumar Stores/)).toBeInTheDocument();
    expect(screen.getByText(/2 requests/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /File on Their Behalf/ })).toBeDisabled();
  });

  test('a new contact needs a name and one contact, and the form then says who it is for', async () => {
    installFetch(base());
    const user = userEvent.setup();
    renderAt('/m/stalls/requests/new', routes, { me: true });
    await user.click(await screen.findByRole('button', { name: /External food and retail vendors/ }));
    const next = screen.getByRole('button', { name: 'Open the Form' });
    expect(next).toBeDisabled();
    await user.type(screen.getByLabelText('Requester Name'), 'Priya Venkat');
    await user.type(screen.getByLabelText('Email'), 'priya@example.org');
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    expect(await screen.findByText(/Filing for Priya Venkat/)).toBeInTheDocument();
    expect(screen.getByLabelText(/I read these declarations/)).toBeInTheDocument();
  });
});
```

Run: `npm test --workspace=apps/web -- FileRequest`
Expected: FAIL — module missing.

- [ ] **Step 2: The page**

```tsx
// apps/web/src/modules/stalls/backoffice/FileRequest.tsx
import {
  type FileRequestResponse,
  PLACEHOLDER_EMAIL_DOMAIN,
  type RequesterLookupResponse,
  type StallRequestType,
  type SubmitRequestInput,
  canReach,
  parseContact,
} from '@stalls/core';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { fileRequest, lookupRequester } from '../api';
import { Attestation } from '../components/Attestation';
import { useDebounced } from '../hooks';
import { useMe } from '../me';
import { REQUEST_FORMS } from '../public/request-forms';
import { RequestFormBody } from '../public/RequestForm';
import { Btn, Card, FormField, H1, Icon, Input, NavTileCard, Tag, useToast } from '../ui';

/**
 * A member files a stall request for somebody who cannot.
 *
 * Three steps, one page: which form, who it is for, then the form itself —
 * the SAME form body the requester would fill, so a question added on the
 * Form Builder is asked here too, and the API refuses the same things.
 *
 * ⚠️ Only the forms inside the caller's scope are offered. A Local Welfare
 * member sees one tile; the API would refuse the other two anyway, and a tile
 * that opens a form the server will not take is a page of typing wasted.
 *
 * ⚠️ The requester step decides WHOSE request this is, and says so before the
 * form opens: a known contact shows the account and how many requests it
 * already holds, because attaching to the wrong vendor is the failure a desk
 * cannot see afterwards.
 */
type Step = 'type' | 'requester' | 'form';

export function FileRequest() {
  const { me, can } = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const [type, setType] = useState<StallRequestType | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [attested, setAttested] = useState(false);
  const [step, setStep] = useState<Step>('type');

  const scope = me?.requestTypeScope ?? null;
  const forms = REQUEST_FORMS.filter((f) => canReach(scope, f.type));

  // One lookup per settled contact, so a number typed digit by digit is not
  // ten requests. Either contact may name the account; both are looked up.
  const settledEmail = useDebounced(email);
  const settledPhone = useDebounced(phone);
  const [byEmail, setByEmail] = useState<RequesterLookupResponse['match']>(null);
  const [byPhone, setByPhone] = useState<RequesterLookupResponse['match']>(null);
  useEffect(() => {
    const c = parseContact(settledEmail);
    if (!c) return void setByEmail(null);
    lookupRequester(settledEmail).then((r) => setByEmail(r.match)).catch(() => setByEmail(null));
  }, [settledEmail]);
  useEffect(() => {
    const c = parseContact(settledPhone);
    if (!c) return void setByPhone(null);
    lookupRequester(settledPhone).then((r) => setByPhone(r.match)).catch(() => setByPhone(null));
  }, [settledPhone]);

  const match = byEmail ?? byPhone;
  const ambiguous = !!byEmail && !!byPhone && byEmail.accountId !== byPhone.accountId;
  const wrongType = !!match?.requesterType && !!type && match.requesterType !== type;
  const hasContact = !!parseContact(email) || !!parseContact(phone);
  const name = match?.displayName ?? displayName.trim();
  const canOpen = !!type && hasContact && !!name && !ambiguous && !wrongType;

  if (!can('filing.request')) {
    return <Card pad={18}>Your role does not file requests for requesters.</Card>;
  }

  const submit = async (input: SubmitRequestInput) => {
    const r: FileRequestResponse = await fileRequest({
      requester: { displayName: name, email: email.trim() || undefined, phone: phone.trim() || undefined },
      request: input,
      attestation: true,
    });
    toast.ok(`${r.reference} filed for ${name}. The receipt has gone to their contact.`);
    navigate(`/m/stalls/requests/${r.requestId}`, { replace: true });
  };

  return (
    <div>
      <Link to='/m/stalls/requests' style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 12.5, fontWeight: 600, color: 'var(--mfg)', textDecoration: 'none' }}>
        <Icon name='chevron-left' size={14} />
        All Requests
      </Link>
      <H1 icon={<Icon name='clipboard-list' size={18} />} sub='For a vendor, department or trader who cannot fill the form themselves. They receive the receipt; you see the record.'>
        File a Request
      </H1>

      {step === 'type' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))' }}>
          {forms.map((f) => (
            <button key={f.type} type='button' onClick={() => { setType(f.type); setStep('requester'); }} style={{ all: 'unset', cursor: 'pointer' }}>
              <NavTileCard item={{ label: f.who, sub: f.whoTa ?? undefined, glyph: f.glyph, tint: f.tint }} />
            </button>
          ))}
        </div>
      )}

      {step === 'requester' && type && (
        <Card pad={18} style={{ display: 'grid', gap: 14, maxWidth: 620 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Who is this for?</div>
          <FormField id='req-phone' label='Mobile Number' help='Either contact is enough. A trader with no email address is filed on their number.'>
            <Input id='req-phone' type='tel' inputMode='tel' value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>
          <FormField id='req-email' label='Email'>
            <Input id='req-email' type='email' value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          {match && !ambiguous && (
            <div style={{ display: 'grid', gap: 4, padding: '10px 12px', borderRadius: 'var(--r2)', background: 'var(--ok-t)', border: '1px solid var(--ok-b)', fontSize: 12.5 }}>
              <div><Icon name='user' size={12} /> This is <strong>{match.displayName}</strong> · {match.requestCount} request{match.requestCount === 1 ? '' : 's'} this edition.</div>
              {wrongType && <Tag tone='des' size='sm'>Registered for the {match.requesterType} form — this one will be refused.</Tag>}
            </div>
          )}
          {ambiguous && byEmail && byPhone && (
            <Tag tone='des'>That email belongs to {byEmail.displayName} and that number to {byPhone.displayName}. File with one contact or the other.</Tag>
          )}
          {!match && (
            <FormField id='req-name' label='Requester Name' required>
              <Input id='req-name' value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </FormField>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={() => setStep('type')}>Back</Btn>
            <Btn kind='primary' disabled={!canOpen} onClick={() => setStep('form')}>
              <Icon name='chevron-right' size={14} />
              Open the Form
            </Btn>
          </div>
        </Card>
      )}

      {step === 'form' && type && (
        <RequestFormBody
          type={type}
          requester={{
            displayName: name,
            // A phone-only requester carries the placeholder address the account
            // will carry, so the form's required email question is answered the
            // way the API expects. The member can overwrite it.
            email: email.trim() || (phone.trim() ? `mobile+${parseContact(phone)?.value ?? phone.trim()}@${PLACEHOLDER_EMAIL_DOMAIN}` : ''),
            phone: parseContact(phone)?.value ?? '',
          }}
          submit={submit}
          submitLabel='File on Their Behalf'
          ready={attested}
          beforeSubmit={<Attestation checked={attested} onChange={setAttested} requesterName={name} />}
        />
      )}
    </div>
  );
}
```

(Check `NavTileCard`'s `item` shape in `ui/components/NavTileCard.tsx` and adapt the tile; a plain `Card` with the glyph, `who` and `whoTa` is fine if it does not fit.)

- [ ] **Step 3: Route and button**

`index.tsx`: import `FileRequest` and add `{ path: 'requests/new', element: <FileRequest /> },` BEFORE `{ path: 'requests/:id', … }`.

`Requests.tsx`: import `useMe` and `Link`; in the `H1`'s `actions`, first:

```tsx
            {can('filing.request') && (
              <Link to='/m/stalls/requests/new' style={{ textDecoration: 'none' }}>
                <Btn kind='primary'>
                  <Icon name='plus' size={14} />
                  File a Request
                </Btn>
              </Link>
            )}
```

with `const { can } = useMe();` in the component.

- [ ] **Step 4: Run**

Run: `npm test --workspace=apps/web -- FileRequest Requests.test && npm run typecheck --workspace=apps/web && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/modules/stalls
git commit -m "feat(stalls): File a Request — which form, who for, then the requester’s own form

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: On their behalf, from the record

**Files:**
- Create: `apps/web/src/modules/stalls/backoffice/FileForRequester.tsx`
- Modify: `apps/web/src/modules/stalls/backoffice/RequestDetail.tsx`, `apps/web/src/modules/stalls/backoffice/Requests.test.tsx`

- [ ] **Step 1: Failing tests**

In `Requests.test.tsx`, add stubs to `base()`: `['GET', /\/requests\/[^/]+\/fssai-form$/, () => ({ reference: 'VEN-2026-0001', stallName: 'Green Leaf Organics', requesterName: 'Priya Venkat', uploadedAt: null, verifiedAt: null, files: [], form: null, declarations: [] })]` and `['POST', /\/requests\/[^/]+\/payment-claim$/, () => [201, { id: 'c1', purpose: 'RENT', status: 'PENDING', referenceNo: 'UTR1', amountPaise: 100, paidOn: '2026-09-01', remitterName: null, note: null, submittedAt: '2026-09-17T00:00:00Z', reviewedAt: null, rejectReason: null, hasReceipt: false }]]`. Then:

```tsx
describe('RequestDetail › on their behalf', () => {
  test('the FSSAI tab offers to upload for the vendor while it is outstanding', async () => {
    installFetch(base());
    const user = userEvent.setup();
    renderAt('/m/stalls/requests/22222222-2222-4222-8222-222222222222', routes, { me: true });
    await user.click(await screen.findByRole('tab', { name: /FSSAI/ }));
    await user.click(screen.getByRole('button', { name: 'Enter on Their Behalf' }));
    expect(await screen.findByText(/Filing for Priya Venkat/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File on Their Behalf' })).toBeDisabled();
  });

  test('a transfer the requester reported is recorded through the filing route', async () => {
    const fx = installFetch(base());
    const user = userEvent.setup();
    renderAt('/m/stalls/requests/22222222-2222-4222-8222-222222222222', routes, { me: true });
    await user.click(await screen.findByRole('button', { name: /Record a Transfer They Reported/ }));
    await user.type(screen.getByLabelText(/UTR or reference number/), 'UTR1');
    await user.type(screen.getByLabelText(/Amount transferred/), '1');
    await user.type(screen.getByLabelText(/Date of transfer/), '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Record It' }));
    await waitFor(() => expect(fx.calls.some((c) => c.method === 'POST' && c.url.endsWith('/payment-claim'))).toBe(true));
    expect(fx.last().body).not.toHaveProperty('reference');
  });

  test('without the privileges nothing is offered', async () => {
    installFetch([
      ['GET', /\/me$/, () => ({ ...ME_LEAD, privileges: ME_LEAD.privileges.filter((p) => !p.startsWith('filing.')) })],
      ...base().slice(1),
    ]);
    renderAt('/m/stalls/requests/22222222-2222-4222-8222-222222222222', routes, { me: true });
    await screen.findByRole('tab', { name: /Application/ });
    expect(screen.queryByRole('button', { name: /Record a Transfer They Reported/ })).not.toBeInTheDocument();
  });
});
```

(The `onboarding()` fixture's `fssai` must be `'PENDING'` and its request `status` `'SELECTED'` for the FSSAI tab and the claim button to draw; check the fixture and pass `onboarding({ fssai: 'PENDING' })` / `detail({ status: 'SELECTED' })` in these stubs if the defaults differ.)

Run: `npm test --workspace=apps/web -- Requests.test`
Expected: FAIL.

- [ ] **Step 2: The dialogs**

```tsx
// apps/web/src/modules/stalls/backoffice/FileForRequester.tsx
import type { RequestDetail as Detail } from '@stalls/core';
import { useState } from 'react';
import * as api from '../api';
import { Attestation } from '../components/Attestation';
import { useLoad } from '../hooks';
import { BankFormBody } from '../public/BankForm';
import { FssaiFormBody } from '../public/FssaiForm';
import { PaymentClaimDialog } from '../public/PaymentClaim';
import { StaffFormBody } from '../public/StaffRegistration';
import { Dialog, ErrorBox, Loading } from '../ui';

/**
 * The four requester forms, opened from the record and filed by a member.
 *
 * Each dialog loads the same view the requester's page loads, draws the same
 * body, and posts to the filing route for this request. The attestation sits
 * above the submit and gates it; the button never reads "Submit".
 */
export type OnBehalf = 'bank' | 'fssai' | 'staff' | 'claim';

export function FileForRequester({
  r,
  which,
  onClose,
  onDone,
}: {
  r: Detail;
  which: OnBehalf;
  onClose: () => void;
  onDone: () => void;
}) {
  const [attested, setAttested] = useState(false);
  const attestation = <Attestation checked={attested} onChange={setAttested} requesterName={r.requesterName} />;
  const done = () => {
    onDone();
    onClose();
  };

  if (which === 'claim') {
    return (
      <PaymentClaimDialog
        reference={r.reference}
        payment={null}
        title={`Record a transfer ${r.requesterName} reported`}
        submitLabel='Record It'
        submit={(input) => api.fileClaim(r.id, input)}
        onClose={onClose}
        onSubmitted={onDone}
      />
    );
  }

  const title =
    which === 'bank' ? 'Bank Details & Requirements' : which === 'fssai' ? 'FSSAI Certificate' : 'Stall Staff Registration';

  return (
    <Dialog title={`${title} — for ${r.requesterName}`} onClose={onClose} width={760}>
      {which === 'bank' && <Bank r={r} attested={attested} attestation={attestation} onDone={done} />}
      {which === 'fssai' && <Fssai r={r} attested={attested} attestation={attestation} onDone={done} />}
      {which === 'staff' && <Staff r={r} attested={attested} attestation={attestation} onDone={onDone} />}
    </Dialog>
  );
}

type Inner = { r: Detail; attested: boolean; attestation: React.ReactNode; onDone: () => void };

function Bank({ r, attested, attestation, onDone }: Inner) {
  const { data, error, loading } = useLoad(() => api.getBankFormFor(r.id), [r.id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the form.'}</ErrorBox>;
  return (
    <BankFormBody
      data={data}
      presign={api.presignBackofficeUpload}
      submit={(body) => api.fileBank(r.id, { ...body, attestation: true })}
      submitLabel='File on Their Behalf'
      ready={attested}
      beforeSubmit={attestation}
      onDone={onDone}
    />
  );
}

function Fssai({ r, attested, attestation, onDone }: Inner) {
  const { data, error, loading } = useLoad(() => api.getFssaiFormFor(r.id), [r.id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the form.'}</ErrorBox>;
  return (
    <FssaiFormBody
      data={data}
      presign={api.presignBackofficeUpload}
      submit={(body) => api.fileFssai(r.id, { ...body, attestation: true })}
      submitLabel='File on Their Behalf'
      ready={attested}
      beforeSubmit={attestation}
      onDone={onDone}
    />
  );
}

function Staff({ r, attested, attestation, onDone }: Inner) {
  const { data, error, loading, setData } = useLoad(() => api.getStaffFormFor(r.id), [r.id]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox>{error?.message ?? 'Could not load the form.'}</ErrorBox>;
  return (
    <StaffFormBody
      coupon={data}
      submit={(body) => api.fileStaff(r.id, { ...body, attestation: true })}
      submitLabel='File on Their Behalf'
      ready={attested}
      beforeSubmit={attestation}
      onRegistered={(next) => {
        setData({ ...data, ...next });
        onDone();
      }}
    />
  );
}
```

- [ ] **Step 3: Wire it into `RequestDetail`**

- Import `FileForRequester, type OnBehalf`; add `const [filing, setFiling] = useState<OnBehalf | null>(null);` and include `filing === null` in the `useEscape` gate.
- Bank tab: `BankPanel` gains `action?: ReactNode`, drawn at the top of its `Section` when `bank` is null. Pass from the parent: `forms?.bankDetails === 'PENDING' && can('filing.bank') ? <Btn onClick={() => setFiling('bank')}><Icon name='pencil' size={13} /> Enter on Their Behalf</Btn> : null`.
- FSSAI tab: same, when `forms?.fssai === 'PENDING' && can('filing.fssai')`.
- Staff tab: when `can('filing.staff') && r.status === 'SELECTED'`, the button reads `Register Staff on Their Behalf`.
- Payment: in the action rail, after Amend, when `r.status === 'SELECTED' && can('filing.claim') && (r.requestType === 'VENDOR' || r.requestType === 'LOCAL_WELFARE')`:

```tsx
            <Btn disabled={busy} onClick={() => setFiling('claim')}>
              <Icon name='rupee' size={14} />
              Record a Transfer They Reported
            </Btn>
```

- At the bottom, beside the other dialogs:

```tsx
      {r && filing && (
        <FileForRequester
          r={r}
          which={filing}
          onClose={() => setFiling(null)}
          onDone={() => {
            reload();
            forms.reload();
            activity.reload();
          }}
        />
      )}
```

(`forms` is the `useLoad(getOnboarding)` result — rename its destructure from `{ data: forms }` to `const formsLoad = useLoad(...)` with `const forms = formsLoad.data` so `formsLoad.reload()` is reachable, or keep `forms` for the data and call the load object's `reload`.)

- [ ] **Step 4: Run**

Run: `npm test --workspace=apps/web && npm run typecheck --workspace=apps/web && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/modules/stalls
git commit -m "feat(stalls): the bank form, FSSAI, staff and a reported transfer, filed from the record on the requester’s behalf

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The words

**Files:**
- Modify: `README.md`, `docs/requirements-traceability.md`, the spec, `apps/web/src/modules/stalls/backoffice/Documentation.tsx` (if it lists backoffice screens by route, add File a Request under Requests; the privilege table updates itself)

- [ ] **Step 1: README**

Under "Decisions worth knowing", replace the bullet beginning **A role may be scoped to a requester type** with one that adds the filing sentence, and add:

```markdown
- **A backoffice member can file any requester form, and it is always
  recorded as filed FOR somebody.** Five `filing.*` privileges, one per form,
  in a category of their own; the same submit functions the public routes
  call, with the member as actor and the account as `onBehalfOfAccountId`; the
  declarations attested rather than skipped, with `attestedBy` on the consent
  row. The filer sees the reference and the record — never the token, never
  the link. A phone-only trader gets the placeholder address registration
  already uses, and the receipt goes by WhatsApp.
```

- [ ] **Step 2: Traceability**

In section 1's table, change the row **The local welfare team works inside the application and files on behalf of their traders** to:

```markdown
| The local welfare team works inside the application and files on behalf of their traders | The Local Welfare role, scoped to `LOCAL_WELFARE`, holds `filing.request`, `filing.fssai`, `filing.staff` and `filing.claim`. `POST /requests/file` and the four request-addressed filing routes (`apps/api/src/modules/stalls/filing.ts`, `routes.ts`); `FileRequest.tsx` and `FileForRequester.tsx`. Every filing is recorded with the member as actor and the trader's account as on-behalf-of. | Built |
```

Add to section 10 (Audit): `| A form filed by a member names both the member and the requester | `onBehalfOfAccountId` on `stall_audit_event`; `attestedBy` on `stall_declaration_consent` | Built |`.

In "What is still NOT self-serve", replace the sentence "backoffice screens remain their only route" with "the backoffice files for them — File a Request, and the on-behalf actions on the record — and the desk can hand them a password (`passwords.write`) if they later get a phone that can open the portal."

- [ ] **Step 3: Spec status**

`Status: Built` in the spec.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run typecheck && npm run check && npm run lint:boundaries`
Expected: all green.

```bash
git add README.md docs apps/web/src/modules/stalls/backoffice/Documentation.tsx
git commit -m "docs(stalls): filing on behalf — who may, what is recorded, what the filer never sees

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
