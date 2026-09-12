// The module's registration seam — what a composition root calls.
//
// Mirrors the host's `registerCycleManagementRoutes(app, deps)`: a typed deps
// object for everything the module does not own, so the module imports nothing
// from outside itself except the Foundation files that exist in the host under
// the same paths. The standalone `app.ts` passes stubs; the host's `app.ts`
// passes the real thing. The module cannot tell the difference, by design.
import type { FastifyInstance } from 'fastify';
import type { MediaStore } from '../../storage/media-namespace';
import { useStallsErrorHandler } from './http-errors';
import type { Mailer } from './mailer';
import { registerStallsPublicRoutes } from './public-routes';
import { MODULE_KEY, MODULE_NAME } from './roles';
import { registerStallsStaffRoutes } from './routes';

export interface StallsDeps {
  /** Object storage — S3 in the host, a directory here. Phase 1 registers it
   *  so the seam exists; Phase 3's FSSAI and cheque uploads use it. */
  files: MediaStore;
  /** Outbound mail. Log-only here; whatever the host provides there. */
  mail: Mailer;
  /** Absolute URL for a vendor's status page. The module does not know its own
   *  public origin — the shell does. */
  statusUrl(token: string): string;
  /** Per-IP cap on public submissions per minute. */
  publicRateLimitMax: number;
}

/** What this module declares to the Foundation's registry: key + name, nothing
 *  more (host ADR 0016). */
export const STALLS_MANIFEST = { key: MODULE_KEY, name: MODULE_NAME } as const;

export function registerStallsModule(app: FastifyInstance, deps: StallsDeps): void {
  app.register(
    async (mod) => {
      useStallsErrorHandler(mod);
      mod.register(async (pub) => registerStallsPublicRoutes(pub, deps), { prefix: '/public' });
      registerStallsStaffRoutes(mod, deps);
    },
    { prefix: `/api/m/${MODULE_KEY}` },
  );
}

export { MODULE_KEY, ROLES } from './roles';
export type { Mailer, OutboundMail } from './mailer';
