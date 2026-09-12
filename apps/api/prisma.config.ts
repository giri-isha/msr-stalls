import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 moved the connection URL out of schema.prisma into this config file.
// The CLI (migrate/generate) reads the datasource URL from here at runtime.
export default defineConfig({
  schema: './prisma/schema.prisma',
  migrations: {
    path: './prisma/migrations',
    seed: 'tsx ./prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
