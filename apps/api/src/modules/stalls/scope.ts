// Which requesters a staff member's roles reach, applied.
//
// `@msr/stalls/rbac.ts` decides the rule — `requestTypeScopeFor` turns a set of
// role keys into the requester types they cover, or `null` for all of them.
// This file is the half that makes the answer bite: a `where` clause for the
// lists, and a guard for the routes that address one request by id.
//
// 🔴 Why it exists at all: the local welfare team works inside this
// application, because the traders they file for are village vendors who mostly
// have no email address. That makes them staff, and `requests:write` is
// otherwise unscoped — so without this the only way to let them enter a request
// was to also let them read a commercial vendor's bank details.
import type { Prisma, PrismaClient, StallRequestType } from '@prisma/client';
import { canReachRequestType, requestTypeScopeFor } from '@msr/stalls';
import { RequestTypeForbiddenError } from './errors';
import type { StaffCaller } from './roles';

export type RequestScope = string[] | null;

export function scopeOf(caller: StaffCaller): RequestScope {
  return requestTypeScopeFor(caller.roleKeys);
}

/** The `requestType` filter for a scope, spread into a `where`.
 *
 *  An unscoped caller contributes nothing, so an unfiltered list stays one
 *  query with no clause. A caller whose roles reach nothing at all gets
 *  `{ in: [] }` — an empty list, not every row. */
export function scopeWhere(scope: RequestScope): Prisma.StallRequestWhereInput {
  if (scope === null) return {};
  return { requestType: { in: scope as StallRequestType[] } };
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
  if (scope !== null && !scope.includes(asked)) return undefined;
  return { requestType: asked };
}

/** Refuses a caller whose roles do not cover this request's requester type.
 *
 *  ⚠️ An id that matches nothing passes. The route's own lookup raises the 404,
 *  and answering 403 here would tell the caller that an id they may not read
 *  nonetheless exists. */
export async function requireRequestScope(
  caller: StaffCaller,
  db: PrismaClient,
  requestId: string,
): Promise<void> {
  if (scopeOf(caller) === null) return;
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    select: { requestType: true },
  });
  if (!r) return;
  if (!canReachRequestType(caller.roleKeys, r.requestType)) {
    throw new RequestTypeForbiddenError(r.requestType);
  }
}
