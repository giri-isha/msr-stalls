// Stalls — the staff HTTP surface, mounted under /api/m/stalls/* to mirror the
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
  LogReminderInput,
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
  UpdateTemplateInput,
  ZoneCodeValue,
  ZoneInput,
  ZonePlanInput,
  actionsFor,
} from '@msr/stalls';
import { prisma } from '../../prisma';
import type { ZodTypeProvider } from '../../zod-validation';
import * as checkin from './checkin';
import * as comms from './comms';
import * as config from './config';
import { activateEdition, activeEdition, listEditions } from './editions';
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
import { ROLES, requireAction, requireStaff } from './roles';
import { requireRequestScope, scopeOf } from './scope';
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
import { grantRole, listStaff, revokeRole, searchPeople } from './staff';

const IdParams = z.object({ id: z.uuid() });
const CodeParams = z.object({ code: ZoneCodeValue });
const RoleParams = z.object({ personRef: z.uuid(), roleKey: z.string() });
const TemplateParams = z.object({ key: TemplateKeyValue });

export function registerStallsStaffRoutes(app: FastifyInstance, deps: StallsDeps): void {
  const zod = app.withTypeProvider<ZodTypeProvider>();

  // ── Me ────────────────────────────────────────────────────────────────────
  zod.get('/me', async (req): Promise<MeResponse> => {
    const caller = await requireStaff(req, prisma);
    return { ...caller, actions: actionsFor(caller.roleKeys) };
  });

  zod.get('/roles', async (req) => {
    await requireStaff(req, prisma);
    return ROLES;
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────
  zod.get('/dashboard', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return dashboardCounts(prisma, edition.id, scopeOf(caller));
  });

  // ── Requests ──────────────────────────────────────────────────────────────
  //
  // 🔴 Every route that reaches one request by id also calls
  // `requireRequestScope`. `requireAction` answers "may this person do this at
  // all"; the scope answers "to whose stall". The local welfare team holds real
  // write access and no business reading a commercial vendor's bank details,
  // and the rule is only worth declaring if every door checks it.
  zod.get('/requests', { schema: { querystring: ListRequestsQuery } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return listRequests(prisma, edition.id, req.query, scopeOf(caller));
  });

  zod.get('/requests/:id', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    await requireRequestScope(caller, prisma, req.params.id);
    return getRequest(prisma, req.params.id);
  });

  /** Correcting an application after the fact — including the bay the team and
   *  the requester settle on, which is what the stall is priced at. */
  zod.patch(
    '/requests/:id',
    { schema: { params: IdParams, body: PatchRequestInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:write');
      await requireRequestScope(caller, prisma, req.params.id);
      return patchRequest(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post(
    '/requests/:id/flag',
    { schema: { params: IdParams, body: FlagRequestInput } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:write');
      await requireRequestScope(caller, prisma, req.params.id);
      await flagRequest(prisma, req.params.id, req.body.reason, caller.personId);
      reply.status(204);
    },
  );

  zod.delete('/requests/:id/flag', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:write');
    await requireRequestScope(caller, prisma, req.params.id);
    await unflagRequest(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  // ── Selection ─────────────────────────────────────────────────────────────
  const simpleTransition =
    (fn: (db: typeof prisma, id: string, by: string) => Promise<void>) =>
    async (
      req: { params: { id: string } } & Parameters<typeof requireStaff>[0],
      reply: { status(c: number): unknown },
    ) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'selection:write');
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
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'selection:write');
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
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'selection:write');
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
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'selection:write');
    await releaseAllocation(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  zod.get(
    '/stalls/available',
    { schema: { querystring: z.object({ zoneCode: ZoneCodeValue.optional() }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'selection:read');
      const edition = await activeEdition(prisma);
      return listAvailableStalls(prisma, edition.id, req.query.zoneCode);
    },
  );

  // ── Planning ──────────────────────────────────────────────────────────────
  zod.get('/planning', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'planning:read');
    const edition = await activeEdition(prisma);
    return readPlan(prisma, edition.id);
  });

  zod.put('/planning', { schema: { body: ZonePlanInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'planning:write');
    const edition = await activeEdition(prisma);
    return writePlan(prisma, edition.id, req.body, caller.personId);
  });

  zod.post('/planning/apply', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'planning:write');
    const edition = await activeEdition(prisma);
    return applyPlan(prisma, edition.id, caller.personId);
  });

  // ── Configuration ─────────────────────────────────────────────────────────
  zod.get('/config', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:read');
    const edition = await activeEdition(prisma);
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
   *  🔴 Every staff screen that filters by bay needs this list, and the venue is
   *  redrawn every season — so a screen that carries its own copy shows last
   *  year's ground. Reading which bays exist is not configuring them: a
   *  volunteer at the counter holds `requests:read` and no business in Admin. */
  zod.get('/zones', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return config.listZones(prisma, edition.id);
  });

  zod.get('/editions', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:read');
    return listEditions(prisma);
  });

  zod.post('/editions', { schema: { body: CreateEditionInput } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    reply.status(201);
    return config.createEdition(prisma, req.body, caller.personId);
  });

  /** The season's own settings: its name, the two virtual-account prefixes
   *  Finance issues for it, and the cap on stalls one request may ask for. */
  zod.patch(
    '/editions/:id/settings',
    { schema: { params: IdParams, body: EditionSettingsInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'config:write');
      return config.updateEditionSettings(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post('/editions/:id/activate', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    await activateEdition(prisma, req.params.id);
    reply.status(204);
  });

  // Adding a bay is ordinary configuration, not a migration: the venue layout
  // is redrawn every year and `ZONE_CODES` used to be a closed union, so a new
  // bay meant a code change and a redeploy.
  zod.post('/config/zones', { schema: { body: CreateZoneInput } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    reply.status(201);
    return config.createZone(prisma, edition.id, req.body, caller.personId);
  });

  // ⚠️ Refuses while the bay holds stalls (409), rather than cascading away the
  // stalls, their allocations and the record of who stood where.
  zod.delete('/config/zones/:code', { schema: { params: CodeParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    await config.deleteZone(prisma, edition.id, req.params.code, caller.personId);
    reply.status(204);
  });

  // The planning grid's columns. Sent whole: a column left out is one the
  // edition no longer carries, and dropping one that is planned or allocated
  // against is a 409 rather than a silent loss of the count.
  zod.put('/config/plan-categories', { schema: { body: PlanCategoryInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    return config.replacePlanCategories(prisma, edition.id, req.body.categories, caller.personId);
  });

  zod.put(
    '/config/zones/:code',
    { schema: { params: CodeParams, body: ZoneInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'config:write');
      const edition = await activeEdition(prisma);
      return config.updateZone(prisma, edition.id, req.params.code, req.body, caller.personId);
    },
  );

  zod.put('/config/rate-card', { schema: { body: RateCardInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    return config.replaceRateCard(prisma, edition.id, req.body.entries, caller.personId);
  });

  zod.put('/config/charges', { schema: { body: ChargesInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    return config.updateCharges(prisma, edition.id, req.body, caller.personId);
  });

  zod.put('/config/flow', { schema: { body: FlowInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    return config.updateFlow(prisma, edition.id, req.body, caller.personId);
  });

  zod.put('/config/fine-types', { schema: { body: FineTypeInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    return config.upsertFineType(prisma, edition.id, req.body, caller.personId);
  });

  zod.post('/config/custom-fields', { schema: { body: CustomFieldInput } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    reply.status(201);
    return config.createCustomField(prisma, edition.id, req.body, caller.personId);
  });

  zod.patch(
    '/config/custom-fields/:id',
    { schema: { params: IdParams, body: CustomFieldPatch } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'config:write');
      return config.updateCustomField(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.delete('/config/custom-fields/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    await config.deleteCustomField(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  // ── Staff ─────────────────────────────────────────────────────────────────
  zod.get('/staff', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:read');
    return listStaff(prisma);
  });

  zod.get(
    '/staff/search',
    { schema: { querystring: z.object({ q: z.string().trim().min(1).max(100) }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'users:write');
      return searchPeople(prisma, req.query.q);
    },
  );

  zod.post('/staff', { schema: { body: GrantRoleInput } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'users:write');
    await grantRole(prisma, req.body, caller.personId);
    reply.status(204);
  });

  zod.delete(
    '/staff/:personRef/:roleKey',
    { schema: { params: RoleParams } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'users:write');
      await revokeRole(prisma, req.params, caller.personId);
      reply.status(204);
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2 — Communication, onboarding, money
  // ══════════════════════════════════════════════════════════════════════════

  // ── Uploads ───────────────────────────────────────────────────────────────
  // A staff-side presign, for the attachment that goes out with a template.
  // The vendor-facing one is in `public-routes.ts` and is gated by a link.
  zod.post('/uploads', { schema: { body: PresignUploadInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'comms:write');
    return presignUpload(deps.files, req.body);
  });

  // ── Communication ─────────────────────────────────────────────────────────
  zod.get('/comms/templates', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'comms:write');
    const edition = await activeEdition(prisma);
    return {
      templates: await comms.listTemplates(prisma, edition.id),
      placeholders: TEMPLATE_PLACEHOLDERS,
    };
  });

  zod.put(
    '/comms/templates/:key',
    { schema: { params: TemplateParams, body: UpdateTemplateInput } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'comms:write');
      const edition = await activeEdition(prisma);
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
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'comms:write');
      const edition = await activeEdition(prisma);
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
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'comms:write');
    const edition = await activeEdition(prisma);
    return comms.listRecipients(prisma, edition.id, scopeOf(caller));
  });

  /** Bulk and individual send are ONE route. The screen offers two buttons;
   *  a list of one is an individual send, and having a second path would be a
   *  second place for the "already sent" rule to be got wrong. */
  zod.post('/comms/send', { schema: { body: SendEmailInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'comms:write');
    const edition = await activeEdition(prisma);
    return comms.sendTemplate(prisma, edition.id, req.body, deps, caller.personId);
  });

  zod.delete(
    '/comms/sent/:id/:key',
    { schema: { params: z.object({ id: z.uuid(), key: TemplateKeyValue }) } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      // Clearing the send log so a letter can go out again is an admin act.
      requireAction(caller, 'config:write');
      await requireRequestScope(caller, prisma, req.params.id);
      await comms.clearSendLog(prisma, req.params.id, req.params.key, caller.personId);
      reply.status(204);
    },
  );

  zod.get(
    '/comms/reminders',
    { schema: { querystring: z.object({ kind: ReminderKind }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'comms:write');
      const edition = await activeEdition(prisma);
      return comms.listReminders(prisma, edition.id, req.query.kind, scopeOf(caller));
    },
  );

  zod.post(
    '/requests/:id/reminders',
    { schema: { params: IdParams, body: LogReminderInput } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'comms:write');
      await requireRequestScope(caller, prisma, req.params.id);
      await comms.logReminder(prisma, req.params.id, req.body, caller.personId);
      reply.status(204);
    },
  );

  // ── Onboarding ────────────────────────────────────────────────────────────
  zod.get('/onboarding', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return onboarding.listOnboarding(prisma, edition.id, scopeOf(caller));
  });

  zod.get('/onboarding/:id', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    await requireRequestScope(caller, prisma, req.params.id);
    return onboarding.getOnboarding(prisma, req.params.id, deps.files);
  });

  zod.post('/onboarding/:id/coupon', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:write');
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
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:write');
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
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    await requireRequestScope(caller, prisma, req.params.id);
    return signature.readSignature(prisma, req.params.id);
  });

  /** ⚠️ Idempotent: re-sending returns the agreement already open rather than
   *  opening a second one against the same stall. Two live documents is exactly
   *  the situation a signature provider cannot resolve for you. */
  zod.post('/requests/:id/signature', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'comms:write');
    await requireRequestScope(caller, prisma, req.params.id);
    return signature.sendForSignature(prisma, req.params.id, deps, caller.personId);
  });

  /** Pulls the provider's current state. Signing happens later and elsewhere,
   *  so it has to be pulled; a host that can receive the provider's webhook
   *  should call the same function from it. */
  zod.post('/requests/:id/signature/refresh', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    await requireRequestScope(caller, prisma, req.params.id);
    return signature.refreshSignature(prisma, req.params.id, deps);
  });

  zod.post(
    '/onboarding/:id/fssai/verify',
    { schema: { params: IdParams, body: z.object({ verified: z.boolean() }) } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:write');
      await requireRequestScope(caller, prisma, req.params.id);
      await onboarding.verifyFssai(prisma, req.params.id, req.body.verified, caller.personId);
      reply.status(204);
    },
  );

  zod.get('/onboarding/:id/staff', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    await requireRequestScope(caller, prisma, req.params.id);
    return onboarding.listStaffFor(prisma, req.params.id);
  });

  zod.delete('/staff-registrations/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:write');
    await onboarding.removeStaff(prisma, req.params.id, caller.personId);
    reply.status(204);
  });

  // ── Finance ───────────────────────────────────────────────────────────────
  zod.get('/finance/payments', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'finance:read');
    const edition = await activeEdition(prisma);
    return finance.listPayments(prisma, edition.id, scopeOf(caller));
  });

  zod.post(
    '/finance/payments/:id',
    { schema: { params: IdParams, body: ConfirmPaymentInput } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'finance:write');
      await requireRequestScope(caller, prisma, req.params.id);
      await finance.confirmPayment(prisma, req.params.id, req.body, caller.personId);
      reply.status(204);
    },
  );

  zod.delete('/finance/payments/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'finance:write');
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
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'finance:write');
      await requireRequestScope(caller, prisma, req.params.id);
      await finance.setDiscretionaryFee(prisma, req.params.id, req.body, caller.personId);
      reply.status(204);
    },
  );

  zod.get('/finance/refunds', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'finance:read');
    const edition = await activeEdition(prisma);
    return finance.listRefunds(prisma, edition.id, scopeOf(caller));
  });

  zod.post(
    '/finance/refunds/:id',
    { schema: { params: IdParams, body: SubmitRefundInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      // The stalls team prepares the refund; Finance pays it. `finance:write`
      // is what the Lead role does NOT hold, so this is deliberately the
      // finance action and not `requests:write`.
      requireAction(caller, 'finance:write');
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
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'finance:write');
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
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'planning:read');
      const edition = await activeEdition(prisma);
      return electricalSheet(prisma, edition.id, req.query.zoneCode);
    },
  );

  zod.get(
    '/checkin',
    { schema: { querystring: z.object({ q: z.string().trim().max(200).optional() }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:read');
      const edition = await activeEdition(prisma);
      return checkin.listCheckIns(prisma, edition.id, req.query.q, scopeOf(caller));
    },
  );

  zod.post('/checkin/:id', { schema: { params: IdParams, body: CheckInInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'checkin:write');
    await requireRequestScope(caller, prisma, req.params.id);
    return checkin.checkIn(prisma, req.params.id, req.body.note, caller.personId);
  });

  zod.delete('/checkin/:id', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'checkin:write');
    await requireRequestScope(caller, prisma, req.params.id);
    return checkin.undoCheckIn(prisma, req.params.id, caller.personId);
  });

  zod.get('/equipment', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return equipment.listEquipment(prisma, edition.id, scopeOf(caller));
  });

  zod.patch(
    '/equipment/:id',
    { schema: { params: IdParams, body: EquipmentPatch } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'checkin:write');
      await requireRequestScope(caller, prisma, req.params.id);
      return equipment.patchEquipment(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post(
    '/equipment/:id/action',
    { schema: { params: IdParams, body: z.object({ action: EquipmentAction }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'checkin:write');
      await requireRequestScope(caller, prisma, req.params.id);
      return equipment.actOnEquipment(prisma, req.params.id, req.body.action, caller.personId);
    },
  );

  zod.get('/equipment/:id/challan', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    return equipment.challan(prisma, req.params.id);
  });
}
