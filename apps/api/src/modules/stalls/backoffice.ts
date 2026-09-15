import type { PrismaClient } from '@prisma/client';
import { type RoleSummary, type BackofficeMember, cannotAssign, cannotEdit } from '@msr/stalls';
import { recordActivity } from '../../activity';
import type { Db } from './editions';
import {
  LastAdminError,
  PersonAboveYouError,
  PrivilegeEscalationError,
  RoleAboveYouError,
  UnknownPersonError,
  UnknownRoleError,
} from './errors';
import { MODULE_KEY, type BackofficeCaller, assignableRolesFor, editableRolesFor } from './roles';

/** The roles, with the caller's own reach marked on each.
 *
 *  ⚠️ Served rather than shipped in the bundle. The Users screen used to render
 *  its picker from the `ROLES` constant, which stopped being the truth the
 *  moment roles became data — a role an admin creates is on no list the client
 *  holds (msr ADR 0065). `assignable` is computed per caller so the picker
 *  cannot offer a choice the grant route is about to refuse. */
export async function listRoles(
  db: PrismaClient,
  caller: BackofficeCaller,
): Promise<RoleSummary[]> {
  const [rows, assignable, activePrivileges] = await Promise.all([
    db.stallRole.findMany({
      orderBy: { sortOrder: 'asc' },
      // Counted here rather than per card. The grid draws every role at once,
      // so a count fetched on open would be a request per role.
      include: { _count: { select: { privileges: true, grants: true } } },
    }),
    assignableRolesFor(db, caller),
    db.stallPrivilege.count({ where: { isActive: true } }),
  ]);
  return rows.map((r) => ({
    roleKey: r.roleKey,
    name: r.name,
    description: r.description,
    parentKey: r.parentKey,
    level: r.level,
    isSystem: r.isSystem,
    assignable: assignable.has(r.roleKey),
    // ⚠️ A role carrying the flag has NO join rows — it resolves against the
    // live table — so counting its rows would say "0 privileges" on the most
    // powerful card in the grid.
    privilegeCount: r.allPrivileges ? activePrivileges : r._count.privileges,
    grantCount: r._count.grants,
    allPrivileges: r.allPrivileges,
    requestTypeScope: r.requestTypeScope,
  }));
}

/** The name a refusal should call a role, which is the name an admin sees on
 *  the screen rather than the key underneath it. */
async function roleNameOf(db: PrismaClient, roleKey: string): Promise<string> {
  const role = await db.stallRole.findUnique({ where: { roleKey }, select: { name: true } });
  return role?.name ?? roleKey;
}

/** Refuses a caller who may not hand this role out.
 *
 *  The rule is `assignableRoleKeys`: everything beneath the roles they hold,
 *  plus their own where the role carries `canAssignSameLevel`. Never a sibling. */
async function assertCanAssign(
  db: PrismaClient,
  caller: BackofficeCaller,
  roleKey: string,
): Promise<void> {
  const exists = await db.stallRole.findUnique({ where: { roleKey }, select: { roleKey: true } });
  if (!exists) throw new UnknownRoleError(roleKey);
  const assignable = await assignableRolesFor(db, caller);
  if (!assignable.has(roleKey)) {
    throw new RoleAboveYouError(roleKey, cannotAssign(await roleNameOf(db, roleKey)));
  }
}

/** Refuses a caller who may not touch this person's account at all.
 *
 *  ⚠️ EVERY role the subject holds must be within reach, not merely the one
 *  being changed. Otherwise a lead could strip the Volunteer role from somebody
 *  who is also an admin — editing an account above them by picking the one
 *  attribute of it that happens to sit below them.
 *
 *  A person holding no roles yet passes, which is what lets a new backoffice member
 *  be given their first one. */
async function assertCanEditPerson(
  db: PrismaClient,
  caller: BackofficeCaller,
  personRef: string,
): Promise<void> {
  const held = await db.stallBackofficeRole.findMany({
    where: { personRef },
    select: { roleKey: true, role: { select: { name: true } } },
  });
  const editable = await editableRolesFor(db, caller);
  const blocking = held.find((g) => !editable.has(g.roleKey));
  if (!blocking) return;
  const person = await db.person.findUnique({
    where: { personId: personRef },
    select: { displayName: true },
  });
  throw new PersonAboveYouError(
    personRef,
    cannotEdit(person?.displayName ?? 'That person', blocking.role.name),
  );
}

/** Everyone who holds at least one stalls role, with the roles. Reads the
 *  Foundation's Person for the name and email — a module may READ the
 *  directory; it never writes it. */
export async function listBackoffice(db: Db): Promise<BackofficeMember[]> {
  const grants = await db.stallBackofficeRole.findMany({ orderBy: { createdAt: 'asc' } });
  const refs = [...new Set(grants.map((g) => g.personRef))];
  const people = await db.person.findMany({ where: { personId: { in: refs } } });
  const byId = new Map(people.map((p) => [p.personId, p]));
  return refs.flatMap((ref) => {
    const p = byId.get(ref);
    if (!p) return [];
    return [
      {
        personId: p.personId,
        email: p.email,
        displayName: p.displayName,
        roleKeys: grants.filter((g) => g.personRef === ref).map((g) => g.roleKey),
      },
    ];
  });
}

export async function grantRole(
  db: PrismaClient,
  input: {
    personRef: string;
    roleKey: string;
    editionScope?: string[];
    zoneScope?: string[];
  },
  caller: BackofficeCaller,
): Promise<void> {
  const by = caller.personId;
  await assertCanAssign(db, caller, input.roleKey);
  await assertCanEditPerson(db, caller, input.personRef);
  const person = await db.person.findUnique({ where: { personId: input.personRef } });
  if (!person) throw new UnknownPersonError(input.personRef);
  const editionScope = input.editionScope ?? [];
  const zoneScope = input.zoneScope ?? [];

  // ⚠️ A scoped grantor must not hand out a WIDER grant than their own, for the
  // same reason `assertNoEscalation` guards the role editor: an empty scope
  // means "every edition" and "every bay", so an unscoped grant made by a
  // bay-scoped marshal would reach past them.
  if (caller.editionScope !== null) {
    const beyond =
      editionScope.length === 0 || editionScope.some((id) => !caller.editionScope?.includes(id));
    if (beyond) {
      throw new PrivilegeEscalationError(
        'you cannot grant access to an edition your own access does not cover',
      );
    }
  }
  if (caller.zoneScope !== null) {
    const beyond = zoneScope.length === 0 || zoneScope.some((z) => !caller.zoneScope?.includes(z));
    if (beyond) {
      throw new PrivilegeEscalationError(
        'you cannot grant access to a bay your own access does not cover',
      );
    }
  }

  await db.stallBackofficeRole.upsert({
    where: { personRef_roleKey: { personRef: input.personRef, roleKey: input.roleKey } },
    create: {
      personRef: input.personRef,
      roleKey: input.roleKey,
      grantedBy: by,
      editionScope,
      zoneScope,
    },
    // Re-granting a role somebody already holds RESETS its scope rather than
    // leaving the old one in place: the grant screen sends the whole picture,
    // so a narrowed grant that silently kept last year's wider reach would be
    // the one failure nobody would look for.
    update: { editionScope, zoneScope },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_backoffice_role.granted',
    subjectRef: input.personRef,
    detail: { roleKey: input.roleKey, editionScope, zoneScope },
  });
}

/** Refuses to remove the last admin: with nobody holding `config.write` and
 *  `users.write`, nobody could grant it back.
 *
 *  Taking a role away is gated exactly as handing it out is — if the role is
 *  out of your reach, so is removing it — plus the account check, so a lead
 *  cannot demote an admin by picking off their lesser roles. */
export async function revokeRole(
  db: PrismaClient,
  input: { personRef: string; roleKey: string },
  caller: BackofficeCaller,
): Promise<void> {
  const by = caller.personId;
  await assertCanAssign(db, caller, input.roleKey);
  await assertCanEditPerson(db, caller, input.personRef);
  await db.$transaction(async (tx) => {
    if (input.roleKey === 'stalls_admin') {
      const admins = await tx.stallBackofficeRole.count({ where: { roleKey: 'stalls_admin' } });
      const isAdmin = await tx.stallBackofficeRole.findUnique({
        where: { personRef_roleKey: { personRef: input.personRef, roleKey: 'stalls_admin' } },
      });
      if (isAdmin && admins <= 1) throw new LastAdminError();
    }
    await tx.stallBackofficeRole.deleteMany({
      where: { personRef: input.personRef, roleKey: input.roleKey },
    });
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_backoffice_role.revoked',
      subjectRef: input.personRef,
      detail: { roleKey: input.roleKey },
    });
  });
}

/** The directory, for the "add a backoffice member" picker. */
export async function searchPeople(db: Db, q: string) {
  return db.person.findMany({
    where: {
      signInDisabled: false,
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 20,
    orderBy: { displayName: 'asc' },
    select: { personId: true, email: true, displayName: true },
  });
}
