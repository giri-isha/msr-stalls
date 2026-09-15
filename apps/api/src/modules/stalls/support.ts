import type { PrismaClient } from '@prisma/client';
import { parseContact } from '@msr/stalls';
import { recordActivity } from '../../activity';
import { clearLockout } from './credentials';
import type { Db } from './editions';
import { NothingToSendError, UnknownAccountError } from './errors';
import { type AccessLinkDeps, deliverAccessLink } from './portal';
import { type SendDeps, sendConfirmation } from './registration';
import { MODULE_KEY } from './roles';

/**
 * The three things a desk can do for a requester who cannot get in.
 *
 * Each one already existed for the requester to do themselves; what is new is
 * a staff member doing it on their behalf, from the Users screen, for the
 * vendor on the phone who cannot follow the instructions being read to them.
 *
 * ⚠️ Two rules hold across all three.
 *
 * **Nothing is ever shown to the caller.** A link is minted and sent to the
 * address or number the ACCOUNT already holds — never to anything typed into
 * the screen. Staff can cause a vendor to receive their own link; they cannot
 * obtain it. That is the same rule the public routes keep, and it is what
 * makes these safe to expose to `users:write` rather than to admins alone.
 *
 * **Every one is written to the activity trail**, with the actor. These act on
 * accounts a vendor owns; who unlocked whom has to be answerable afterwards.
 *
 * ⚠️ TEMPORARY, with `credentials.ts`: unlock and resend-confirmation exist
 * only because this module carries its own requester passwords. When the
 * host's Isha OIDC takes that over, both go, and only the access link — which
 * predates passwords and never depended on them — stays.
 */

async function accountOr404(db: Db, accountId: string) {
  const account = await db.stallAccount.findUnique({
    where: { id: accountId },
    include: { credentials: true },
  });
  if (!account) throw new UnknownAccountError(accountId);
  return account;
}

/** Clears the lockout too many wrong passwords caused, on every credential the
 *  account holds. A no-op is reported as a `409` rather than as success: the
 *  caller pressed Unlock because a row said Locked, and if it no longer is,
 *  that row is stale and they should see it refresh rather than be told a
 *  thing was done that was not. */
export async function unlockAccount(
  db: PrismaClient,
  accountId: string,
  by: string,
): Promise<void> {
  const account = await accountOr404(db, accountId);
  if (account.credentials.length === 0) {
    throw new NothingToSendError('this requester has never registered a password to lock');
  }
  const cleared = await clearLockout(db, account.id);
  if (cleared === 0) throw new NothingToSendError('this login is not locked');
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_account.unlocked',
    subjectRef: account.id,
    detail: { credentials: cleared },
  });
}

/** Sends the confirmation link again, to the contact the credential was
 *  registered under. */
export async function resendConfirmation(
  db: PrismaClient,
  deps: SendDeps,
  accountId: string,
  by: string,
): Promise<void> {
  const account = await accountOr404(db, accountId);
  const unconfirmed = account.credentials.find((c) => !c.confirmedAt);
  if (!unconfirmed) {
    throw new NothingToSendError(
      account.credentials.length === 0
        ? 'this requester has never registered a password — send them their access link instead'
        : 'this login is already confirmed',
    );
  }
  // The stored `loginValue` is already normalised, so this re-parse only
  // recovers which KIND it is — which is what picks email or WhatsApp.
  const contact = parseContact(unconfirmed.loginValue);
  if (!contact) throw new NothingToSendError('this login has no contact to send to');

  await sendConfirmation(db, deps, account.id, contact);
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_account.confirmation_resent',
    subjectRef: account.id,
    detail: { loginKind: unconfirmed.loginKind },
  });
}

/** Sends the vendor their own status link — the way back in that needs no
 *  password, and the answer for every requester who never registered one. */
export async function sendAccountAccessLink(
  db: PrismaClient,
  deps: AccessLinkDeps,
  accountId: string,
  by: string,
): Promise<void> {
  const account = await accountOr404(db, accountId);
  await deliverAccessLink(db, deps, account);
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_account.access_link_sent',
    subjectRef: account.id,
    detail: {},
  });
}
