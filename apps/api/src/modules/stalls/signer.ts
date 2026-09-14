import type { SignatureStatus } from '@msr/stalls';

/** The module's digital-signature PORT.
 *
 *  The legal team sends the stall agreement out through Digio for real digital
 *  signature, and the ask was that it happen inside this application rather
 *  than in a parallel mailbox. This is the seam that lets it: the module knows
 *  "a document was sent, and it came back signed", and knows nothing about any
 *  provider's API.
 *
 *  Three reasons it is a port rather than a client, in order of how likely each
 *  is to matter:
 *
 *  1. The credentials are not this module's to hold. They belong to the shell
 *     that boots it, alongside the mail transport's.
 *  2. Signature providers get re-tendered, and this one is already the second
 *     arrangement — the terms were a tick-box on a form before it.
 *  3. Every test that touches onboarding would otherwise need a live account.
 *
 *  ⚠️ The adapter maps the provider's own states into `SignatureStatus`. Every
 *  provider spells these differently and most add states that mean nothing
 *  here; doing the mapping at the edge is what keeps a provider swap from
 *  reaching the screens.
 */
export interface SignatureRequest {
  /** Who signs. Both are passed because providers differ on which they key the
   *  invitation to, and some send on both. */
  signerName: string;
  signerEmail: string;
  signerMobile: string;
  /** What the document is about, for the provider's own subject line. */
  reference: string;
  stallName: string;
  editionName: string;
}

export interface SignatureHandle {
  /** The provider's own id for the document, kept so a dispute can be traced
   *  into their audit trail without going through this application at all. */
  documentId: string;
  /** Where the requester goes to sign. Short-lived at every provider. */
  signUrl: string | null;
  status: SignatureStatus;
}

export interface Signer {
  /** Whether a provider is actually wired up. The send path asks BEFORE it
   *  writes anything, so that an unconfigured environment leaves no half-built
   *  signature row behind and a selection letter still goes out with an empty
   *  signature link rather than failing. */
  configured(): boolean;
  send(request: SignatureRequest): Promise<SignatureHandle>;
  /** Re-reads the provider's state. Signature completion is something the
   *  requester does later and elsewhere, so it has to be pulled — a webhook
   *  would be better and is what the adapter should use where the host can
   *  receive one, but the module must work without it. */
  fetch(documentId: string): Promise<SignatureHandle>;
}

/** The standalone adapter: no provider, and honest about it.
 *
 *  ⚠️ `configured()` is false, so nothing calls `send`. That is deliberately
 *  different from an adapter that pretends to send: a developer looking at the
 *  Onboarding screen sees "not sent for signature", which is true, rather than
 *  a signed agreement that does not exist. */
export function createUnconfiguredSigner(): Signer {
  return {
    configured: () => false,
    async send() {
      throw new Error('no signature provider is configured');
    },
    async fetch() {
      throw new Error('no signature provider is configured');
    },
  };
}
