import { createHash, randomBytes } from 'node:crypto';
import type { StallAccessLink, StallAccessPurpose, StallAccount } from '@prisma/client';
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
