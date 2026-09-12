// Stalls — the Phase 2 and 3 staff surface: communication, onboarding and
// payment, finance, staff coupons, FSSAI review, electrical sheet, check-in,
// chairs & tables, fines and refunds. Same shape as routes.ts: authenticate →
// seam → the error handler maps.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CheckInInput,
  ClusterInput,
  ConfirmPaymentInput,
  FineInput,
  FssaiReviewInput,
  FurnitureIssueInput,
  FurnitureReturnInput,
  IssueCouponInput,
  LinksInput,
  RefundPaidInput,
  RegisteredCountInput,
  SendEmailInput,
  TemplateInput,
  TemplateKeyValue,
  ZoneCodeValue,
} from '@msr/stalls';
import { prisma } from '../../prisma';
import type { ZodTypeProvider } from '../../zod-validation';
import { bankDetailsFor } from './bank';
import {
  commsRows,
  listEmailLog,
  listTemplates,
  previewTemplate,
  sendEmails,
  sendOne,
  upsertTemplate,
} from './comms';
import { linksFor, updateLinks } from './config';
import type { StallsDeps } from './deps';
import { activeEdition } from './editions';
import * as ops from './ops';
import { confirmPayment, ensureQuote, financeRows, onboardingRows, paymentView } from './payments';
import { requireAction, requireStaff } from './roles';

const IdParams = z.object({ id: z.uuid() });
const KeyParams = z.object({ key: TemplateKeyValue });

export function registerStallsOpsRoutes(app: FastifyInstance, deps: StallsDeps): void {
  const zod = app.withTypeProvider<ZodTypeProvider>();

  // ── Communication ─────────────────────────────────────────────────────────
  zod.get('/comms/templates', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return listTemplates(prisma, edition.id);
  });

  zod.put(
    '/comms/templates/:key',
    { schema: { params: KeyParams, body: TemplateInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'comms:write');
      const edition = await activeEdition(prisma);
      return upsertTemplate(prisma, edition.id, req.params.key, req.body, caller.personId);
    },
  );

  zod.post(
    '/comms/preview',
    { schema: { body: z.object({ templateKey: TemplateKeyValue, requestId: z.uuid() }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:read');
      const edition = await activeEdition(prisma);
      return previewTemplate(prisma, edition.id, req.body.templateKey, req.body.requestId, deps);
    },
  );

  zod.post('/comms/send', { schema: { body: SendEmailInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'comms:write');
    const edition = await activeEdition(prisma);
    return sendEmails(prisma, edition.id, req.body, caller.personId, deps);
  });

  zod.get(
    '/comms/rows',
    { schema: { querystring: z.object({ requestType: z.string().optional() }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:read');
      const edition = await activeEdition(prisma);
      return commsRows(prisma, edition.id, req.query);
    },
  );

  zod.get('/requests/:id/emails', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    return listEmailLog(prisma, req.params.id);
  });

  // ── Onboarding & payment ──────────────────────────────────────────────────
  zod.get('/onboarding', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return onboardingRows(prisma, edition.id);
  });

  zod.get('/requests/:id/bank', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'finance:read');
    return (await bankDetailsFor(prisma, req.params.id)) ?? null;
  });

  zod.get('/requests/:id/payment', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    return paymentView(prisma, req.params.id, caller.personId);
  });

  zod.post('/requests/:id/payment/requote', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'comms:write');
    await ensureQuote(prisma, req.params.id, caller.personId);
    return paymentView(prisma, req.params.id, caller.personId);
  });

  zod.post('/requests/:id/payment/send', { schema: { params: IdParams } }, async (req, reply) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'comms:write');
    const edition = await activeEdition(prisma);
    await sendOne(
      prisma,
      edition.id,
      req.params.id,
      'PAYMENT_DETAILS',
      caller.personId,
      deps,
      true,
    );
    reply.status(204);
  });

  /** Finance confirms; then the module issues the staff coupon (if the request
   *  asked for staff passes) and sends the post-payment mail with FSSAI and
   *  staff-registration instructions. The mail is best-effort — a refusal to
   *  send never undoes the confirmation. */
  zod.post(
    '/requests/:id/payment/confirm',
    { schema: { params: IdParams, body: ConfirmPaymentInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'finance:write');
      const payment = await confirmPayment(prisma, req.params.id, req.body, caller.personId);
      const r = await prisma.stallRequest.findUniqueOrThrow({ where: { id: req.params.id } });
      if (r.passesStaff > 0) await ops.issueCoupon(prisma, r.id, caller.personId);
      const edition = await activeEdition(prisma);
      const mail = await sendEmails(
        prisma,
        edition.id,
        { requestIds: [r.id], templateKey: 'POST_PAYMENT', force: false },
        caller.personId,
        deps,
      );
      return { payment, postPaymentMail: mail };
    },
  );

  zod.get(
    '/finance',
    { schema: { querystring: z.object({ pending: z.coerce.boolean().optional() }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'finance:read');
      const edition = await activeEdition(prisma);
      return financeRows(prisma, edition.id, req.query.pending === true);
    },
  );

  zod.get('/config/links', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:read');
    const edition = await activeEdition(prisma);
    return linksFor(prisma, edition.id);
  });

  zod.put('/config/links', { schema: { body: LinksInput } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'config:write');
    const edition = await activeEdition(prisma);
    return updateLinks(prisma, edition.id, req.body, caller.personId);
  });

  // ── Staff coupons & FSSAI ─────────────────────────────────────────────────
  zod.post(
    '/requests/:id/coupon',
    { schema: { params: IdParams, body: IssueCouponInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:write');
      return ops.issueCoupon(prisma, req.params.id, caller.personId, req.body.maxStaff);
    },
  );

  zod.put(
    '/requests/:id/coupon/registered',
    { schema: { params: IdParams, body: RegisteredCountInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'checkin:write');
      return ops.setRegisteredCount(
        prisma,
        req.params.id,
        req.body.registeredCount,
        caller.personId,
      );
    },
  );

  zod.post(
    '/requests/:id/fssai/review',
    { schema: { params: IdParams, body: FssaiReviewInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:write');
      return ops.reviewFssai(
        prisma,
        req.params.id,
        req.body.verdict,
        req.body.reason,
        caller.personId,
      );
    },
  );

  zod.get('/requests/:id/fssai', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const f = await prisma.stallFssai.findUnique({ where: { requestId: req.params.id } });
    if (!f) return null;
    const url = deps.files.configured() ? await deps.files.presignView(f.mediaKey) : null;
    return { ...f, viewUrl: url };
  });

  // ── Electrical & venue ────────────────────────────────────────────────────
  zod.get(
    '/electrical',
    { schema: { querystring: z.object({ zoneCode: ZoneCodeValue.optional() }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'planning:read');
      const edition = await activeEdition(prisma);
      return ops.electricalRows(prisma, edition.id, req.query.zoneCode);
    },
  );

  zod.put(
    '/stalls/:number/cluster',
    { schema: { params: z.object({ number: z.string().max(10) }), body: ClusterInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'planning:write');
      const edition = await activeEdition(prisma);
      return ops.setCluster(
        prisma,
        edition.id,
        req.params.number,
        req.body.cluster,
        caller.personId,
      );
    },
  );

  // ── Check-in ──────────────────────────────────────────────────────────────
  zod.get(
    '/checkin',
    { schema: { querystring: z.object({ q: z.string().max(200).optional() }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'requests:read');
      const edition = await activeEdition(prisma);
      return ops.checkInRows(prisma, edition.id, req.query.q);
    },
  );

  zod.post(
    '/requests/:id/checkin',
    { schema: { params: IdParams, body: CheckInInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'checkin:write');
      return ops.checkIn(prisma, req.params.id, req.body, caller.personId);
    },
  );

  // ── Chairs & tables ───────────────────────────────────────────────────────
  zod.get('/furniture', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    const edition = await activeEdition(prisma);
    return ops.furnitureRows(prisma, edition.id);
  });

  zod.post(
    '/requests/:id/furniture/issue',
    { schema: { params: IdParams, body: FurnitureIssueInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'checkin:write');
      return ops.issueFurniture(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post(
    '/requests/:id/furniture/return',
    { schema: { params: IdParams, body: FurnitureReturnInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'checkin:write');
      return ops.returnFurniture(prisma, req.params.id, req.body, caller.personId);
    },
  );

  // ── Fines & refunds ───────────────────────────────────────────────────────
  zod.get('/requests/:id/fines', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'requests:read');
    return ops.listFines(prisma, req.params.id);
  });

  zod.post(
    '/requests/:id/fines',
    { schema: { params: IdParams, body: FineInput } },
    async (req, reply) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'refunds:write');
      reply.status(201);
      return ops.addFine(prisma, req.params.id, req.body, caller.personId);
    },
  );

  zod.post('/fines/:id/waive', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'refunds:write');
    return ops.waiveFine(prisma, req.params.id, caller.personId);
  });

  zod.get('/refunds', async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'finance:read');
    const edition = await activeEdition(prisma);
    return ops.refundRows(prisma, edition.id);
  });

  zod.post('/requests/:id/refund/prepare', { schema: { params: IdParams } }, async (req) => {
    const caller = await requireStaff(req, prisma);
    requireAction(caller, 'refunds:write');
    return ops.prepareRefund(prisma, req.params.id, caller.personId);
  });

  zod.post(
    '/refunds/send',
    { schema: { body: z.object({ requestIds: z.array(z.uuid()).min(1).max(500) }) } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'refunds:write');
      return { sent: await ops.sendRefundsToFinance(prisma, req.body.requestIds, caller.personId) };
    },
  );

  zod.post(
    '/requests/:id/refund/paid',
    { schema: { params: IdParams, body: RefundPaidInput } },
    async (req) => {
      const caller = await requireStaff(req, prisma);
      requireAction(caller, 'finance:write');
      return ops.markRefundPaid(prisma, req.params.id, req.body.referenceNo, caller.personId);
    },
  );
}
