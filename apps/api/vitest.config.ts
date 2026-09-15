import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Point the suite at a *test* database and refuse to run anywhere else,
    // before any test file imports the Prisma client. The guard matters because
    // the harness TRUNCATEs every stall table between tests.
    setupFiles: ['./test/setup/test-env.ts'],
    // The privilege vocabulary and the shipped role bundles, topped up once
    // before anything runs — see the file for why the suite cannot rely on the
    // migrations alone.
    globalSetup: ['./test/setup/rbac.ts'],
    // Integration tests share one Postgres database and isolate themselves with
    // a TRUNCATE in beforeEach. Parallel files would let one file's truncate
    // wipe another file's rows mid-test — a real, load-dependent race. Files run
    // serially; tests within a file already do.
    fileParallelism: false,
  },
});
