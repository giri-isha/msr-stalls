import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { assertTestDatabase } from '../helpers/test-database';

// Runs before any test file's imports, so it settles which database the suite
// talks to BEFORE `src/prisma.ts` builds its client. dotenv never overwrites a
// variable that is already set, so CI — which supplies DATABASE_URL directly —
// is unaffected whether or not the file exists.
config({ path: fileURLToPath(new URL('../../.env.test', import.meta.url)) });

// Belt and braces: even with the file in place, a stray shell variable could
// still aim the suite at a live database. Fail with instructions instead.
assertTestDatabase(process.env.DATABASE_URL);

// Object storage is OFF for the suite. Empty string, not `delete`: the first
// test file to import `src/prisma.ts` pulls in `dotenv/config`, which loads
// `.env` and would put a deleted value straight back. dotenv never overwrites a
// key already present, so an empty string is what actually holds.
process.env.STALLS_DEV_MEDIA_DIR = '';

// Public submit is rate-limited per IP. The suite fires dozens of submissions
// from one address; lift the cap so tests exercise the domain, not the limiter.
process.env.STALLS_PUBLIC_RATE_LIMIT = '10000';
