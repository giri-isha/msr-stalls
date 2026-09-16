import type { StallCredential } from '@prisma/client';
import {
  DIRECTORY_VIEWS,
  type DirectoryUser,
  type DirectoryView,
  type ListUsersQuery,
  type ListUsersResponse,
  type SignInState,
} from '@stalls/core';
import type { Db } from './editions';

/**
 * Everyone who can reach this module, in one list.
 *
 * Two populations that the database deliberately keeps apart — backoffice members are
 * Foundation `Person`s holding a `StallBackofficeRole`, requesters are
 * `StallAccount`s a public form created — joined here and ONLY here, as a
 * read, for the Users screen.
 *
 * ⚠️ **The union happens in this process, not in SQL.** The two tables live in
 * different schemas (`foundation` and `stalls`) and Prisma cannot union across
 * models, so the alternative was hand-written SQL naming both schemas — in a
 * file that migrates verbatim into the host, where the other half of that
 * union is another team's table. Two indexed queries and a merge here is the
 * thing the host can move without re-plumbing.
 *
 * ⚠️ **What that costs.** Both tables are read WHOLE on every call, so this
 * holds while the directory is thousands of rows, not hundreds of thousands.
 * One edition is a few hundred accounts and a few dozen backoffice members. If an
 * edition ever arrives where that is wrong, the fix is a real paged query per
 * population with the counts computed separately — not a bigger `take`.
 */
export async function listUsers(
  db: Db,
  input: ListUsersQuery & { editionId: string },
): Promise<ListUsersResponse> {
  const everyone = [...(await backofficeRows(db)), ...(await requesterRows(db, input.editionId))];

  // Search and the Filter popover narrow the counts; the VIEW does not — see
  // `ListUsersResponse.counts`. So the tiles are computed from this list and
  // the rows from a further narrowing of it.
  const filtered = everyone.filter(
    (u) =>
      matchesSearch(u, input.q) &&
      matchesRole(u, input.roleKey) &&
      matchesState(u, input.signInState),
  );

  const counts = DIRECTORY_VIEWS.map((label) => ({
    label,
    count: filtered.filter((u) => inView(u, label)).length,
  }));

  const rows = filtered
    .filter((u) => inView(u, input.view))
    // One order for both populations, because the reader is looking for a
    // person and does not know or care which table they came from.
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const start = input.page * input.pageSize;
  return {
    users: rows.slice(start, start + input.pageSize),
    counts,
    total: rows.length,
    page: input.page,
    pageSize: input.pageSize,
  };
}

/** Backoffice, by the same route `listBackoffice` takes: the grants are this module's,
 *  the name and email are the Foundation's, and a grant whose person has gone
 *  from the directory is dropped rather than shown as a blank row. */
async function backofficeRows(db: Db): Promise<DirectoryUser[]> {
  const grants = await db.stallBackofficeRole.findMany({ orderBy: { createdAt: 'asc' } });
  const refs = [...new Set(grants.map((g) => g.personRef))];
  const people = await db.person.findMany({ where: { personId: { in: refs } } });
  const byId = new Map(people.map((p) => [p.personId, p]));
  return refs.flatMap((ref) => {
    const p = byId.get(ref);
    if (!p) return [];
    return [
      {
        id: p.personId,
        kind: 'BACKOFFICE' as const,
        displayName: p.displayName,
        email: p.email,
        phone: p.phone,
        grants: grants
          .filter((g) => g.personRef === ref)
          .map((g) => ({
            roleKey: g.roleKey,
            editionScope: g.editionScope,
            zoneScope: g.zoneScope,
          })),
        requestCount: null,
        // ⚠️ Three states, and the middle one is the point. `OK` on a person an
        // admin added this morning and nobody has signed in as would read
        // "Active" in the Sign-in column — a claim about somebody who has never
        // been here. `INVITED` says what is actually true, and deliberately
        // does not count under "Cannot sign in": they can, they have not.
        signInState: p.signInDisabled
          ? ('DISABLED' as const)
          : p.staged
            ? ('INVITED' as const)
            : ('OK' as const),
        lockedUntil: null,
      },
    ];
  });
}

/** Requesters, with their credentials and their count of requests in the
 *  edition every other backoffice screen is showing. */
async function requesterRows(db: Db, editionId: string): Promise<DirectoryUser[]> {
  const accounts = await db.stallAccount.findMany({
    include: {
      credentials: true,
      _count: { select: { requests: { where: { editionId } } } },
    },
  });
  return accounts.map((a) => {
    const state = requesterState(a.credentials);
    return {
      id: a.id,
      kind: 'REQUESTER' as const,
      displayName: a.displayName,
      email: a.email,
      phone: a.phone || null,
      grants: [],
      requestCount: a._count.requests,
      signInState: state,
      lockedUntil:
        state === 'LOCKED' ? (lockedUntilOf(a.credentials)?.toISOString() ?? null) : null,
    };
  });
}

/**
 * What a requester's credentials say about getting in.
 *
 * No credential at all is `LINK_ONLY` — the ordinary case, and emphatically
 * not a fault. Otherwise a registered requester can get in unless a lockout is
 * live, which is the one thing here a desk can do something about.
 */
export function requesterState(creds: StallCredential[], now: Date = new Date()): SignInState {
  if (creds.length === 0) return 'LINK_ONLY';
  if (creds.some((c) => c.lockedUntil && c.lockedUntil.getTime() > now.getTime())) return 'LOCKED';
  return 'OK';
}

function lockedUntilOf(creds: StallCredential[], now: Date = new Date()): Date | null {
  const live = creds
    .map((c) => c.lockedUntil)
    .filter((d): d is Date => !!d && d.getTime() > now.getTime());
  if (live.length === 0) return null;
  // The last one to expire: that is when they can try again unaided.
  return live.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));
}

/**
 * Which tile a row falls under.
 *
 * ⚠️ `LINK_ONLY` and `INVITED` are absent from "Cannot sign in" on purpose —
 * see `SignInState`. A vendor who never registered has not lost anything, and
 * neither has a coordinator who was added an hour ago.
 */
function inView(u: DirectoryUser, view: DirectoryView): boolean {
  switch (view) {
    case 'All':
      return true;
    case 'Backoffice':
      return u.kind === 'BACKOFFICE';
    case 'Requesters':
      return u.kind === 'REQUESTER';
    case 'Cannot sign in':
      return u.signInState === 'DISABLED';
    case 'Locked out':
      return u.signInState === 'LOCKED';
  }
}

/** Name, email or number — the same three for both populations, now that a
 *  backoffice row can carry a number too. */
function matchesSearch(u: DirectoryUser, q: string | undefined): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    u.displayName.toLowerCase().includes(needle) ||
    u.email.toLowerCase().includes(needle) ||
    (u.phone ?? '').includes(needle)
  );
}

function matchesRole(u: DirectoryUser, roleKey: string | undefined): boolean {
  if (!roleKey) return true;
  return u.grants.some((g) => g.roleKey === roleKey);
}

function matchesState(u: DirectoryUser, state: SignInState | undefined): boolean {
  if (!state) return true;
  return u.signInState === state;
}
