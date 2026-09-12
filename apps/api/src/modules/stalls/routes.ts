// Stalls — the staff HTTP surface, mounted under /api/m/stalls/* to mirror the
// host's /m/{key} convention. Handlers stay thin: authenticate → seam → the
// error handler maps a thrown domain error to a status.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ChargesInput,
  CreateEditionInput,
  CustomFieldInput,
  CustomFieldPatch,
  FineTypeInput,
  FlagRequestInput,
  FlowInput,
  GrantRoleInput,
  ListRequestsQuery,
  type MeResponse,
  RateCardInput,
  RejectRequestInput,
  SelectRequestInput,
  ZoneCodeValue,
  ZoneInput,
  ZonePlanInput,
  actionsFor,
} from '@msr/stalls';
import { prisma } from '../../prisma';
import type { ZodTypeProvider } from '../../zod-validation';
import * as config from './config';
import { activateEdition, activeEdition, listEditions } from './editions';
import type { StallsDeps } from './deps';
import { applyPlan, listAvailableStalls, readPlan, writePlan } from './planning';
import { dashboardCounts, flagRequest, getRequest, listRequests, unflagRequest } from './requests';
import { ROLES, requireAction, requireStaff } from './roles';
import {
  backupRequest,
  cancelRequest,
  rejectRequest,
  releaseAllocation,
  selectRequest,
  shortlist,
  unshortlist,
} from './selection';
import { grantRole, listStaff, revokeRole, searchPeople } from './staff';

const IdParams = z.object({ id: z.uuid() });
const CodeParams = z.object({ code: ZoneCodeValue });
const RoleParams = z.object({ personRef: z.uuid(), roleKey: z.string() });

export function registerStallsStaffRoutes(app: FastifyInstance, _deps: StallsDeps): void {
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
    return dashboardCounts(prisma, edition.id);
  });

  // ── Requests ──────────────────────────────────────────────────────────────
  zod.get('/requests', { schema: { querystring: ListRequestsQuery } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return listRequests(prisma, edition.id, req.query);
  });

  zod.get('/requests/:id', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    return getRequest(prisma, req.params.id);
  });

  zod.post(
    '/requests/:id/flag',
    { schema: { params: IdParams, body: FlagRequestInput } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:write');
      await flagRequest(prisma, req.params.id, req.body.reason, caller.personId);
      reply.status(204);
    },
  );

  zod.delete('/requests/:id/flag', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:write');
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
      await rejectRequest(prisma, req.params.id, req.body.reason, caller.personId);
      reply.status(204);
    },
  );

  zod.post(
    '/requests/:id/select',
    { schema: { params: IdParams, body: SelectRequestInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'selection:write');
      return selectRequest(
        prisma,
        { requestId: req.params.id, stallNumbers: req.body.stallNumbers },
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
    const [zones, rateCard, charges, flow, fineTypes, customFields] = await Promise.all([
      config.listZones(prisma, edition.id),
      config.rateCardFor(prisma, edition.id),
      config.chargesFor(prisma, edition.id),
      config.flowFor(prisma, edition.id),
      config.listFineTypes(prisma, edition.id),
      config.listCustomFields(prisma, edition.id),
    ]);
    return { edition, zones, rateCard, charges, flow, fineTypes, customFields };
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

  zod.post('/editions/:id/activate', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    await activateEdition(prisma, req.params.id);
    reply.status(204);
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
}
