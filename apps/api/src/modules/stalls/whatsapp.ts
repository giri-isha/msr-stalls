/** The module's outbound-WhatsApp PORT, and a sibling of `mailer.ts` in every
 *  respect: the module owns the interface, whichever shell boots it supplies
 *  the adapter through `StallsDeps.whatsapp`, and the module never imports a
 *  transport.
 *
 *  ── Why a second channel at all ────────────────────────────────────────────
 *  Because the team asked for both — "we would like to send them a WhatsApp
 *  message as well as an email" — and because for a large part of the people
 *  being written to, email is not a channel that works. Village traders filed
 *  by the local welfare team routinely have no address of their own; the team
 *  puts a placeholder in the form so it will submit. A letter sent only by
 *  email is, for exactly those requesters, a letter that is never read.
 *
 *  ⚠️ No attachments, and that is not an omission. WhatsApp carries the short
 *  wording; the zone map that goes out with a selection letter rides on the
 *  email beside it. A template with an empty `whatsappBody` is email-only by
 *  design and the send path skips it silently rather than reporting a failure.
 */
export interface OutboundWhatsApp {
  /** The bare ten digits `IndianMobile` normalises to. The adapter adds
   *  whatever country prefix its provider wants — the module does not know and
   *  must not guess, because a number stored with a prefix would no longer
   *  match the one the virtual account is built from. */
  to: string;
  text: string;
  /** What this letter is about, for the audit log — so a receipt or a payment
   *  letter is filed against the request it concerns rather than floating.
   *  Transports ignore it. */
  about?: { requestId?: string; accountId?: string };
}

export interface WhatsAppSender {
  send(message: OutboundWhatsApp): Promise<void>;
}

/** The standalone adapter: writes the message where the developer can read it.
 *
 *  ⚠️ It SUCCEEDS rather than throwing. A send path that treats "no provider
 *  configured" as a delivery failure would mark every letter undeliverable in
 *  development and in any environment where WhatsApp has not been wired up yet
 *  — which is not the same thing as a number that bounced, and must not read
 *  the same on the Communication screen. Wiring a real provider is a change of
 *  adapter here and nothing else. */
export function createLoggingWhatsAppSender(
  log: (message: OutboundWhatsApp) => void,
): WhatsAppSender {
  return {
    async send(message) {
      log(message);
    },
  };
}
