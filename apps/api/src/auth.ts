// FOUNDATION STUB — exposes the host's `getCurrentPerson(req, client)` seam with
// the host's exact signature, backed by a development session cookie instead of
// Isha OIDC SSO. Discarded at migration.
//
// ⚠️ The ONE thing in this repo that cannot be exercised against the real
// implementation until migration. In the host, `Person` rows come from Isha
// SSO and the token is a signed identity-only JWT. Here, `Person` is a small
// table of backoffice seeded for development, and the token is the person's id in a
// cookie. The stalls module sees the same `Person | null` either way — that is
// the whole point of the stub.
import type { FastifyRequest } from 'fastify';
import type { Person, PrismaClient } from '@prisma/client';

/** The cookie name the host uses, so the web shell's dev sign-in sets the same
 *  cookie the host's SSO callback would. */
export const SESSION_COOKIE = 'stalls_session';

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

/** The COOKIE wins, then the header — the host's order (its ADR 0042). */
function sessionToken(req: FastifyRequest): string | null {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  return bearerToken(req);
}

/** Resolve the signed-in Person, or null if unauthenticated / unknown.
 *
 *  In the host the token is a JWT whose `sub` is the person_id; verification
 *  happens before the lookup. Here the token IS the person_id — acceptable only
 *  because this file never ships. A disabled account is refused on every
 *  request, the same as the host. */
export async function getCurrentPerson(
  req: FastifyRequest,
  client: PrismaClient,
): Promise<Person | null> {
  const token = sessionToken(req);
  if (!token) return null;
  // A junk token must read as "not signed in", never as a 500 from Prisma
  // refusing a non-uuid. Same shape as the host: verify, then look up.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return null;
  }
  const person = await client.person.findUnique({ where: { personId: token } });
  if (!person || person.signInDisabled) return null;
  return person;
}

/** Look a Person up by email and mint a session token. Development only — the
 *  host has the same function and the same rule: no HTTP caller, ever.
 *
 *  ⚠️ **This is where a staged row is claimed.** A person an admin added from
 *  the Users screen exists with `staged` set and nobody behind it; signing in as
 *  them is the event that makes them real, so the flag is cleared here and
 *  nowhere else. In the host the same moment is Isha's callback writing an
 *  `sso_id` onto the row it matched by email — see the `Person` model. */
export async function devLogin(
  client: PrismaClient,
  email: string,
): Promise<{ personId: string; email: string; token: string } | null> {
  const person = await client.person.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!person || person.signInDisabled) return null;
  // Only when it is actually set, so an ordinary sign-in is still a pure read.
  if (person.staged) {
    await client.person.update({ where: { personId: person.personId }, data: { staged: false } });
  }
  return { personId: person.personId, email: person.email, token: person.personId };
}
