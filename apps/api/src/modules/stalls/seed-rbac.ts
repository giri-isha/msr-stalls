// The RBAC reference data: the privilege vocabulary and the roles the module
// ships with.
//
// ⚠️ These rows are installed by the MIGRATION that created the tables, not by
// this function — the foreign key on `stall_staff_role.role_key` is added in
// that same migration, so the roles have to exist before it lands or every
// existing grant violates it.
//
// This is the idempotent top-up beside it, and it earns its place three ways:
// it carries a later edit to `PRIVILEGE_CATEGORIES` or `SEED_ROLES` into an
// existing database without a second migration; it repairs a database whose
// reference rows were removed; and it lets the test harness guarantee them
// without replaying migrations.
//
// It UPSERTS and never deletes. A role an admin authored is not in these
// constants and must survive, and a privilege dropped from the code is retired
// by setting `isActive` false, never by deleting a row that roles still bundle.
import type { PrismaClient } from '@prisma/client';
import { PRIVILEGE_CATEGORIES, SEED_ROLES } from '@msr/stalls';

export async function seedRbac(db: PrismaClient): Promise<void> {
  let sortOrder = 0;
  for (const category of PRIVILEGE_CATEGORIES) {
    for (const item of category.items) {
      const row = {
        label: item.label,
        category: category.key,
        kind: item.kind,
        description: item.description,
        sortOrder: sortOrder++,
      };
      await db.stallPrivilege.upsert({
        where: { code: item.code },
        // `isActive` is deliberately not reset on update: retiring a privilege
        // is an operational act, and re-running the seed must not quietly
        // switch one back on.
        update: row,
        create: { code: item.code, ...row },
      });
    }
  }

  for (const role of SEED_ROLES) {
    const row = {
      name: role.name,
      description: role.description,
      parentKey: role.parentKey,
      isSystem: true,
      allPrivileges: role.allPrivileges,
      canAssignSameLevel: role.canAssignSameLevel,
      requestTypeScope: [...(role.requestTypeScope ?? [])],
      sortOrder: role.sortOrder,
    };
    // ⚠️ `update` deliberately omits the privilege bundle, which is set below.
    // Rewriting it as a set is the point: a privilege removed from a shipped
    // role in code must actually leave the role, which an upsert of additions
    // alone would never do.
    const saved = await db.stallRole.upsert({
      where: { roleKey: role.roleKey },
      update: row,
      create: { roleKey: role.roleKey, ...row },
    });

    const wanted = await db.stallPrivilege.findMany({
      where: { code: { in: [...role.privileges] } },
      select: { id: true },
    });
    await db.stallRolePrivilege.deleteMany({
      where: { roleId: saved.id, privilegeId: { notIn: wanted.map((p) => p.id) } },
    });
    for (const privilege of wanted) {
      await db.stallRolePrivilege.upsert({
        where: { roleId_privilegeId: { roleId: saved.id, privilegeId: privilege.id } },
        update: {},
        create: { roleId: saved.id, privilegeId: privilege.id },
      });
    }
  }
}
