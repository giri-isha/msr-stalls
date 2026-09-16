// What this module declares to the Foundation, and how a route checks a caller.
//
// Host ADR 0016: the Foundation stores a module's KEY and NAME and nothing
// else. Roles, and what each permits, are this module's own fact. Host ADR
// 0018: they are DATA — `StallRole` / `StallRolePrivilege`, editable by an
// admin without a deploy — and this file is where those rows become an answer.
//
// The rules themselves live in `@stalls/core` and take resolved rows, so they
// stay testable without a database. Nothing here decides anything; it reads.
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import {
  MODULE_KEY,
  type HeldRole,
  type RoleNode,
  type StallPrivilege,
  assignableRoleKeys,
  can,
  canReach,
  editableRoleKeys,
  unionEditionScope,
  unionPrivileges,
  unionRequestTypeScope,
  unionZoneScope,
} from '@stalls/core';
import { getCurrentPerson } from '../../auth';
import { NotAuthorizedError } from '../../errors';
import { EditionForbiddenError } from './errors';

export { MODULE_KEY };
export const MODULE_NAME = 'Stalls';

export interface BackofficeCaller {
  personId: string;
  displayName: string;
  roleKeys: string[];
  /** The union across every role held, with `allPrivileges` expanded. */
  privileges: string[];
  /** The requester types these roles reach, or `null` for all of them. From the
   *  ROLE — it is what the role is for. */
  requestTypeScope: string[] | null;
  /** The editions these GRANTS reach, or `null` for every one. */
  editionScope: string[] | null;
  /** The bays these GRANTS reach, by zone code, or `null` for every bay. */
  zoneScope: string[] | null;
}

/** Thrown by `requireBackoffice` when there is no session at all. Mapped to 401 —
 *  distinct from `NotAuthorizedError` (403), because "sign in" and "you may
 *  not" are different instructions to the caller. */
export class NotSignedInError extends Error {
  constructor() {
    super('sign in required');
    this.name = 'NotSignedInError';
  }
}

/** An empty `request_type_scope` column means UNSCOPED; an empty resolved scope
 *  means "reaches nothing". Opposite answers, so the mapping is explicit and
 *  lives in exactly one place. */
function scopeOfRow(column: string[]): string[] | null {
  return column.length === 0 ? null : column;
}

/** Who is calling, and what this module has granted them.
 *
 *  A signed-in person with NO stalls grants is a valid caller who can do
 *  nothing — that is a 403 from `requirePrivilege`, not a 401 from here.
 *
 *  A grant naming a role that no longer exists cannot occur: `role_key` is a
 *  foreign key. A role holding a RETIRED privilege still resolves, minus that
 *  privilege, because the join filters on `isActive` — retiring one must narrow
 *  access quietly rather than 500 every request made by anyone holding it. */
export async function requireBackoffice(
  req: FastifyRequest,
  db: PrismaClient,
): Promise<BackofficeCaller> {
  const person = await getCurrentPerson(req, db);
  if (!person) throw new NotSignedInError();

  const grants = await db.stallBackofficeRole.findMany({
    where: { personRef: person.personId },
    select: {
      roleKey: true,
      editionScope: true,
      zoneScope: true,
      role: {
        select: {
          allPrivileges: true,
          requestTypeScope: true,
          privileges: {
            where: { privilege: { isActive: true } },
            select: { privilege: { select: { code: true } } },
          },
        },
      },
    },
  });

  const held: HeldRole[] = grants.map((g) => ({
    roleKey: g.roleKey,
    allPrivileges: g.role.allPrivileges,
    privileges: g.role.privileges.map((rp) => rp.privilege.code),
    requestTypeScope: scopeOfRow(g.role.requestTypeScope),
    editionScope: scopeOfRow(g.editionScope),
    zoneScope: scopeOfRow(g.zoneScope),
  }));

  // Only fetched when something actually holds the flag — the common caller
  // holds none, and this saves a query on every request they make.
  const activePrivileges = held.some((r) => r.allPrivileges)
    ? (await db.stallPrivilege.findMany({ where: { isActive: true }, select: { code: true } })).map(
        (p) => p.code,
      )
    : [];

  return {
    personId: person.personId,
    displayName: person.displayName,
    roleKeys: grants.map((g) => g.roleKey),
    privileges: unionPrivileges(held, activePrivileges),
    requestTypeScope: unionRequestTypeScope(held),
    editionScope: unionEditionScope(held),
    zoneScope: unionZoneScope(held),
  };
}

/** Refuses a caller whose grants do not cover this edition.
 *
 *  ⚠️ The edition is not a `where` clause like the other two axes. Every backoffice
 *  query in the module already runs against the ACTIVE edition, so a grant that
 *  does not cover it does not narrow what the caller sees — it means they have
 *  no business here at all this year. A refusal says that; an empty list would
 *  show a volunteer whose access lapsed an event with nothing in it and leave
 *  them to guess why. */
export function requireEditionReach(caller: BackofficeCaller, editionId: string): void {
  if (!canReach(caller.editionScope, editionId)) throw new EditionForbiddenError(editionId);
}

export function requirePrivilege(caller: BackofficeCaller, privilege: StallPrivilege): void {
  if (!can(caller.privileges, privilege)) {
    throw new NotAuthorizedError(`${privilege} requires a stalls role that grants it`);
  }
}

/** For a read several roles reach by different routes — the bay list, which
 *  every screen that filters by bay needs and no role should have to hold
 *  `config.read` for. Not a general escape hatch: a write always names one
 *  privilege, because "any of these may change it" is how a guard stops meaning
 *  anything. */
export function requireAnyPrivilege(caller: BackofficeCaller, privileges: StallPrivilege[]): void {
  if (!privileges.some((p) => can(caller.privileges, p))) {
    throw new NotAuthorizedError(
      `${privileges.join(' or ')} requires a stalls role that grants it`,
    );
  }
}

/* ── The hierarchy ──────────────────────────────────────────────────────────*/

/** The whole tree.
 *
 *  Loaded entire rather than walked in SQL: it is a dozen rows an admin edits
 *  by hand, a recursive query would need the same cycle guard the in-memory
 *  walk already has, and the rule has to stay testable without a database. */
export async function roleTree(db: PrismaClient): Promise<RoleNode[]> {
  const roles = await db.stallRole.findMany({
    select: { roleKey: true, parentKey: true, canAssignSameLevel: true },
    orderBy: { sortOrder: 'asc' },
  });
  return roles;
}

/** Which roles this caller may hand out. */
export async function assignableRolesFor(
  db: PrismaClient,
  caller: BackofficeCaller,
): Promise<Set<string>> {
  return assignableRoleKeys(await roleTree(db), caller.roleKeys);
}

/** Which roles this caller may edit the holder of — the assignable set plus
 *  their own, so the top of a branch can still fix its own account. */
export async function editableRolesFor(
  db: PrismaClient,
  caller: BackofficeCaller,
): Promise<Set<string>> {
  return editableRoleKeys(await roleTree(db), caller.roleKeys);
}
