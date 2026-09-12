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
