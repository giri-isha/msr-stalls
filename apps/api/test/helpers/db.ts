import type { FastifyInstance } from 'fastify';
import type { StallEdition } from '@prisma/client';
import { LogMailer } from '../../src/email';
import { createEdition } from '../../src/modules/stalls/config';
import { addFormField } from '../../src/modules/stalls/form-builder';
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
      -- The RBAC vocabulary is REFERENCE DATA, installed by the migration that
      -- created it, not a fixture any test writes. Truncating it would empty
      -- stall_role, and every seedBackoffice call would then violate the foreign key
      -- on stall_backoffice_role.role_key -- the suite would be exercising a module
      -- with no roles in it at all.
      --
      -- Safe only while nothing AUTHORS a role at runtime. When the role editor
      -- lands, a test that creates one must clean it up, or this exclusion
      -- becomes leakage between tests.
      and table_name not in ('stall_privilege', 'stall_role', 'stall_role_privilege')
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

/**
 * A question appended to one of an edition's forms, as the Form Builder appends
 * it.
 *
 * ⚠️ Goes through `addFormField` rather than `prisma.stallFormField.create`, so
 * a test's field hangs off the form definition and carries the same sort order
 * and `isBuiltIn: false` a real one does. There is no longer a seam that writes
 * an appended field any other way — the Custom fields tab that used to own one
 * is gone, and the Form Builder is the only way in.
 */
export async function appendField(
  editionId: string,
  formType: string,
  label: string,
  fieldType = 'text',
): Promise<{ id: string }> {
  const definition = await prisma.stallFormDefinition.findFirstOrThrow({
    where: { editionId, formType: formType as never },
    select: { id: true },
  });
  return addFormField(prisma, editionId, definition.id, {
    label,
    labelTa: null,
    help: null,
    fieldType,
    isRequired: false,
    sectionId: null,
    options: null,
    min: null,
    max: null,
  });
}

export interface Backoffice {
  personId: string;
  email: string;
  /** Pass as `headers` on `app.inject` to act as this person. */
  headers: { cookie: string };
}

/** A signed-in backoffice member holding the given stalls roles. */
export async function seedBackoffice(roleKeys: string[], email?: string): Promise<Backoffice> {
  const addr = email ?? `backoffice-${Math.random().toString(36).slice(2, 8)}@example.org`;
  const person = await prisma.person.create({
    data: { email: addr, displayName: addr.split('@')[0] },
  });
  for (const roleKey of roleKeys) {
    await prisma.stallBackofficeRole.create({
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
    // ⚠️ Zeros, not omissions. The 2025 LOCAL WELFARE form marks every one of
    // these required — a requester with no gas stove types 0 — and since the
    // form definition became the thing the API validates against, leaving them
    // out is an unanswered question rather than a default. Harmless on a vendor
    // body, where the same fields are optional.
    plugs5a: 0,
    plugs15a: 0,
    gasStoves: 0,
    tablesNeeded: 0,
    chairsNeeded: 0,
    passes2w: 0,
    passes4w: 0,
    passesStaff: 0,
    ...overrides,
  };
}

export { LogMailer, prisma };

/** A registered, logged-in requester, with the cookie jar `app.inject` wants.
 *
 *  The stall request form sits behind a session now, so every test that submits
 *  needs one of these.
 *
 *  ⚠️ It registers and logs in through the real routes rather than writing the
 *  rows itself, because the part its callers depend on is that a real session
 *  cookie comes back from the login route. */
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
  const login = await app.inject({
    method: 'POST',
    url: '/api/m/stalls/public/login',
    payload: { contact, password },
  });
  const value = login.cookies.find((c) => c.name === 'msr_stall_requester')?.value;
  if (!value) throw new Error(`seedRequester could not log in: ${login.statusCode} ${login.body}`);

  const cred = await prisma.stallCredential.findUniqueOrThrow({ where: { loginValue: contact } });
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
