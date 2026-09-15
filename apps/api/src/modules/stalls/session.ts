import type { StallAccount } from '@prisma/client';
import type { FastifyReply } from 'fastify';
import { mintAccessLink, resolveAccessLink } from './accounts';
import type { Db } from './editions';
import { UnknownAccessLinkError } from './errors';

/** A logged-in requester.
 *
 *  ── Why there is no session table ──────────────────────────────────────────
 *  Because there already is one. `StallAccessLink` stores only a SHA-256 of
 *  its token, expires, revokes, belongs to an account, and carries a `purpose`
 *  that `resolveAccessLink` refuses to answer across. That is a session store
 *  with a different name on the door.
 *
 *  ⚠️ This matters beyond tidiness. The password login is TEMPORARY — the
 *  host's Isha OIDC replaces it. When it does, the OIDC callback calls
 *  `startSession` and every other line in the module stays where it is: the
 *  portal, the pending steps, the backoffice screens, the guard below. The seam is
 *  one function, and it is already covered by the access-link tests.
 */

/** ⚠️ NOT `msr_session`. That cookie is the BACKOFFICE session and the host's own
 *  auth reads it; a requester holding one would be a backoffice member. Two
 *  populations, two cookies, and the names must never converge. */
export const REQUESTER_COOKIE = 'msr_stall_requester';

/** Long, because the alternative is a vendor locked out of their own
 *  onboarding halfway through an edition. Revocation is the real control —
 *  logout ends one, a password reset ends all of them. */
export const SESSION_TTL_DAYS = 30;

export async function startSession(db: Db, accountId: string): Promise<string> {
  const { token } = await mintAccessLink(db, {
    accountId,
    purpose: 'SESSION',
    ttlDays: SESSION_TTL_DAYS,
  });
  return token;
}

export async function endSession(db: Db, token: string): Promise<void> {
  const link = await resolveAccessLink(db, token, 'SESSION').catch(() => null);
  if (!link) return;
  await db.stallAccessLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
}

/** Every live session for an account. A password reset calls this: whoever
 *  prompted the reset is the person it most needs to evict. */
export async function endAllSessions(db: Db, accountId: string): Promise<void> {
  await db.stallAccessLink.updateMany({
    where: { accountId, purpose: 'SESSION', revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REQUESTER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(REQUESTER_COOKIE, { path: '/' });
}

/** The account behind the session cookie, or `UnknownAccessLinkError` — the
 *  same error a bad link raises, so "not logged in", "expired" and "that is
 *  not a session token" read identically to a caller. */
export async function requireRequester(
  db: Db,
  req: { cookies: Record<string, string | undefined> },
): Promise<StallAccount> {
  const token = req.cookies[REQUESTER_COOKIE];
  if (!token) throw new UnknownAccessLinkError();
  const link = await resolveAccessLink(db, token, 'SESSION');
  return link.account;
}
