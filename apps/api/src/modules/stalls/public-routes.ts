// The module's ENTIRE unauthenticated surface. Three routes. Anything that a
// person without a session can reach lives in this file and nowhere else, so
// the boundary is one screen to review.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  type PublicStatusResponse,
  type SubmitRequestResponse,
  SubmitRequestInput,
} from '@msr/stalls';
import { prisma } from '../../prisma';
import type { ZodTypeProvider } from '../../zod-validation';
import { resolveAccessLink } from './accounts';
import { getPublicConfig } from './config';
import type { StallsDeps } from './deps';
import { submitRequest } from './submit';

const TokenParams = z.object({ token: z.string().min(16).max(128) });

export function registerStallsPublicRoutes(app: FastifyInstance, deps: StallsDeps): void {
  const zod = app.withTypeProvider<ZodTypeProvider>();

  /** What the form needs to render. No staff data. */
  zod.get('/config', async () => getPublicConfig(prisma));

  /** The one public write. Per-IP rate limit on top of the global one: a
   *  script cannot fill the pipeline with junk, and a real vendor never hits
   *  the cap. Strict Zod; nothing in the body reaches status, stage or money. */
  zod.post(
    '/requests',
    {
      schema: { body: SubmitRequestInput },
      config: {
        rateLimit: { max: deps.publicRateLimitMax, timeWindow: '1 minute' },
      },
    },
    async (req, reply): Promise<SubmitRequestResponse> => {
      const { reference, statusToken } = await submitRequest(prisma, req.body, {
        mail: deps.mail,
        statusUrl: deps.statusUrl,
      });
      reply.status(201);
      return { reference, statusToken };
    },
  );

  /** That vendor's own requests, and nothing else. A wrong token is a 404 —
   *  never a 403, which would confirm the token exists. Fields staff use
   *  internally (flag reason, reject reason, notes) are not here. */
  zod.get(
    '/status/:token',
    { schema: { params: TokenParams } },
    async (req): Promise<PublicStatusResponse> => {
      const link = await resolveAccessLink(prisma, req.params.token, 'STATUS');
      const requests = await prisma.stallRequest.findMany({
        where: { accountId: link.accountId },
        orderBy: { submittedAt: 'desc' },
        include: {
          allocations: { where: { releasedAt: null }, include: { stall: true } },
        },
      });
      return {
        displayName: link.account.displayName,
        requests: requests.map((r) => ({
          reference: r.reference,
          requestType: r.requestType,
          stallName: r.stallName,
          status: r.status,
          submittedAt: r.submittedAt.toISOString(),
          // A vendor learns their stall number only once SELECTED; a shortlist
          // is internal and must not read as a promise.
          allocatedStalls: r.status === 'SELECTED' ? r.allocations.map((a) => a.stall.number) : [],
        })),
      };
    },
  );
}
