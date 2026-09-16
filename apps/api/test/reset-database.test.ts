import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, expect, test } from 'vitest';
import { prisma, resetDatabase } from './helpers/db';

/** The harness's own truncate, and what it says when it cannot run.
 *
 *  `resetDatabase` competes for locks with anything else using the test
 *  database — a second `vitest run`, an editor running tests on save. It loses,
 *  and before this it lost as `deadlock detected` at `beforeEach`, which named
 *  neither the database nor the other process. Worse, the rows it failed to
 *  clear stayed, so the REST of the file failed as "no zone C1 in this edition"
 *  and "edition … has no charge config" — a cascade that reads like a bug in
 *  the code under test.
 *
 *  One statement of the real problem beats thirteen misleading ones. */

// A SECOND client, not the shared one: the whole point is a connection the
// code under test does not control. Prisma 7 connects through a driver
// adapter, so it is built the way `src/prisma.ts` builds its own.
const blocker = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
afterAll(() => blocker.$disconnect());

test('says who is holding the database rather than "deadlock detected"', async () => {
  let release!: () => void;
  let held!: () => void;
  const releasing = new Promise<void>((r) => {
    release = r;
  });
  const holding = new Promise<void>((r) => {
    held = r;
  });

  // A second connection holding one of the tables, the way a test in another
  // run holds them. ACCESS EXCLUSIVE rather than a race: the point is what
  // `resetDatabase` SAYS when it cannot get in, and that must not itself be
  // timing-dependent.
  const lock = blocker.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('LOCK TABLE "stalls"."stall_edition" IN ACCESS EXCLUSIVE MODE');
      held();
      await releasing;
    },
    { timeout: 30_000 },
  );

  await holding;
  try {
    // One call, both assertions: each attempt waits out the helper's lock
    // timeout, and a second one would buy nothing for another three seconds.
    const err = await resetDatabase().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/another connection is holding/i);
    // It names the database, so a reader knows which one to go looking for.
    expect((err as Error).message).toMatch(/stalls_test/);
  } finally {
    release();
    await lock;
  }

  // And it still works once the other connection has let go.
  await expect(resetDatabase()).resolves.toBeUndefined();
  expect(await prisma.stallEdition.count()).toBe(0);
  // Longer than the helper's own lock timeout, twice over: the test WANTS to
  // reach that timeout, so the default 5s would race the thing under test.
}, 30_000);
