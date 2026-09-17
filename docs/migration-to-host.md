# Moving the stalls module into `msr-app-replit`

This repo is a staging ground. Three folders migrate verbatim; everything else
is a shell that stands in for the host and is thrown away. This is the
checklist that makes that promise concrete. Every step is a copy, an append, or
a one-line registration — none is a port.

## What moves

| From (this repo) | To (host) | Notes |
|---|---|---|
| `packages/stalls/` | `packages/stalls/` | Becomes `@stalls/core`, next to `@stalls/volunteering`. Add to root `workspaces` if not globbed. |
| `apps/api/src/modules/stalls/` | `apps/api/src/modules/stalls/` | Verbatim. Every import outside the folder resolves to a host file with the same path and signature. |
| `apps/web/src/modules/stalls/` | `apps/web/src/modules/stalls/` | Verbatim. Imports only `../../components/ui/*` and `../../lib/*`, which the host has. |
| `apps/api/prisma/schema.prisma` — the `stalls` section only | appended to host `schema.prisma` | Add `"stalls"` to the datasource `schemas` list. Do **not** copy the `foundation` models — they are stubs for the host's real `Person` and activity trail. `StallCredential` and `StallLoginKind` belong to the temporary password login and are dropped when SSO lands — see step 3b. |
| `apps/api/prisma/migrations/*_stalls_*/` | do not copy | Generate ONE fresh migration in the host after appending the models (`prisma migrate dev --name stalls`). The stub tables must not be created there, and the migrations here are only this repo's own history — including `*_backoffice_role_rename`, which renames a table that will not exist in the host until this append creates it. |

## What does not move

`apps/api/src/{app,auth,prisma,errors,zod-validation,activity,email,index,dev-signin}.ts`,
`apps/api/src/storage/*`, `apps/web/src/app/*`, `apps/web/src/main.tsx`,
`apps/web/index.html`, root configs. The host has all of these.

## Host edits, in order

1. **Schema.** Append the `stalls` enums and models. Add `"stalls"` to `schemas`. Run `npm run db:generate`, then `npm run db:migrate -- --name stalls`.

2. **Mail port.** The host has no outbound mail today. `modules/stalls/mailer.ts` declares the `Mailer` interface the module needs. Write one adapter in the host (`apps/api/src/mail.ts`, SES or SMTP) that satisfies it. This is the only piece of Foundation the module *brings*.

   `OutboundMail.attachments` carries **presigned URLs, not bytes** — the
   selection letter's zone map can be tens of megabytes and the module never
   reads an object into memory. An adapter that can attach should fetch the URL
   at send time (they are short-lived); one that cannot should append the link
   to the body. Either is correct; silently dropping them is not.

3. **Register the module** in the host's `apps/api/src/app.ts`, where the other modules are registered:

   ```ts
   import { registerStallsModule } from './modules/stalls';
   // …
   registerStallsModule(app, {
     files: mediaStore,                       // the host's S3 MediaStore, namespace 'stalls/'
     mail: mailer,                            // step 2
     statusUrl: (token) => `${WEB_ORIGIN}/stalls/status/${token}`,
     bankFormUrl: (token) => `${WEB_ORIGIN}/stalls/bank/${token}`,
     registerConfirmUrl: (token) => `${WEB_ORIGIN}/stalls/confirm/${token}`,
     passwordResetUrl: (token) => `${WEB_ORIGIN}/stalls/reset/${token}`,
     fssaiUrl: (token) => `${WEB_ORIGIN}/stalls/fssai/${token}`,
     staffRegistrationUrl: (code) => `${WEB_ORIGIN}/stalls/staff/${encodeURIComponent(code)}`,
     publicRateLimitMax: 20,
   });
   ```

   The six URL builders are the only place the module learns its own public
   origin. Point them wherever the host serves `stallsPublicRoutes` — they are
   what the outbound letters carry, so a wrong path here is a dead link in a
   vendor's inbox rather than a build error.

   `registerConfirmUrl` and `passwordResetUrl` belong to the temporary password
   login (see below) and go with it.

3b. **The requester login is a stopgap — plan to delete it.** The module ships a
   password login for external requesters because the requirement asks for one
   and the host's Isha OIDC is not available to vendors: ADR 0016 keeps them out
   of the `Person` directory. Design:
   `docs/superpowers/specs/2026-09-15-stalls-vendor-login-design.md`.

   It is built so that swapping it for OIDC touches one seam. A logged-in
   requester is a `StallAccessLink` carrying a `SESSION` purpose, minted by
   `startSession(db, accountId)` in `modules/stalls/session.ts`. To replace it:

   - have the host's OIDC callback call `startSession` and hand the token to
     `setSessionCookie` from the same file;
   - drop `StallCredential` and `StallLoginKind` from the schema, and the
     `REGISTER_CONFIRM` and `PASSWORD_RESET` purposes;
   - delete `credentials.ts`, `registration.ts`, the six password routes in
     `public-routes.ts`, and the four public screens (`Login`, `Register`,
     `ConfirmRegistration`, `ResetPassword`);
   - delete the **backoffice password edit** with them — see below;
   - keep `session.ts`, `SESSION`, `StallAccount`, the portal, and every
     backoffice screen. None of them knows which credential minted the session.

3c. **The backoffice password edit goes too, and it is the one piece of RBAC
   that does.** While this module holds its own requester passwords, a desk can
   choose one for a vendor who cannot get in — the village trader with no
   address, no smartphone, and a number shared with a shop. Under Isha SSO no
   password here is anybody's to set, so nothing in this list survives the move:

   - the `passwords.write` privilege in `PRIVILEGE_CATEGORIES`
     (`packages/stalls/rbac.ts`) and its `stall_privilege` row. Retire the row
     with `is_active = false` rather than deleting it, exactly as the seed's own
     note says: a role an admin authored may still bundle it;
   - `SetRequesterPasswordInput` in `access.ts`;
   - `setAccountPassword` in `credentials.ts` (deleted whole anyway) and
     `setRequesterPassword` + `loginContactOf` in `support.ts`;
   - `POST /users/:id/password` in `routes.ts`, and `CannotSetPasswordError`;
   - `api.setRequesterPassword` and the `SetPassword` dialog in the Users
     screen, with the key action on the row;
   - the `setting a requester's password` blocks in `test/directory.test.ts` and
     `Users.test.tsx`.

   ⚠️ The other four account actions on that screen — unlock, resend
   confirmation, access link, edit details — are NOT all in this list. Unlock
   and resend go with the passwords; the access link predates them and stays.

4. **Module registry** (`apps/api/src/modules.ts` or wherever `syncModuleRegistry` is fed): add `STALLS_MANIFEST` from `./modules/stalls`.

5. **Grantable roles** (`apps/api/src/module-roles.ts`): add

   ```ts
   import { ROLES as STALLS_ROLES } from './modules/stalls/roles';
   // …
   stalls: STALLS_ROLES.map((r) => r.roleKey),
   ```

   The module's own `StallBackofficeRole` table is what its routes check; this line only tells the console which keys it may hand out.

6. **Web routes.** In the host's router, mount `stallsBackofficeRoutes` under `/m/stalls` inside the host's authenticated shell, and `stallsPublicRoutes` under `/stalls` on the public side. Add `STALLS_NAV` entries to the host's nav, filtering on `requires` with the module's `useMe().can()` — or map them onto the host's own nav-item model.

7. **`MeProvider`.** The module's screens call `useMe()` for `can()`. Wrap the backoffice subtree in the module's `MeProvider`; it reads `/api/m/stalls/me`, which resolves the host's `Person` through the host's `getCurrentPerson` and this module's grants.

8. **Boundary rules.** The host's `.dependency-cruiser.cjs` already forbids cross-module imports. Copy the two `stalls-*` migration-guard rules from this repo's config if you want the same import allow-list enforced there.

## Things to verify after the move

- `npm run lint:boundaries` in the host: zero violations.
- `GET /api/m/stalls/public/config` answers with the active edition.
- A person with NO stalls grant gets 403 (not 401) from `/api/m/stalls/requests`.
- The API tests in `apps/api/test/*.test.ts` pass against the host's test database once `test/helpers/db.ts` is pointed at the host's `Person` model (it already uses the same field names).
- `POST /api/m/stalls/public/uploads/:token` presigns against the host's S3 store, and the returned headers are the ones the browser must send. A store whose presign ignores `content-length` makes the upload size limit advisory — check that before the first real FSSAI upload.

## Known differences to reconcile

- **Backoffice auth.** Here, `auth.ts` is a dev stub. In the host, `getCurrentPerson` is Isha SSO. The module never noticed; nothing to change in the module.
- **Person lookup in `backoffice.ts`.** `listBackoffice` and `searchPeople` read `db.person` with `personId`, `email`, `displayName`, `phone`, `staged`, `signInDisabled`. The host's `Person` has all but `staged` under those names.

- 🔴 **The module WRITES `foundation.person`, in exactly two places.** Everything else it does with that table is a read, and the two writes are both in `backoffice.ts`:

  - `stagePerson` — a human an admin adds from the Users screen, created inside the grant's transaction so a refused grant stages nobody. It mints the row with `staged: true`, meaning "claimable, nobody has signed in as them yet".
  - `updatePersonDetails` — the correction that follows from being able to create the row. Gated on `users.write` plus the same hierarchy check a grant takes.

  **What changes in the host.** The host's `Person` has no `staged` column and does not need one: a claimable row there is one whose `sso_id` is null, which is what its own onboarding seam already mints. So:

  - point `stagePerson` at the host's directory seam (`stagePerson` in its `onboarding.ts` — same name, same job, including the duplicate-address refusal) instead of writing `db.person.create` here, and drop `staged: true` with it;
  - read `staged` as `ssoId === null` in the two places that consume it — the `signInState` in `directory.ts`, and the row `searchPeople` returns;
  - delete the `staged` clearing in `devLogin` (`auth.ts`): the host's Isha callback writes `sso_id` onto the row it matched by email, which IS the claim, and `auth.ts` does not survive the move anyway.

  ⚠️ **Confirm the host wants this module writing its directory before you keep it.** The alternative is to drop the Add-user staging arm and the backoffice half of the Edit dialog, and send admins to the Admin Console's own People screen — everything else on the Users screen stands either way. What the concession buys is that a desk can put a new coordinator into the directory and give them a role in one errand, rather than waiting on somebody with console access.
- **`recordActivity` and the audit log.** The module keeps its OWN insert-only log, `stall_audit_event`, written by `audit()` in `modules/stalls/audit.ts` — that is what the Audit Logs page and a request's Activity Log tab read, and it migrates with the schema. `audit()` also forwards every event to the host's `recordActivity` with the same `ActivityEvent` shape (the subject's type, on-behalf-of and change sets ride in `detail`), so the Admin Console goes on seeing everything. `audit.ts` is the only file that imports `activity.ts`; the boundary rule `stalls-trail-through-audit-only` enforces it. **One call moves:** the standalone `app.ts` calls `auditBackofficeSignIn(prisma, person)` after its dev sign-in. In the host, make that same call from the Isha SSO callback once the `Person` is resolved — or leave it out if the host's own sign-in log is considered sufficient, in which case the `stall_backoffice.signed_in` action simply never appears.
- **Media namespace.** Every key the module mints begins `stalls/`. Construct the host's `MediaStore` for this module with that namespace, or `keyWithinNamespace` refuses every upload — loudly, which is the intended failure.
- **Print stylesheets.** `Electrical.tsx` and the chairs-and-tables challan inject `@media print` rules that hide `nav`, `header` and `aside`. If the host's shell uses different landmark elements for its chrome, add its selector to the `.stalls-noprint` list in those two files — a stray sidebar on an A4 sheet is the only thing that breaks.
