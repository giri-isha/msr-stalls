// FOUNDATION STUB — copied verbatim from msr-app-replit/apps/api/src/prisma.ts.
// Discarded at migration; the module's `../../prisma` import resolves to the
// host's file, which is this file.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set (see apps/api/.env.example)');
}

// Prisma 7 connects through a driver adapter rather than a schema-level URL.
const adapter = new PrismaPg({ connectionString });

/** One shared Prisma client for the process. */
export const prisma = new PrismaClient({ adapter });
