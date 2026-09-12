// What the module needs from whoever boots it. Its own file so that
// `index.ts` (which imports the route files) and the route files (which need
// this type) do not import each other — the boundary guard forbids the cycle,
// and it is right to: a cycle here is how a module's public seam quietly grows
// into a reach into its own internals.
import type { MediaStore } from '../../storage/media-namespace';
import type { Mailer } from './mailer';

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
