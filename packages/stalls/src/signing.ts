/** The signed contract.
 *
 *  ── What changed on the ground ─────────────────────────────────────────────
 *  The terms used to be a tick-box at the bottom of the request form, and an
 *  acknowledgement timestamp was a fair record of it. It is not any more: the
 *  legal team now sends the agreement out for real digital signature through
 *  Digio, and the ask is that it happen inside this application rather than in
 *  a parallel mailbox — "so they can have that in the app, and they can do the
 *  digital signing".
 *
 *  A tick-box and a signature are not the same artefact. One says a person saw
 *  a paragraph; the other is a document with an audit trail that can be
 *  produced if a stall is ever in dispute. Keeping only the first would mean
 *  the signature exists, but nowhere the stall team can see it — which is the
 *  state the team asked to leave.
 *
 *  ── Why the provider is behind a port ──────────────────────────────────────
 *  `Signer` in the API's `deps.ts` is a port, like `Mailer`. The module knows
 *  "a document was sent for signature, and it came back signed"; it does not
 *  know Digio's API shape. Three reasons, in order of how likely each is to
 *  matter: the credentials are not this module's to hold; signature providers
 *  get re-tendered and this one is already the second; and every test in the
 *  suite would otherwise need a live account to run.
 *
 *  ⚠️ The status below is the module's OWN vocabulary, not the provider's.
 *  Providers each spell these differently and add states that mean nothing
 *  here; the adapter maps into this set, so a provider swap never reaches the
 *  screens.
 */

export const SIGNATURE_STATUSES = [
  /** Nothing has been sent. The default for every request. */
  'NOT_SENT',
  /** Sent, and the requester has not finished. */
  'SENT',
  'SIGNED',
  /** The requester actively refused, which is different from not having got to
   *  it — it needs a phone call, not a reminder. */
  'DECLINED',
  /** The provider expired the request, or it was withdrawn. */
  'EXPIRED',
  /** The provider rejected the send. Carries `error` for the team to read. */
  'FAILED',
] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

/** Still waiting on the requester — what a reminder call is for. */
export function isSignaturePending(status: SignatureStatus): boolean {
  return status === 'SENT';
}

/** Settled one way or the other, so the team can stop chasing. */
export function isSignatureClosed(status: SignatureStatus): boolean {
  return status === 'SIGNED' || status === 'DECLINED' || status === 'EXPIRED';
}

/** What the stall team is told, in one line, on the onboarding list. */
export const SIGNATURE_LABEL: Record<SignatureStatus, string> = {
  NOT_SENT: 'Not sent for signature',
  SENT: 'Awaiting signature',
  SIGNED: 'Signed',
  DECLINED: 'Declined by requester',
  EXPIRED: 'Signature request expired',
  FAILED: 'Could not be sent',
};

/** Only vendors sign. Local welfare stalls are filed by the welfare team on a
 *  trader's behalf and ashram departments are internal — neither has a
 *  counterparty to sign an agreement with, and sending one would be asking a
 *  colleague to countersign their own department's requisition. */
export function needsSignature(requestType: string): boolean {
  return requestType === 'VENDOR';
}
