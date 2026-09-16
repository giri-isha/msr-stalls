// The standalone composition root. Discarded at migration — the host's app.ts
// is the composition root there, and it adds ONE call:
//   registerStallsModule(app, { files, mail, statusUrl, publicRateLimitMax })
//
// Everything below the stalls line is the shell: dev sign-in in place of Isha
// SSO, a disk media store in place of S3, a log mailer in place of SES.
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, devLogin, getCurrentPerson } from './auth';
import { LogMailer, type Mailer } from './email';
import { type Signer, createUnconfiguredSigner } from './modules/stalls/signer';
import { type WhatsAppSender, createLoggingWhatsAppSender } from './modules/stalls/whatsapp';
import { registerStallsModule } from './modules/stalls';
import { prisma } from './prisma';
import { DEV_MEDIA_ROUTE, DiskMediaStore, devMediaDir } from './storage/disk-media-store';
import type { MediaStore } from './storage/media-namespace';
import { type ZodTypeProvider, useZodValidation } from './zod-validation';

export interface BuildOptions {
  mail?: Mailer;
  /** Injectable like the mailer, so a test can assert what went out on each
   *  channel without a provider. */
  whatsapp?: WhatsAppSender;
  signer?: Signer;
  files?: MediaStore;
  /** Where the web app is served from; used for CORS and status links. */
  webOrigin?: string;
  logger?: boolean;
}

/** A store that is honestly "not configured" — every caller degrades. */
const noStore: MediaStore = {
  configured: () => false,
  presignUpload: async () => {
    throw new Error('media store not configured');
  },
  presignView: async () => {
    throw new Error('media store not configured');
  },
  head: async () => null,
  deleteMany: async () => {},
};

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const webOrigin = opts.webOrigin ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : process.env.LOG_PRETTY
          ? { transport: { target: 'pino-pretty' } }
          : process.env.NODE_ENV !== 'test',
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  useZodValidation(app);

  const mail = opts.mail ?? new LogMailer((line) => app.log.info(line));
  const mediaDir = devMediaDir();
  const files =
    opts.files ?? (mediaDir ? new DiskMediaStore(mediaDir, 'stalls/', DEV_MEDIA_ROUTE) : noStore);

  app.get('/health', async () => ({ status: 'ok', service: 'msr-stalls-api' }));

  // ── Dev sign-in (the shell's stand-in for Isha SSO) ───────────────────────
  // Off outside development. In the host, sign-in is the OIDC handshake and
  // there is no HTTP route that mints a session from an email — its ADR 0049.
  if (process.env.NODE_ENV !== 'production') {
    const zod = app.withTypeProvider<ZodTypeProvider>();
    zod.post(
      '/api/dev/signin',
      { schema: { body: z.object({ email: z.email() }) } },
      async (req, reply) => {
        const r = await devLogin(prisma, req.body.email);
        if (!r) return reply.status(404).send({ error: 'no such backoffice member' });
        reply.setCookie(SESSION_COOKIE, r.token, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        });
        return { personId: r.personId, email: r.email };
      },
    );
    app.post('/api/dev/signout', async (_req, reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    });
    app.get('/api/dev/people', async () =>
      prisma.person.findMany({
        where: { signInDisabled: false },
        select: { personId: true, email: true, displayName: true },
        orderBy: { displayName: 'asc' },
      }),
    );
  }

  app.get('/api/me', async (req, reply) => {
    const person = await getCurrentPerson(req, prisma);
    if (!person) return reply.status(401).send({ error: 'sign in required' });
    return { personId: person.personId, email: person.email, displayName: person.displayName };
  });

  // ── Dev media (stands in for presigned S3 URLs) ───────────────────────────
  if (files instanceof DiskMediaStore) {
    app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    app.put(`${DEV_MEDIA_ROUTE}/*`, async (req, reply) => {
      const key = (req.params as { '*': string })['*'];
      await files.put(key, req.body as Buffer);
      return reply.status(204).send();
    });
    app.get(`${DEV_MEDIA_ROUTE}/*`, async (req, reply) => {
      const key = (req.params as { '*': string })['*'];
      const bytes = await files.get(key);
      if (!bytes) return reply.status(404).send();
      return reply.send(Buffer.from(bytes));
    });
  }

  // ── The module ────────────────────────────────────────────────────────────
  registerStallsModule(app, {
    files,
    mail,
    // Standalone adapters. The host supplies real ones through the same ports;
    // see `whatsapp.ts` and `signer.ts` for why each behaves as it does when
    // nothing is wired up — the WhatsApp one succeeds and logs, the signature
    // one reports itself unconfigured rather than pretending to have sent.
    whatsapp: opts.whatsapp ?? createLoggingWhatsAppSender((m) => app.log.info(m, 'whatsapp')),
    signer: opts.signer ?? createUnconfiguredSigner(),
    statusUrl: (token) => `${webOrigin}/stalls/status/${token}`,
    bankFormUrl: (token) => `${webOrigin}/stalls/bank/${token}`,
    passwordResetUrl: (token) => `${webOrigin}/stalls/reset/${token}`,
    fssaiUrl: (token) => `${webOrigin}/stalls/fssai/${token}`,
    staffRegistrationUrl: (code) => `${webOrigin}/stalls/staff/${encodeURIComponent(code)}`,
    signatureUrl: (token) => `${webOrigin}/stalls/sign/${token}`,
    publicRateLimitMax: Number(process.env.STALLS_PUBLIC_RATE_LIMIT ?? 20),
  });

  return app;
}
