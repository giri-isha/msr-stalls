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
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}
