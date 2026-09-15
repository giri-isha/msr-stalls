import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { StallCredential } from '@prisma/client';
import { type Contact, parseContact } from '@msr/stalls';
import type { Db } from './editions';
import { InvalidCredentialsError } from './errors';

/** A requester's password.
 *
 *  ⚠️ TEMPORARY. The host's Isha OIDC replaces all of this — see the
 *  2026-09-15 design. That is why there is no dependency here, no password
 *  policy beyond a length floor, and no account-settings surface: everything
 *  in this file is written to be deleted rather than extended.
 */

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** A floor, and nothing more. A policy demanding a symbol and a digit would
 *  outlive the mechanism it protects and buy nothing a length floor does not. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_FAILED = 10;
export const LOCKOUT_MINUTES = 15;

const KEYLEN = 64;

/** Stored as `scrypt$<salt hex>$<key hex>`, so the scheme travels with the hash
 *  and a later change of cost or algorithm does not invalidate the rows already
 *  written — the verifier reads what each row says it is. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length === 0) return false;
  const actual = await scrypt(plain, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export async function createCredential(
  db: Db,
  input: { accountId: string; contact: Contact; password: string },
): Promise<StallCredential> {
  return db.stallCredential.create({
    data: {
      accountId: input.accountId,
      loginValue: input.contact.value,
      loginKind: input.contact.kind,
      passwordHash: await hashPassword(input.password),
    },
  });
}

export async function confirmCredential(
  db: Db,
  credentialId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.stallCredential.update({
    where: { id: credentialId },
    data: { confirmedAt: now, failedCount: 0, lockedUntil: null },
  });
}

export async function setPassword(db: Db, credentialId: string, password: string): Promise<void> {
  await db.stallCredential.update({
    where: { id: credentialId },
    data: {
      passwordHash: await hashPassword(password),
      failedCount: 0,
      lockedUntil: null,
      // A reset also confirms. Following the link proved the contact, which is
      // the same thing the confirmation link proves.
      confirmedAt: new Date(),
    },
  });
}

/**
 * A password chosen for a requester by somebody at a desk, rather than by the
 * requester themselves.
 *
 * ⚠️ EVERY credential the account holds, for the same reason `clearLockout`
 * clears every one: an account registered on both an address and a number has
 * two, and setting the one a desk happened to look at leaves the other still
 * opening the account on the password the vendor has lost.
 *
 * A requester who never registered holds none, and gets one minted on
 * `fallback` — which is the whole point of the action. It is confirmed on
 * creation: confirmation exists to prove somebody holds the contact, and a
 * desk that has just spoken to them has proved it by a better route than a
 * link the vendor could not follow in the first place.
 *
 * Reports whether it created one, so the caller can say which happened. A
 * `loginValue` another account already holds surfaces as a unique-constraint
 * failure, which the caller turns into a 409 — see `CannotSetPasswordError`.
 *
 * ⚠️ TEMPORARY, with the rest of this file.
 */
export async function setAccountPassword(
  db: Db,
  accountId: string,
  password: string,
  fallback: Contact,
): Promise<{ created: boolean }> {
  const passwordHash = await hashPassword(password);
  const { count } = await db.stallCredential.updateMany({
    where: { accountId },
    // Confirmed, unlocked and with the failure count cleared: the desk has
    // just handed over a password that works, and leaving a live lockout on
    // the row would refuse it for the next fifteen minutes.
    data: { passwordHash, failedCount: 0, lockedUntil: null, confirmedAt: new Date() },
  });
  if (count > 0) return { created: false };

  await db.stallCredential.create({
    data: {
      accountId,
      loginValue: fallback.value,
      loginKind: fallback.kind,
      passwordHash,
      confirmedAt: new Date(),
    },
  });
  return { created: true };
}

/** The credential behind a contact and a password, or `InvalidCredentialsError`.
 *
 *  ⚠️ EVERY failure raises that one error — no contact, no credential, not yet
 *  confirmed, locked out, wrong password. A reader looking for the branch that
 *  reports "no such account" will not find one, and must not add it. */
export async function authenticate(
  db: Db,
  input: { contact: string; password: string },
  now: Date = new Date(),
): Promise<StallCredential> {
  const contact = parseContact(input.contact);
  if (!contact) throw new InvalidCredentialsError();

  const cred = await db.stallCredential.findUnique({ where: { loginValue: contact.value } });
  if (!cred) throw new InvalidCredentialsError();
  if (!cred.confirmedAt) throw new InvalidCredentialsError();
  if (cred.lockedUntil && cred.lockedUntil.getTime() > now.getTime()) {
    throw new InvalidCredentialsError();
  }

  if (!(await verifyPassword(input.password, cred.passwordHash))) {
    const failedCount = cred.failedCount + 1;
    await db.stallCredential.update({
      where: { id: cred.id },
      data: {
        failedCount,
        lockedUntil:
          failedCount >= MAX_FAILED
            ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
            : cred.lockedUntil,
      },
    });
    throw new InvalidCredentialsError();
  }

  if (cred.failedCount !== 0 || cred.lockedUntil) {
    await db.stallCredential.update({
      where: { id: cred.id },
      data: { failedCount: 0, lockedUntil: null },
    });
  }
  return cred;
}

/**
 * Lets a locked-out requester try again now, rather than in fifteen minutes.
 *
 * Clears the lockout on EVERY credential the account holds: an account
 * registered on both an address and a number has two, and unlocking the one a
 * desk happened to look at leaves the person still locked out of the other.
 *
 * Returns how many were actually locked, so the caller can tell "unlocked"
 * from "there was nothing to unlock" without reading the table again.
 *
 * ⚠️ The `lockedUntil: { not: null }` is what makes that number mean anything.
 * `updateMany` reports rows MATCHED, not rows changed, so scoping this to the
 * account alone returned 1 for a credential that was never locked — and the
 * caller, which reports 0 as a 409, answered 204 to an unlock that did
 * nothing. An expired-but-unreset lockout is included deliberately: clearing
 * it is what the row would have asked for a minute earlier.
 */
export async function clearLockout(db: Db, accountId: string): Promise<number> {
  const { count } = await db.stallCredential.updateMany({
    where: { accountId, lockedUntil: { not: null } },
    data: { failedCount: 0, lockedUntil: null },
  });
  return count;
}
