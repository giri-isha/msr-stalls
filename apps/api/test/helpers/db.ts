import type { FastifyInstance } from 'fastify';
import type { StallEdition } from '@prisma/client';
import { LogMailer } from '../../src/email';
import { createEdition } from '../../src/modules/stalls/config';
import { prisma } from '../../src/prisma';

/** How long the truncate waits for the tables before giving up. Generous: on an
 *  idle test database it takes milliseconds, so anything near this means
 *  somebody else is holding them and waiting longer will not help. */
const LOCK_TIMEOUT_MS = 3_000;

/** The name of the database we are pointed at, for the message below. */
function databaseName(): string {
  const url = process.env.DATABASE_URL ?? '';
  return url.split('/').pop()?.split('?')[0] || 'the test database';
}

/** ⚠️ Everything else in the suite fails strangely when this does, so it is
 *  worth reading. TRUNCATE needs ACCESS EXCLUSIVE on all 37 tables, which it
 *  cannot get while another connection is working — a second `vitest run`, an
 *  editor running tests on save, a REPL left open. Postgres then either blocks
 *  or picks this statement as the deadlock victim.
 *
 *  Neither outcome used to say so. A `deadlock detected` surfaced at
 *  `beforeEach` naming no database and no other process, and because the rows
 *  it failed to clear stayed behind, the rest of the file failed as "no zone C1
 *  in this edition" and "edition … has no charge config" — which read like bugs
 *  in the code under test and are not. */
function contention(err: unknown): Error | null {
  const text = err instanceof Error ? err.message : String(err);
  if (!/deadlock detected|lock timeout|canceling statement due to lock/i.test(text)) return null;
  return new Error(
    `Could not reset ${databaseName()}: another connection is holding its tables.\n` +
      'Something else is using the test database — a second `vitest run`, an editor ' +
      'running tests on save, or a dev server pointed at it. The suite shares one ' +
      'database and runs its files serially, so it has to be the only thing using it. ' +
      'Run one at a time and try again.',
  );
}

/** Wipes every table the module and the Foundation stubs own. Discovers them
 *  from the catalogue rather than listing them, so a new model cannot be
 *  forgotten here and leak rows between tests. */
export async function resetDatabase(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ table_schema: string; table_name: string }>>`
    select table_schema, table_name
    from information_schema.tables
    where table_schema in ('stalls', 'foundation')
      and table_type = 'BASE TABLE'
      and table_name <> '_prisma_migrations'
  `;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.table_schema}"."${r.table_name}"`).join(', ');

  try {
    // One transaction, so `SET LOCAL` applies to the TRUNCATE beside it and to
    // nothing afterwards. Without the timeout the truncate waits for as long as
    // the other run takes, which is how a blocked suite looks like a hung one.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`),
      prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`),
    ]);
  } catch (err) {
    throw contention(err) ?? err;
  }
}

export const SYSTEM = '00000000-0000-0000-0000-000000000000';

/** A 2026 edition with all defaults — zones, rates, charges, sequences. */
export async function seedEdition(year = 2026): Promise<StallEdition> {
  return createEdition(prisma, { year, name: `MSR ${year}`, activate: true }, SYSTEM);
}

export interface Staff {
  personId: string;
  email: string;
  /** Pass as `headers` on `app.inject` to act as this person. */
  headers: { cookie: string };
}

/** A signed-in staff member holding the given stalls roles. */
export async function seedStaff(roleKeys: string[], email?: string): Promise<Staff> {
  const addr = email ?? `staff-${Math.random().toString(36).slice(2, 8)}@example.org`;
  const person = await prisma.person.create({
    data: { email: addr, displayName: addr.split('@')[0] },
  });
  for (const roleKey of roleKeys) {
    await prisma.stallStaffRole.create({
      data: { personRef: person.personId, roleKey, grantedBy: SYSTEM },
    });
  }
  return {
    personId: person.personId,
    email: person.email,
    headers: { cookie: `msr_session=${person.personId}` },
  };
}

/** A well-formed vendor submission body, overridable per test. */
export function vendorBody(overrides: Record<string, unknown> = {}) {
  return {
    requestType: 'VENDOR',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    email: 'priya@greenleaf.example',
    contactNumber: '9840012345',
    address: '12 Mettupalayam Road, Coimbatore',
    stallType: 'FOOD',
    preferredZoneCode: 'C1',
    itemsSelling: 'Organic spices, cold-pressed oils, honey',
    numStallsRequested: 1,
    agreed: true,
    ...overrides,
  };
}

export { LogMailer, prisma };

/** A confirmed, logged-in requester, with the cookie jar `app.inject` wants.
 *
 *  The stall request form sits behind a session now, so every test that submits
 *  needs one of these.
 *
 *  ⚠️ It flips `confirmedAt` directly rather than following the confirmation
 *  link. The raw token exists only in the message the app's own mailer was
 *  handed, which this helper cannot reach from another test file — and the
 *  confirm route is covered end to end, link and all, in
 *  `requester-auth.test.ts`. What this helper must exercise is the part its
 *  callers depend on: that a real session cookie comes back from the login
 *  route. */
export async function seedRequester(
  app: FastifyInstance,
  contact = 'priya@greenleaf.example',
  password = 'hunter2hunter2',
  displayName = 'Priya Venkat',
): Promise<{ accountId: string; cookies: Record<string, string> }> {
  await app.inject({
    method: 'POST',
    url: '/api/m/stalls/public/register',
    payload: { contact, password, displayName },
  });
  const cred = await prisma.stallCredential.findUniqueOrThrow({ where: { loginValue: contact } });
  await prisma.stallCredential.update({
    where: { id: cred.id },
    data: { confirmedAt: new Date() },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/api/m/stalls/public/login',
    payload: { contact, password },
  });
  const value = login.cookies.find((c) => c.name === 'msr_stall_requester')?.value;
  if (!value) throw new Error(`seedRequester could not log in: ${login.statusCode} ${login.body}`);

  return { accountId: cred.accountId, cookies: { msr_stall_requester: value } };
}

/** The account a test submits against when it calls `submitRequest` directly
 *  rather than through the route.
 *
 *  Keyed on the body's own email, which is exactly what `findOrCreateAccount`
 *  did before the session gate: two submissions under one address land on one
 *  account, two addresses make two. Tests written against that behaviour keep
 *  meaning what they meant — the gate changed where the account comes from in
 *  PRODUCTION, and this helper stands in for the session a test has not got. */
export async function accountFor(body: Record<string, unknown> = {}): Promise<string> {
  const email = String(body.email ?? 'priya@greenleaf.example')
    .trim()
    .toLowerCase();
  const account = await prisma.stallAccount.upsert({
    where: { email },
    update: {},
    create: {
      email,
      phone: String(body.contactNumber ?? '9840012345'),
      displayName: String(body.requesterName ?? 'Priya Venkat'),
    },
  });
  return account.id;
}
