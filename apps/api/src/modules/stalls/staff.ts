import type { PrismaClient } from '@prisma/client';
import {
  type RoleSummary,
  type StaffMember,
  cannotAssign,
  cannotEdit,
  roleDepth,
} from '@msr/stalls';
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
import { MODULE_KEY, type StaffCaller, assignableRolesFor, editableRolesFor } from './roles';

/** The roles, with the caller's own reach marked on each.
 *
 *  ⚠️ Served rather than shipped in the bundle. The Users screen used to render
 *  its picker from the `ROLES` constant, which stopped being the truth the
 *  moment roles became data — a role an admin creates is on no list the client
 *  holds (msr ADR 0065). `assignable` is computed per caller so the picker
 *  cannot offer a choice the grant route is about to refuse. */
export async function listRoles(db: PrismaClient, caller: StaffCaller): Promise<RoleSummary[]> {
  const [rows, assignable] = await Promise.all([
    db.stallRole.findMany({ orderBy: { sortOrder: 'asc' } }),
    assignableRolesFor(db, caller),
  ]);
  const tree = rows.map((r) => ({
    roleKey: r.roleKey,
    parentKey: r.parentKey,
    canAssignSameLevel: r.canAssignSameLevel,
  }));
  return rows.map((r) => ({
    roleKey: r.roleKey,
    name: r.name,
    description: r.description,
    parentKey: r.parentKey,
    depth: roleDepth(tree, r.roleKey),
    isSystem: r.isSystem,
    assignable: assignable.has(r.roleKey),
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
  caller: StaffCaller,
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
 *  A person holding no roles yet passes, which is what lets a new staff member
 *  be given their first one. */
async function assertCanEditPerson(
  db: PrismaClient,
  caller: StaffCaller,
  personRef: string,
): Promise<void> {
  const held = await db.stallStaffRole.findMany({
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
export async function listStaff(db: Db): Promise<StaffMember[]> {
  const grants = await db.stallStaffRole.findMany({ orderBy: { createdAt: 'asc' } });
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
  caller: StaffCaller,
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
  // means "every season" and "every bay", so an unscoped grant made by a
  // bay-scoped marshal would reach past them.
  if (caller.editionScope !== null) {
    const beyond =
      editionScope.length === 0 || editionScope.some((id) => !caller.editionScope?.includes(id));
    if (beyond) {
      throw new PrivilegeEscalationError(
        'you cannot grant access to a season your own access does not cover',
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

  await db.stallStaffRole.upsert({
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
    action: 'stall_staff_role.granted',
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
  caller: StaffCaller,
): Promise<void> {
  const by = caller.personId;
  await assertCanAssign(db, caller, input.roleKey);
  await assertCanEditPerson(db, caller, input.personRef);
  await db.$transaction(async (tx) => {
    if (input.roleKey === 'stalls_admin') {
      const admins = await tx.stallStaffRole.count({ where: { roleKey: 'stalls_admin' } });
      const isAdmin = await tx.stallStaffRole.findUnique({
        where: { personRef_roleKey: { personRef: input.personRef, roleKey: 'stalls_admin' } },
      });
      if (isAdmin && admins <= 1) throw new LastAdminError();
    }
    await tx.stallStaffRole.deleteMany({
      where: { personRef: input.personRef, roleKey: input.roleKey },
    });
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_staff_role.revoked',
      subjectRef: input.personRef,
      detail: { roleKey: input.roleKey },
    });
  });
}

/** The directory, for the "add a staff member" picker. */
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
