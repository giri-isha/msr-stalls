import type { PrismaClient } from '@prisma/client';
import { type UpdateAccountInput, parseContact } from '@msr/stalls';
import { recordActivity } from '../../activity';
import { normalizeEmail } from './accounts';
import { clearLockout } from './credentials';
import type { Db } from './editions';
import { AccountEmailTakenError, NothingToSendError, UnknownAccountError } from './errors';
import { type AccessLinkDeps, deliverAccessLink } from './portal';
import { type SendDeps, sendConfirmation } from './registration';
import { MODULE_KEY } from './roles';

/**
 * What a desk can do to a requester's account on their behalf.
 *
 * Three of these unstick a vendor who cannot get in; each already existed for
 * the requester to do themselves, and what is new is a staff member doing it
 * from the Users screen for the vendor on the phone who cannot follow the
 * instructions being read to them. The fourth corrects the details the account
 * carries — the same call, from the same screen, for the vendor whose address
 * was typed wrong on the form and who therefore receives none of the other
 * three.
 *
 * ⚠️ Two rules hold across all of them.
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

/**
 * A requester's name, address and number, corrected.
 *
 * ⚠️ **The address is the module's identity key.** `accounts.ts` merges a new
 * submission onto the account holding that email, and every access link is
 * sent to it, so moving it moves both. A second account already holding the
 * new address is refused rather than merged: merging two vendors' request
 * histories on a desk's typo is not undoable, and the desk can see both rows.
 *
 * ⚠️ **It deliberately does NOT move the password login.** `StallCredential`
 * holds its own unique `loginValue` (see the schema for why it cannot be a
 * column here), and a vendor who registered under the old address goes on
 * signing in with it. Rewriting it would silently change what somebody types
 * to get in, without telling them — and the Sign-in column would go on reading
 * "Registered" either way. A desk that has moved an address and stranded
 * somebody sends them their access link, which needs no password at all.
 *
 * A save that changes nothing writes nothing: the trail answers "who changed
 * this vendor's address", and a row saying somebody changed nothing is noise
 * in the only place that question gets asked.
 */
export async function updateAccount(
  db: PrismaClient,
  accountId: string,
  input: UpdateAccountInput,
  by: string,
): Promise<void> {
  const account = await accountOr404(db, accountId);
  const next = {
    displayName: input.displayName,
    email: normalizeEmail(input.email),
    phone: input.phone,
  };

  if (next.email !== account.email) {
    const held = await db.stallAccount.findUnique({ where: { email: next.email } });
    if (held) throw new AccountEmailTakenError(held.displayName);
  }

  const changed: Record<string, { from: string; to: string }> = {};
  for (const field of ['displayName', 'email', 'phone'] as const) {
    if (next[field] !== account[field]) changed[field] = { from: account[field], to: next[field] };
  }
  if (Object.keys(changed).length === 0) return;

  await db.stallAccount.update({ where: { id: account.id }, data: next });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_account.updated',
    subjectRef: account.id,
    detail: changed,
  });
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
