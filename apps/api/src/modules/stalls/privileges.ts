// The privilege catalogue, read.
//
// ⚠️ There is no write in this file, and that is the design rather than an
// omission. The privilege VOCABULARY is code — a privilege means nothing unless
// a route enforces it — so it ships in `PRIVILEGE_CATEGORIES` and arrives in
// the table through `seed-rbac.ts`. One invented from a screen would be a code
// that grants nothing, which is worse than absent because it reads as a rule.
// What an admin authors is the COMPOSITION: see `roles-admin.ts`.
//
// Served rather than read off the bundle because of one field: `isActive`. A
// privilege is retired by clearing that flag, never by deleting a row roles
// still bundle, and the compiled-in list cannot know it happened.
import type { PrismaClient } from '@prisma/client';
import type { PrivilegeCatalogEntry } from '@stalls/core';

export async function listPrivileges(db: PrismaClient): Promise<PrivilegeCatalogEntry[]> {
  // Retired rows included. The catalogue is a reference an admin reads while
  // composing a role, and "this used to exist and no longer applies" is an
  // answer it has to be able to give.
  const rows = await db.stallPrivilege.findMany({
    orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
  });
  return rows.map((p) => ({
    code: p.code,
    label: p.label,
    category: p.category,
    kind: p.kind,
    description: p.description,
    isActive: p.isActive,
  }));
}
