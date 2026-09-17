// Two decorators that write a row for every letter the module sends.
//
// ⚠️ Wrapped at REGISTRATION (`index.ts`), around whatever the shell supplied,
// so every send in the module is recorded without any send site knowing. The
// row is SYSTEM/SYSTEM: nobody pressed "send this one email" — a member
// pressed Send Letters, or a requester submitted a form, and THAT is already a
// row of its own. This is the delivery, and delivery is the transport's act.
//
// ⚠️ Best-effort. A failure to write the row is swallowed; a failure to SEND
// is recorded as FAILED and re-thrown, so the caller's own handling — the
// comms screen undoing its log, a submission standing regardless — is
// unchanged.
import { audit } from './audit';
import type { Db } from './editions';
import type { Mailer, OutboundMail } from './mailer';
import type { OutboundWhatsApp, WhatsAppSender } from './whatsapp';

type SendAction =
  | 'stall_email.sent'
  | 'stall_email.failed'
  | 'stall_whatsapp.sent'
  | 'stall_whatsapp.failed';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function auditedMailer(db: Db, inner: Mailer): Mailer {
  return {
    async send(mail: OutboundMail) {
      try {
        await inner.send(mail);
      } catch (err) {
        await record(db, 'stall_email.failed', mail, { error: message(err) });
        throw err;
      }
      await record(db, 'stall_email.sent', mail, {});
    },
  };
}

export function auditedWhatsApp(db: Db, inner: WhatsAppSender): WhatsAppSender {
  return {
    async send(m: OutboundWhatsApp) {
      try {
        await inner.send(m);
      } catch (err) {
        await record(db, 'stall_whatsapp.failed', m, { error: message(err) });
        throw err;
      }
      await record(db, 'stall_whatsapp.sent', m, {});
    },
  };
}

async function record(
  db: Db,
  action: SendAction,
  m: OutboundMail | OutboundWhatsApp,
  extra: Record<string, unknown>,
): Promise<void> {
  // `{ to, subject, error }` in that order — a JSON column keeps insertion
  // order, and that is the order a reader scans them in.
  const detail: Record<string, unknown> = { to: m.to };
  if ('subject' in m) detail.subject = m.subject;
  if (extra.error !== undefined) detail.error = extra.error;

  try {
    await audit(db, {
      actor: { kind: 'SYSTEM' },
      action,
      subject: { type: action.startsWith('stall_email') ? 'email' : 'whatsapp', ref: m.to },
      requestId: m.about?.requestId ?? null,
      accountId: m.about?.accountId ?? null,
      detail,
      outcome: action.endsWith('.failed') ? 'FAILED' : 'OK',
    });
  } catch {
    // The letter went (or failed) regardless. The log is not allowed to make a
    // delivery fail twice, and a send site that swallows a transport error
    // must not start seeing one from here.
  }
}
