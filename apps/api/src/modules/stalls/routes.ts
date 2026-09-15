// Stalls — the backoffice HTTP surface, mounted under /api/m/stalls/* to mirror the
// host's /m/{key} convention. Handlers stay thin: authenticate → seam → the
// error handler maps a thrown domain error to a status.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ChargesInput,
  CheckInInput,
  ConfirmPaymentInput,
  CreateEditionInput,
  CreateZoneInput,
  CustomFieldInput,
  CustomFieldPatch,
  EditionSettingsInput,
  EquipmentAction,
  EquipmentPatch,
  FineTypeInput,
  FlagRequestInput,
  FlowInput,
  GrantRoleInput,
  ListRequestsQuery,
  ListUsersQuery,
  LogReminderInput,
  CreateRoleInput,
  type ListPrivilegesResponse,
  type ListRolesResponse,
  SaveRoleInput,
  type MeResponse,
  PatchRequestInput,
  PlanCategoryInput,
  PresignUploadInput,
  RateCardInput,
  RejectRequestInput,
  ReminderKind,
  SelectRequestInput,
  SendEmailInput,
  SetCouponCapacityInput,
  SetDiscretionaryFeeInput,
  SubmitRefundInput,
  TEMPLATE_PLACEHOLDERS,
  TemplateKeyValue,
  UpdateAccountInput,
  SetRequesterPasswordInput,
  UpdateTemplateInput,
  ZoneCodeValue,
  ZoneInput,
  ZonePlanInput,
} from '@msr/stalls';
import { prisma } from '../../prisma';
import type { ZodTypeProvider } from '../../zod-validation';
import * as checkin from './checkin';
import * as comms from './comms';
import * as config from './config';
// ⚠️ `activeEdition` itself is deliberately NOT imported here: every backoffice route
// resolves the edition through `activeEditionFor`, which refuses a caller whose
// grants do not cover it. Reaching for the unguarded one is how a route would
// quietly opt out of edition scope.
import { activateEdition, activeEditionFor, listEditions } from './editions';
import type { StallsDeps } from './deps';
import { electricalSheet } from './electrical';
import * as equipment from './equipment';
import * as finance from './finance';
import * as onboarding from './onboarding';
import { applyPlan, listAvailableStalls, readPlan, writePlan } from './planning';
import { presignUpload } from './uploads';
import {
  dashboardCounts,
  flagRequest,
  getRequest,
  listRequests,
  patchRequest,
  unflagRequest,
} from './requests';
import { UnknownRequestError } from './errors';
import { requirePrivilege, requireAnyPrivilege, requireBackoffice } from './roles';
import { requireOwnerScope, requireRequestScope, scopeOf } from './scope';
import {
  backupRequest,
  cancelRequest,
  rejectRequest,
  releaseAllocation,
  selectRequest,
  shortlist,
  unshortlist,
} from './selection';
import * as signature from './signature';
import { listUsers } from './directory';
import { listPrivileges } from './privileges';
import { createRole, deleteRole, getRole, updateRole } from './roles-admin';
import { grantRole, listRoles, listBackoffice, revokeRole, searchPeople } from './backoffice';
import {
  resendConfirmation,
  sendAccountAccessLink,
  setRequesterPassword,
  unlockAccount,
  updateAccount,
} from './support';

const IdParams = z.object({ id: z.uuid() });
const CodeParams = z.object({ code: ZoneCodeValue });
const RoleParams = z.object({ personRef: z.uuid(), roleKey: z.string() });
const RoleKeyParams = z.object({ roleKey: z.string().min(1).max(60) });
const TemplateParams = z.object({ key: TemplateKeyValue });

export function registerStallsBackofficeRoutes(app: FastifyInstance, deps: StallsDeps): void {
  const zod = app.withTypeProvider<ZodTypeProvider>();

  // ── Me ────────────────────────────────────────────────────────────────────
  zod.get('/me', async (req): Promise<MeResponse> => {
    const caller = await requireBackoffice(req, prisma);
    // `requestTypeScope` is deliberately not published: it narrows what the
    // server returns, and a screen that also filtered by it would be a second
    // opinion on the same rule.
    const { personId, displayName, roleKeys, privileges } = caller;
    return { personId, displayName, roleKeys, privileges };
  });

  zod.get('/roles', async (req): Promise<ListRolesResponse> => {
    const caller = await requireBackoffice(req, prisma);
    return { roles: await listRoles(prisma, caller) };
  });

  // ⚠️ The role LIST above is open to any backoffice member — the Users screen has to
  // be able to name the role somebody holds. Everything below composes roles and
  // is gated on `roles.write`.
  zod.get('/roles/:roleKey', { schema: { params: RoleKeyParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'roles.write');
    return getRole(prisma, caller, req.params.roleKey);
  });

  zod.post('/roles', { schema: { body: CreateRoleInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'roles.write');
    reply.status(201);
    return createRole(prisma, req.body, caller);
  });

  zod.put(
    '/roles/:roleKey',
    { schema: { params: RoleKeyParams, body: SaveRoleInput } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'roles.write');
      return updateRole(prisma, req.params.roleKey, req.body, caller);
    },
  );

  zod.delete('/roles/:roleKey', { schema: { params: RoleKeyParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'roles.write');
    await deleteRole(prisma, req.params.roleKey, caller);
    reply.status(204);
  });

  /**
   * The privilege catalogue — what the vocabulary MEANS, for the reader
   * composing a role.
   *
   * ⚠️ Read only, and there is no sibling that writes. The vocabulary is code;
   * see `privileges.ts` for why a privilege authored from a screen would be a
   * code no route enforces.
   *
   * `config.read` rather than `roles.write`: this is reference material, and the
   * same guard `GET /users` carries. Somebody who may read the configuration may
   * read what the privileges in it mean without being able to compose anything.
   */
  zod.get('/privileges', async (req): Promise<ListPrivilegesResponse> => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.read');
    return { privileges: await listPrivileges(prisma) };
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────
  zod.get('/dashboard', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    const edition = await activeEditionFor(prisma, caller);
    return dashboardCounts(prisma, edition.id, scopeOf(caller));
  });

  // ── Requests ──────────────────────────────────────────────────────────────
  //
  // 🔴 Every route that reaches one request by id also calls
  // `requireRequestScope`. `requirePrivilege` answers "may this person do this at
  // all"; the scope answers "to whose stall". The local welfare team holds real
  // write access and no business reading a commercial vendor's bank details,
  // and the rule is only worth declaring if every door checks it.
  zod.get('/requests', { schema: { querystring: ListRequestsQuery } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    const edition = await activeEditionFor(prisma, caller);
    return listRequests(prisma, edition.id, req.query, scopeOf(caller));
  });

  zod.get('/requests/:id', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return getRequest(prisma, req.params.id);
  });

  /** Correcting an application after the fact — including the bay the team and
   *  the requester settle on, which is what the stall is priced at. */
  zod.patch(
    '/requests/:id',
    { schema: { params: IdParams, body: PatchRequestInput } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'requests.write');
      await requireRequestScope(caller, prisma, req.params.id);
      return patchRequest(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post(
    '/requests/:id/flag',
    { schema: { params: IdParams, body: FlagRequestInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'requests.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await flagRequest(prisma, req.params.id, req.body.reason, caller.personId);
      reply.status(204);
    },
  );

  zod.delete('/requests/:id/flag', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.write');
    await requireRequestScope(caller, prisma, req.params.id);
    await unflagRequest(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  // ── Selection ─────────────────────────────────────────────────────────────
  const simpleTransition =
    (fn: (db: typeof prisma, id: string, by: string) => Promise<void>) =>
    async (
      req: { params: { id: string } } & Parameters<typeof requireBackoffice>[0],
      reply: { status(c: number): unknown },
    ) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'selection.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await fn(prisma, req.params.id, caller.personId);
      reply.status(204);
    };

  zod.post(
    '/requests/:id/shortlist',
    { schema: { params: IdParams } },
    simpleTransition(shortlist),
  );
  zod.post(
    '/requests/:id/unshortlist',
    { schema: { params: IdParams } },
    simpleTransition(unshortlist),
  );
  zod.post(
    '/requests/:id/backup',
    { schema: { params: IdParams } },
    simpleTransition(backupRequest),
  );
  zod.post(
    '/requests/:id/cancel',
    { schema: { params: IdParams } },
    simpleTransition(cancelRequest),
  );

  zod.post(
    '/requests/:id/reject',
    { schema: { params: IdParams, body: RejectRequestInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'selection.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await rejectRequest(prisma, req.params.id, req.body.reason, caller.personId);
      reply.status(204);
    },
  );

  /** ⚠️ `agreedZoneCode` is half of this call, not a decoration. The bay is
   *  settled at selection and the stall number days later, and the bay is what
   *  the rent is read from — so a selection that moves a vendor to another bay
   *  must carry it, or the payment letter quotes the bay they asked for rather
   *  than the one they were given. */
  zod.post(
    '/requests/:id/select',
    { schema: { params: IdParams, body: SelectRequestInput } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'selection.write');
      await requireRequestScope(caller, prisma, req.params.id);
      return selectRequest(
        prisma,
        {
          requestId: req.params.id,
          stallNumbers: req.body.stallNumbers,
          agreedZoneCode: req.body.agreedZoneCode,
        },
        caller.personId,
      );
    },
  );

  zod.delete('/allocations/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'selection.write');
    await requireOwnerScope(caller, prisma, () =>
      prisma.stallAllocation.findUnique({
        where: { id: req.params.id },
        select: { requestId: true },
      }),
    );
    await releaseAllocation(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  zod.get(
    '/stalls/available',
    { schema: { querystring: z.object({ zoneCode: ZoneCodeValue.optional() }) } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'selection.read');
      const edition = await activeEditionFor(prisma, caller);
      return listAvailableStalls(prisma, edition.id, req.query.zoneCode);
    },
  );

  // ── Planning ──────────────────────────────────────────────────────────────
  zod.get('/planning', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'planning.read');
    const edition = await activeEditionFor(prisma, caller);
    return readPlan(prisma, edition.id);
  });

  zod.put('/planning', { schema: { body: ZonePlanInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'planning.write');
    const edition = await activeEditionFor(prisma, caller);
    return writePlan(prisma, edition.id, req.body, caller.personId);
  });

  zod.post('/planning/apply', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'planning.write');
    const edition = await activeEditionFor(prisma, caller);
    return applyPlan(prisma, edition.id, caller.personId);
  });

  // ── Configuration ─────────────────────────────────────────────────────────
  zod.get('/config', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.read');
    const edition = await activeEditionFor(prisma, caller);
    const [zones, planCategories, rateCard, charges, flow, fineTypes, customFields] =
      await Promise.all([
        config.listZones(prisma, edition.id),
        config.listPlanCategories(prisma, edition.id),
        config.rateCardFor(prisma, edition.id),
        config.chargesFor(prisma, edition.id),
        config.flowFor(prisma, edition.id),
        config.listFineTypes(prisma, edition.id),
        config.listCustomFields(prisma, edition.id),
      ]);
    return { edition, zones, planCategories, rateCard, charges, flow, fineTypes, customFields };
  });

  /** The edition's bays on their own, behind `requests:read` rather than
   *  `config:read`.
   *
   *  🔴 Every backoffice screen that filters by bay needs this list, and the venue is
   *  redrawn every edition — so a screen that carries its own copy shows last
   *  year's ground. Reading which bays exist is not configuring them: a
   *  volunteer at the counter holds `requests:read` and no business in Admin. */
  zod.get('/zones', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requireAnyPrivilege(caller, ['requests.read', 'planning.read', 'electrical.read']);
    const edition = await activeEditionFor(prisma, caller);
    return config.listZones(prisma, edition.id);
  });

  zod.get('/editions', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.read');
    return listEditions(prisma);
  });

  zod.post('/editions', { schema: { body: CreateEditionInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    reply.status(201);
    return config.createEdition(prisma, req.body, caller.personId);
  });

  /** The edition's own settings: its name, the two virtual-account prefixes
   *  Finance issues for it, and the cap on stalls one request may ask for. */
  zod.patch(
    '/editions/:id/settings',
    { schema: { params: IdParams, body: EditionSettingsInput } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      return config.updateEditionSettings(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post('/editions/:id/activate', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    await activateEdition(prisma, req.params.id);
    reply.status(204);
  });

  // Adding a bay is ordinary configuration, not a migration: the venue layout
  // is redrawn every year and `ZONE_CODES` used to be a closed union, so a new
  // bay meant a code change and a redeploy.
  zod.post('/config/zones', { schema: { body: CreateZoneInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    reply.status(201);
    return config.createZone(prisma, edition.id, req.body, caller.personId);
  });

  // ⚠️ Refuses while the bay holds stalls (409), rather than cascading away the
  // stalls, their allocations and the record of who stood where.
  zod.delete('/config/zones/:code', { schema: { params: CodeParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    await config.deleteZone(prisma, edition.id, req.params.code, caller.personId);
    reply.status(204);
  });

  // The planning grid's columns. Sent whole: a column left out is one the
  // edition no longer carries, and dropping one that is planned or allocated
  // against is a 409 rather than a silent loss of the count.
  zod.put('/config/plan-categories', { schema: { body: PlanCategoryInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    return config.replacePlanCategories(prisma, edition.id, req.body.categories, caller.personId);
  });

  zod.put(
    '/config/zones/:code',
    { schema: { params: CodeParams, body: ZoneInput } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      return config.updateZone(prisma, edition.id, req.params.code, req.body, caller.personId);
    },
  );

  zod.put('/config/rate-card', { schema: { body: RateCardInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    return config.replaceRateCard(prisma, edition.id, req.body.entries, caller.personId);
  });

  zod.put('/config/charges', { schema: { body: ChargesInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    return config.updateCharges(prisma, edition.id, req.body, caller.personId);
  });

  zod.put('/config/flow', { schema: { body: FlowInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    return config.updateFlow(prisma, edition.id, req.body, caller.personId);
  });

  zod.put('/config/fine-types', { schema: { body: FineTypeInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    return config.upsertFineType(prisma, edition.id, req.body, caller.personId);
  });

  zod.post('/config/custom-fields', { schema: { body: CustomFieldInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    reply.status(201);
    return config.createCustomField(prisma, edition.id, req.body, caller.personId);
  });

  zod.patch(
    '/config/custom-fields/:id',
    { schema: { params: IdParams, body: CustomFieldPatch } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      return config.updateCustomField(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.delete('/config/custom-fields/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    await config.deleteCustomField(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  // ── Backoffice ─────────────────────────────────────────────────────────────────
  zod.get('/backoffice', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.read');
    return listBackoffice(prisma);
  });

  // ── The users directory ───────────────────────────────────────────────────

  /** Backoffice and requesters in one list, with the tile counts beside it.
   *
   *  `config:read`, the same guard `GET /backoffice` carries — this is the same
   *  population plus the accounts, and reading who has applied is what every
   *  request screen already does. */
  zod.get('/users', { schema: { querystring: ListUsersQuery } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.read');
    const edition = await activeEditionFor(prisma, caller);
    return listUsers(prisma, { ...req.query, editionId: edition.id });
  });

  /** The three support actions, all on a requester's account and all
   *  `users:write` — the action that already governs who may change who can
   *  reach this module.
   *
   *  ⚠️ Each sends to the contact the ACCOUNT holds and returns nothing. A
   *  route here that handed the link back to the caller would turn "help a
   *  vendor get in" into "read any vendor's private link", which is the one
   *  thing the whole access-link design is built to prevent. */
  zod.post('/users/:id/unlock', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'users.write');
    await unlockAccount(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  zod.post(
    '/users/:id/resend-confirmation',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'users.write');
      await resendConfirmation(prisma, deps, req.params.id, caller.personId);
      reply.status(204);
    },
  );

  zod.post('/users/:id/access-link', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'users.write');
    await sendAccountAccessLink(prisma, deps, req.params.id, caller.personId);
    reply.status(204);
  });

  /** A requester's own details, corrected.
   *
   *  `users:write`, with the support actions, because it is the same job: the
   *  desk that mails a vendor their access link is the desk that has just been
   *  told the address it goes to is wrong.
   *
   *  ⚠️ Requesters only. A backoffice row's name and address belong to the
   *  Foundation directory, which this module reads and never writes — what a
   *  backoffice row's Edit changes is the grants below. */
  zod.patch(
    '/users/:id',
    { schema: { params: IdParams, body: UpdateAccountInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'users.write');
      await updateAccount(prisma, req.params.id, req.body, caller.personId);
      reply.status(204);
    },
  );

  /** A password chosen for a requester, by somebody at a desk.
   *
   *  🔴 **`passwords.write`, NOT `users.write`, and that is the whole point of
   *  the privilege.** Every route above it sends a link to the contact the
   *  account already holds and returns nothing, which is what makes them safe
   *  for a support desk: the desk causes a vendor to receive their own way in
   *  and can never obtain it. This one hands over a password that works.
   *
   *  ⚠️ TEMPORARY. It goes with the rest of the requester password login when
   *  the host's Isha SSO lands — step 3b of `docs/migration-to-host.md`. Do not
   *  grow anything on top of it. */
  zod.post(
    '/users/:id/password',
    { schema: { params: IdParams, body: SetRequesterPasswordInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'passwords.write');
      await setRequesterPassword(prisma, req.params.id, req.body.password, caller.personId);
      reply.status(204);
    },
  );

  zod.get(
    '/backoffice/search',
    { schema: { querystring: z.object({ q: z.string().trim().min(1).max(100) }) } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'users.write');
      return searchPeople(prisma, req.query.q);
    },
  );

  zod.post('/backoffice', { schema: { body: GrantRoleInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'users.write');
    await grantRole(prisma, req.body, caller);
    reply.status(204);
  });

  zod.delete(
    '/backoffice/:personRef/:roleKey',
    { schema: { params: RoleParams } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'users.write');
      await revokeRole(prisma, req.params, caller);
      reply.status(204);
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2 — Communication, onboarding, money
  // ══════════════════════════════════════════════════════════════════════════

  // ── Uploads ───────────────────────────────────────────────────────────────
  // A backoffice-side presign, for the attachment that goes out with a template.
  // The vendor-facing one is in `public-routes.ts` and is gated by a link.
  zod.post('/uploads', { schema: { body: PresignUploadInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'comms.write');
    return presignUpload(deps.files, req.body);
  });

  // ── Communication ─────────────────────────────────────────────────────────
  zod.get('/comms/templates', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'comms.write');
    const edition = await activeEditionFor(prisma, caller);
    return {
      templates: await comms.listTemplates(prisma, edition.id),
      placeholders: TEMPLATE_PLACEHOLDERS,
    };
  });

  zod.put(
    '/comms/templates/:key',
    { schema: { params: TemplateParams, body: UpdateTemplateInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'comms.write');
      const edition = await activeEditionFor(prisma, caller);
      await comms.updateTemplate(prisma, edition.id, req.params.key, req.body, caller.personId);
      reply.status(204);
    },
  );

  zod.put(
    '/comms/templates/:key/attachment',
    {
      schema: {
        params: TemplateParams,
        body: z
          .object({
            key: z.string().trim().min(1).max(400),
            name: z.string().trim().min(1).max(300),
            bytes: z.number().int().min(0),
          })
          .nullable(),
      },
    },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'comms.write');
      const edition = await activeEditionFor(prisma, caller);
      await comms.setTemplateAttachment(
        prisma,
        edition.id,
        req.params.key,
        req.body,
        caller.personId,
      );
      reply.status(204);
    },
  );

  zod.get('/comms/recipients', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'comms.write');
    const edition = await activeEditionFor(prisma, caller);
    return comms.listRecipients(prisma, edition.id, scopeOf(caller));
  });

  /** Bulk and individual send are ONE route. The screen offers two buttons;
   *  a list of one is an individual send, and having a second path would be a
   *  second place for the "already sent" rule to be got wrong. */
  zod.post('/comms/send', { schema: { body: SendEmailInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'comms.write');
    const edition = await activeEditionFor(prisma, caller);
    return comms.sendTemplate(prisma, edition.id, req.body, deps, caller.personId);
  });

  zod.delete(
    '/comms/sent/:id/:key',
    { schema: { params: z.object({ id: z.uuid(), key: TemplateKeyValue }) } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      // Clearing the send log so a letter can go out again is an admin act.
      requirePrivilege(caller, 'config.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await comms.clearSendLog(prisma, req.params.id, req.params.key, caller.personId);
      reply.status(204);
    },
  );

  zod.get(
    '/comms/reminders',
    { schema: { querystring: z.object({ kind: ReminderKind }) } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'comms.write');
      const edition = await activeEditionFor(prisma, caller);
      return comms.listReminders(prisma, edition.id, req.query.kind, scopeOf(caller));
    },
  );

  zod.post(
    '/requests/:id/reminders',
    { schema: { params: IdParams, body: LogReminderInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'comms.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await comms.logReminder(prisma, req.params.id, req.body, caller.personId);
      reply.status(204);
    },
  );

  // ── Onboarding ────────────────────────────────────────────────────────────
  zod.get('/onboarding', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    const edition = await activeEditionFor(prisma, caller);
    return onboarding.listOnboarding(prisma, edition.id, scopeOf(caller));
  });

  zod.get('/onboarding/:id', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return onboarding.getOnboarding(prisma, req.params.id, deps.files);
  });

  zod.post('/onboarding/:id/coupon', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.write');
    await requireRequestScope(caller, prisma, req.params.id);
    const r = await prisma.stallRequest.findUnique({
      where: { id: req.params.id },
      include: { edition: true },
    });
    if (!r) throw new UnknownRequestError(req.params.id);
    const coupon = await onboarding.ensureCoupon(
      prisma,
      r.id,
      r.stallName,
      r.edition.year,
      caller.personId,
    );
    return { code: coupon.code };
  });

  /** Raising what one coupon may register.
   *
   *  🔴 Eight by default, and moved case by case: "if they want more staff
   *  members, in the back end we raise that capacity to 10, 12". It takes
   *  effect on a coupon already in the vendor's hands, so nobody has to be sent
   *  a new code. */
  zod.put(
    '/onboarding/:id/coupon/capacity',
    { schema: { params: IdParams, body: SetCouponCapacityInput } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'requests.write');
      await requireRequestScope(caller, prisma, req.params.id);
      const coupon = await onboarding.setCouponCapacity(
        prisma,
        req.params.id,
        req.body.capacity,
        caller.personId,
      );
      return { code: coupon.code, capacity: coupon.capacity };
    },
  );

  // ── Contract signature ────────────────────────────────────────────────────
  //
  // The legal team sends the stall agreement out for real digital signature and
  // asked that it happen inside this application rather than in a parallel
  // mailbox. Until these three routes existed the whole flow was reachable only
  // as a side effect of sending a selection letter, which swallows its own
  // errors — so a failed send was invisible and could not be retried.

  zod.get('/requests/:id/signature', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return signature.readSignature(prisma, req.params.id);
  });

  /** ⚠️ Idempotent: re-sending returns the agreement already open rather than
   *  opening a second one against the same stall. Two live documents is exactly
   *  the situation a signature provider cannot resolve for you. */
  zod.post('/requests/:id/signature', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'comms.write');
    await requireRequestScope(caller, prisma, req.params.id);
    return signature.sendForSignature(prisma, req.params.id, deps, caller.personId);
  });

  /** Pulls the provider's current state. Signing happens later and elsewhere,
   *  so it has to be pulled; a host that can receive the provider's webhook
   *  should call the same function from it. */
  zod.post('/requests/:id/signature/refresh', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return signature.refreshSignature(prisma, req.params.id, deps);
  });

  zod.post(
    '/onboarding/:id/fssai/verify',
    { schema: { params: IdParams, body: z.object({ verified: z.boolean() }) } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'requests.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await onboarding.verifyFssai(prisma, req.params.id, req.body.verified, caller.personId);
      reply.status(204);
    },
  );

  zod.get('/onboarding/:id/backoffice', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return onboarding.listStaffFor(prisma, req.params.id);
  });

  // ⚠️ `:id` is the registration's, not the request's — the scope check has to
  // walk to the stall it belongs to before it can answer.
  zod.delete('/staff-registrations/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.write');
    await requireOwnerScope(caller, prisma, () =>
      prisma.stallVendorStaff.findUnique({
        where: { id: req.params.id },
        select: { requestId: true },
      }),
    );
    await onboarding.removeStaff(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  // ── Finance ───────────────────────────────────────────────────────────────
  zod.get('/finance/payments', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'finance.read');
    const edition = await activeEditionFor(prisma, caller);
    return finance.listPayments(prisma, edition.id, scopeOf(caller));
  });

  zod.post(
    '/finance/payments/:id',
    { schema: { params: IdParams, body: ConfirmPaymentInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'finance.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await finance.confirmPayment(prisma, req.params.id, req.body, caller.personId);
      reply.status(204);
    },
  );

  // ⚠️ `:id` is the credit record's here, not the request's — unlike the POST
  // above it, which is addressed by request.
  zod.delete('/finance/payments/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'finance.write');
    await requireOwnerScope(caller, prisma, () =>
      prisma.stallPaymentRecord.findUnique({
        where: { id: req.params.id },
        select: { requestId: true },
      }),
    );
    await finance.deletePayment(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  /** The concession the local welfare team agreed on one stall — "for A3 the
   *  cost is 10,000; for the coconut wala, probably we will give that at
   *  5,000". Recorded beside the quote, never on top of it: what the requester
   *  was told and what they owe are two figures, and the team is entitled to
   *  see both. `null` clears it and puts the quoted figure back in force. */
  zod.put(
    '/finance/payments/:id/discretionary-fee',
    { schema: { params: IdParams, body: SetDiscretionaryFeeInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'finance.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await finance.setDiscretionaryFee(prisma, req.params.id, req.body, caller.personId);
      reply.status(204);
    },
  );

  zod.get('/finance/refunds', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'finance.read');
    const edition = await activeEditionFor(prisma, caller);
    return finance.listRefunds(prisma, edition.id, scopeOf(caller));
  });

  zod.post(
    '/finance/refunds/:id',
    { schema: { params: IdParams, body: SubmitRefundInput } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      // The stalls team prepares the refund; Finance pays it. `finance:write`
      // is what the Lead role does NOT hold, so this is deliberately the
      // finance action and not `requests:write`.
      requirePrivilege(caller, 'finance.write');
      await requireRequestScope(caller, prisma, req.params.id);
      return finance.submitRefund(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.put(
    '/finance/refunds/:id/voucher',
    {
      schema: {
        params: IdParams,
        body: z.object({ voucherRef: z.string().trim().min(1).max(100) }),
      },
    },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'finance.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await finance.setVoucherRef(prisma, req.params.id, req.body.voucherRef, caller.personId);
      reply.status(204);
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3 — Event operations
  // ══════════════════════════════════════════════════════════════════════════

  zod.get(
    '/electrical',
    { schema: { querystring: z.object({ zoneCode: ZoneCodeValue.optional() }) } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'electrical.read');
      const edition = await activeEditionFor(prisma, caller);
      return electricalSheet(prisma, edition.id, req.query.zoneCode);
    },
  );

  zod.get(
    '/checkin',
    { schema: { querystring: z.object({ q: z.string().trim().max(200).optional() }) } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'requests.read');
      const edition = await activeEditionFor(prisma, caller);
      return checkin.listCheckIns(prisma, edition.id, req.query.q, scopeOf(caller));
    },
  );

  zod.post('/checkin/:id', { schema: { params: IdParams, body: CheckInInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'checkin.write');
    await requireRequestScope(caller, prisma, req.params.id);
    return checkin.checkIn(prisma, req.params.id, req.body.note, caller.personId);
  });

  zod.delete('/checkin/:id', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'checkin.write');
    await requireRequestScope(caller, prisma, req.params.id);
    return checkin.undoCheckIn(prisma, req.params.id, caller.personId);
  });

  zod.get('/equipment', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    const edition = await activeEditionFor(prisma, caller);
    return equipment.listEquipment(prisma, edition.id, scopeOf(caller));
  });

  zod.patch(
    '/equipment/:id',
    { schema: { params: IdParams, body: EquipmentPatch } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'checkin.write');
      await requireRequestScope(caller, prisma, req.params.id);
      return equipment.patchEquipment(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post(
    '/equipment/:id/action',
    { schema: { params: IdParams, body: z.object({ action: EquipmentAction }) } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'checkin.write');
      await requireRequestScope(caller, prisma, req.params.id);
      return equipment.actOnEquipment(prisma, req.params.id, req.body.action, caller.personId);
    },
  );

  zod.get('/equipment/:id/challan', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'requests.read');
    return equipment.challan(prisma, req.params.id);
  });
}
