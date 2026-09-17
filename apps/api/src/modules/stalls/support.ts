import type { PrismaClient } from '@prisma/client';
import {
  changeSet,
  type Contact,
  type UpdateAccountInput,
  isPlaceholderEmail,
  parseContact,
} from '@stalls/core';
import { actorFrom, audit } from './audit';
import { normalizeEmail } from './accounts';
import { clearLockout, setAccountPassword } from './credentials';
import type { Db } from './editions';
import {
  AccountEmailTakenError,
  CannotSetPasswordError,
  NothingToSendError,
  UnknownAccountError,
} from './errors';
import { type AccessLinkDeps, deliverAccessLink } from './portal';
import { endAllSessions } from './session';

/**
 * What a desk can do to a requester's account on their behalf.
 *
 * Two of these unstick a vendor who cannot get in; each already existed for
 * the requester to do themselves, and what is new is a backoffice member doing
 * it from the Users screen for the vendor on the phone who cannot follow the
 * instructions being read to them. The third corrects the details the account
 * carries — the same call, from the same screen, for the vendor whose address
 * was typed wrong on the form and who therefore receives neither of the other
 * two.
 *
 * ⚠️ Two rules hold across the first three.
 *
 * **Nothing is ever shown to the caller.** A link is minted and sent to the
 * address or number the ACCOUNT already holds — never to anything typed into
 * the screen. The backoffice can cause a vendor to receive their own link; it
 * cannot obtain it. That is the same rule the public routes keep, and it is
 * what makes these safe to expose to `users:write` rather than to admins
 * alone.
 *
 * **Every one is written to the activity trail**, with the actor. These act on
 * accounts a vendor owns; who unlocked whom has to be answerable afterwards.
 *
 * 🔴 `setRequesterPassword` is the FOURTH, and it breaks the first rule on
 * purpose — which is exactly why it is gated by its own `passwords.write` and
 * not by `users:write` with the rest. See it below.
 *
 * ⚠️ TEMPORARY, with `credentials.ts`: unlock and set-password exist only
 * because this module carries its own requester passwords. When the host's
 * Isha OIDC takes that over, both go, and only the access link — which
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

  // ⚠️ The same `changeSet` the amendment uses, so one shape of "what moved"
  // is stored everywhere and the two audit screens draw both the same way.
  const changes = changeSet(account, next);
  if (changes.length === 0) return;

  // The old `{ field: { from, to } }` shape stays in `detail` as well: the
  // host's trail has no `changes` column, and this is the reading it has
  // always had.
  const changed = Object.fromEntries(
    changes.map((c) => [c.field, { from: c.before, to: c.after }]),
  );

  await db.stallAccount.update({ where: { id: account.id }, data: next });
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_account.updated',
    subject: { type: 'account', ref: account.id },
    accountId: account.id,
    changes,
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
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_account.unlocked',
    subject: { type: 'account', ref: account.id },
    accountId: account.id,
    detail: { credentials: cleared },
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
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_account.access_link_sent',
    subject: { type: 'account', ref: account.id },
    accountId: account.id,
    detail: {},
  });
}

/* ── The requester password ─────────────────────────────────────────────────
 *
 * ⚠️ TEMPORARY. Deleted with `credentials.ts` and `registration.ts` when the
 * host's Isha SSO signs requesters in — step 3b of
 * `docs/migration-to-host.md`. There is no password in the host for anybody to
 * set, so nothing below migrates.
 */

/**
 * The contact a login is registered against, for an account that holds none
 * yet.
 *
 * The address first, because the address is the module's identity key and the
 * thing the vendor is most likely to be told to type. The number only when
 * there is no real address — an account registered on a mobile carries a
 * placeholder nothing delivers to, and a login registered against THAT is a
 * login nobody could ever use.
 */
function loginContactOf(account: { email: string; phone: string }): Contact | null {
  const email = isPlaceholderEmail(account.email) ? null : parseContact(account.email);
  return email ?? (account.phone ? parseContact(account.phone) : null);
}

/**
 * A password the backoffice chooses and reads out to a requester.
 *
 * 🔴 **The one action here that hands over a way in, rather than causing one to
 * be sent.** Every other support action mints a link and posts it to the
 * contact the ACCOUNT already holds, which is what makes them safe for any desk
 * with `users:write`: the desk can cause a vendor to receive their own way in
 * and can never obtain it. This one gives the desk a password that works. That
 * is a different power and it holds a different privilege —
 * `passwords.write` — so an admin can staff a support desk without also
 * handing it every vendor's account.
 *
 * It exists because the alternative for a village trader with no address, no
 * smartphone and a number they share with a shop is that they never get in at
 * all. When SSO arrives that vendor signs in the way everyone else does and
 * this goes.
 *
 * A requester who never registered gets a credential minted here, so this is
 * also how a login is CREATED for somebody who cannot create their own — which
 * is why it does not refuse an account with no credential the way Unlock and
 * Resend do.
 *
 * ⚠️ **Every live session ends**, exactly as a self-service reset ends them.
 * Half the reason a desk is setting a password is that somebody else may have
 * had the account, and leaving their session standing would change the
 * password without closing the door.
 */
export async function setRequesterPassword(
  db: PrismaClient,
  accountId: string,
  password: string,
  by: string,
): Promise<void> {
  const account = await accountOr404(db, accountId);
  const contact = loginContactOf(account);
  if (!contact) {
    throw new CannotSetPasswordError(
      'this requester has no email address or mobile number to register a login against — correct their details first',
    );
  }

  let created: boolean;
  try {
    ({ created } = await setAccountPassword(db, account.id, password, contact));
  } catch {
    // The only way the write fails is the unique `loginValue`: another account
    // already signs in with this contact. Named as such rather than re-read,
    // because the desk's answer is the same either way — look at the other row.
    throw new CannotSetPasswordError(
      `another account already signs in with ${contact.value} — that account is this requester's login, not this one`,
    );
  }

  await endAllSessions(db, account.id);
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_account.password_set',
    subject: { type: 'account', ref: account.id },
    accountId: account.id,
    detail: { created, loginKind: contact.kind },
  });
}
