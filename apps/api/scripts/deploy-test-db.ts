import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { assertTestDatabase } from '../test/helpers/test-database';

// Apply migrations to the TEST database (`.env.test`), not the dev one. Exists
// because `prisma migrate deploy` reads DATABASE_URL via prisma.config.ts, and
// there is no cross-platform way to set one env var for one npm script without
// another dependency. Run this whenever a migration lands, alongside
// `db:migrate` for dev.
config({ path: fileURLToPath(new URL('../.env.test', import.meta.url)) });
assertTestDatabase(process.env.DATABASE_URL);

// dotenv does not overwrite variables that are already set, so the DATABASE_URL
// just loaded survives prisma.config.ts loading `.env` in the child process.
execSync('npx prisma migrate deploy', { stdio: 'inherit' });

// The RBAC reference data, topped up after the migrations.
//
// `migrate deploy` will not replay a migration already recorded as applied, so
// a test database that has had its `stall_role` rows removed stays empty and
// every `seedStaff` call then violates the foreign key on
// `stall_staff_role.role_key`. This makes the vocabulary a guarantee of running
// this script rather than a side effect of which migrations happened to run.
const { PrismaPg } = await import('@prisma/adapter-pg');
const { PrismaClient } = await import('@prisma/client');
const { seedRbac } = await import('../src/modules/stalls/seed-rbac');

// Built here rather than imported from `src/prisma.ts`: that module reads
// DATABASE_URL at import time and would bind to the DEV database, which is the
// one thing this script must never touch.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
await seedRbac(prisma);
await prisma.$disconnect();
