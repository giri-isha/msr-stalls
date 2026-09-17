// The module's registration seam — what a composition root calls.
//
// Mirrors the host's `registerCycleManagementRoutes(app, deps)`: a typed deps
// object for everything the module does not own, so the module imports nothing
// from outside itself except the Foundation files that exist in the host under
// the same paths. The standalone `app.ts` passes stubs; the host's `app.ts`
// passes the real thing. The module cannot tell the difference, by design.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../prisma';
import { auditedMailer, auditedWhatsApp } from './audit-senders';
import type { StallsDeps } from './deps';
import { useStallsErrorHandler } from './http-errors';
import { registerStallsPublicRoutes } from './public-routes';
import { MODULE_KEY, MODULE_NAME } from './roles';
import { registerStallsBackofficeRoutes } from './routes';

/** What this module declares to the Foundation's registry: key + name, nothing
 *  more (host ADR 0016). */
export const STALLS_MANIFEST = { key: MODULE_KEY, name: MODULE_NAME } as const;

export function registerStallsModule(app: FastifyInstance, deps: StallsDeps): void {
  // Every letter the module sends is recorded, whichever transport the shell
  // supplied — see `audit-senders.ts`. Wrapped HERE so no send site has to
  // know, and so a shell that forgets cannot opt out.
  const audited: StallsDeps = {
    ...deps,
    mail: auditedMailer(prisma, deps.mail),
    whatsapp: auditedWhatsApp(prisma, deps.whatsapp),
  };
  app.register(
    async (mod) => {
      useStallsErrorHandler(mod);
      mod.register(async (pub) => registerStallsPublicRoutes(pub, audited), { prefix: '/public' });
      registerStallsBackofficeRoutes(mod, audited);
    },
    { prefix: `/api/m/${MODULE_KEY}` },
  );
}

export { auditBackofficeSignIn } from './audit';
export type { StallsDeps } from './deps';
export type { Mailer, OutboundMail } from './mailer';
export { MODULE_KEY } from './roles';
