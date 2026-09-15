# MSR Stalls — Requester Login (temporary, pre-SSO) Design

Date: 2026-09-15
Status: Approved, not yet built

## Context

The requirement has always said "The user has to register & login (SSO) using
email or phone number." The module answered it with signed links rather than a
session, and recorded that as a deliberate deviation — decision 16 of the
Phase 2/3 spec, and the one row still marked **Differs** in
`docs/requirements-traceability.md`.

This spec reverses that decision for a stated reason: a real login is coming
in the form of the host's Isha OIDC, and the team wants a requester login
before it arrives. Everything here is therefore designed to be **deleted**, not
extended. The measure of the design is how little of the module moves on the
day SSO lands.

### What already exists

| Piece | Where |
|---|---|
| Find-my-requests, emails a signed link | `public/AccessLink.tsx`, `POST /public/access-link` |
| The requester's portal — status, allocation, "Still to do", "Open the form" | `public/StatusPage.tsx`, `GET /public/status/:token` |
| Token mint/resolve with hashing, expiry, revocation, purpose narrowing | `accounts.ts` — `mintAccessLink`, `resolveAccessLink` |
| Contact normalisation for email **and** mobile | `parseContact` in `@msr/stalls/access.ts` |
| Outbound email and outbound WhatsApp ports | `mailer.ts`, `whatsapp.ts` |
| Cookie support | `@fastify/cookie`, registered in `app.ts:61` |

"See the step they are in and the form they can fill" is already built and is
not re-built here. What this spec adds is the account and the session in front
of it.

## Decisions

1. **Passwords, not OTP or magic links.** Chosen over a one-time code and over
   promoting the existing link flow. This reverses decision 16 of the Phase 2/3
   spec, which must be amended rather than left to contradict this document.

2. **It is temporary and is built to be deleted.** No password feature grows
   beyond what a stopgap needs: no "remember me", no password policy beyond a
   length floor, no account settings screen, no email-change flow.

3. **Register before you apply.** `/stalls/apply` is a gate without a session.
   This closes a hole in the current open write: `submit.ts:73` picks the
   account from the email **typed into the form**, so typing a known vendor's
   address today attaches the request to their account and mails the receipt
   there. After this the account comes from the session and the typed contact
   fields are per-request facts only.

4. **The credential is a separate table; `StallAccount` is not touched.**
   `phone` is deliberately not unique — `accounts.ts:36` records why, "two
   stalls can share a shopkeeper's number under different addresses" — so
   adding `@unique` could fail against existing rows. Login identity therefore
   lives on the credential, where uniqueness only has to hold among people who
   actually registered.

5. **Either a mobile or an email is the login.** One credential row per
   contact, both may point at one account. `parseContact` already yields
   exactly `loginKind` and `loginValue`.

6. **The session reuses `StallAccessLink`.** It is already a session store: the
   token is stored only as a SHA-256, and it has `expiresAt`, `revokedAt`, an
   account relation, and a `purpose` that `resolveAccessLink` refuses to cross.
   Login mints one and returns it as a cookie instead of a URL. Logout sets
   `revokedAt`.

7. **No self-serve claim of an existing contact.** Registering on a contact
   that already has an account does not attach a password to it. Staff do that
   linking. The village traders the welfare team files for therefore still
   cannot reach the portal themselves — unchanged from today, but not fixed
   here either. `StallCredential` is shaped to take a claim flow later.

8. **The refusal is never visible to the caller.** Decision 17 stands: the
   response is identical for a hit, a miss and a contact that does not parse.
   "Someone tried to register on this contact" goes to the contact **on the
   account**, never to whoever typed it. This is what forces registration to be
   confirmed rather than immediate — since no response can distinguish the
   cases, a session can only begin once the holder of the contact proves they
   hold it.

9. **A registered contact is a reachable contact.** A consequence of 8 worth
   naming: confirmation means a login is never built on the placeholder
   addresses the welfare team types to make the form submit.

10. **Existing signed links keep working.** `STATUS`, `BANK_FORM` and
    `FSSAI_UPLOAD` links are in inboxes already and are what people mid-
    onboarding hold. Two ways in during the transition is correct for a
    stopgap; breaking the older one would strand the vendors furthest along.

11. **`scrypt` from `node:crypto`.** No new dependency for something scheduled
    for deletion. `accounts.ts` already imports `node:crypto`. argon2id is a
    one-function swap if wanted.

12. **One error for every credential failure.** Unknown contact, wrong
    password and unconfirmed credential are indistinguishable.

13. **The requester session is named apart from the staff one.** Staff already
    hold a `msr_session` cookie, a `MeResponse` and `useMe()`. The requester
    gets `msr_stall_requester`, `RequesterSession` and `useRequester()`. Two
    things called "me" in one module is how a requester ends up being asked
    what they `can()` do.

14. **`GET /public/session` answers 404, not 401, with no session.** It is
    asked by a public page that must render for someone who has never logged
    in; a 401 would make the browser treat the apply form as protected.

15. **A mobile-only registration gets a placeholder address.**
    `StallAccount.email` is non-null and unique, so a trader registering on a
    number needs something in the column. It is
    `mobile+<digits>@stalls.invalid`, nothing ever sends to it, and delivery is
    chosen by the credential's `loginKind` rather than by that column.

## Data model

One new table. `StallAccount` is unchanged.

```prisma
model StallCredential {
  id           String              @id @default(uuid()) @db.Uuid
  accountId    String              @map("account_id") @db.Uuid
  /// Normalised by `parseContact`: a lowercased email, or bare ten digits.
  loginValue   String              @unique @map("login_value")
  loginKind    StallLoginKind      @map("login_kind")
  passwordHash String              @map("password_hash")
  /// Null until the confirmation link is followed. An unconfirmed credential
  /// cannot log in and is indistinguishable from a wrong password.
  confirmedAt  DateTime?           @map("confirmed_at") @db.Timestamptz
  failedCount  Int                 @default(0) @map("failed_count")
  lockedUntil  DateTime?           @map("locked_until") @db.Timestamptz
  createdAt    DateTime            @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime            @updatedAt @map("updated_at") @db.Timestamptz

  account StallAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@map("stall_credential")
  @@schema("stalls")
}

enum StallLoginKind { EMAIL MOBILE @@schema("stalls") }
```

`StallAccessPurpose` gains `SESSION`, `REGISTER_CONFIRM`, `PASSWORD_RESET`.
`StallAccount` gains the back-relation `credentials StallCredential[]`.

## API

All in `public-routes.ts`. Its header comment — "gated by one of exactly two
credentials", "three routes take no credential" — is wrong the moment this
lands and is updated as part of the work.

| Route | Behaviour |
|---|---|
| `POST /public/register` | `{ contact, password, displayName }` → always `202 {ok:true}` |
| `POST /public/register/confirm` | `{ token }` → confirms, mints `SESSION`, sets cookie |
| `POST /public/login` | `{ contact, password }` → `200` + cookie, or `InvalidCredentialsError` |
| `POST /public/logout` | revokes the session |
| `POST /public/password-reset` | `{ contact }` → always `202 {ok:true}` |
| `POST /public/password-reset/confirm` | `{ token, password }` → sets it, revokes every live session |
| `GET /public/session` | `RequesterSession`, or `404` with no session |

`POST /public/register` branches invisibly:

- contact free → create account if none, create unconfirmed credential, send
  the confirmation link over the contact's own channel (email or WhatsApp)
- contact taken → send "someone tried to register on this contact, please call
  the stall team" to the contact on the account
- contact does not parse → nothing sent

Session cookie: httpOnly, `Secure`, `SameSite=Lax`, 30 days, matching the
`SESSION` link's `expiresAt`.

Rate limiting: register, login and both reset routes carry
`rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' }` like
every other public route. Per-credential lockout via `failedCount` /
`lockedUntil` returns the same `InvalidCredentialsError`.

`POST /public/requests` and the form it serves now require a session, and
`submitRequest` takes `accountId` from it instead of calling
`findOrCreateAccount` on the typed email.

## Web

New, in `apps/web/src/modules/stalls/public/`: `Register.tsx`, `Login.tsx`,
`ResetPassword.tsx`, `ConfirmRegistration.tsx`.

Changed:

- `FormPicker.tsx` — without a session, the gate: Register / Log in, with the
  four tiles visible but inert beneath, so an applicant sees what they are
  signing up for. With one, exactly as today.
- `RequestForm.tsx` — requires a session; prefills requester name, email and
  contact number from the account, all still editable.
- `PublicLayout.tsx` — "logged in as …" and Log out.
- `index.tsx` — the new routes.
- `AccessLink.tsx` — unchanged. It is still the answer for everyone who never
  registers.

A `MeProvider`-shaped context (`me.tsx` already exists for staff) supplies the
session to the public tree.

## Testing

Added to the 284 that pass today:

- register creates an account and an unconfirmed credential
- register on a taken contact responds byte-identically to a free one, and the
  notice goes to the account's contact, not the caller's
- register on an unparseable contact responds identically and sends nothing
- confirm mints a session; a second use of the same token fails
- login sets the cookie; unknown contact, wrong password and unconfirmed
  credential are indistinguishable
- lockout after repeated failures returns that same error
- logout revokes; an expired session is refused
- `apply/:type` and `POST /public/requests` refuse without a session
- a submitted request attaches to the **session's** account even when a
  different email is typed into the form
- `resolveAccessLink(sessionToken, 'BANK_FORM')` throws, and a bank-form token
  is refused as a session

## Documents to amend

- `docs/superpowers/specs/2026-09-13-msr-stalls-phase2-phase3-design.md` —
  decision 16 is reversed by decision 1 here and must say so.
- `docs/requirements-traceability.md:26` — "Register and log in with email or
  phone number" moves from **Differs** to **Built**, and the "Vendor identity"
  open decision is rewritten: item 1 (email-only delivery) is closed by
  WhatsApp delivery; item 2 (real SSO) remains open and is the reason this is
  temporary.
- `docs/migration-to-host.md` — the new table and the SSO swap point.

## What SSO deletes

`StallCredential`, `StallLoginKind`, the six password routes, the four web
screens, and the `REGISTER_CONFIRM` and `PASSWORD_RESET` purposes. The OIDC
callback mints the same `SESSION` link the login route mints today. `SESSION`
stays, `StallAccount` stays, `StatusPage` stays, the portal routes stay,
`pendingSteps` stays, and no staff screen moves.
