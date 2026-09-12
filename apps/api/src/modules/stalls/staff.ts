import type { PrismaClient } from '@prisma/client';
import { ROLES, type StaffMember } from '@msr/stalls';
import { recordActivity } from '../../activity';
import type { Db } from './editions';
import { LastAdminError, UnknownPersonError } from './errors';
import { MODULE_KEY } from './roles';

const ROLE_KEYS = new Set(ROLES.map((r) => r.roleKey));

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
  input: { personRef: string; roleKey: string },
  by: string,
): Promise<void> {
  if (!ROLE_KEYS.has(input.roleKey)) {
    throw new Error(`unknown stalls role ${JSON.stringify(input.roleKey)}`);
  }
  const person = await db.person.findUnique({ where: { personId: input.personRef } });
  if (!person) throw new UnknownPersonError(input.personRef);
  await db.stallStaffRole.upsert({
    where: { personRef_roleKey: { personRef: input.personRef, roleKey: input.roleKey } },
    create: { personRef: input.personRef, roleKey: input.roleKey, grantedBy: by },
    update: {},
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_staff_role.granted',
    subjectRef: input.personRef,
    detail: { roleKey: input.roleKey },
  });
}

/** Refuses to remove the last admin: with nobody holding `config:write` and
 *  `users:write`, nobody could grant it back. */
export async function revokeRole(
  db: PrismaClient,
  input: { personRef: string; roleKey: string },
  by: string,
): Promise<void> {
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
