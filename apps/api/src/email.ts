// FOUNDATION STUB — outbound mail. The host has no mail sender today (it uses
// web-push), so this file is the one Foundation piece the stalls module will
// BRING to the host rather than find there. It is therefore kept to a port and
// one adapter, so the host can supply an SES/SMTP adapter behind the same
// interface without the module changing.
//
// The module never imports this file. It receives a `Mailer` through
// `StallsDeps` — see modules/stalls/index.ts.

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: OutboundMail): Promise<void>;
}

/** Logs instead of sending. What every environment without SMTP credentials
 *  gets, and what the test suite gets: a test can read `sent` to assert that a
 *  receipt went to the right address without any network. */
export class LogMailer implements Mailer {
  readonly sent: OutboundMail[] = [];
  constructor(private readonly log: (line: string) => void = () => {}) {}

  async send(mail: OutboundMail): Promise<void> {
    this.sent.push(mail);
    this.log(`[mail] to=${mail.to} subject=${JSON.stringify(mail.subject)}`);
  }
}
