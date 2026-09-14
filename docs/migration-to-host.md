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
| `apps/api/prisma/schema.prisma` — the `stalls` section only | appended to host `schema.prisma` | Add `"stalls"` to the datasource `schemas` list. Do **not** copy the `foundation` models — they are stubs for the host's real `Person` and activity trail. |
| `apps/api/prisma/migrations/*_stalls_*/` | do not copy | Generate ONE fresh migration in the host after appending the models (`prisma migrate dev --name stalls`). The stub tables must not be created there, and the two migrations here are only this repo's own history. |

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
     fssaiUrl: (token) => `${WEB_ORIGIN}/stalls/fssai/${token}`,
     staffRegistrationUrl: (code) => `${WEB_ORIGIN}/stalls/staff/${encodeURIComponent(code)}`,
     publicRateLimitMax: 20,
   });
   ```

   The four URL builders are the only place the module learns its own public
   origin. Point them wherever the host serves `stallsPublicRoutes` — they are
   what the outbound letters carry, so a wrong path here is a dead link in a
   vendor's inbox rather than a build error.

4. **Module registry** (`apps/api/src/modules.ts` or wherever `syncModuleRegistry` is fed): add `STALLS_MANIFEST` from `./modules/stalls`.

5. **Grantable roles** (`apps/api/src/module-roles.ts`): add

   ```ts
   import { ROLES as STALLS_ROLES } from './modules/stalls/roles';
   // …
   stalls: STALLS_ROLES.map((r) => r.roleKey),
   ```

   The module's own `StallStaffRole` table is what its routes check; this line only tells the console which keys it may hand out.

6. **Web routes.** In the host's router, mount `stallsStaffRoutes` under `/m/stalls` inside the host's authenticated shell, and `stallsPublicRoutes` under `/stalls` on the public side. Add `STALLS_NAV` entries to the host's nav, filtering on `requires` with the module's `useMe().can()` — or map them onto the host's own nav-item model.

7. **`MeProvider`.** The module's screens call `useMe()` for `can()`. Wrap the staff subtree in the module's `MeProvider`; it reads `/api/m/stalls/me`, which resolves the host's `Person` through the host's `getCurrentPerson` and this module's grants.

8. **Boundary rules.** The host's `.dependency-cruiser.cjs` already forbids cross-module imports. Copy the two `stalls-*` migration-guard rules from this repo's config if you want the same import allow-list enforced there.

## Things to verify after the move

- `npm run lint:boundaries` in the host: zero violations.
- `GET /api/m/stalls/public/config` answers with the active edition.
- A person with NO stalls grant gets 403 (not 401) from `/api/m/stalls/requests`.
- The API tests in `apps/api/test/*.test.ts` pass against the host's test database once `test/helpers/db.ts` is pointed at the host's `Person` model (it already uses the same field names).
- `POST /api/m/stalls/public/uploads/:token` presigns against the host's S3 store, and the returned headers are the ones the browser must send. A store whose presign ignores `content-length` makes the upload size limit advisory — check that before the first real FSSAI upload.

## Known differences to reconcile

- **Staff auth.** Here, `auth.ts` is a dev stub. In the host, `getCurrentPerson` is Isha SSO. The module never noticed; nothing to change in the module.
- **Person lookup in `staff.ts`.** `listStaff` and `searchPeople` read `db.person` with `personId`, `email`, `displayName`, `signInDisabled`. Confirm the host's `Person` exposes those four; rename in one file if not.
- **`recordActivity`.** The stub writes to `activity_trail`. The host's `recordActivity` takes the same `ActivityEvent` shape; if its field names differ, the adaptation is inside the host's function, not in the module.
- **Media namespace.** Every key the module mints begins `stalls/`. Construct the host's `MediaStore` for this module with that namespace, or `keyWithinNamespace` refuses every upload — loudly, which is the intended failure.
- **Print stylesheets.** `Electrical.tsx` and the chairs-and-tables challan inject `@media print` rules that hide `nav`, `header` and `aside`. If the host's shell uses different landmark elements for its chrome, add its selector to the `.msrs-noprint` list in those two files — a stray sidebar on an A4 sheet is the only thing that breaks.
