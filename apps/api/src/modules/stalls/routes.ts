// Stalls — the backoffice HTTP surface, mounted under /api/m/stalls/* to mirror the
// host's /m/{key} convention. Handlers stay thin: authenticate → seam → the
// error handler maps a thrown domain error to a status.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ChargesInput,
  type CopyPlan,
  type CopyResult,
  CopyEditionInput,
  CallQuestionPatch,
  CallScriptPatch,
  type CallFormView,
  CheckInInput,
  ConfirmPaymentInput,
  type CouponView,
  type PaymentClaimView,
  type PaymentClaimsResponse,
  ReviewPaymentClaimInput,
  CreateEditionInput,
  CreateZoneInput,
  AddCallQuestionInput,
  AddFormFieldInput,
  AddSectionInput,
  DeclarationInput,
  FormDefinitionPatch,
  FormFieldPatch,
  type ListFormsResponse,
  ReorderFieldsInput,
  RequestType,
  DeclarationPatch,
  type DeclarationRow,
  type ListDeclarationsResponse,
  EditionSettingsInput,
  EquipmentAction,
  EquipmentPatch,
  FineTypeInput,
  FlagRequestInput,
  FileBankInput,
  FileClaimInput,
  FileFssaiInput,
  FileRequestInput,
  type FileRequestResponse,
  FileStaffInput,
  FlowInput,
  GrantRoleInput,
  ListAuditQuery,
  ListRequestsQuery,
  ListUsersQuery,
  LogReminderInput,
  MoveAllocationInput,
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
  type ReminderCallView,
  RequesterLookupQuery,
  SelectRequestInput,
  SendEmailInput,
  SetCouponCapacityInput,
  SetDiscretionaryFeeInput,
  SubmitRefundInput,
  TEMPLATE_PLACEHOLDERS,
  TemplateKeyValue,
  UpdateAccountInput,
  UpdatePersonInput,
  SetRequesterPasswordInput,
  UpdateTemplateInput,
  VoidPaymentInput,
  ZoneCodeValue,
  ZoneInput,
  ZonePlanInput,
} from '@stalls/core';
import { prisma } from '../../prisma';
import type { ZodTypeProvider } from '../../zod-validation';
import * as checkin from './checkin';
import * as callForm from './call-form';
import * as comms from './comms';
import * as config from './config';
import * as declarations from './declarations';
import * as formBuilder from './form-builder';
// ⚠️ `activeEdition` itself is deliberately NOT imported here: every backoffice route
// resolves the edition through `activeEditionFor`, which refuses a caller whose
// grants do not cover it. Reaching for the unguarded one is how a route would
// quietly opt out of edition scope.
import { activateEdition, activeEditionFor, editionFor, listEditions } from './editions';
import { applyCopy, planCopy } from './edition-copy';
import type { StallsDeps } from './deps';
import { electricalSheet } from './electrical';
import * as equipment from './equipment';
import * as finance from './finance';
import * as paymentClaims from './payment-claims';
import * as onboarding from './onboarding';
import { applyPlan, listAvailableStalls, readPlan, writePlan } from './planning';
import { isOurKey, presignUpload } from './uploads';
import {
  dashboardCounts,
  flagRequest,
  getRequest,
  listRequests,
  patchRequest,
  unflagRequest,
} from './requests';
import { UnknownAccessLinkError, UnknownRequestError } from './errors';
import {
  type BackofficeCaller,
  requireAnyPrivilege,
  requireBackoffice,
  requirePrivilege,
} from './roles';
import { requireOwnerScope, requireRequestScope, scopeOf } from './scope';
import {
  backupRequest,
  cancelRequest,
  rejectRequest,
  moveAllocation,
  releaseAllocation,
  selectRequest,
  shortlist,
  unshortlist,
} from './selection';
import * as signature from './signature';
import { onBehalfOf } from './audit';
import { listAudit, requestAudit } from './audit-read';
import { getBankForm, submitBankDetails } from './bank';
import { fileRequest, fssaiFormView, lookupRequester, staffFormView } from './filing';
import { listUsers } from './directory';
import { listPrivileges } from './privileges';
import { createRole, deleteRole, getRole, updateRole } from './roles-admin';
import {
  grantRole,
  listRoles,
  listBackoffice,
  revokeRole,
  searchPeople,
  updatePersonDetails,
} from './backoffice';
import {
  sendAccountAccessLink,
  setRequesterPassword,
  unlockAccount,
  updateAccount,
} from './support';

const IdParams = z.object({ id: z.uuid() });
const CodeParams = z.object({ code: ZoneCodeValue });

/** Which edition a READ is about. Absent means the active one, which is what
 *  every screen but the Admin selector asks for. */
const EditionQuery = z.object({ editionId: z.uuid().optional() });
const RoleParams = z.object({ personRef: z.uuid(), roleKey: z.string() });
const PersonParams = z.object({ personRef: z.uuid() });
const RoleKeyParams = z.object({ roleKey: z.string().min(1).max(60) });
const TemplateParams = z.object({ key: TemplateKeyValue });

/** A declaration row as the wire carries it: dates as ISO strings, and the
 *  enum widened to a string because `DeclarationRow` is shared with the web,
 *  which has no Prisma types. */
function declarationRow(d: {
  id: string;
  key: string;
  formType: string | null;
  version: number;
  title: string;
  body: string;
  bodyTa: string | null;
  isActive: boolean;
  isCurrent: boolean;
  createdAt: Date;
  archivedAt: Date | null;
}): DeclarationRow {
  return {
    ...d,
    createdAt: d.createdAt.toISOString(),
    archivedAt: d.archivedAt?.toISOString() ?? null,
  };
}

export function registerStallsBackofficeRoutes(app: FastifyInstance, deps: StallsDeps): void {
  const zod = app.withTypeProvider<ZodTypeProvider>();

  // ── Me ────────────────────────────────────────────────────────────────────
  zod.get('/me', async (req): Promise<MeResponse> => {
    const caller = await requireBackoffice(req, prisma);
    // ⚠️ `requestTypeScope` IS published now, and only for the one screen that
    // has to know before it asks: File a Request offers the forms the caller
    // may file, and a tile that opens a form the server will refuse costs the
    // filer two pages of typing. Every LIST still narrows on the server; this
    // is not a filter the web applies.
    const { personId, displayName, roleKeys, privileges, requestTypeScope } = caller;
    return { personId, displayName, roleKeys, privileges, requestTypeScope };
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

  /** One request's own log — what happened to it, who did it, and what each
   *  field said before. `audit.read` is `sensitive`: the change sets include
   *  what a bank form said before it was corrected. */
  zod.get('/requests/:id/audit', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'audit.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return requestAudit(prisma, req.params.id);
  });

  // ── Filing on behalf of a requester ──────────────────────────────────────
  //
  // The same five writes the requester has, with a member as the actor. Each
  // is gated on its OWN privilege, then on the request's scope; the seam
  // validates, once, for both sides.

  /** Resolves a contact to an account for the requester step.
   *
   *  ⚠️ On `filing.request`, NOT the Users directory: that needs `config.read`,
   *  which a Local Welfare member does not hold. Returns who the account is and
   *  how much they already have here — never a token. */
  zod.get(
    '/requests/file/lookup',
    { schema: { querystring: RequesterLookupQuery } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'filing.request');
      const edition = await activeEditionFor(prisma, caller);
      return lookupRequester(prisma, edition.id, req.query.contact);
    },
  );

  zod.post(
    '/requests/file',
    { schema: { body: FileRequestInput } },
    async (req, reply): Promise<FileRequestResponse> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'filing.request');
      await activeEditionFor(prisma, caller);
      reply.status(201);
      return fileRequest(
        prisma,
        { mail: deps.mail, whatsapp: deps.whatsapp, statusUrl: deps.statusUrl },
        caller,
        req.body,
      );
    },
  );

  /** The request's account, for `onBehalfOf`. A request that is not there
   *  raises the same 404 the route's own lookup would. */
  const accountOf = async (id: string) => {
    const r = await prisma.stallRequest.findUnique({
      where: { id },
      select: { accountId: true },
    });
    if (!r) throw new UnknownRequestError(id);
    return r.accountId;
  };
  const filingFor = async (caller: BackofficeCaller, requestId: string) =>
    onBehalfOf(
      { personId: caller.personId, displayName: caller.displayName },
      await accountOf(requestId),
    );

  zod.get('/requests/:id/bank-form', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.bank');
    await requireRequestScope(caller, prisma, req.params.id);
    return getBankForm(prisma, req.params.id);
  });

  zod.post(
    '/requests/:id/bank',
    { schema: { params: IdParams, body: FileBankInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'filing.bank');
      await requireRequestScope(caller, prisma, req.params.id);
      const { attestation: _attested, ...body } = req.body;
      await submitBankDetails(prisma, req.params.id, body, await filingFor(caller, req.params.id));
      reply.status(204);
    },
  );

  zod.get('/requests/:id/fssai-form', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.fssai');
    await requireRequestScope(caller, prisma, req.params.id);
    return fssaiFormView(prisma, req.params.id);
  });

  zod.post(
    '/requests/:id/fssai',
    { schema: { params: IdParams, body: FileFssaiInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'filing.fssai');
      await requireRequestScope(caller, prisma, req.params.id);
      // The same rule the vendor's own upload keeps: a key sent back must be
      // one this module handed out, for this purpose.
      if (!req.body.files.every((f) => isOurKey(f.key, 'FSSAI'))) {
        throw new UnknownAccessLinkError();
      }
      const { attestation: _attested, ...body } = req.body;
      await onboarding.submitFssai(
        prisma,
        req.params.id,
        body,
        await filingFor(caller, req.params.id),
      );
      reply.status(204);
    },
  );

  zod.get('/requests/:id/staff-form', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'filing.staff');
    await requireRequestScope(caller, prisma, req.params.id);
    return staffFormView(prisma, req.params.id, {
      kind: 'BACKOFFICE',
      personId: caller.personId,
      name: caller.displayName,
    });
  });

  zod.post(
    '/requests/:id/staff',
    { schema: { params: IdParams, body: FileStaffInput } },
    async (req, reply): Promise<CouponView> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'filing.staff');
      await requireRequestScope(caller, prisma, req.params.id);
      const filing = await filingFor(caller, req.params.id);
      // 🔴 The STALL'S own coupon, found or issued — never a code from the
      // body. The capacity rule and the coupon's own audit row both still
      // hold, exactly as they do for the vendor's team registering themselves.
      const { couponCode } = await staffFormView(prisma, req.params.id, filing.actor);
      const { attestation: _attested, ...body } = req.body;
      reply.status(201);
      return onboarding.registerStaff(prisma, { ...body, couponCode }, filing);
    },
  );

  zod.post(
    '/requests/:id/payment-claim',
    { schema: { params: IdParams, body: FileClaimInput } },
    async (req, reply): Promise<PaymentClaimView> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'filing.claim');
      await requireRequestScope(caller, prisma, req.params.id);
      reply.status(201);
      return paymentClaims.submitPaymentClaim(
        prisma,
        req.params.id,
        req.body,
        await filingFor(caller, req.params.id),
      );
    },
  );

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

  /** A correction to a number already given out, kept out of DELETE + POST so
   *  the stall being moved to cannot be taken in the gap between them. */
  zod.patch(
    '/allocations/:id',
    { schema: { params: IdParams, body: MoveAllocationInput } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'selection.write');
      await requireOwnerScope(caller, prisma, () =>
        prisma.stallAllocation.findUnique({
          where: { id: req.params.id },
          select: { requestId: true },
        }),
      );
      return moveAllocation(prisma, req.params.id, req.body.stallNumber, caller.personId);
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
  /** ⚠️ `editionId` reads ANOTHER edition — the Admin screen's selector, so a
   *  past year can be compared against this one and copied from. Every WRITE
   *  below still resolves `activeEditionFor`: a write that took its edition
   *  from the caller would let a stale selector edit a closed year. */
  zod.get('/config', { schema: { querystring: EditionQuery } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.read');
    const edition = await editionFor(prisma, caller, req.query.editionId);
    const [zones, planCategories, rateCard, charges, flow, fineTypes, customFields] =
      await Promise.all([
        config.listZones(prisma, edition.id),
        config.listPlanCategories(prisma, edition.id),
        config.rateCardFor(prisma, edition.id),
        config.chargesFor(prisma, edition.id),
        config.flowView(prisma, edition.id),
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

  /** What copying a section from another edition would do. Reads only.
   *
   *  🔴 A POST that writes nothing, because the question carries a body: the
   *  source edition and the section. A GET with both in the query string would
   *  be cacheable, and a cached answer to "what would change?" is the one answer
   *  that must never be stale. */
  zod.post(
    '/config/copy/preview',
    { schema: { body: CopyEditionInput } },
    async (req): Promise<CopyPlan> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.read');
      const into = await activeEditionFor(prisma, caller);
      const from = await editionFor(prisma, caller, req.body.fromEditionId);
      return planCopy(prisma, from, into, req.body.section);
    },
  );

  /** ⚠️ The target is the ACTIVE edition and is never taken from the body. The
   *  source is resolved through `editionFor`, so a caller whose grants do not
   *  reach it is refused before anything is read. */
  zod.post(
    '/config/copy',
    { schema: { body: CopyEditionInput } },
    async (req): Promise<CopyResult> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const into = await activeEditionFor(prisma, caller);
      const from = await editionFor(prisma, caller, req.body.fromEditionId);
      return applyCopy(prisma, from, into, req.body.section, caller.personId);
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

  /* ── The form builder ────────────────────────────────────────────────────*/

  zod.get(
    '/config/forms',
    { schema: { querystring: EditionQuery } },
    async (req): Promise<ListFormsResponse> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.read');
      const edition = await editionFor(prisma, caller, req.query.editionId);
      return { forms: await formBuilder.formsFor(prisma, edition.id) };
    },
  );

  zod.patch(
    '/config/forms/:formType',
    { schema: { params: z.object({ formType: RequestType }), body: FormDefinitionPatch } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      await formBuilder.updateFormDefinition(
        prisma,
        edition.id,
        req.params.formType,
        req.body,
        caller.personId,
      );
      reply.status(204);
    },
  );

  zod.post(
    '/config/forms/:definitionId/fields',
    { schema: { params: z.object({ definitionId: z.uuid() }), body: AddFormFieldInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      reply.status(201);
      return formBuilder.addFormField(prisma, edition.id, req.params.definitionId, req.body);
    },
  );

  zod.patch(
    '/config/form-fields/:id',
    { schema: { params: IdParams, body: FormFieldPatch } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      await formBuilder.updateFormField(prisma, edition.id, req.params.id, req.body);
      reply.status(204);
    },
  );

  /** ⚠️ Refuses a built-in, and refuses an appended field that has been
   *  answered — the screen offers Delete only where both hold, and this is what
   *  makes it a rule rather than a suggestion. */
  zod.delete('/config/form-fields/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    await formBuilder.deleteFormField(prisma, edition.id, req.params.id);
    reply.status(204);
  });

  zod.put(
    '/config/forms/:definitionId/order',
    { schema: { params: z.object({ definitionId: z.uuid() }), body: ReorderFieldsInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      await formBuilder.reorderFormFields(
        prisma,
        edition.id,
        req.params.definitionId,
        req.body.fields,
      );
      reply.status(204);
    },
  );

  zod.post(
    '/config/forms/:definitionId/sections',
    { schema: { params: z.object({ definitionId: z.uuid() }), body: AddSectionInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      reply.status(201);
      return formBuilder.addSection(prisma, edition.id, req.params.definitionId, req.body);
    },
  );

  /** ⚠️ Removes the HEADING, never the questions under it — `section_id` is
   *  `ON DELETE SET NULL`, so they fall back into the form's own flow. */
  zod.delete('/config/sections/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    await formBuilder.deleteSection(prisma, edition.id, req.params.id);
    reply.status(204);
  });

  /* ── The call log form ───────────────────────────────────────────────────*/

  /** Both kinds' scripts and questions, for the Admin tab.
   *
   *  ⚠️ `config.read`, like every other tab on that screen — and NOT the gate
   *  the Log Call dialog goes through, which is `comms.read`. Writing the
   *  questions is admin work; answering them is the caller's. */
  zod.get(
    '/config/call-forms',
    { schema: { querystring: EditionQuery } },
    async (req): Promise<{ forms: CallFormView[] }> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.read');
      const edition = await editionFor(prisma, caller, req.query.editionId);
      return { forms: await callForm.listCallForms(prisma, edition.id) };
    },
  );

  zod.put(
    '/config/call-forms/:kind/script',
    { schema: { params: z.object({ kind: ReminderKind }), body: CallScriptPatch } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      await callForm.updateCallScript(
        prisma,
        edition.id,
        req.params.kind,
        req.body.script,
        caller.personId,
      );
      reply.status(204);
    },
  );

  zod.post(
    '/config/call-forms/:kind/questions',
    { schema: { params: z.object({ kind: ReminderKind }), body: AddCallQuestionInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      reply.status(201);
      return callForm.addCallQuestion(
        prisma,
        edition.id,
        req.params.kind,
        req.body,
        caller.personId,
      );
    },
  );

  zod.patch(
    '/config/call-questions/:id',
    { schema: { params: IdParams, body: CallQuestionPatch } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      await callForm.updateCallQuestion(
        prisma,
        edition.id,
        req.params.id,
        req.body,
        caller.personId,
      );
      reply.status(204);
    },
  );

  /** ⚠️ Refuses a question a call has answered — the builder offers Switch off
   *  instead, and this is what makes that a rule rather than a suggestion. */
  zod.delete('/config/call-questions/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    await callForm.deleteCallQuestion(prisma, edition.id, req.params.id, caller.personId);
    reply.status(204);
  });

  /* ── Declarations ────────────────────────────────────────────────────────*/

  /** Every VERSION, not just what is live — the screen shows the history
   *  beside the current wording, because "what did this say in January?" is
   *  the question the whole feature exists to answer. */
  zod.get(
    '/config/declarations',
    { schema: { querystring: EditionQuery } },
    async (req): Promise<ListDeclarationsResponse> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.read');
      const edition = await editionFor(prisma, caller, req.query.editionId);
      const rows = await declarations.listDeclarations(prisma, edition.id);
      return { declarations: rows.map(declarationRow) };
    },
  );

  zod.post('/config/declarations', { schema: { body: DeclarationInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'config.write');
    const edition = await activeEditionFor(prisma, caller);
    reply.status(201);
    return declarationRow(
      await declarations.createDeclaration(prisma, edition.id, req.body, caller.personId),
    );
  });

  /** ⚠️ A PATCH that may create a row. Changing the wording archives this
   *  version and returns the new one — see `updateDeclaration` for why an
   *  in-place update would rewrite what people already agreed to. The caller
   *  gets whichever row is now current, and does not have to know which
   *  happened. */
  zod.patch(
    '/config/declarations/:id',
    { schema: { params: IdParams, body: DeclarationPatch } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'config.write');
      const edition = await activeEditionFor(prisma, caller);
      return declarationRow(
        await declarations.updateDeclaration(
          prisma,
          edition.id,
          req.params.id,
          req.body,
          caller.personId,
        ),
      );
    },
  );

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
   *  ⚠️ Requesters only, and `:id` is a `StallAccount` id. A backoffice row's
   *  details live in the Foundation directory and are saved by
   *  `PATCH /backoffice/:personRef` below — a separate route because the two
   *  ids come from different tables. */
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

  /** A role handed out — to somebody in the directory, or to somebody this call
   *  puts there (`newPerson`). Still 204: the staging arm mints a `Person`, but
   *  no caller has anything to do with its id that reloading the directory does
   *  not already do, and a body on one arm and not the other would be a shape
   *  every client had to branch on. */
  zod.post('/backoffice', { schema: { body: GrantRoleInput } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'users.write');
    await grantRole(prisma, req.body, caller);
    reply.status(204);
  });

  /** A backoffice member's own name, address and number.
   *
   *  🔴 **This module WRITING the Foundation directory**, which is new and is
   *  narrow on purpose — see `updatePersonDetails` for why staging somebody
   *  from a typed address makes mending that address this module's problem too.
   *
   *  `users.write`, and separate from `PATCH /users/:id`: that one edits a
   *  `StallAccount` and this one a `Person`, the ids come from different tables,
   *  and one route deciding which by looking the id up in both would be a route
   *  that silently edits the wrong human on a collision. */
  zod.patch(
    '/backoffice/:personRef',
    { schema: { params: PersonParams, body: UpdatePersonInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'users.write');
      await updatePersonDetails(prisma, req.params.personRef, req.body, caller);
      reply.status(204);
    },
  );

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

  // ── Audit ─────────────────────────────────────────────────────────────────

  /** The edition's whole log, filtered and paged.
   *
   *  ⚠️ Request-bound rows are narrowed by the caller's requester-type and bay
   *  scope; rows about roles, bays and accounts are NOT, because they have no
   *  requester type to narrow by and hiding them would hide the configuration
   *  change that explains what a reader is looking at. */
  zod.get('/audit', { schema: { querystring: ListAuditQuery } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'audit.read');
    const edition = await activeEditionFor(prisma, caller);
    return listAudit(prisma, edition.id, scopeOf(caller), req.query);
  });

  // ── Uploads ───────────────────────────────────────────────────────────────
  // A backoffice-side presign, for the attachment that goes out with a template.
  // The vendor-facing one is in `public-routes.ts` and is gated by a link.
  zod.post('/uploads', { schema: { body: PresignUploadInput } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    // ⚠️ The privilege follows the PURPOSE. A display block's picture is part of
    // a form, authored on the Form Builder by somebody who configures the
    // edition; the template attachment is part of an email. Asking for
    // `comms.write` before a form image would mean nobody could put the venue
    // layout on a form without also being able to send mail to every vendor.
    // A display block's picture is part of a FORM, authored by somebody who
    // configures the edition; a template attachment is part of an EMAIL; a
    // cheque, PAN, GST or certificate is part of a form being filed FOR a
    // requester. An admin-added file question can sit on any of the five.
    const purpose = req.body.purpose;
    if (purpose === 'FORM_NOTE') requirePrivilege(caller, 'config.write');
    else if (purpose === 'TEMPLATE_ATTACHMENT') requirePrivilege(caller, 'comms.write');
    else if (purpose === 'FSSAI') requirePrivilege(caller, 'filing.fssai');
    else if (purpose === 'FORM_FIELD') {
      requireAnyPrivilege(caller, [
        'filing.request',
        'filing.bank',
        'filing.fssai',
        'filing.staff',
      ]);
    } else requirePrivilege(caller, 'filing.bank');
    return presignUpload(deps.files, req.body);
  });

  // ── Communication ─────────────────────────────────────────────────────────
  zod.get('/comms/templates', async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'comms.read');
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
    requirePrivilege(caller, 'comms.read');
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
      requirePrivilege(caller, 'comms.read');
      const edition = await activeEditionFor(prisma, caller);
      return comms.listReminders(prisma, edition.id, req.query.kind, scopeOf(caller));
    },
  );

  /** The script and the questions this call will ask.
   *
   *  ⚠️ `comms.read`, not `config.read`. A caller working the list has to SEE
   *  the form to fill it, and gating the read on the admin privilege would mean
   *  only admins could log a call — which is the opposite of who does. */
  zod.get(
    '/comms/call-form',
    { schema: { querystring: z.object({ kind: ReminderKind }) } },
    async (req): Promise<CallFormView> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'comms.read');
      const edition = await activeEditionFor(prisma, caller);
      return callForm.getCallForm(prisma, edition.id, req.query.kind);
    },
  );

  /** What has already been said to this vendor, newest first. */
  zod.get(
    '/requests/:id/reminders',
    { schema: { params: IdParams, querystring: z.object({ kind: ReminderKind }) } },
    async (req): Promise<ReminderCallView[]> => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'comms.read');
      await requireRequestScope(caller, prisma, req.params.id);
      return comms.listReminderCalls(prisma, req.params.id, req.query.kind);
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
    requirePrivilege(caller, 'onboarding.read');
    const edition = await activeEditionFor(prisma, caller);
    return onboarding.listOnboarding(prisma, edition.id, scopeOf(caller));
  });

  zod.get('/onboarding/:id', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'onboarding.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return onboarding.getOnboarding(prisma, req.params.id, deps.files);
  });

  /** Issues a staff coupon — the first one, or ANOTHER one.
   *
   *  🔴 Always mints. The team's second lever beside raising a capacity: "if
   *  they want more staff members" a caterer can be handed their own code
   *  rather than a share of the vendor's, and the two are counted apart so the
   *  gate can say who somebody came in with.
   *
   *  ⚠️ `issueCoupon`, not `ensureCoupon`. The idempotent one is for everything
   *  that runs on its own — a letter going out, a vendor pressing Get Your
   *  Coupon — where a second code would mean staff registering against
   *  something nobody is counting. This route is a person pressing a button
   *  that says New Coupon, and it must do what it says. */
  zod.post('/onboarding/:id/coupon', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'onboarding.write');
    await requireRequestScope(caller, prisma, req.params.id);
    const r = await prisma.stallRequest.findUnique({
      where: { id: req.params.id },
      include: { edition: true },
    });
    if (!r) throw new UnknownRequestError(req.params.id);
    const coupon = await onboarding.issueCoupon(
      prisma,
      r.id,
      r.stallName,
      r.edition.year,
      caller.personId,
    );
    return { id: coupon.id, code: coupon.code, capacity: coupon.capacity };
  });

  /** Raising what one coupon may register.
   *
   *  🔴 Eight by default, and moved case by case: "if they want more staff
   *  members, in the back end we raise that capacity to 10, 12". It takes
   *  effect on a coupon already in the vendor's hands, so nobody has to be sent
   *  a new code. */
  zod.put(
    '/onboarding/:id/coupons/:couponId/capacity',
    {
      schema: {
        params: IdParams.extend({ couponId: z.string().uuid() }),
        body: SetCouponCapacityInput,
      },
    },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'onboarding.write');
      // ⚠️ Scoped on the REQUEST in the path, and `setCouponCapacity` then
      // refuses a coupon that does not belong to it — otherwise the id in the
      // path would be a way past the scope check above.
      await requireRequestScope(caller, prisma, req.params.id);
      const coupon = await onboarding.setCouponCapacity(
        prisma,
        req.params.id,
        req.params.couponId,
        req.body.capacity,
        caller.personId,
      );
      return { id: coupon.id, code: coupon.code, capacity: coupon.capacity };
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
    requirePrivilege(caller, 'onboarding.read');
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
    requirePrivilege(caller, 'onboarding.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return signature.refreshSignature(prisma, req.params.id, deps);
  });

  zod.post(
    '/onboarding/:id/fssai/verify',
    { schema: { params: IdParams, body: z.object({ verified: z.boolean() }) } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'onboarding.write');
      await requireRequestScope(caller, prisma, req.params.id);
      await onboarding.verifyFssai(prisma, req.params.id, req.body.verified, caller.personId);
      reply.status(204);
    },
  );

  zod.get('/onboarding/:id/backoffice', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'onboarding.read');
    await requireRequestScope(caller, prisma, req.params.id);
    return onboarding.listStaffFor(prisma, req.params.id);
  });

  // ⚠️ `:id` is the registration's, not the request's — the scope check has to
  // walk to the stall it belongs to before it can answer.
  zod.delete('/staff-registrations/:id', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'onboarding.write');
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

  /** The claims queue: what requesters say they have paid and finance has not
   *  yet settled.
   *
   *  ⚠️ `finance.read`, the same privilege as the payments list. A claim names
   *  a bank reference and an amount, which is the same class of information. */
  zod.get('/finance/claims', async (req): Promise<PaymentClaimsResponse> => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'finance.read');
    const edition = await activeEditionFor(prisma, caller);
    return { claims: await paymentClaims.pendingClaims(prisma, edition.id) };
  });

  /** Settling one.
   *
   *  🔴 `finance.write`: verifying writes a `StallPaymentRecord`, which is the
   *  row that makes the money real and advances the stage. */
  zod.post(
    '/finance/claims/:id',
    { schema: { params: IdParams, body: ReviewPaymentClaimInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'finance.write');
      const edition = await activeEditionFor(prisma, caller);
      await paymentClaims.reviewPaymentClaim(
        prisma,
        edition.id,
        req.params.id,
        req.body,
        caller.personId,
      );
      reply.status(204);
    },
  );

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

  /** Withdraw a credit entered in error.
   *
   *  🔴 A POST, not a DELETE. The row is kept and marked — see
   *  `finance.voidPayment`. There is no route that destroys a confirmed credit:
   *  a deleted one leaves the vendor's "why has my payment disappeared?"
   *  answerable only from the audit log.
   *
   *  ⚠️ `:id` is the credit record's here, not the request's — unlike the POST
   *  above it, which is addressed by request. */
  zod.post(
    '/finance/payments/:id/void',
    { schema: { params: IdParams, body: VoidPaymentInput } },
    async (req, reply) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'finance.write');
      await requireOwnerScope(caller, prisma, () =>
        prisma.stallPaymentRecord.findUnique({
          where: { id: req.params.id },
          select: { requestId: true },
        }),
      );
      await finance.voidPayment(prisma, req.params.id, req.body, caller.personId);
      reply.status(204);
    },
  );

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
      // 🔴 `concession.write`, not `finance.write`. Agreeing the fee happens in
      // the negotiation — a lead on the Select dialog, the local welfare team
      // for their own villages — while confirming a credit against a bank
      // statement is Finance's separate job. Gating both on one privilege meant
      // the people who actually agree the figure could not record it.
      requirePrivilege(caller, 'concession.write');
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
      requirePrivilege(caller, 'checkin.read');
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
    requirePrivilege(caller, 'equipment.read');
    const edition = await activeEditionFor(prisma, caller);
    return equipment.listEquipment(prisma, edition.id, scopeOf(caller));
  });

  zod.patch(
    '/equipment/:id',
    { schema: { params: IdParams, body: EquipmentPatch } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'equipment.write');
      await requireRequestScope(caller, prisma, req.params.id);
      return equipment.patchEquipment(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post(
    '/equipment/:id/action',
    { schema: { params: IdParams, body: z.object({ action: EquipmentAction }) } },
    async (req) => {
      const caller = await requireBackoffice(req, prisma);
      requirePrivilege(caller, 'equipment.write');
      await requireRequestScope(caller, prisma, req.params.id);
      return equipment.actOnEquipment(prisma, req.params.id, req.body.action, caller.personId);
    },
  );

  zod.get('/equipment/:id/challan', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireBackoffice(req, prisma);
    requirePrivilege(caller, 'equipment.read');
    return equipment.challan(prisma, req.params.id);
  });
}
