// The module's ENTIRE unauthenticated surface. Anything a person without a
// session can reach lives in this file and nowhere else, so the boundary is
// one screen to review.
//
// Two kinds of route: the open ones (config, submit) and the signed-link ones
// (status, bank, FSSAI, staff, upload). A signed-link route resolves the token
// FIRST and refuses with the same 404 for unknown, expired, revoked and
// wrong-purpose, so the response never says which.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  BankDetailsInput,
  FssaiUploadInput,
  PresignUploadInput,
  type SubmitRequestResponse,
  SubmitRequestInput,
} from '@msr/stalls';
import { prisma } from '../../prisma';
import type { ZodTypeProvider } from '../../zod-validation';
import { bankView, presignUpload, submitBank } from './bank';
import { getPublicConfig } from './config';
import type { StallsDeps } from './deps';
import { fssaiView, staffView, submitFssai } from './ops';
import { statusView } from './status';
import { submitRequest } from './submit';

const TokenParams = z.object({ token: z.string().min(16).max(128) });

export function registerStallsPublicRoutes(app: FastifyInstance, deps: StallsDeps): void {
  const zod = app.withTypeProvider<ZodTypeProvider>();
  const limited = { rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' } };

  // ── Open ──────────────────────────────────────────────────────────────────

  /** What the request form needs to render. No staff data. */
  zod.get('/config', async () => getPublicConfig(prisma));

  /** The one open write. Per-IP rate limit on top of the global one. Strict
   *  Zod; nothing in the body reaches status, stage or money. */
  zod.post(
    '/requests',
    { schema: { body: SubmitRequestInput }, config: limited },
    async (req, reply): Promise<SubmitRequestResponse> => {
      const { reference, statusToken } = await submitRequest(prisma, req.body, {
        mail: deps.mail,
        statusUrl: deps.statusUrl,
      });
      reply.status(201);
      return { reference, statusToken };
    },
  );

  // ── Signed links ──────────────────────────────────────────────────────────

  /** That vendor's own requests with their onboarding steps and whichever
   *  links are open now. A wrong token is a 404 — never a 403. */
  zod.get('/status/:token', { schema: { params: TokenParams } }, async (req) =>
    statusView(prisma, req.params.token, deps),
  );

  /** The bank / GST / contract form. */
  zod.get('/bank/:token', { schema: { params: TokenParams } }, async (req) =>
    bankView(prisma, req.params.token),
  );
  zod.post(
    '/bank/:token',
    { schema: { params: TokenParams, body: BankDetailsInput }, config: limited },
    async (req) => submitBank(prisma, req.params.token, req.body),
  );

  /** An upload slot for a cheque, PAN, GST or FSSAI file. The token's purpose
   *  decides which of those it may ask for. */
  zod.post(
    '/upload/:token',
    { schema: { params: TokenParams, body: PresignUploadInput }, config: limited },
    async (req) => presignUpload(prisma, req.params.token, req.body, deps.files),
  );

  /** FSSAI certificate. */
  zod.get('/fssai/:token', { schema: { params: TokenParams } }, async (req) =>
    fssaiView(prisma, req.params.token),
  );
  zod.post(
    '/fssai/:token',
    { schema: { params: TokenParams, body: FssaiUploadInput }, config: limited },
    async (req) => submitFssai(prisma, req.params.token, req.body),
  );

  /** The staff-registration coupon and where to use it. */
  zod.get('/staff/:token', { schema: { params: TokenParams } }, async (req) =>
    staffView(prisma, req.params.token),
  );
}
