// Authoring roles — the half of ADR 0018 that makes "no deploy" real.
//
// The privilege VOCABULARY stays developer-defined (`PRIVILEGE_CATEGORIES` in
// `@stalls/core`, seeded by `seed-rbac.ts`). What happens here is composition:
// which privileges a role bundles, where it sits in the hierarchy, and which
// requester types it reaches.
//
// 🔴 Every write in this file is guarded twice. Once by the hierarchy — you may
// only retune a role beneath you — and once by `assertNoEscalation`, because
// whoever can author a role can, with `users.write`, grant it to themselves.
// Without the second guard `roles.write` is a route to every other privilege.
import type { PrismaClient } from '@prisma/client';
import {
  type CreateRoleInput,
  type RoleDetail,
  type SaveRoleInput,
  assignableRoleKeys,
  cannotAssign,
} from '@stalls/core';
import {
  PrivilegeEscalationError,
  RoleAboveYouError,
  RoleCycleError,
  RoleInUseError,
  RoleKeyTakenError,
  SystemRoleError,
  UnknownRoleError,
} from './errors';
import { actorFrom, audit } from './audit';
import { MODULE_KEY, type BackofficeCaller, assignableRolesFor, roleTree } from './roles';

/** One role, opened for editing. */
export async function getRole(
  db: PrismaClient,
  caller: BackofficeCaller,
  roleKey: string,
): Promise<RoleDetail> {
  const role = await db.stallRole.findUnique({
    where: { roleKey },
    include: {
      privileges: { include: { privilege: true } },
      _count: { select: { grants: true, privileges: true } },
    },
  });
  if (!role) throw new UnknownRoleError(roleKey);
  const [assignable, activePrivileges] = await Promise.all([
    assignableRolesFor(db, caller),
    db.stallPrivilege.count({ where: { isActive: true } }),
  ]);
  return {
    roleKey: role.roleKey,
    name: role.name,
    description: role.description,
    parentKey: role.parentKey,
    level: role.level,
    isSystem: role.isSystem,
    assignable: assignable.has(role.roleKey),
    privileges: role.privileges.map((rp) => rp.privilege.code),
    allPrivileges: role.allPrivileges,
    canAssignSameLevel: role.canAssignSameLevel,
    requestTypeScope: role.requestTypeScope,
    privilegeCount: role.allPrivileges ? activePrivileges : role._count.privileges,
    grantCount: role._count.grants,
  };
}

/**
 * Refuses to put anything into a role that its author does not already hold.
 *
 * 🔴 The guard that keeps `roles.write` from being a route to every other
 * privilege. An author who can also grant roles can hand the new role to
 * themselves, so a role composed here may never reach further than its author
 * already reaches — in privileges, in the `allPrivileges` flag, or in requester
 * types.
 *
 * ⚠️ `allPrivileges` is checked against the LIVE privilege list rather than
 * against the author's own flag. Somebody who happens to hold every privilege
 * one by one may set it; somebody missing even one may not, because the flag
 * would then also carry everything added in a later release.
 */
async function assertNoEscalation(
  db: PrismaClient,
  caller: BackofficeCaller,
  input: SaveRoleInput,
): Promise<void> {
  const mine = new Set(caller.privileges);

  const beyond = input.privileges.filter((code) => !mine.has(code));
  if (beyond.length > 0) {
    throw new PrivilegeEscalationError(
      `you cannot put ${beyond.sort().join(', ')} into a role — a role can only carry what you hold yourself`,
    );
  }

  if (input.allPrivileges) {
    const active = await db.stallPrivilege.findMany({
      where: { isActive: true },
      select: { code: true },
    });
    const missing = active.filter((p) => !mine.has(p.code));
    if (missing.length > 0) {
      throw new PrivilegeEscalationError(
        'only somebody who already holds every privilege can give a role all of them',
      );
    }
  }

  // A scoped author must not author an unscoped role. `null` on the caller is
  // "reaches every type", which is the only case that may widen.
  if (caller.requestTypeScope !== null) {
    const reachable = new Set(caller.requestTypeScope);
    const wider =
      input.requestTypeScope.length === 0 || input.requestTypeScope.some((t) => !reachable.has(t));
    if (wider) {
      throw new PrivilegeEscalationError(
        'you cannot give a role reach over requester types you cannot see yourself',
      );
    }
  }
}

/** Refuses a parent the caller may not build under, and one that would loop.
 *
 *  A role is only ever created or moved INTO the caller's own reach: its parent
 *  must be a role they could hand out. A root role — one with no parent at all —
 *  sits above everything, so only somebody who already holds a root role they
 *  may hand out (in the shipped tree, an Admin) can make another. */
async function assertParentAllowed(
  db: PrismaClient,
  caller: BackofficeCaller,
  roleKey: string | null,
  parentKey: string | null,
): Promise<void> {
  const tree = await roleTree(db);
  const assignable = assignableRoleKeys(tree, caller.roleKeys);

  if (parentKey === null) {
    const holdsAssignableRoot = tree.some(
      (r) => r.parentKey === null && caller.roleKeys.includes(r.roleKey) && r.canAssignSameLevel,
    );
    if (!holdsAssignableRoot) {
      throw new PrivilegeEscalationError(
        'a role with no parent sits above every other — only somebody at the top of the tree can create one',
      );
    }
    return;
  }

  const parent = tree.find((r) => r.roleKey === parentKey);
  if (!parent) throw new UnknownRoleError(parentKey);
  if (!assignable.has(parentKey) && !caller.roleKeys.includes(parentKey)) {
    const named = await db.stallRole.findUnique({
      where: { roleKey: parentKey },
      select: { name: true },
    });
    throw new RoleAboveYouError(parentKey, cannotAssign(named?.name ?? parentKey));
  }

  // Walking up from the proposed parent must never arrive back at the role
  // being moved. The `seen` set is the guard against a tree that is ALREADY
  // tangled hanging the request that would untangle it.
  if (roleKey !== null) {
    const byKey = new Map(tree.map((r) => [r.roleKey, r]));
    const seen = new Set<string>();
    let cursor: string | null = parentKey;
    while (cursor && !seen.has(cursor)) {
      if (cursor === roleKey) throw new RoleCycleError();
      seen.add(cursor);
      cursor = byKey.get(cursor)?.parentKey ?? null;
    }
  }
}

/** Rewrite a role's privilege bundle as a SET.
 *
 *  Never an upsert of additions: a privilege the author cleared has to actually
 *  leave the role, and "add what is ticked" would leave it in place for ever. */
async function setPrivileges(
  db: PrismaClient,
  roleId: string,
  codes: readonly string[],
): Promise<void> {
  const wanted = await db.stallPrivilege.findMany({
    where: { code: { in: [...codes] } },
    select: { id: true },
  });
  const ids = wanted.map((p) => p.id);
  await db.stallRolePrivilege.deleteMany({
    where: { roleId, ...(ids.length > 0 ? { privilegeId: { notIn: ids } } : {}) },
  });
  for (const privilegeId of ids) {
    await db.stallRolePrivilege.upsert({
      where: { roleId_privilegeId: { roleId, privilegeId } },
      update: {},
      create: { roleId, privilegeId },
    });
  }
}

/** A role carrying `allPrivileges` holds no join rows — the flag resolves
 *  against the live table, and storing both would be two answers to one
 *  question. */
const bundleFor = (input: SaveRoleInput) => (input.allPrivileges ? [] : input.privileges);

export async function createRole(
  db: PrismaClient,
  input: CreateRoleInput,
  caller: BackofficeCaller,
): Promise<RoleDetail> {
  const existing = await db.stallRole.findUnique({ where: { roleKey: input.roleKey } });
  if (existing) throw new RoleKeyTakenError(input.roleKey);

  await assertNoEscalation(db, caller, input);
  await assertParentAllowed(db, caller, null, input.parentKey);

  const last = await db.stallRole.findFirst({ orderBy: { sortOrder: 'desc' } });
  const role = await db.stallRole.create({
    data: {
      roleKey: input.roleKey,
      name: input.name,
      description: input.description,
      parentKey: input.parentKey,
      level: input.level,
      isSystem: false,
      allPrivileges: input.allPrivileges,
      canAssignSameLevel: input.canAssignSameLevel,
      requestTypeScope: input.requestTypeScope,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });
  await setPrivileges(db, role.id, bundleFor(input));

  await audit(db, {
    actor: actorFrom(caller.personId),
    action: 'stall_role.created',
    subject: { type: 'role', ref: role.id },
    detail: { roleKey: input.roleKey, privileges: bundleFor(input) },
  });
  return getRole(db, caller, input.roleKey);
}

export async function updateRole(
  db: PrismaClient,
  roleKey: string,
  input: SaveRoleInput,
  caller: BackofficeCaller,
): Promise<RoleDetail> {
  const role = await db.stallRole.findUnique({ where: { roleKey } });
  if (!role) throw new UnknownRoleError(roleKey);

  // Retuning a role you cannot hand out is retuning something above you — and
  // for a role you HOLD but cannot assign, it is editing your own reach.
  const assignable = await assignableRolesFor(db, caller);
  if (!assignable.has(roleKey)) throw new RoleAboveYouError(roleKey, cannotAssign(role.name));

  await assertNoEscalation(db, caller, input);
  if (input.parentKey !== role.parentKey) {
    await assertParentAllowed(db, caller, roleKey, input.parentKey);
  }

  await db.stallRole.update({
    where: { roleKey },
    data: {
      name: input.name,
      description: input.description,
      parentKey: input.parentKey,
      level: input.level,
      allPrivileges: input.allPrivileges,
      canAssignSameLevel: input.canAssignSameLevel,
      requestTypeScope: input.requestTypeScope,
    },
  });
  await setPrivileges(db, role.id, bundleFor(input));

  await audit(db, {
    actor: actorFrom(caller.personId),
    action: 'stall_role.updated',
    subject: { type: 'role', ref: role.id },
    detail: { roleKey, privileges: bundleFor(input) },
  });
  return getRole(db, caller, roleKey);
}

export async function deleteRole(
  db: PrismaClient,
  roleKey: string,
  caller: BackofficeCaller,
): Promise<void> {
  const role = await db.stallRole.findUnique({
    where: { roleKey },
    include: { _count: { select: { grants: true, children: true } } },
  });
  if (!role) throw new UnknownRoleError(roleKey);
  if (role.isSystem) throw new SystemRoleError(roleKey, 'cannot be deleted');

  const assignable = await assignableRolesFor(db, caller);
  if (!assignable.has(roleKey)) throw new RoleAboveYouError(roleKey, cannotAssign(role.name));

  if (role._count.grants > 0) throw new RoleInUseError(roleKey, role._count.grants);

  // Children are re-parented by the schema's `onDelete: SetNull`, which lifts
  // them to the root rather than deleting a subtree nobody asked to lose. Said
  // out loud here because it is the surprising half of this operation.
  await db.stallRole.delete({ where: { roleKey } });

  await audit(db, {
    actor: actorFrom(caller.personId),
    action: 'stall_role.deleted',
    subject: { type: 'role', ref: role.id },
    detail: { roleKey, orphanedChildren: role._count.children },
  });
}
