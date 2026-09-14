/** The module's outbound-mail PORT. The module owns the interface; whichever
 *  shell boots it supplies the adapter through `StallsDeps.mail` — a log-only
 *  one here, SES/SMTP in the host. The module never imports a mail
 *  implementation, so the host can pick any transport without touching this
 *  folder. (This is also why it is not `../../email`: that file is a
 *  standalone-only adapter and the boundary rules forbid importing it.) */
export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Files that belong with the letter — the zone map that goes out with a
   *  selection confirmation.
   *
   *  A presigned URL rather than bytes. The module holds media-store KEYS and
   *  never reads an object into memory; a transport that can attach fetches the
   *  URL, and one that cannot appends the link. Either way a 40 MB site plan
   *  does not travel through this process. The URL is short-lived, so a
   *  transport must fetch it when it sends, not days later. */
  attachments?: Array<{ filename: string; url: string }>;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}
