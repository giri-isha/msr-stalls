// Which requesters a backoffice member's roles reach, applied.
//
// `@msr/stalls/rbac.ts` decides the rule — `unionRequestTypeScope` turns the
// roles a person holds into the requester types they cover, or `null` for all
// of them, and `requireBackoffice` resolves it once per request.
// This file is the half that makes the answer bite: a `where` clause for the
// lists, and a guard for the routes that address one request by id.
//
// 🔴 Why it exists at all: the local welfare team works inside this
// application, because the traders they file for are village vendors who mostly
// have no email address. That makes them backoffice members, and `requests.write` is
// otherwise unscoped — so without this the only way to let them enter a request
// was to also let them read a commercial vendor's bank details.
import type { Prisma, PrismaClient, StallRequestType } from '@prisma/client';
import { canReach, zoneOfRequest } from '@msr/stalls';
import { RequestTypeForbiddenError, ZoneForbiddenError } from './errors';
import type { BackofficeCaller } from './roles';

/**
 * How far a caller reaches, on the two axes that narrow a REQUEST.
 *
 * ⚠️ They come from different rows and mean different things. `requestTypes`
 * belongs to the ROLE — it is what the role is for, and the local welfare team
 * is the reason it exists. `zones` belongs to the GRANT, because two people can
 * hold the same role for different bays. `null` is "everything" on either axis.
 *
 * The third axis, the EDITION, is not here: it does not narrow a list, it
 * decides whether the caller may work in this edition at all, so it is a refusal
 * (`requireEditionReach`) rather than a `where` clause.
 */
export interface RequestScope {
  requestTypes: string[] | null;
  zones: string[] | null;
}

/** Reaching everything on both axes.
 *
 *  The default for a seam called without a caller — the seed, a background job —
 *  and the value that replaced a bare `null` when scope stopped being one list. */
export const UNSCOPED: RequestScope = { requestTypes: null, zones: null };

/** Resolved once per request, when the caller's roles are read. This reads it
 *  back rather than recomputing it, so a list and the guard beside it cannot
 *  disagree about what the same caller reaches. */
export function scopeOf(caller: BackofficeCaller): RequestScope {
  return { requestTypes: caller.requestTypeScope, zones: caller.zoneScope };
}

/** Whether either axis narrows anything. An unscoped caller skips every extra
 *  query and every extra clause, which is nearly every caller. */
function unscoped(scope: RequestScope): boolean {
  return scope.requestTypes === null && scope.zones === null;
}

/** The `requestType` filter for a scope, spread into a `where`.
 *
 *  An unscoped caller contributes nothing, so an unfiltered list stays one
 *  query with no clause. A caller whose roles reach nothing at all gets
 *  `{ in: [] }` — an empty list, not every row. */
export function scopeWhere(scope: RequestScope): Prisma.StallRequestWhereInput {
  const where: Prisma.StallRequestWhereInput = {};
  if (scope.requestTypes !== null) {
    where.requestType = { in: scope.requestTypes as StallRequestType[] };
  }
  if (scope.zones !== null) {
    // The agreed bay once the team has settled one, and the requested bay until
    // then — the `where` twin of `zoneOfRequest`. A request nobody has placed
    // yet must stay visible to the marshal who is about to receive it.
    //
    // ⚠️ `AND`, not a bare `OR`: every caller spreads this into a `where` of its
    // own, and a top-level `OR` would be overwritten by — or would overwrite —
    // theirs. None of them uses `AND`.
    where.AND = [
      {
        OR: [
          { agreedZoneCode: { in: scope.zones } },
          { agreedZoneCode: null, preferredZoneCode: { in: scope.zones } },
        ],
      },
    ];
  }
  return where;
}

/** Narrows a requested type filter to the scope. Returns `undefined` when the
 *  caller asked for a type they may not see — the caller should answer with an
 *  empty page rather than a 403, because a filter nobody may use is a filter
 *  that matches nothing, not an attempt to break in. */
export function narrowType(
  scope: RequestScope,
  asked: StallRequestType | undefined,
): Prisma.StallRequestWhereInput | undefined {
  if (!asked) return scopeWhere(scope);
  if (!canReach(scope.requestTypes, asked)) return undefined;
  // The asked-for type replaces the type clause; the bay clause still applies,
  // because narrowing by type is not permission to leave your own bays.
  return { ...scopeWhere(scope), requestType: asked };
}

/** Refuses a caller whose roles do not cover this request's requester type.
 *
 *  ⚠️ An id that matches nothing passes. The route's own lookup raises the 404,
 *  and answering 403 here would tell the caller that an id they may not read
 *  nonetheless exists. */
export async function requireRequestScope(
  caller: BackofficeCaller,
  db: PrismaClient,
  requestId: string,
): Promise<void> {
  const scope = scopeOf(caller);
  if (unscoped(scope)) return;
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    select: { requestType: true, agreedZoneCode: true, preferredZoneCode: true },
  });
  if (!r) return;
  if (!canReach(scope.requestTypes, r.requestType)) {
    throw new RequestTypeForbiddenError(r.requestType);
  }
  const zone = zoneOfRequest(r);
  // A request with no bay at all cannot be placed inside anyone's, so a
  // bay-scoped caller is refused rather than quietly let through.
  if (scope.zones !== null && (zone === null || !scope.zones.includes(zone))) {
    throw new ZoneForbiddenError(zone);
  }
}

/** The same check for a route addressed by a CHILD row — a staff registration,
 *  a payment record, an allocation — whose `:id` is not a request id.
 *
 *  The lookup is passed in rather than done here so this file stays ignorant of
 *  which tables hang off a request, and it runs only for a scoped caller: an
 *  unscoped one costs no extra query, which is every caller but one role. */
export async function requireOwnerScope(
  caller: BackofficeCaller,
  db: PrismaClient,
  findOwner: () => Promise<{ requestId: string } | null>,
): Promise<void> {
  if (unscoped(scopeOf(caller))) return;
  const row = await findOwner();
  if (!row) return;
  await requireRequestScope(caller, db, row.requestId);
}
