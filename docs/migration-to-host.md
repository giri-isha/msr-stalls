# Moving the stalls module into `msr-app-replit`

This repo is a staging ground. Three folders migrate verbatim; everything else
is a shell that stands in for the host and is thrown away. This is the
checklist that makes that promise concrete. Every step is a copy, an append, or
a one-line registration — none is a port.

## What moves

| From (this repo) | To (host) | Notes |
|---|---|---|
| `packages/stalls/` | `packages/stalls/` | Becomes `@msr/stalls`, next to `@msr/volunteering`. Add to root `workspaces` if not globbed. |
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
- **Person lookup in `backoffice.ts`.** `listBackoffice` and `searchPeople` read `db.person` with `personId`, `email`, `displayName`, `signInDisabled`. Confirm the host's `Person` exposes those four; rename in one file if not.
- **`recordActivity`.** The stub writes to `activity_trail`. The host's `recordActivity` takes the same `ActivityEvent` shape; if its field names differ, the adaptation is inside the host's function, not in the module.
- **Media namespace.** Every key the module mints begins `stalls/`. Construct the host's `MediaStore` for this module with that namespace, or `keyWithinNamespace` refuses every upload — loudly, which is the intended failure.
- **Print stylesheets.** `Electrical.tsx` and the chairs-and-tables challan inject `@media print` rules that hide `nav`, `header` and `aside`. If the host's shell uses different landmark elements for its chrome, add its selector to the `.msrs-noprint` list in those two files — a stray sidebar on an A4 sheet is the only thing that breaks.
