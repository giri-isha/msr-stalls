import { createHash, randomBytes } from 'node:crypto';
import type {
  StallAccessLink,
  StallAccessPurpose,
  StallAccount,
  StallRequestType,
} from '@prisma/client';
import { parseContact } from '@stalls/core';
import type { Db } from './editions';
import { UnknownAccessLinkError } from './errors';

/** Email is the ONE lookup key for an external requester. Case and pasted
 *  whitespace must not create two accounts for one vendor — `Priya@X` and
 *  `priya@x ` are the same person, and the second submission must land on the
 *  first account so the status page shows both. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function findOrCreateAccount(
  db: Db,
  input: { email: string; phone: string; displayName: string },
): Promise<StallAccount> {
  const email = normalizeEmail(input.email);
  const existing = await db.stallAccount.findUnique({ where: { email } });
  if (existing) return existing;
  return db.stallAccount.create({
    data: { email, phone: input.phone, displayName: input.displayName },
  });
}

/**
 * Which form this account may fill.
 *
 * 🔴 The stored answer, and where there is none, the type of what the account
 * has already FILED. An account created before registration asked the question
 * came in through one of the three forms, and that is what it is — the
 * migration backfills exactly this, and this function is what keeps a row the
 * backfill could not reach (an account the team filed for afterwards) honest
 * without a second backfill.
 *
 * ⚠️ The FIRST request, so an account the team later filed a second type
 * against keeps what it came in as rather than the most recent thing on it.
 *
 * Null only for an account that has never applied. That is the one state in
 * which all three forms are offered — nothing has decided yet — and the next
 * submission settles it; see `submitRequest`.
 */
export async function resolveRequesterType(
  db: Db,
  account: { id: string; requesterType: StallRequestType | null },
): Promise<StallRequestType | null> {
  if (account.requesterType) return account.requesterType;
  const first = await db.stallRequest.findFirst({
    where: { accountId: account.id },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    select: { requestType: true },
  });
  return first?.requestType ?? null;
}

/** The account behind an email address or a mobile number, for a vendor who
 *  has lost their link.
 *
 *  Both columns are stored normalised — `normalizeEmail` on the way in, and
 *  `IndianMobile` reduces a number to its bare ten digits — so this is an
 *  exact match on either, never a scan or a LIKE. `null` for a contact that
 *  parses but matches nothing, and for one that does not parse at all: the
 *  caller must answer the same way to both.
 *
 *  A mobile is not unique in the table (two stalls can share a shopkeeper's
 *  number under different addresses), so the FIRST account registered under it
 *  wins. The email is the module's identity key; a number is a way back to it. */
export async function findAccountByContact(db: Db, raw: string): Promise<StallAccount | null> {
  const contact = parseContact(raw);
  if (!contact) return null;
  if (contact.kind === 'EMAIL') {
    return db.stallAccount.findUnique({ where: { email: contact.value } });
  }
  return db.stallAccount.findFirst({
    where: { phone: contact.value },
    orderBy: { createdAt: 'asc' },
  });
}

/** 32 random bytes, base64url — 256 bits, unguessable. Only its SHA-256 is
 *  stored: a database leak hands out hashes, not links. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function mintAccessLink(
  db: Db,
  input: {
    accountId: string;
    requestId?: string;
    purpose: StallAccessPurpose;
    ttlDays: number;
    now?: Date;
  },
): Promise<{ token: string; link: StallAccessLink }> {
  const token = newToken();
  const now = input.now ?? new Date();
  const link = await db.stallAccessLink.create({
    data: {
      tokenHash: hashToken(token),
      accountId: input.accountId,
      requestId: input.requestId,
      purpose: input.purpose,
      expiresAt: new Date(now.getTime() + input.ttlDays * 86_400_000),
    },
  });
  return { token, link };
}

/** Looks the token up by hash — never by scanning. Throws the SAME error for
 *  unknown, expired and revoked so the response cannot distinguish them. A
 *  `purpose` narrows the lookup so a STATUS link cannot open the bank form. */
export async function resolveAccessLink(
  db: Db,
  token: string,
  purpose?: StallAccessPurpose,
  now: Date = new Date(),
): Promise<StallAccessLink & { account: StallAccount }> {
  if (!token || token.length > 128) throw new UnknownAccessLinkError();
  const link = await db.stallAccessLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { account: true },
  });
  if (!link) throw new UnknownAccessLinkError();
  if (purpose && link.purpose !== purpose) throw new UnknownAccessLinkError();
  if (link.revokedAt) throw new UnknownAccessLinkError();
  if (link.expiresAt.getTime() <= now.getTime()) throw new UnknownAccessLinkError();
  return link;
}
