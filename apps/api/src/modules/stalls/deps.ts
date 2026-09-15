// What the module needs from whoever boots it. Its own file so that
// `index.ts` (which imports the route files) and the route files (which need
// this type) do not import each other — the boundary guard forbids the cycle,
// and it is right to: a cycle here is how a module's public seam quietly grows
// into a reach into its own internals.
import type { MediaStore } from '../../storage/media-namespace';
import type { Mailer } from './mailer';
import type { Signer } from './signer';
import type { WhatsAppSender } from './whatsapp';

export interface StallsDeps {
  /** Object storage — S3 in the host, a directory here. Phase 1 registers it
   *  so the seam exists; Phase 3's FSSAI and cheque uploads use it. */
  files: MediaStore;
  /** Outbound mail. Log-only here; whatever the host provides there. */
  mail: Mailer;
  /** Outbound WhatsApp. The channel a village trader actually reads — see
   *  `whatsapp.ts`. Log-only here. */
  whatsapp: WhatsAppSender;
  /** Digital signature for the stall agreement. Unconfigured here, so the
   *  signature step reports itself as not sent rather than pretending. */
  signer: Signer;
  /** Absolute URLs for the pages a vendor reaches from an email. The module
   *  does not know its own public origin — the shell does, and the host mounts
   *  these routes wherever it likes. */
  statusUrl(token: string): string;
  bankFormUrl(token: string): string;
  /** Where a new registration is confirmed. Following it is what proves the
   *  requester holds the contact they registered under — which is the only
   *  reason the register route can answer identically to everyone. */
  registerConfirmUrl(token: string): string;
  /** Where a password is reset. */
  passwordResetUrl(token: string): string;
  fssaiUrl(token: string): string;
  /** Takes the coupon CODE, not a token: the staff-registration page asks for
   *  the coupon anyway, and a vendor forwards this link to their own team. */
  staffRegistrationUrl(code: string): string;
  /** Where a requester goes to sign the stall agreement. Some providers hand
   *  back their own URL, in which case this is unused; others expect the host
   *  to host the frame. */
  signatureUrl(token: string): string;
  /** Per-IP cap on public submissions per minute. */
  publicRateLimitMax: number;
}
