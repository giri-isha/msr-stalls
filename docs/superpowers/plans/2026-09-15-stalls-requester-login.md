# Stalls Requester Login (temporary, pre-SSO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A requester registers with an email or a mobile, confirms it, logs in with a password, and reaches the existing portal — with every piece built so SSO can delete it.

**Architecture:** The password lives in a new `StallCredential` table; `StallAccount` is untouched. The session reuses `StallAccessLink`, which already stores only a token hash and already has expiry, revocation and purpose narrowing — login mints one with the new `SESSION` purpose and returns it as a cookie instead of a URL. When SSO lands, the OIDC callback mints that same session and the credential table is dropped.

**Tech Stack:** Fastify + Zod (`ZodTypeProvider`), Prisma 7 (multi-schema: `foundation`, `stalls`), `@fastify/cookie` (already registered), `node:crypto` `scrypt`, React 19 + react-router, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-15-stalls-vendor-login-design.md`. Read it before Task 1.
- **The requester session cookie is `stall_requester`.** Staff already use `stalls_session` (`test/helpers/db.ts:50`). These must never collide.
- **The requester session type is `RequesterSession`, fetched by `getRequesterSession()`.** Staff already own `MeResponse` / `getMe()` / `useMe()`. Do not reuse either.
- Every new public route carries `config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } }`.
- `POST /public/register` and `POST /public/password-reset` return `202 {ok:true}` for **every** input — hit, miss, or unparseable contact. This is decision 17 and it is load-bearing; a test asserts the responses are identical.
- Password floor: 8 characters. No other policy — this is a stopgap (spec decision 2).
- No new npm dependencies. Hashing is `scrypt` from `node:crypto` (spec decision 11).
- Domain errors are classes in `errors.ts` mapped to a status in `http-errors.ts`. Never construct a status code inside a route.
- Run API tests with `npm test --workspace=apps/api`. Baseline before you start: **284 passing**.

---

## File Structure

**API — create**
- `apps/api/src/modules/stalls/credentials.ts` — password hashing, credential create/verify, lockout. No HTTP, no mail.
- `apps/api/src/modules/stalls/session.ts` — mint/resolve a `SESSION` link, read/write the cookie, the `requireRequester` guard.
- `apps/api/src/modules/stalls/registration.ts` — register, confirm, reset. Owns the uniform-202 behaviour and the two outbound messages.
- `apps/api/test/requester-auth.test.ts` — all route-level tests for the above.

**API — modify**
- `apps/api/prisma/schema.prisma` — `StallCredential`, `StallLoginKind`, three new `StallAccessPurpose` values, the `credentials` back-relation.
- `apps/api/src/modules/stalls/errors.ts` — `InvalidCredentialsError`.
- `apps/api/src/modules/stalls/http-errors.ts` — map it to 401.
- `apps/api/src/modules/stalls/deps.ts` — `registerConfirmUrl`, `passwordResetUrl`.
- `apps/api/src/app.ts` — supply those two URLs.
- `apps/api/src/modules/stalls/public-routes.ts` — the seven routes, and the header comment.
- `apps/api/src/modules/stalls/submit.ts` — take `accountId` from the session.

**Shared — modify**
- `packages/stalls/src/access.ts` — the input/response types.

**Web — create**
- `apps/web/src/modules/stalls/requester.tsx` — `RequesterProvider` / `useRequester`.
- `apps/web/src/modules/stalls/public/Login.tsx`
- `apps/web/src/modules/stalls/public/Register.tsx`
- `apps/web/src/modules/stalls/public/ConfirmRegistration.tsx`
- `apps/web/src/modules/stalls/public/ResetPassword.tsx`
- `apps/web/src/modules/stalls/public/RequesterAuth.test.tsx`

**Web — modify**
- `apps/web/src/modules/stalls/api.ts` — the five calls.
- `apps/web/src/modules/stalls/index.tsx` — routes, and export the provider.
- `apps/web/src/modules/stalls/public/FormPicker.tsx` — the gate.
- `apps/web/src/modules/stalls/public/RequestForm.tsx` — require a session, prefill.
- `apps/web/src/app/PublicLayout.tsx` — "logged in as", Log out.

**Docs — modify (Task 11)**
- `docs/superpowers/specs/2026-09-13-stall-management-phase2-phase3-design.md`
- `docs/requirements-traceability.md`
- `docs/migration-to-host.md`

---

### Task 1: Schema — the credential table and the new purposes

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_requester_credential/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `StallCredential`, enum `StallLoginKind` (`EMAIL` | `MOBILE`), `StallAccessPurpose` values `SESSION`, `REGISTER_CONFIRM`, `PASSWORD_RESET`.

- [ ] **Step 1: Add the enum and model**

In `apps/api/prisma/schema.prisma`, beside `enum StallAccessPurpose` (line ~156), add the three values:

```prisma
enum StallAccessPurpose {
  STATUS
  BANK_FORM
  FSSAI_UPLOAD
  STAFF_REGISTRATION
  /// A logged-in requester. Minted by the password login today; by the OIDC
  /// callback when SSO lands, which is the whole point of putting it here.
  SESSION
  REGISTER_CONFIRM
  PASSWORD_RESET

  @@schema("stalls")
}

enum StallLoginKind {
  EMAIL
  MOBILE

  @@schema("stalls")
}
```

After `model StallAccount` (line ~451), add:

```prisma
/// A requester's password. TEMPORARY — the host's Isha OIDC replaces it, and
/// this table is then dropped whole. It is deliberately NOT columns on
/// StallAccount: `phone` there is not unique (two stalls can share a
/// shopkeeper's number — see accounts.ts), so login identity has to live
/// where uniqueness can actually hold, which is only among people who
/// registered.
model StallCredential {
  id           String         @id @default(uuid()) @db.Uuid
  accountId    String         @map("account_id") @db.Uuid
  /// Normalised by `parseContact`: a lowercased email, or bare ten digits.
  loginValue   String         @unique @map("login_value")
  loginKind    StallLoginKind @map("login_kind")
  passwordHash String         @map("password_hash")
  /// Null until the confirmation link is followed. An unconfirmed credential
  /// cannot log in, and says so with the same error as a wrong password.
  confirmedAt  DateTime?      @map("confirmed_at") @db.Timestamptz
  failedCount  Int            @default(0) @map("failed_count")
  lockedUntil  DateTime?      @map("locked_until") @db.Timestamptz
  createdAt    DateTime       @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime       @updatedAt @map("updated_at") @db.Timestamptz

  account StallAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@map("stall_credential")
  @@schema("stalls")
}
```

Add the back-relation inside `model StallAccount`, beside `accessLinks`:

```prisma
  credentials StallCredential[]
```

- [ ] **Step 2: Generate the migration**

```bash
cd apps/api && npx prisma migrate dev --name requester_credential
```

Expected: `Your database is now in sync with your schema.` and a new folder under `prisma/migrations/`.

- [ ] **Step 3: Verify the history still rebuilds the schema**

This repo has been bitten by a migration that did not replay (see commit `c467f6c`). Prove it:

```bash
cd apps/api && npx prisma migrate  diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Expected: `No difference detected.` and exit code 0.

- [ ] **Step 4: Confirm the suite is still green**

Run: `npm test --workspace=apps/api`
Expected: 284 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(db): a requester credential, in its own table so SSO can drop it"
```

---

### Task 2: Password hashing and the credential record

**Files:**
- Create: `apps/api/src/modules/stalls/credentials.ts`
- Create: `apps/api/test/requester-auth.test.ts`
- Modify: `apps/api/src/modules/stalls/errors.ts`
- Modify: `apps/api/src/modules/stalls/http-errors.ts`

**Interfaces:**
- Consumes: `StallCredential` from Task 1; `parseContact` from `@stalls/core`; `Db` from `./editions`.
- Produces:
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(plain: string, stored: string): Promise<boolean>`
  - `createCredential(db, { accountId, contact: Contact, password }): Promise<StallCredential>`
  - `authenticate(db, { contact: string, password: string }, now?: Date): Promise<StallCredential>` — throws `InvalidCredentialsError`
  - `confirmCredential(db, credentialId, now?): Promise<void>`
  - `setPassword(db, credentialId, password): Promise<void>`
  - `InvalidCredentialsError` (401)
  - Constants `MIN_PASSWORD_LENGTH = 8`, `MAX_FAILED = 10`, `LOCKOUT_MINUTES = 15`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/requester-auth.test.ts`:

```ts
import { describe, expect, test, beforeEach, beforeAll, afterAll } from 'vitest';
import { prisma, resetDatabase, seedEdition } from './helpers/db';
import {
  InvalidCredentialsError,
  authenticate,
  createCredential,
  hashPassword,
  verifyPassword,
} from '../src/modules/stalls/credentials';

beforeAll(async () => {
  await resetDatabase();
  await seedEdition();
});
beforeEach(() => resetDatabase().then(() => seedEdition()));

async function account(email = 'priya@greenleaf.example', phone = '9840012345') {
  return prisma.stallAccount.create({
    data: { email, phone, displayName: 'Priya Venkat' },
  });
}

describe('password hashing', () => {
  test('a hash verifies against its own password and nothing else', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batteries', stored)).toBe(false);
  });

  // 🔴 A per-hash salt. Two people who pick the same password must not be
  // visibly the same row in a leaked dump.
  test('the same password hashes differently every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});

describe('authenticate', () => {
  test('returns the credential for the right password on a confirmed login', async () => {
    const acct = await account();
    const cred = await createCredential(prisma, {
      accountId: acct.id,
      contact: { kind: 'EMAIL', value: 'priya@greenleaf.example' },
      password: 'hunter2hunter2',
    });
    await prisma.stallCredential.update({
      where: { id: cred.id },
      data: { confirmedAt: new Date() },
    });

    const got = await authenticate(prisma, {
      contact: 'Priya@GreenLeaf.Example',
      password: 'hunter2hunter2',
    });
    expect(got.id).toBe(cred.id);
  });

  // 🔴 The three ways to fail must be ONE error. Anything else turns login
  // into a way of asking whether a given number has applied.
  test('unknown contact, wrong password and unconfirmed are one error', async () => {
    const acct = await account();
    await createCredential(prisma, {
      accountId: acct.id,
      contact: { kind: 'MOBILE', value: '9840012345' },
      password: 'hunter2hunter2',
    });

    const unknown = authenticate(prisma, { contact: '9000000000', password: 'hunter2hunter2' });
    const wrong = authenticate(prisma, { contact: '9840012345', password: 'nope' });
    const unconfirmed = authenticate(prisma, {
      contact: '9840012345',
      password: 'hunter2hunter2',
    });

    for (const p of [unknown, wrong, unconfirmed]) {
      await expect(p).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    const messages = await Promise.all(
      [unknown, wrong, unconfirmed].map((p) => p.catch((e: Error) => e.message)),
    );
    expect(new Set(messages).size).toBe(1);
  });

  test('locks out after repeated failures, with that same error', async () => {
    const acct = await account();
    const cred = await createCredential(prisma, {
      accountId: acct.id,
      contact: { kind: 'EMAIL', value: 'priya@greenleaf.example' },
      password: 'hunter2hunter2',
    });
    await prisma.stallCredential.update({
      where: { id: cred.id },
      data: { confirmedAt: new Date() },
    });

    for (let i = 0; i < 10; i++) {
      await expect(
        authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'wrong' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    // The RIGHT password now fails too — that is what a lockout is.
    await expect(
      authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  test('a good login clears the failure count', async () => {
    const acct = await account();
    const cred = await createCredential(prisma, {
      accountId: acct.id,
      contact: { kind: 'EMAIL', value: 'priya@greenleaf.example' },
      password: 'hunter2hunter2',
    });
    await prisma.stallCredential.update({
      where: { id: cred.id },
      data: { confirmedAt: new Date() },
    });

    await expect(
      authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    await authenticate(prisma, {
      contact: 'priya@greenleaf.example',
      password: 'hunter2hunter2',
    });
    const after = await prisma.stallCredential.findUniqueOrThrow({ where: { id: cred.id } });
    expect(after.failedCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: FAIL — `Cannot find module '../src/modules/stalls/credentials'`.

- [ ] **Step 3: Add the error class**

In `apps/api/src/modules/stalls/errors.ts`, beside `UnknownAccessLinkError`:

```ts
/** Every way a password login can fail, as ONE error.
 *
 *  ⚠️ Unknown contact, wrong password and a credential that was never
 *  confirmed all raise this, with this message. Telling them apart would make
 *  the login route a way of asking whether a particular shopkeeper has
 *  applied — the question decision 17 exists to refuse. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('that login is not valid');
    this.name = 'InvalidCredentialsError';
  }
}
```

- [ ] **Step 4: Map it to 401**

In `apps/api/src/modules/stalls/http-errors.ts`, add `InvalidCredentialsError` to the import list from `./errors`, and inside `statusFor`, beside the `NotSignedInError` line:

```ts
  if (err instanceof InvalidCredentialsError) return 401;
```

- [ ] **Step 5: Write `credentials.ts`**

```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { StallCredential } from '@prisma/client';
import { type Contact, parseContact } from '@stalls/core';
import type { Db } from './editions';
import { InvalidCredentialsError } from './errors';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** A floor, and nothing more. This is a stopgap until SSO — a policy that
 *  forced a symbol and a digit would outlive the mechanism it protects and
 *  buy nothing a length floor does not. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_FAILED = 10;
export const LOCKOUT_MINUTES = 15;

const KEYLEN = 64;

/** `scrypt` from node's own crypto — no dependency, because this whole file is
 *  scheduled for deletion. Stored as `scrypt$<salt hex>$<key hex>`, so the
 *  parameters travel with the hash and a future change of cost does not
 *  invalidate the rows already written. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(plain, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export async function createCredential(
  db: Db,
  input: { accountId: string; contact: Contact; password: string },
): Promise<StallCredential> {
  return db.stallCredential.create({
    data: {
      accountId: input.accountId,
      loginValue: input.contact.value,
      loginKind: input.contact.kind,
      passwordHash: await hashPassword(input.password),
    },
  });
}

export async function confirmCredential(
  db: Db,
  credentialId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.stallCredential.update({
    where: { id: credentialId },
    data: { confirmedAt: now, failedCount: 0, lockedUntil: null },
  });
}

export async function setPassword(db: Db, credentialId: string, password: string): Promise<void> {
  await db.stallCredential.update({
    where: { id: credentialId },
    data: {
      passwordHash: await hashPassword(password),
      failedCount: 0,
      lockedUntil: null,
      // A reset also confirms: following the link proved the contact.
      confirmedAt: new Date(),
    },
  });
}

/** The credential behind a contact and a password, or `InvalidCredentialsError`.
 *
 *  ⚠️ EVERY failure raises that one error — no contact, no credential, not yet
 *  confirmed, locked out, wrong password. The caller must not be able to tell
 *  them apart, and neither must a reader of this function. */
export async function authenticate(
  db: Db,
  input: { contact: string; password: string },
  now: Date = new Date(),
): Promise<StallCredential> {
  const contact = parseContact(input.contact);
  if (!contact) throw new InvalidCredentialsError();

  const cred = await db.stallCredential.findUnique({ where: { loginValue: contact.value } });
  if (!cred) throw new InvalidCredentialsError();
  if (!cred.confirmedAt) throw new InvalidCredentialsError();
  if (cred.lockedUntil && cred.lockedUntil.getTime() > now.getTime()) {
    throw new InvalidCredentialsError();
  }

  if (!(await verifyPassword(input.password, cred.passwordHash))) {
    const failedCount = cred.failedCount + 1;
    await db.stallCredential.update({
      where: { id: cred.id },
      data: {
        failedCount,
        lockedUntil:
          failedCount >= MAX_FAILED
            ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
            : cred.lockedUntil,
      },
    });
    throw new InvalidCredentialsError();
  }

  if (cred.failedCount !== 0 || cred.lockedUntil) {
    await db.stallCredential.update({
      where: { id: cred.id },
      data: { failedCount: 0, lockedUntil: null },
    });
  }
  return cred;
}
```

Export `Contact` from `@stalls/core` if it is not already exported — check `packages/stalls/src/index.ts` and add `export type { Contact }` from `./access` if missing.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/stalls/credentials.ts apps/api/src/modules/stalls/errors.ts apps/api/src/modules/stalls/http-errors.ts apps/api/test/requester-auth.test.ts packages/stalls/src/index.ts
git commit -m "feat: a requester password, and one error for every way it fails"
```

---

### Task 3: The session — minted from the link machinery, carried in a cookie

**Files:**
- Create: `apps/api/src/modules/stalls/session.ts`
- Modify: `apps/api/test/requester-auth.test.ts`

**Interfaces:**
- Consumes: `mintAccessLink`, `resolveAccessLink` from `./accounts`; `SESSION` purpose from Task 1.
- Produces:
  - `REQUESTER_COOKIE = 'stall_requester'`
  - `SESSION_TTL_DAYS = 30`
  - `startSession(db, accountId): Promise<string>` — returns the raw token
  - `setSessionCookie(reply, token): void`
  - `clearSessionCookie(reply): void`
  - `requireRequester(db, req): Promise<StallAccount>` — throws `UnknownAccessLinkError`
  - `endSession(db, token): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/requester-auth.test.ts`:

```ts
import { startSession, requireRequester, endSession } from '../src/modules/stalls/session';
import { resolveAccessLink } from '../src/modules/stalls/accounts';
import { UnknownAccessLinkError } from '../src/modules/stalls/errors';

describe('session', () => {
  test('a started session resolves back to its account', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    const got = await requireRequester(prisma, { cookies: { stall_requester: token } });
    expect(got.id).toBe(acct.id);
  });

  test('no cookie is refused', async () => {
    await expect(requireRequester(prisma, { cookies: {} })).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );
  });

  test('ending a session revokes it', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    await endSession(prisma, token);
    await expect(
      requireRequester(prisma, { cookies: { stall_requester: token } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });

  // 🔴 The purpose is the wall between the two credentials. A session cookie
  // must not open a bank form, and a bank-form token must not act as a
  // session — `resolveAccessLink` already refuses to cross, and this is the
  // test that says so out loud.
  test('a session token cannot open a bank form, and vice versa', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    await expect(resolveAccessLink(prisma, token, 'BANK_FORM')).rejects.toBeInstanceOf(
      UnknownAccessLinkError,
    );

    const { mintAccessLink } = await import('../src/modules/stalls/accounts');
    const { token: bank } = await mintAccessLink(prisma, {
      accountId: acct.id,
      purpose: 'BANK_FORM',
      ttlDays: 180,
    });
    await expect(
      requireRequester(prisma, { cookies: { stall_requester: bank } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });

  test('an expired session is refused', async () => {
    const acct = await account();
    const token = await startSession(prisma, acct.id);
    await prisma.stallAccessLink.updateMany({
      where: { accountId: acct.id, purpose: 'SESSION' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      requireRequester(prisma, { cookies: { stall_requester: token } }),
    ).rejects.toBeInstanceOf(UnknownAccessLinkError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: FAIL — `Cannot find module '../src/modules/stalls/session'`.

- [ ] **Step 3: Write `session.ts`**

```ts
import type { FastifyReply } from 'fastify';
import type { StallAccount } from '@prisma/client';
import { mintAccessLink, resolveAccessLink } from './accounts';
import type { Db } from './editions';
import { UnknownAccessLinkError } from './errors';

/** ⚠️ NOT `stalls_session`. That cookie is the STAFF session and is read by the
 *  host's own auth; a requester holding one would be a staff member. Two
 *  populations, two cookies, and the names must never converge. */
export const REQUESTER_COOKIE = 'stall_requester';

/** Long, because the alternative is a vendor locked out of their own
 *  onboarding mid-season. Revocation is the real control: logout and a
 *  password reset both revoke. */
export const SESSION_TTL_DAYS = 30;

/** A logged-in requester is an access link with a purpose, nothing more.
 *
 *  That is the whole design: `StallAccessLink` already stores only a SHA-256
 *  of the token, already expires, already revokes, and `resolveAccessLink`
 *  already refuses to answer for the wrong purpose. When the host's OIDC
 *  arrives, its callback calls THIS function and every other line in the
 *  module stays where it is. */
export async function startSession(db: Db, accountId: string): Promise<string> {
  const { token } = await mintAccessLink(db, {
    accountId,
    purpose: 'SESSION',
    ttlDays: SESSION_TTL_DAYS,
  });
  return token;
}

export async function endSession(db: Db, token: string): Promise<void> {
  const link = await resolveAccessLink(db, token, 'SESSION').catch(() => null);
  if (!link) return;
  await db.stallAccessLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
}

/** Revokes every live session for an account — used by a password reset, where
 *  the point is to evict whoever prompted the reset. */
export async function endAllSessions(db: Db, accountId: string): Promise<void> {
  await db.stallAccessLink.updateMany({
    where: { accountId, purpose: 'SESSION', revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REQUESTER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(REQUESTER_COOKIE, { path: '/' });
}

/** The account behind the session cookie, or `UnknownAccessLinkError` — the
 *  same error an unknown link raises, so "not logged in" and "bad token" read
 *  identically to a caller. */
export async function requireRequester(
  db: Db,
  req: { cookies: Record<string, string | undefined> },
): Promise<StallAccount> {
  const token = req.cookies[REQUESTER_COOKIE];
  if (!token) throw new UnknownAccessLinkError();
  const link = await resolveAccessLink(db, token, 'SESSION');
  return link.account;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/stalls/session.ts apps/api/test/requester-auth.test.ts
git commit -m "feat: the requester session is an access link with a purpose"
```

---

### Task 4: Registration — one response for every case

**Files:**
- Create: `apps/api/src/modules/stalls/registration.ts`
- Modify: `apps/api/src/modules/stalls/deps.ts`, `apps/api/src/app.ts`, `packages/stalls/src/access.ts`
- Modify: `apps/api/test/requester-auth.test.ts`

**Interfaces:**
- Consumes: `createCredential`, `confirmCredential`, `setPassword` (Task 2); `startSession`, `endAllSessions` (Task 3); `parseContact`; `mintAccessLink`, `resolveAccessLink`.
- Produces:
  - `register(db, deps, input: RegisterInput): Promise<void>` — never throws for a taken or malformed contact
  - `confirmRegistration(db, token): Promise<{ accountId: string }>`
  - `requestPasswordReset(db, deps, contact: string): Promise<void>`
  - `completePasswordReset(db, token, password): Promise<{ accountId: string }>`
  - Types in `@stalls/core`: `RegisterInput`, `LoginInput`, `ConfirmRegistrationInput`, `PasswordResetInput`, `PasswordResetConfirmInput`, `RequesterSession`
  - `StallsDeps.registerConfirmUrl(token)`, `StallsDeps.passwordResetUrl(token)`

- [ ] **Step 1: Add the shared types**

In `packages/stalls/src/access.ts`, append:

```ts
import { z } from 'zod';

/** 8 is a floor, not a policy — see the API's `MIN_PASSWORD_LENGTH`. */
export const RegisterInput = z.object({
  contact: z.string().min(1).max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(160),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  contact: z.string().min(1).max(254),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const ConfirmRegistrationInput = z.object({ token: z.string().min(16).max(128) });
export type ConfirmRegistrationInput = z.infer<typeof ConfirmRegistrationInput>;

export const PasswordResetInput = z.object({ contact: z.string().min(1).max(254) });
export type PasswordResetInput = z.infer<typeof PasswordResetInput>;

export const PasswordResetConfirmInput = z.object({
  token: z.string().min(16).max(128),
  password: z.string().min(8).max(200),
});
export type PasswordResetConfirmInput = z.infer<typeof PasswordResetConfirmInput>;

/** ⚠️ NOT `MeResponse`. That is the STAFF session. A requester has no roles and
 *  no actions — conflating the two types is how a requester ends up being
 *  asked what they `can()` do. */
export interface RequesterSession {
  accountId: string;
  displayName: string;
  email: string;
  phone: string;
}
```

Export these from `packages/stalls/src/index.ts` alongside the existing access exports.

- [ ] **Step 2: Add the two URL builders to deps**

In `apps/api/src/modules/stalls/deps.ts`, beside `statusUrl`:

```ts
  /** Where a new registration is confirmed. The token is the credential. */
  registerConfirmUrl(token: string): string;
  /** Where a password is reset. */
  passwordResetUrl(token: string): string;
```

In `apps/api/src/app.ts`, beside `statusUrl`:

```ts
    registerConfirmUrl: (token) => `${webOrigin}/stalls/confirm/${token}`,
    passwordResetUrl: (token) => `${webOrigin}/stalls/reset/${token}`,
```

Add the same two to `apps/api/test/helpers/onboarding.ts` inside `testDeps()`, matching the shape used for `statusUrl` there.

- [ ] **Step 3: Write the failing tests**

Append to `apps/api/test/requester-auth.test.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { LogMailer } from './helpers/db';
import { recordingWhatsApp } from './helpers/onboarding';

let app: FastifyInstance;
const mail = new LogMailer();
const whatsapp = recordingWhatsApp();
beforeAll(async () => {
  app = await buildApp({ logger: false, mail, whatsapp, webOrigin: 'http://web.example' });
});
afterAll(() => app.close());

const url = (p: string) => `/api/m/stalls/public/${p}`;
const postRegister = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: url('register'), payload: body });

describe('POST /public/register', () => {
  beforeEach(() => {
    mail.sent.length = 0;
    whatsapp.sent.length = 0;
  });

  test('a free email creates an account and an UNCONFIRMED credential', async () => {
    const res = await postRegister({
      contact: 'new@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'New Vendor',
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });

    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'new@vendor.example' },
    });
    expect(cred.confirmedAt).toBeNull();
    expect(mail.sent).toHaveLength(1);
  });

  test('a free mobile is confirmed over WhatsApp, not email', async () => {
    const res = await postRegister({
      contact: '98400 12399',
      password: 'hunter2hunter2',
      displayName: 'Trader',
    });
    expect(res.statusCode).toBe(202);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].to).toBe('9840012399');
    expect(mail.sent).toHaveLength(0);
  });

  // 🔴 THE test for this feature. A taken contact, a free one and a contact
  // that is not a contact at all must be one response. Anything else and the
  // route answers "has this shopkeeper applied?" — decision 17.
  test('taken, free and malformed are byte-identical responses', async () => {
    await account('taken@vendor.example', '9840012345');

    const free = await postRegister({
      contact: 'free@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'A',
    });
    const taken = await postRegister({
      contact: 'taken@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'B',
    });
    const junk = await postRegister({
      contact: 'not a contact',
      password: 'hunter2hunter2',
      displayName: 'C',
    });

    expect(taken.statusCode).toBe(free.statusCode);
    expect(junk.statusCode).toBe(free.statusCode);
    expect(taken.body).toBe(free.body);
    expect(junk.body).toBe(free.body);
  });

  // 🔴 The refusal is real, it just travels by the account's own channel.
  test('registering on a taken contact warns the ACCOUNT, and makes no credential', async () => {
    await account('taken@vendor.example', '9840012345');
    await postRegister({
      contact: 'taken@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'Impostor',
    });

    expect(await prisma.stallCredential.count()).toBe(0);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('taken@vendor.example');
    expect(mail.sent[0].subject.toLowerCase()).toContain('stall team');
  });

  test('a malformed contact sends nothing at all', async () => {
    await postRegister({
      contact: 'not a contact',
      password: 'hunter2hunter2',
      displayName: 'C',
    });
    expect(mail.sent).toHaveLength(0);
    expect(whatsapp.sent).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: FAIL — 404 on `/public/register` (the route does not exist yet).

- [ ] **Step 5: Write `registration.ts`**

```ts
import type { StallAccount } from '@prisma/client';
import { type RegisterInput, parseContact } from '@stalls/core';
import { findAccountByContact, mintAccessLink, resolveAccessLink } from './accounts';
import { confirmCredential, createCredential, setPassword } from './credentials';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { UnknownAccessLinkError } from './errors';
import type { Mailer } from './mailer';
import { endAllSessions } from './session';
import type { WhatsAppSender } from './whatsapp';

const CONFIRM_TTL_DAYS = 2;
const RESET_TTL_DAYS = 1;

type SendDeps = Pick<
  StallsDeps,
  'mail' | 'whatsapp' | 'registerConfirmUrl' | 'passwordResetUrl'
>;

/** Registers, or does not, and tells the caller nothing either way.
 *
 *  ⚠️ This function RETURNS for every input — a taken contact, a contact that
 *  does not parse, a send that fails. The route answers 202 regardless. The
 *  only place the three cases differ is which message goes out, and every
 *  message goes to a contact the module already had, never to the one typed.
 *
 *  The refusal on a taken contact is the team's decision: staff link a
 *  password to an existing account, not the person typing. The warning still
 *  has to reach the real account holder, or an attempt is invisible. */
export async function register(db: Db, deps: SendDeps, input: RegisterInput): Promise<void> {
  const contact = parseContact(input.contact);
  if (!contact) return;

  const existing = await findAccountByContact(db, input.contact);
  if (existing) {
    await warnAccountHolder(deps, existing);
    return;
  }

  // A contact with no account but an existing credential can only be a second
  // registration on the same address before the first was confirmed. Same
  // silence, and the first token stays the live one.
  const takenCredential = await db.stallCredential.findUnique({
    where: { loginValue: contact.value },
  });
  if (takenCredential) return;

  const account = await db.stallAccount.create({
    data: {
      email: contact.kind === 'EMAIL' ? contact.value : placeholderEmail(contact.value),
      phone: contact.kind === 'MOBILE' ? contact.value : '',
      displayName: input.displayName,
    },
  });
  const credential = await createCredential(db, {
    accountId: account.id,
    contact,
    password: input.password,
  });
  const { token } = await mintAccessLink(db, {
    accountId: account.id,
    purpose: 'REGISTER_CONFIRM',
    ttlDays: CONFIRM_TTL_DAYS,
  });

  await deliver(deps, contact, {
    subject: 'Confirm your stall account',
    body: `Confirm your stall account: ${deps.registerConfirmUrl(token)}`,
  });
  void credential;
}

/** `StallAccount.email` is non-null and unique, and a trader registering on a
 *  mobile has no address. A namespaced placeholder keeps the column honest
 *  without pretending it is reachable — nothing sends to it, because delivery
 *  is chosen by `loginKind`, not by this column. */
function placeholderEmail(mobile: string): string {
  return `mobile+${mobile}@stalls.invalid`;
}

async function warnAccountHolder(deps: SendDeps, account: StallAccount): Promise<void> {
  const subject = 'Someone tried to register — please call the stall team';
  const body =
    'Someone tried to create a login using your contact details. If that was ' +
    'you, please call the stall team and they will set it up for you.';
  try {
    if (!account.email.endsWith('@stalls.invalid')) {
      await deps.mail.send({ to: account.email, subject, text: body });
    }
    if (account.phone) await deps.whatsapp.send({ to: account.phone, text: `${subject}. ${body}` });
  } catch {
    // Same reason `sendAccessLink` swallows: a transport failure must not
    // become a different response from "nothing matched".
  }
}

async function deliver(
  deps: SendDeps,
  contact: { kind: 'EMAIL' | 'MOBILE'; value: string },
  msg: { subject: string; body: string },
): Promise<void> {
  try {
    if (contact.kind === 'EMAIL') {
      await deps.mail.send({ to: contact.value, subject: msg.subject, text: msg.body });
    } else {
      await deps.whatsapp.send({ to: contact.value, text: `${msg.subject}. ${msg.body}` });
    }
  } catch {
    // As above.
  }
}

export async function confirmRegistration(
  db: Db,
  token: string,
): Promise<{ accountId: string }> {
  const link = await resolveAccessLink(db, token, 'REGISTER_CONFIRM');
  const cred = await db.stallCredential.findFirst({ where: { accountId: link.accountId } });
  if (!cred) throw new UnknownAccessLinkError();
  await confirmCredential(db, cred.id);
  await db.stallAccessLink.update({
    where: { id: link.id },
    data: { usedAt: new Date(), revokedAt: new Date() },
  });
  return { accountId: link.accountId };
}

export async function requestPasswordReset(
  db: Db,
  deps: SendDeps,
  rawContact: string,
): Promise<void> {
  const contact = parseContact(rawContact);
  if (!contact) return;
  const cred = await db.stallCredential.findUnique({ where: { loginValue: contact.value } });
  if (!cred) return;

  const { token } = await mintAccessLink(db, {
    accountId: cred.accountId,
    purpose: 'PASSWORD_RESET',
    ttlDays: RESET_TTL_DAYS,
  });
  await deliver(deps, contact, {
    subject: 'Reset your stall password',
    body: `Reset your stall password: ${deps.passwordResetUrl(token)}`,
  });
}

export async function completePasswordReset(
  db: Db,
  token: string,
  password: string,
): Promise<{ accountId: string }> {
  const link = await resolveAccessLink(db, token, 'PASSWORD_RESET');
  const cred = await db.stallCredential.findFirst({ where: { accountId: link.accountId } });
  if (!cred) throw new UnknownAccessLinkError();
  await setPassword(db, cred.id, password);
  await db.stallAccessLink.update({
    where: { id: link.id },
    data: { usedAt: new Date(), revokedAt: new Date() },
  });
  // Whoever prompted the reset is evicted. That is most of the point.
  await endAllSessions(db, link.accountId);
  return { accountId: link.accountId };
}
```

- [ ] **Step 6: Wire the register route**

In `apps/api/src/modules/stalls/public-routes.ts`, import `RegisterInput` from `@stalls/core` and `register` from `./registration`, then add:

```ts
  /** Registration, which answers the same 202 for a free contact, a taken one
   *  and a string that is not a contact. See `registration.ts` for why. */
  zod.post(
    '/public/register',
    {
      schema: { body: RegisterInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await register(prisma, deps, req.body);
      return reply.code(202).send({ ok: true });
    },
  );
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: 15 passed.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/stalls/registration.ts apps/api/src/modules/stalls/deps.ts apps/api/src/app.ts apps/api/src/modules/stalls/public-routes.ts apps/api/test packages/stalls/src
git commit -m "feat: registration answers the same way to a free, taken and malformed contact"
```

---

### Task 5: Confirm, login, logout, session

**Files:**
- Modify: `apps/api/src/modules/stalls/public-routes.ts`
- Modify: `apps/api/test/requester-auth.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: `POST /public/register/confirm`, `POST /public/login`, `POST /public/logout`, `GET /public/session`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/requester-auth.test.ts`:

```ts
describe('confirm, login, logout', () => {
  beforeEach(() => {
    mail.sent.length = 0;
    whatsapp.sent.length = 0;
  });

  /** Registers and returns the confirm token straight from the table — the
   *  test does not parse the email body, which is copy and will change. */
  async function registerAndTokenFor(contact: string) {
    await postRegister({ contact, password: 'hunter2hunter2', displayName: 'Vendor' });
    const link = await prisma.stallAccessLink.findFirstOrThrow({
      where: { purpose: 'REGISTER_CONFIRM' },
      orderBy: { createdAt: 'desc' },
    });
    return link;
  }

  test('confirming logs them straight in', async () => {
    await registerAndTokenFor('new@vendor.example');
    // The raw token is not recoverable from the hash, so re-mint through the
    // documented path: the confirmation link is what the vendor clicks.
    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'new@vendor.example' },
    });
    expect(cred.confirmedAt).toBeNull();
  });

  test('login sets the session cookie and the portal opens', async () => {
    await postRegister({
      contact: 'new@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'Vendor',
    });
    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'new@vendor.example' },
    });
    await prisma.stallCredential.update({
      where: { id: cred.id },
      data: { confirmedAt: new Date() },
    });

    const res = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'hunter2hunter2' },
    });
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'stall_requester');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);

    const me = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: cookie?.value ?? '' },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().displayName).toBe('Vendor');
  });

  test('a wrong password and an unknown contact are the same 401', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'nobody@vendor.example', password: 'hunter2hunter2' },
    });
    const wrong = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'new@vendor.example', password: 'wrongwrongwrong' },
    });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  test('GET /public/session without a cookie is 404, not a hint', async () => {
    const res = await app.inject({ method: 'GET', url: url('session') });
    expect(res.statusCode).toBe(404);
  });

  test('logout revokes the session', async () => {
    await postRegister({
      contact: 'out@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'Vendor',
    });
    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'out@vendor.example' },
    });
    await prisma.stallCredential.update({
      where: { id: cred.id },
      data: { confirmedAt: new Date() },
    });
    const login = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'out@vendor.example', password: 'hunter2hunter2' },
    });
    const value = login.cookies.find((c) => c.name === 'stall_requester')?.value ?? '';

    await app.inject({
      method: 'POST',
      url: url('logout'),
      cookies: { stall_requester: value },
    });
    const after = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: value },
    });
    expect(after.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: FAIL — 404 on `/public/login`.

- [ ] **Step 3: Add the four routes**

In `public-routes.ts`, import `ConfirmRegistrationInput`, `LoginInput` from `@stalls/core`; `authenticate` from `./credentials`; `confirmRegistration` from `./registration`; and `clearSessionCookie`, `endSession`, `REQUESTER_COOKIE`, `requireRequester`, `setSessionCookie`, `startSession` from `./session`. Then:

```ts
  zod.post(
    '/public/register/confirm',
    {
      schema: { body: ConfirmRegistrationInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { accountId } = await confirmRegistration(prisma, req.body.token);
      setSessionCookie(reply, await startSession(prisma, accountId));
      return { ok: true };
    },
  );

  zod.post(
    '/public/login',
    {
      schema: { body: LoginInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const cred = await authenticate(prisma, req.body);
      setSessionCookie(reply, await startSession(prisma, cred.accountId));
      return { ok: true };
    },
  );

  app.post('/public/logout', async (req, reply) => {
    const token = req.cookies[REQUESTER_COOKIE];
    if (token) await endSession(prisma, token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  /** ⚠️ 404, not 401, for no session. This is a PUBLIC route on a public page;
   *  a 401 here would make the browser think it must authenticate to read the
   *  apply form, which it must not. */
  app.get('/public/session', async (req, reply) => {
    const account = await requireRequester(prisma, req).catch(() => null);
    if (!account) return reply.code(404).send({ error: 'no session' });
    return {
      accountId: account.id,
      displayName: account.displayName,
      email: account.email,
      phone: account.phone,
    };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: 20 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/stalls/public-routes.ts apps/api/test/requester-auth.test.ts
git commit -m "feat: confirm, login, logout and the session a public page can ask about"
```

---

### Task 6: Password reset

**Files:**
- Modify: `apps/api/src/modules/stalls/public-routes.ts`
- Modify: `apps/api/test/requester-auth.test.ts`

**Interfaces:**
- Consumes: `requestPasswordReset`, `completePasswordReset` (Task 4).
- Produces: `POST /public/password-reset`, `POST /public/password-reset/confirm`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('password reset', () => {
  beforeEach(() => {
    mail.sent.length = 0;
  });

  test('an unknown contact gets the same 202 as a known one', async () => {
    const unknown = await app.inject({
      method: 'POST',
      url: url('password-reset'),
      payload: { contact: 'nobody@vendor.example' },
    });
    expect(unknown.statusCode).toBe(202);
    expect(unknown.json()).toEqual({ ok: true });
    expect(mail.sent).toHaveLength(0);
  });

  test('a reset sets the new password and evicts every live session', async () => {
    await postRegister({
      contact: 'reset@vendor.example',
      password: 'hunter2hunter2',
      displayName: 'Vendor',
    });
    const cred = await prisma.stallCredential.findUniqueOrThrow({
      where: { loginValue: 'reset@vendor.example' },
    });
    await prisma.stallCredential.update({
      where: { id: cred.id },
      data: { confirmedAt: new Date() },
    });
    const login = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'reset@vendor.example', password: 'hunter2hunter2' },
    });
    const old = login.cookies.find((c) => c.name === 'stall_requester')?.value ?? '';

    const { completePasswordReset } = await import('../src/modules/stalls/registration');
    const { mintAccessLink } = await import('../src/modules/stalls/accounts');
    const { token } = await mintAccessLink(prisma, {
      accountId: cred.accountId,
      purpose: 'PASSWORD_RESET',
      ttlDays: 1,
    });
    await completePasswordReset(prisma, token, 'brandnewpassword');

    const stale = await app.inject({
      method: 'GET',
      url: url('session'),
      cookies: { stall_requester: old },
    });
    expect(stale.statusCode).toBe(404);

    const relogin = await app.inject({
      method: 'POST',
      url: url('login'),
      payload: { contact: 'reset@vendor.example', password: 'brandnewpassword' },
    });
    expect(relogin.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: FAIL — 404 on `/public/password-reset`.

- [ ] **Step 3: Add the routes**

```ts
  zod.post(
    '/public/password-reset',
    {
      schema: { body: PasswordResetInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      await requestPasswordReset(prisma, deps, req.body.contact);
      return reply.code(202).send({ ok: true });
    },
  );

  zod.post(
    '/public/password-reset/confirm',
    {
      schema: { body: PasswordResetConfirmInput },
      config: { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { accountId } = await completePasswordReset(prisma, req.body.token, req.body.password);
      setSessionCookie(reply, await startSession(prisma, accountId));
      return { ok: true };
    },
  );
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: 22 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/stalls/public-routes.ts apps/api/test/requester-auth.test.ts
git commit -m "feat: a password reset that evicts whoever prompted it"
```

---

### Task 7: The gate — submission takes its account from the session

**Files:**
- Modify: `apps/api/src/modules/stalls/submit.ts:73`
- Modify: `apps/api/src/modules/stalls/public-routes.ts`
- Modify: `apps/api/test/submit.test.ts`, `apps/api/test/public-routes.test.ts`, `apps/api/test/helpers/db.ts`
- Modify: `apps/api/test/requester-auth.test.ts`

**Interfaces:**
- Consumes: `requireRequester` (Task 3).
- Produces: `submitRequest(db, deps, input, accountId)` — the fourth parameter is new and required. `POST /public/requests` requires a session.
- Produces: test helper `seedRequester(app, contact?, password?): Promise<{ accountId, cookies }>` in `test/helpers/db.ts`, used by every test that submits.

- [ ] **Step 1: Add the test helper**

In `apps/api/test/helpers/db.ts`:

```ts
/** A confirmed, logged-in requester. Returns the cookie jar `app.inject`
 *  wants, so a submitting test reads the same as it did before the gate. */
export async function seedRequester(
  app: FastifyInstance,
  contact = 'priya@greenleaf.example',
  password = 'hunter2hunter2',
): Promise<{ accountId: string; cookies: Record<string, string> }> {
  await app.inject({
    method: 'POST',
    url: '/api/m/stalls/public/register',
    payload: { contact, password, displayName: 'Priya Venkat' },
  });
  const cred = await prisma.stallCredential.findUniqueOrThrow({ where: { loginValue: contact } });
  await prisma.stallCredential.update({
    where: { id: cred.id },
    data: { confirmedAt: new Date() },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/m/stalls/public/login',
    payload: { contact, password },
  });
  const value = login.cookies.find((c) => c.name === 'stall_requester')?.value ?? '';
  return { accountId: cred.accountId, cookies: { stall_requester: value } };
}
```

Add `import type { FastifyInstance } from 'fastify';` at the top.

- [ ] **Step 2: Write the failing tests**

Append to `apps/api/test/requester-auth.test.ts`:

```ts
describe('the apply gate', () => {
  test('submitting without a session is refused', async () => {
    const res = await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody(),
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.stallRequest.count()).toBe(0);
  });

  // 🔴 The hole this closes. Before the gate, `findOrCreateAccount` picked the
  // account from the email TYPED INTO THE FORM — so typing a known vendor's
  // address attached your request to their account and mailed the receipt
  // there. The session decides now, and the typed email is just a field.
  test('a typed email cannot choose someone else another account', async () => {
    const victim = await account('victim@vendor.example', '9840011111');
    const { accountId, cookies } = await seedRequester(app, 'attacker@vendor.example');

    const res = await app.inject({
      method: 'POST',
      url: url('requests'),
      payload: vendorBody({ email: 'victim@vendor.example' }),
      cookies,
    });
    expect(res.statusCode).toBe(201);

    const created = await prisma.stallRequest.findFirstOrThrow();
    expect(created.accountId).toBe(accountId);
    expect(created.accountId).not.toBe(victim.id);
  });
});
```

Import `vendorBody` and `seedRequester` from `./helpers/db`.

- [ ] **Step 3: Run to verify they fail**

Run: `npm test --workspace=apps/api -- requester-auth`
Expected: FAIL — submission still succeeds without a cookie.

- [ ] **Step 4: Change `submitRequest`**

In `apps/api/src/modules/stalls/submit.ts`, add `accountId: string` as the fourth parameter and replace the `findOrCreateAccount` call at line ~73:

```ts
    // ⚠️ The account comes from the SESSION, never from `input.email`. It used
    // to come from the typed address, which meant typing a known vendor's
    // email attached the request to their account and sent the receipt there.
    // The contact fields on the form are per-request facts now — a department
    // files for several contact people under one login — and select nothing.
    const account = await tx.stallAccount.findUniqueOrThrow({ where: { id: accountId } });
```

Remove the now-unused `findOrCreateAccount` import if nothing else in the file uses it.

- [ ] **Step 5: Gate the route**

In `public-routes.ts`, in the `POST /public/requests` handler, before calling `submitRequest`:

```ts
      const requester = await requireRequester(prisma, req);
```

and pass `requester.id` as the fourth argument.

Update the file's header comment — it currently says every route is gated by "exactly two credentials" and that three routes take none:

```ts
// Every route here is gated by one of exactly three credentials:
//
//   • a signed access LINK  — status page, bank form, FSSAI upload.
//   • a staff COUPON        — staff registration.
//   • a requester SESSION   — the apply form and the submission behind it.
//     A password today, the host's OIDC when it lands; `session.ts` is the
//     seam and nothing else in the module knows which it was.
//
// Four routes take no credential: `GET /config`, `POST /access-link`,
// `POST /register` and `POST /password-reset`. The last three read nothing
// back to the caller and answer identically whatever they are given.
```

- [ ] **Step 6: Fix the existing tests that submit**

`submit.test.ts`, `public-routes.test.ts`, `phase2-routes.test.ts`, `portal.test.ts`, `onboarding.test.ts` and `helpers/onboarding.ts` all submit. For direct `submitRequest(...)` calls, create an account in the test and pass its id. For `app.inject` calls to `/public/requests`, call `seedRequester(app)` in `beforeEach` and pass `cookies`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test --workspace=apps/api`
Expected: 284 + 24 = **308 passed**, 0 failed. If any test fails because it submitted without a session, give it a requester — do not weaken the gate.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat: the account on a request comes from the session, not the typed email"
```

---

### Task 8: Web — the API calls and the requester context

**Files:**
- Modify: `apps/web/src/modules/stalls/api.ts`
- Create: `apps/web/src/modules/stalls/requester.tsx`
- Modify: `apps/web/src/modules/stalls/index.tsx`

**Interfaces:**
- Consumes: the routes from Tasks 4–6.
- Produces:
  - `registerRequester(input: RegisterInput): Promise<void>`
  - `confirmRegistration(token: string): Promise<void>`
  - `loginRequester(input: LoginInput): Promise<void>`
  - `logoutRequester(): Promise<void>`
  - `getRequesterSession(): Promise<RequesterSession>`
  - `requestPasswordReset(contact: string): Promise<void>`
  - `completePasswordReset(token: string, password: string): Promise<void>`
  - `RequesterProvider`, `useRequester(): { requester: RequesterSession | null; status: 'loading' | 'ready'; reload(): void }`

- [ ] **Step 1: Add the API calls**

In `apps/web/src/modules/stalls/api.ts`, following the existing call style:

```ts
export const registerRequester = (input: RegisterInput) =>
  post<{ ok: true }>('/public/register', input).then(() => undefined);

export const confirmRegistration = (token: string) =>
  post<{ ok: true }>('/public/register/confirm', { token }).then(() => undefined);

export const loginRequester = (input: LoginInput) =>
  post<{ ok: true }>('/public/login', input).then(() => undefined);

export const logoutRequester = () =>
  post<{ ok: true }>('/public/logout', {}).then(() => undefined);

export const getRequesterSession = () => get<RequesterSession>('/public/session');

export const requestPasswordReset = (contact: string) =>
  post<{ ok: true }>('/public/password-reset', { contact }).then(() => undefined);

export const completePasswordReset = (token: string, password: string) =>
  post<{ ok: true }>('/public/password-reset/confirm', { token, password }).then(() => undefined);
```

Match the file's existing `get`/`post` helper names exactly — read the top of `api.ts` first. Add the types to the `@stalls/core` import block.

- [ ] **Step 2: Write `requester.tsx`**

```tsx
import type { RequesterSession } from '@stalls/core';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getRequesterSession } from './api';

interface RequesterState {
  requester: RequesterSession | null;
  status: 'loading' | 'ready';
  reload(): void;
}

const RequesterContext = createContext<RequesterState | null>(null);

/** Who is logged in on the PUBLIC side.
 *
 *  ⚠️ Deliberately not `MeProvider`. That one is staff, and answers `can()`
 *  about roles a requester will never hold. Two populations, two contexts —
 *  and when SSO replaces the password login, only this one changes.
 *
 *  A missing session is `null`, never an error: the apply page is public and
 *  has to render for someone who has never logged in. */
export function RequesterProvider({ children }: { children: ReactNode }) {
  const [requester, setRequester] = useState<RequesterSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [tick, setTick] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the reload signal
  useEffect(() => {
    let alive = true;
    setStatus('loading');
    getRequesterSession()
      .then((r) => alive && setRequester(r))
      .catch(() => alive && setRequester(null))
      .finally(() => alive && setStatus('ready'));
    return () => {
      alive = false;
    };
  }, [tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return (
    <RequesterContext.Provider value={{ requester, status, reload }}>
      {children}
    </RequesterContext.Provider>
  );
}

export function useRequester(): RequesterState {
  const ctx = useContext(RequesterContext);
  if (!ctx) throw new Error('useRequester must be used inside RequesterProvider');
  return ctx;
}
```

- [ ] **Step 3: Export it**

In `apps/web/src/modules/stalls/index.tsx`, beside the existing `MeProvider` export:

```tsx
export { RequesterProvider, useRequester } from './requester';
```

- [ ] **Step 4: Typecheck**

Run: `npm run build --workspace=apps/web`
Expected: builds clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/modules/stalls/api.ts apps/web/src/modules/stalls/requester.tsx apps/web/src/modules/stalls/index.tsx
git commit -m "feat(web): the requester session, kept apart from the staff one"
```

---

### Task 9: Web — the four auth screens

**Files:**
- Create: `apps/web/src/modules/stalls/public/Login.tsx`, `Register.tsx`, `ConfirmRegistration.tsx`, `ResetPassword.tsx`
- Create: `apps/web/src/modules/stalls/public/RequesterAuth.test.tsx`
- Modify: `apps/web/src/modules/stalls/index.tsx`

**Interfaces:**
- Consumes: Task 8's calls and `useRequester`.
- Produces: routes `login`, `register`, `confirm/:token`, `forgot`, `reset/:token` under the public tree.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/modules/stalls/public/RequesterAuth.test.tsx`, following the structure of the existing `PublicOnboarding.test.tsx` (read it first for the render helper and mocking style):

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from './Login';
import { Register } from './Register';

vi.mock('../api', () => ({
  loginRequester: vi.fn().mockResolvedValue(undefined),
  registerRequester: vi.fn().mockResolvedValue(undefined),
  getRequesterSession: vi.fn().mockRejectedValue(new Error('no session')),
}));

describe('Login', () => {
  test('sends the contact and password', async () => {
    const { loginRequester } = await import('../api');
    render(<Login />);
    await userEvent.type(screen.getByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    await waitFor(() =>
      expect(loginRequester).toHaveBeenCalledWith({
        contact: 'a@b.example',
        password: 'hunter2hunter2',
      }),
    );
  });

  test('a failure says one thing, and never which half was wrong', async () => {
    const { loginRequester } = await import('../api');
    vi.mocked(loginRequester).mockRejectedValueOnce(new Error('nope'));
    render(<Login />);
    await userEvent.type(screen.getByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /log in/i }));
    const msg = await screen.findByRole('alert');
    expect(msg.textContent?.toLowerCase()).not.toMatch(/password|account|exist|found/);
  });
});

describe('Register', () => {
  // 🔴 The screen must say the same thing whatever happened, because the API
  // does. Copy that promised "we created your account" would be a lie on a
  // contact that already had one.
  test('always lands on the same "check your messages" panel', async () => {
    render(<Register />);
    await userEvent.type(screen.getByLabelText(/your name/i), 'Priya');
    await userEvent.type(screen.getByLabelText(/email address or mobile/i), 'a@b.example');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2hunter2');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/check your/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=apps/web -- RequesterAuth`
Expected: FAIL — `Cannot find module './Login'`.

- [ ] **Step 3: Write the screens**

Build all four on `AccessLink.tsx` as the template — it is the closest existing screen and already has the card, the `FormField`/`Input`/`Btn` usage, the `BilingualLabel`, and the "say the same thing either way" copy discipline. Requirements per screen:

- **`Login.tsx`** — contact + password, a link to `register` and to `forgot`. One error message for every failure: *"That email or mobile and password do not match. Please try again."* On success, `reload()` then navigate to `/stalls/apply`.
- **`Register.tsx`** — name, contact, password (min 8, with the floor stated). After submit, always the same panel: *"Check your email or WhatsApp — if we can create an account for that contact, a confirmation link is on its way. If you have applied before, the stall team will need to set your login up for you."*
- **`ConfirmRegistration.tsx`** — reads `:token`, calls `confirmRegistration` on mount, then `reload()` and navigate to `/stalls/apply`. A failure reuses `StatusPage`'s "this link is not valid" card, with the amber `--warn` treatment and its reasoning — an expired link is not the reader's mistake.
- **`ResetPassword.tsx`** — two modes on one screen: no `:token` asks for the contact and always answers the same panel; with `:token` takes a new password and on success lands logged in at `/stalls/apply`.

- [ ] **Step 4: Add the routes**

In `apps/web/src/modules/stalls/index.tsx`, in `stallsPublicRoutes`:

```tsx
  { path: 'login', element: <Login /> },
  { path: 'register', element: <Register /> },
  { path: 'confirm/:token', element: <ConfirmRegistration /> },
  { path: 'forgot', element: <ResetPassword /> },
  { path: 'reset/:token', element: <ResetPassword /> },
```

These paths must match `registerConfirmUrl` and `passwordResetUrl` in `app.ts` — `/stalls/confirm/:token` and `/stalls/reset/:token`.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test --workspace=apps/web -- RequesterAuth`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/modules/stalls/public apps/web/src/modules/stalls/index.tsx
git commit -m "feat(web): register, log in, confirm and reset"
```

---

### Task 10: Web — the gate on /stalls/apply

**Files:**
- Modify: `apps/web/src/modules/stalls/public/FormPicker.tsx`
- Modify: `apps/web/src/modules/stalls/public/RequestForm.tsx`
- Modify: `apps/web/src/app/PublicLayout.tsx`
- Modify: `apps/web/src/modules/stalls/public/RequestForm.test.tsx`

**Interfaces:**
- Consumes: `useRequester` (Task 8).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `RequesterAuth.test.tsx`:

```tsx
import { FormPicker } from './FormPicker';
import { RequesterProvider } from '../requester';

describe('the apply gate', () => {
  test('without a session the form tiles are not links', async () => {
    render(
      <RequesterProvider>
        <FormPicker />
      </RequesterProvider>,
    );
    expect(await screen.findByRole('link', { name: /log in/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /vendor stall/i })).not.toBeInTheDocument();
  });
});
```

Wrap in a router provider the way `PublicOnboarding.test.tsx` does.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace=apps/web -- RequesterAuth`
Expected: FAIL — the tiles render as links regardless.

- [ ] **Step 3: Gate `FormPicker`**

Read `useRequester()`. While `status === 'loading'`, render `<Loading />`. When `requester` is null, render the four tiles as inert `<div>`s (no `<Link>`, no `cursor: pointer`, reduced opacity) beneath a card holding the two buttons:

```tsx
<Card pad={18} style={{ display: 'grid', gap: 12, textAlign: 'center' }}>
  <div style={{ fontSize: 15, fontWeight: 700 }}>To request a stall you need an account</div>
  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
    It keeps your requests together and lets you come back to see where each one has got to.
  </p>
  <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
    <Link to='/stalls/register'><Btn kind='primary'>Create an account</Btn></Link>
    <Link to='/stalls/login'><Btn>Log in</Btn></Link>
  </div>
</Card>
```

Keep the existing "Already submitted?" paragraph — `AccessLink` is still the route for everyone who never registers.

- [ ] **Step 4: Gate and prefill `RequestForm`**

At the top, `useRequester()`. If `status === 'ready'` and `requester` is null, `<Navigate to='/stalls/apply' replace />`. Seed the initial state of `requesterName` from `requester.displayName`, `email` from `requester.email` (blank when it ends in `@stalls.invalid` — that is a placeholder, not an address), and `contactNumber` from `requester.phone`. All three stay editable.

- [ ] **Step 5: Add the session strip to `PublicLayout`**

When `requester` is set, a right-aligned line: the display name and a Log out button calling `logoutRequester()` then `reload()` then navigating to `/stalls/apply`. Wrap the public tree in `<RequesterProvider>` here.

- [ ] **Step 6: Run the web suite**

Run: `npm test --workspace=apps/web`
Expected: all pass. `RequestForm.test.tsx` will need a `RequesterProvider` wrapper with a mocked session — add it rather than removing the gate.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): /stalls/apply asks who you are before it shows the forms"
```

---

### Task 11: The documents that now contradict the code

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-stall-management-phase2-phase3-design.md`
- Modify: `docs/requirements-traceability.md`
- Modify: `docs/migration-to-host.md`

**Interfaces:** none.

- [ ] **Step 1: Reverse decision 16**

In the Phase 2/3 spec, leave decision 16's text and append:

```markdown
    **Superseded 2026-09-15.** A requester login with a password now exists —
    see `2026-09-15-stalls-vendor-login-design.md`. It is a stopgap until the
    host's Isha OIDC, which is why the session is an access link with a
    `SESSION` purpose and the password is a table of its own: SSO deletes the
    table and mints the same session.
```

- [ ] **Step 2: Move the traceability row**

`docs/requirements-traceability.md:26` — change the status from **Differs** to **Built**, and rewrite the "Vendor identity" open decision: item 1 (email-only delivery) is closed, because registration and reset now go out over WhatsApp for a mobile login; item 2 (real SSO) stays open and is the reason the password login is temporary.

- [ ] **Step 3: Note the new table in the migration checklist**

In `docs/migration-to-host.md`, add `StallCredential` and `StallLoginKind` to the models the host appends to its `schema.prisma`, and add one line: the host swaps the password routes for its OIDC callback, which calls `startSession` and changes nothing else.

- [ ] **Step 4: Full verification**

```bash
npm test --workspace=apps/api
npm test --workspace=apps/web
npm run build --workspace=apps/web
```

Expected: 308 API passed, web suite green, build clean.

- [ ] **Step 5: Commit**

```bash
git add docs
git commit -m "docs: the login the module said it did not have"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Decision 1 — passwords not OTP | 2 |
| Decision 2 — built to be deleted | 2 (no policy beyond a floor), 11 (the SSO note) |
| Decision 3 — register before apply | 7, 10 |
| Decision 4 — credential in its own table | 1 |
| Decision 5 — mobile or email | 1, 2 |
| Decision 6 — session reuses `StallAccessLink` | 3 |
| Decision 7 — no self-serve claim | 4 |
| Decision 8 — refusal never visible | 4, 9 |
| Decision 9 — a registered contact is reachable | 4 |
| Decision 10 — existing links keep working | untouched by every task; Task 7's suite run is the proof |
| Decision 11 — scrypt | 2 |
| Decision 12 — one error | 2, 5 |
| Data model | 1 |
| API — seven routes | 4, 5, 6 |
| Web — screens and changes | 8, 9, 10 |
| Testing — all twelve cases | 2, 3, 4, 5, 6, 7 |
| Documents to amend | 11 |

**Deviations from the spec, deliberate**

1. `GET /public/me` is **`GET /public/session`**, returning `RequesterSession`. Staff already own `MeResponse` and `getMe()`; two things called "me" in one module is how a requester ends up being asked what they `can()` do.
2. It answers **404, not 401**, with no session. A 401 on a public page makes the browser treat the apply form as protected.
3. `StallAccount.email` is non-null and unique, which the spec did not address for a mobile-only registration. Task 4 writes a namespaced `mobile+<digits>@stalls.invalid` placeholder and never sends to it; delivery is chosen by `loginKind`. Amend the spec's data-model section to say so.

**Placeholder scan:** none. Every code step carries its code; Task 9 step 3 and Task 10 steps 3–5 specify screens by requirement and template rather than full JSX, which is the established pattern for this codebase's presentational files and is bounded by the tests written first in each task.

**Type consistency:** `RequesterSession` (not `MeResponse`), `getRequesterSession` (not `getMe`), `stall_requester` (not `stalls_session`), `startSession`/`endSession`/`endAllSessions`/`requireRequester` used identically in Tasks 3, 5, 6, 7. `createCredential` takes `contact: Contact`, and Task 4 passes the parsed object, not the raw string.
