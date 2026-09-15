import type { StallAccount } from '@prisma/client';
import {
  PLACEHOLDER_EMAIL_DOMAIN,
  isPlaceholderEmail,
  type Contact,
  type RegisterInput,
  parseContact,
} from '@msr/stalls';
import { findAccountByContact, mintAccessLink, resolveAccessLink } from './accounts';
import { confirmCredential, createCredential, setPassword } from './credentials';
import type { StallsDeps } from './deps';
import type { Db } from './editions';
import { UnknownAccessLinkError } from './errors';
import { endAllSessions } from './session';

/** Registering, confirming, and resetting a forgotten password.
 *
 *  ── The one rule this file exists to hold ──────────────────────────────────
 *  Nothing here tells the caller anything. `register` returns for every input
 *  — a free contact, one that already has an account, one that is not a
 *  contact at all, a send that fails — and the route answers 202 to all of
 *  them. Where the cases differ is which message goes out, and every message
 *  goes to a contact the module ALREADY held, never to the one just typed.
 *
 *  That is decision 17 of the Phase 2/3 spec, and it is the reason a
 *  registration has to be confirmed rather than logging someone straight in:
 *  if no response may distinguish the cases, a session can only start once the
 *  holder of the contact has proved they hold it.
 */

const CONFIRM_TTL_DAYS = 2;
const RESET_TTL_DAYS = 1;

type SendDeps = Pick<StallsDeps, 'mail' | 'whatsapp' | 'registerConfirmUrl' | 'passwordResetUrl'>;

/** Nothing sends to a placeholder address: delivery is chosen by the
 *  credential's `loginKind`, not by this column. The domain itself lives in
 *  `@msr/stalls` because the Users screen needs it too — see there. */
function placeholderEmail(mobile: string): string {
  return `mobile+${mobile}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export async function register(db: Db, deps: SendDeps, input: RegisterInput): Promise<void> {
  const contact = parseContact(input.contact);
  if (!contact) return;

  // ⚠️ An existing account is a REFUSAL, not a claim. Attaching a password to
  // an account somebody else built would hand over that vendor's requests,
  // bank details and allocation to anyone who knows their number. Staff do
  // this linking; the warning below is how the real holder finds out.
  const existing = await findAccountByContact(db, input.contact);
  if (existing) {
    await warnAccountHolder(deps, existing);
    return;
  }

  // No account, but a credential already on this contact: a second attempt
  // before the first was confirmed. Same silence, and the first link stays the
  // live one rather than being quietly replaced by a stranger's.
  const taken = await db.stallCredential.findUnique({ where: { loginValue: contact.value } });
  if (taken) return;

  const account = await db.stallAccount.create({
    data: {
      email: contact.kind === 'EMAIL' ? contact.value : placeholderEmail(contact.value),
      phone: contact.kind === 'MOBILE' ? contact.value : '',
      displayName: input.displayName,
    },
  });
  await createCredential(db, {
    accountId: account.id,
    contact,
    password: input.password,
  });
  await sendConfirmation(db, deps, account.id, contact);
}

/**
 * Mints a confirmation link and sends it over the channel the credential was
 * registered on.
 *
 * Shared by `register` and the staff-side resend. The channel comes from the
 * CONTACT, never from the account row: an account registered on a mobile
 * carries a placeholder email that nothing can deliver to.
 */
export async function sendConfirmation(
  db: Db,
  deps: SendDeps,
  accountId: string,
  contact: Contact,
): Promise<void> {
  const { token } = await mintAccessLink(db, {
    accountId,
    purpose: 'REGISTER_CONFIRM',
    ttlDays: CONFIRM_TTL_DAYS,
  });

  await deliver(deps, contact, {
    subject: 'Confirm your stall account',
    body: `Confirm your stall account and you are signed in: ${deps.registerConfirmUrl(token)}`,
  });
}

export type { SendDeps };

/** Tells the person who actually holds the contact that someone tried to use
 *  it — over every channel the account has, because the one that works is the
 *  one that was not typed by the person attempting it. */
async function warnAccountHolder(deps: SendDeps, account: StallAccount): Promise<void> {
  const subject = 'Someone tried to register — please call the stall team';
  const body =
    'Someone tried to create a login using your contact details. Your stall ' +
    'requests have not changed and no login was created. If that was you, ' +
    'please call the stall team and they will set your login up for you.';
  try {
    if (!isPlaceholderEmail(account.email)) {
      await deps.mail.send({ to: account.email, subject, text: body });
    }
  } catch {
    // A transport failure must not become a different outcome from "nothing
    // matched" — the same reason `sendAccessLink` swallows.
  }
  try {
    if (account.phone) await deps.whatsapp.send({ to: account.phone, text: `${subject}. ${body}` });
  } catch {
    // As above, and separately: one channel failing must not skip the other.
  }
}

async function deliver(
  deps: SendDeps,
  contact: Contact,
  msg: { subject: string; body: string },
): Promise<void> {
  try {
    if (contact.kind === 'EMAIL') {
      await deps.mail.send({ to: contact.value, subject: msg.subject, text: msg.body });
    } else {
      await deps.whatsapp.send({ to: contact.value, text: `${msg.subject}. ${msg.body}` });
    }
  } catch {
    // As above.
  }
}

export async function confirmRegistration(db: Db, token: string): Promise<{ accountId: string }> {
  const link = await resolveAccessLink(db, token, 'REGISTER_CONFIRM');
  const cred = await db.stallCredential.findFirst({ where: { accountId: link.accountId } });
  if (!cred) throw new UnknownAccessLinkError();
  await confirmCredential(db, cred.id);
  // Single use. A confirmation link in a forwarded email is not a spare key.
  await db.stallAccessLink.update({
    where: { id: link.id },
    data: { usedAt: new Date(), revokedAt: new Date() },
  });
  return { accountId: link.accountId };
}

export async function requestPasswordReset(
  db: Db,
  deps: SendDeps,
  rawContact: string,
): Promise<void> {
  const contact = parseContact(rawContact);
  if (!contact) return;
  const cred = await db.stallCredential.findUnique({ where: { loginValue: contact.value } });
  if (!cred) return;

  const { token } = await mintAccessLink(db, {
    accountId: cred.accountId,
    purpose: 'PASSWORD_RESET',
    ttlDays: RESET_TTL_DAYS,
  });
  await deliver(deps, contact, {
    subject: 'Reset your stall password',
    body: `Reset your stall password: ${deps.passwordResetUrl(token)}`,
  });
}

export async function completePasswordReset(
  db: Db,
  token: string,
  password: string,
): Promise<{ accountId: string }> {
  const link = await resolveAccessLink(db, token, 'PASSWORD_RESET');
  const cred = await db.stallCredential.findFirst({ where: { accountId: link.accountId } });
  if (!cred) throw new UnknownAccessLinkError();
  await setPassword(db, cred.id, password);
  await db.stallAccessLink.update({
    where: { id: link.id },
    data: { usedAt: new Date(), revokedAt: new Date() },
  });
  // Whoever prompted the reset is evicted. That is most of the point of one.
  await endAllSessions(db, link.accountId);
  return { accountId: link.accountId };
}
