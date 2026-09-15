// The RBAC reference data, guaranteed once for the whole run.
//
// 🔴 `resetDatabase` deliberately does NOT truncate `stall_privilege`,
// `stall_role` or `stall_role_privilege` — the reason is written out there —
// so the vocabulary and the shipped roles are whatever the migrations left
// behind. That is fine until a release CHANGES what a shipped role grants, and
// then the suite runs the new code against last month's bundles: the Lead role
// in the test database keeps the privileges it was migrated with, and tests
// fail in a way that reads like a broken guard rather than a stale fixture.
//
// `seedRbac` is idempotent and upserts, which is exactly the third job its own
// file claims — "it lets the test harness guarantee them without replaying
// migrations" — and until now nothing was calling it.
//
// ⚠️ A `globalSetup`, so it runs ONCE. Doing it per test would be twenty-odd
// upserts before each of four hundred tests, for reference data no test writes.
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { assertTestDatabase } from '../helpers/test-database';
import { seedRbac } from '../../src/modules/stalls/seed-rbac';

export default async function setup(): Promise<void> {
  // ⚠️ `globalSetup` runs in its own context, BEFORE `setupFiles` — so the work
  // `test-env.ts` does is not done here and has to be repeated. Both loads are
  // no-ops if the variable is already set, which is how CI supplies it.
  config({ path: fileURLToPath(new URL('../../.env.test', import.meta.url)) });
  const connectionString = process.env.DATABASE_URL;
  assertTestDatabase(connectionString);

  // Built by hand rather than imported from `src/prisma.ts`: that module is a
  // singleton the test workers own, and this runs in a different process.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seedRbac(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
