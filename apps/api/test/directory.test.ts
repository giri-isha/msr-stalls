import type { FastifyInstance } from 'fastify';
import type { ListUsersResponse } from '@stalls/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { authenticate, createCredential } from '../src/modules/stalls/credentials';
import { InvalidCredentialsError } from '../src/modules/stalls/errors';
import {
  LogMailer,
  prisma,
  resetDatabase,
  seedEdition,
  seedRequester,
  seedBackoffice,
} from './helpers/db';
import { recordingWhatsApp } from './helpers/onboarding';

let app: FastifyInstance;
const mail = new LogMailer();
const whatsapp = recordingWhatsApp();

beforeAll(async () => {
  app = await buildApp({ logger: false, mail, whatsapp, webOrigin: 'http://web.example' });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
  mail.sent.length = 0;
  whatsapp.sent.length = 0;
});

/** A requester account, optionally with a password credential in a given state. */
async function requester(
  opts: {
    email?: string;
    phone?: string;
    name?: string;
    credential?: 'registered' | 'locked';
    mobileLogin?: boolean;
  } = {},
) {
  const email = opts.email ?? 'priya@greenleaf.example';
  const phone = opts.phone ?? '9840012345';
  const account = await prisma.stallAccount.create({
    data: { email, phone, displayName: opts.name ?? 'Priya Venkat' },
  });
  if (opts.credential) {
    const contact = opts.mobileLogin
      ? ({ kind: 'MOBILE', value: phone } as const)
      : ({ kind: 'EMAIL', value: email } as const);
    const cred = await createCredential(prisma, {
      accountId: account.id,
      contact,
      password: 'hunter2hunter2',
    });
    if (opts.credential === 'locked') {
      await prisma.stallCredential.update({
        where: { id: cred.id },
        data: { failedCount: 10, lockedUntil: new Date(Date.now() + 15 * 60_000) },
      });
    }
  }
  return account;
}

async function list(
  headers: { cookie: string },
  query = '',
): Promise<{ status: number; body: ListUsersResponse }> {
  const res = await app.inject({ method: 'GET', url: `/api/m/stalls/users${query}`, headers });
  return { status: res.statusCode, body: res.json() as ListUsersResponse };
}

const count = (body: ListUsersResponse, label: string) =>
  body.counts.find((c) => c.label === label)?.count;

describe('the union', () => {
  test('backoffice and requesters arrive in one list, each tagged with its kind', async () => {
    const admin = await seedBackoffice(['stalls_admin'], 'vikram.s@ishafoundation.org');
    await requester();

    const { body } = await list(admin.headers);

    expect(body.users.map((u) => [u.kind, u.email]).sort()).toEqual([
      ['BACKOFFICE', 'vikram.s@ishafoundation.org'],
      ['REQUESTER', 'priya@greenleaf.example'],
    ]);
  });

  test('a backoffice row carries its roles and no request count; a requester the reverse', async () => {
    const admin = await seedBackoffice(['stalls_admin'], 'vikram.s@ishafoundation.org');
    const account = await requester();
    const edition = await prisma.stallEdition.findFirstOrThrow({ where: { isActive: true } });
    // Seeded directly: the public route sits behind a requester session, and
    // what this test is about is the COUNT, not how the row got there.
    await prisma.stallRequest.create({
      data: {
        editionId: edition.id,
        accountId: account.id,
        reference: 'VEN-2026-0001',
        requestType: 'VENDOR',
        stallType: 'FOOD',
        stallName: 'Green Leaf Organics',
        requesterName: 'Priya Venkat',
        contactNumber: '9840012345',
        email: 'priya@greenleaf.example',
        itemsSelling: 'Spices',
        numStallsRequested: 1,
        preferredZoneCode: 'C1',
        agreedAt: new Date(),
      },
    });

    const { body } = await list(admin.headers);
    const backofficeRow = body.users.find((u) => u.kind === 'BACKOFFICE');
    const reqRow = body.users.find((u) => u.kind === 'REQUESTER');

    expect(backofficeRow?.grants.map((g) => g.roleKey)).toEqual(['stalls_admin']);
    expect(backofficeRow).toMatchObject({ requestCount: null, phone: null });
    expect(reqRow).toMatchObject({ grants: [], requestCount: 1, phone: '9840012345' });
  });

  test('a request in another edition is not counted against this one', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();
    const other = await seedEdition(2025);
    await prisma.stallRequest.create({
      data: {
        editionId: other.id,
        accountId: account.id,
        reference: 'VEN-2025-0001',
        requestType: 'VENDOR',
        stallType: 'FOOD',
        stallName: 'Green Leaf Organics',
        requesterName: 'Priya Venkat',
        contactNumber: '9840012345',
        email: 'priya@greenleaf.example',
        itemsSelling: 'Spices',
        numStallsRequested: 1,
        preferredZoneCode: 'C1',
        agreedAt: new Date(),
      },
    });
    // `seedEdition(2025)` activated 2025; put 2026 back in front.
    const y2026 = await prisma.stallEdition.findFirstOrThrow({ where: { year: 2026 } });
    await prisma.stallEdition.updateMany({ data: { isActive: false } });
    await prisma.stallEdition.update({ where: { id: y2026.id }, data: { isActive: true } });

    const { body } = await list(admin.headers);
    expect(body.users.find((u) => u.kind === 'REQUESTER')?.requestCount).toBe(0);
  });
});

/**
 * What each grant REACHES, on the row.
 *
 * ⚠️ The dialog that edits somebody's roles has to send the whole grant back —
 * role, editions and bays — because a re-grant RESETS scope (see `grantRole`).
 * Without the scope on the row, an admin who opened that dialog to add one role
 * would silently widen every role the person already held to "every edition,
 * every bay". So the scope travels with the list, not on a second request.
 */
describe('what a grant reaches', () => {
  test('a backoffice row carries the editions and bays each of its roles is scoped to', async () => {
    const admin = await seedBackoffice(['stalls_admin'], 'vikram.s@ishafoundation.org');
    const marshal = await seedBackoffice([], 'marshal@example.org');
    const edition = await prisma.stallEdition.findFirstOrThrow({ where: { year: 2026 } });
    await prisma.stallBackofficeRole.create({
      data: {
        personRef: marshal.personId,
        roleKey: 'stalls_volunteer',
        grantedBy: admin.personId,
        editionScope: [edition.id],
        zoneScope: ['A1'],
      },
    });

    const { body } = await list(admin.headers);
    const row = body.users.find((u) => u.email === 'marshal@example.org');
    expect(row?.grants).toEqual([
      { roleKey: 'stalls_volunteer', editionScope: [edition.id], zoneScope: ['A1'] },
    ]);
  });

  // Empty is EVERY edition and EVERY bay, not none — the opposite of how a
  // filter reads, and the reason the dialog says so in words.
  test('an unscoped grant arrives with both lists empty', async () => {
    const admin = await seedBackoffice(['stalls_admin'], 'vikram.s@ishafoundation.org');

    const { body } = await list(admin.headers);
    const row = body.users.find((u) => u.email === 'vikram.s@ishafoundation.org');
    expect(row?.grants).toEqual([{ roleKey: 'stalls_admin', editionScope: [], zoneScope: [] }]);
  });

  test('a requester holds no grants at all', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await requester();

    const { body } = await list(admin.headers);
    expect(body.users.find((u) => u.kind === 'REQUESTER')?.grants).toEqual([]);
  });
});

describe('sign-in state', () => {
  test('a requester who never registered is LINK_ONLY, not a fault', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await requester();

    const { body } = await list(admin.headers);

    expect(body.users.find((u) => u.kind === 'REQUESTER')?.signInState).toBe('LINK_ONLY');
    // ⚠️ The whole reason the state exists: most vendors never register, and
    // counting them as stuck would make that tile read as an outage.
    expect(count(body, 'Cannot sign in')).toBe(0);
  });

  test('a registered requester reads OK, and counts as nothing to fix', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await requester({ credential: 'registered' });

    const { body } = await list(admin.headers);

    expect(body.users.find((u) => u.kind === 'REQUESTER')?.signInState).toBe('OK');
    expect(count(body, 'Cannot sign in')).toBe(0);
  });

  test('a locked credential reads LOCKED with the time it frees up', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await requester({ credential: 'locked' });

    const { body } = await list(admin.headers);
    const row = body.users.find((u) => u.kind === 'REQUESTER');

    expect(row?.signInState).toBe('LOCKED');
    expect(row?.lockedUntil).toBeTruthy();
    expect(count(body, 'Locked out')).toBe(1);
    // Locked wins over registered: it is the one a desk can act on.
    expect(count(body, 'Cannot sign in')).toBe(0);
  });

  test('a backoffice member the Foundation has disabled cannot sign in', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const other = await seedBackoffice(['stalls_volunteer'], 'kavya.n@ishafoundation.org');
    await prisma.person.update({
      where: { personId: other.personId },
      data: { signInDisabled: true },
    });

    const { body } = await list(admin.headers);

    expect(body.users.find((u) => u.email === 'kavya.n@ishafoundation.org')?.signInState).toBe(
      'DISABLED',
    );
    expect(count(body, 'Cannot sign in')).toBe(1);
  });
});

describe('views, search and paging', () => {
  test('the tile counts are NOT narrowed by the active view', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await requester();

    const { body } = await list(admin.headers, '?view=Backoffice');

    expect(body.users).toHaveLength(1);
    expect(body.users[0].kind).toBe('BACKOFFICE');
    // ⚠️ The Requesters tile still reads 1 while Backoffice is the active view — a
    // tile row that zeroed the view you might move to would be useless.
    expect(count(body, 'Requesters')).toBe(1);
    expect(count(body, 'All')).toBe(2);
  });

  test('search narrows both the rows and the counts, across both populations', async () => {
    const admin = await seedBackoffice(['stalls_admin'], 'vikram.s@ishafoundation.org');
    await requester({ name: 'Priya Venkat' });

    const { body } = await list(admin.headers, '?q=priya');

    expect(body.users).toHaveLength(1);
    expect(count(body, 'All')).toBe(1);
    expect(count(body, 'Backoffice')).toBe(0);
  });

  test('a phone number finds the requester who carries it', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await requester({ phone: '9840012345' });

    const { body } = await list(admin.headers, '?q=98400');
    expect(body.users.map((u) => u.kind)).toEqual(['REQUESTER']);
  });

  test('a role filter narrows to the backoffice members holding it', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await seedBackoffice(['stalls_lead'], 'deepa.r@ishafoundation.org');
    await requester();

    const { body } = await list(admin.headers, '?roleKey=stalls_lead');

    expect(body.users.map((u) => u.email)).toEqual(['deepa.r@ishafoundation.org']);
  });

  test('pages, sorted by name, with the total counting the whole view', async () => {
    const admin = await seedBackoffice(['stalls_admin'], 'zz@ishafoundation.org');
    await requester({ email: 'a@example.com', name: 'Aarti Kumar' });
    await requester({ email: 'b@example.com', name: 'Bharat Singh' });

    const first = await list(admin.headers, '?pageSize=2&page=0');
    expect(first.body.users.map((u) => u.displayName)).toEqual(['Aarti Kumar', 'Bharat Singh']);
    expect(first.body.total).toBe(3);

    const second = await list(admin.headers, '?pageSize=2&page=1');
    expect(second.body.users).toHaveLength(1);
    expect(second.body.total).toBe(3);
  });
});

describe('who may read it', () => {
  test('config:read reaches the directory', async () => {
    const lead = await seedBackoffice(['stalls_lead']);
    expect((await list(lead.headers)).status).toBe(200);
  });

  test('a role without config:read does not', async () => {
    const volunteer = await seedBackoffice(['stalls_volunteer']);
    expect((await list(volunteer.headers)).status).toBe(403);
  });

  test('a caller with no session at all is a 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/m/stalls/users' });
    expect(res.statusCode).toBe(401);
  });
});

describe('support actions', () => {
  const post = (path: string, headers: { cookie: string }) =>
    app.inject({ method: 'POST', url: `/api/m/stalls/users/${path}`, headers });

  test('unlock lets a locked credential authenticate again', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'locked' });

    // Proof it is genuinely locked, through the real authenticator.
    await expect(
      authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect((await post(`${account.id}/unlock`, admin.headers)).statusCode).toBe(204);

    const cred = await authenticate(prisma, {
      contact: 'priya@greenleaf.example',
      password: 'hunter2hunter2',
    });
    expect(cred.accountId).toBe(account.id);
  });

  test('unlocking an account with no login at all is a 409, not a silent success', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    const res = await post(`${account.id}/unlock`, admin.headers);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/never registered/);
  });

  /** 🔴 This is what a live run caught and the suite did not. `updateMany`
   *  reports rows MATCHED, so an unlock scoped to the account alone returned 1
   *  for a credential that was never locked, and a second press answered 204 —
   *  telling a desk it had freed somebody who was never stuck. */
  test('unlocking a login that is not locked is a 409, however many times it is pressed', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'locked' });

    expect((await post(`${account.id}/unlock`, admin.headers)).statusCode).toBe(204);

    const again = await post(`${account.id}/unlock`, admin.headers);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/not locked/);
  });

  test('an unlock that did nothing writes nothing to the activity trail', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'registered' });

    await post(`${account.id}/unlock`, admin.headers);

    const trail = await prisma.activityTrail.count({
      where: { subjectRef: account.id, action: 'stall_account.unlocked' },
    });
    expect(trail).toBe(0);
  });

  test('access-link mints a STATUS link and mails it to the account', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    expect((await post(`${account.id}/access-link`, admin.headers)).statusCode).toBe(204);

    expect(mail.sent.at(-1)?.to).toBe('priya@greenleaf.example');
    const link = await prisma.stallAccessLink.findFirstOrThrow({
      where: { accountId: account.id },
    });
    expect(link.purpose).toBe('STATUS');
  });

  /** ⚠️ The rule the whole access-link design rests on: backoffice can cause a
   *  vendor to receive their link; they can never read it. */
  test('no support action returns the link to the caller', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    const res = await post(`${account.id}/access-link`, admin.headers);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  test('every support action is written to the activity trail with its actor', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'locked' });

    await post(`${account.id}/unlock`, admin.headers);
    await post(`${account.id}/access-link`, admin.headers);

    const trail = await prisma.activityTrail.findMany({ where: { subjectRef: account.id } });
    expect(trail.map((t) => t.action).sort()).toEqual([
      'stall_account.access_link_sent',
      'stall_account.unlocked',
    ]);
    expect(trail.every((t) => t.actorRef === admin.personId)).toBe(true);
  });

  test('an unknown account is a 404', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const res = await post('11111111-1111-4111-8111-111111111111/unlock', admin.headers);
    expect(res.statusCode).toBe(404);
  });

  test('config:read alone cannot run a support action', async () => {
    const lead = await seedBackoffice(['stalls_lead']);
    const account = await requester();

    expect((await post(`${account.id}/access-link`, lead.headers)).statusCode).toBe(403);
    expect(mail.sent).toHaveLength(0);
  });
});

/**
 * 🔴 TEMPORARY, with the requester password login itself. When the host's Isha
 * SSO signs requesters in there is no password here for anybody to set, and
 * this block goes with the route — see `docs/migration-to-host.md` step 3b.
 */
describe("setting a requester's password", () => {
  const setPassword = (id: string, headers: { cookie: string }, password: string) =>
    app.inject({
      method: 'POST',
      url: `/api/m/stalls/users/${id}/password`,
      headers,
      payload: { password },
    });

  /** A role with exactly these privileges, and a person holding it.
   *
   *  ⚠️ It cleans up after itself. `resetDatabase` deliberately does NOT
   *  truncate the RBAC tables — they are reference data the migration installs
   *  — so a role a test authors would otherwise leak into every later file. */
  const authored: string[] = [];
  async function backofficeHolding(roleKey: string, privileges: string[]) {
    // Idempotent, because the cleanup below is the only thing that removes
    // these and a run that died before it left the row behind. Without this a
    // single failure makes every later run fail on the unique key instead.
    await prisma.stallBackofficeRole.deleteMany({ where: { roleKey } });
    await prisma.stallRolePrivilege.deleteMany({ where: { role: { roleKey } } });
    await prisma.stallRole.deleteMany({ where: { roleKey } });
    const role = await prisma.stallRole.create({
      data: { roleKey, name: roleKey, description: 'authored by a test', level: 1, sortOrder: 99 },
    });
    authored.push(roleKey);
    const rows = await prisma.stallPrivilege.findMany({ where: { code: { in: privileges } } });
    expect(rows).toHaveLength(privileges.length);
    await prisma.stallRolePrivilege.createMany({
      data: rows.map((p) => ({ roleId: role.id, privilegeId: p.id })),
    });
    return seedBackoffice([roleKey]);
  }

  afterEach(async () => {
    for (const roleKey of authored.splice(0)) {
      // The grants first: `role_key` is a foreign key, and this hook runs
      // before the next test's truncate rather than after it.
      await prisma.stallBackofficeRole.deleteMany({ where: { roleKey } });
      await prisma.stallRolePrivilege.deleteMany({ where: { role: { roleKey } } });
      await prisma.stallRole.delete({ where: { roleKey } });
    }
  });

  test('replaces the password on a login the requester already had', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'registered' });

    expect((await setPassword(account.id, admin.headers, 'monsoon-fig-84')).statusCode).toBe(204);

    const cred = await authenticate(prisma, {
      contact: 'priya@greenleaf.example',
      password: 'monsoon-fig-84',
    });
    expect(cred.accountId).toBe(account.id);
    await expect(
      authenticate(prisma, { contact: 'priya@greenleaf.example', password: 'hunter2hunter2' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  /** The whole reason the action exists: the vendor who never registered, and
   *  cannot. Unlock and Resend both refuse this account — this is what answers
   *  it. */
  test('creates a login for a requester who never registered one', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    expect((await setPassword(account.id, admin.headers, 'monsoon-fig-84')).statusCode).toBe(204);

    const cred = await authenticate(prisma, {
      contact: 'priya@greenleaf.example',
      password: 'monsoon-fig-84',
    });
    expect(cred.accountId).toBe(account.id);
  });

  /** An account registered on a number carries a placeholder address nothing
   *  delivers to. A login minted against THAT is a login nobody can use. */
  test('registers the login on the number when there is no real address', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ email: 'mobile+9840012345@stalls.invalid' });

    expect((await setPassword(account.id, admin.headers, 'monsoon-fig-84')).statusCode).toBe(204);

    const cred = await authenticate(prisma, {
      contact: '9840012345',
      password: 'monsoon-fig-84',
    });
    expect(cred.accountId).toBe(account.id);
  });

  test('a locked-out requester can sign in with the new password straight away', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'locked' });

    await setPassword(account.id, admin.headers, 'monsoon-fig-84');

    const cred = await authenticate(prisma, {
      contact: 'priya@greenleaf.example',
      password: 'monsoon-fig-84',
    });
    expect(cred.lockedUntil).toBeNull();
    expect(cred.failedCount).toBe(0);
  });

  /** Half the reason a desk is doing this is that somebody else may have had
   *  the account. Changing the password without closing their session would
   *  change the lock and leave the door open. */
  test('every session the account has open is ended', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const { accountId } = await seedRequester(app);

    await setPassword(accountId, admin.headers, 'monsoon-fig-84');

    const live = await prisma.stallAccessLink.count({
      where: { accountId, purpose: 'SESSION', revokedAt: null },
    });
    expect(live).toBe(0);
  });

  test('the trail records who set it, and never what it was', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'registered' });

    await setPassword(account.id, admin.headers, 'monsoon-fig-84');

    const row = await prisma.activityTrail.findFirstOrThrow({
      where: { subjectRef: account.id, action: 'stall_account.password_set' },
    });
    expect(row.actorRef).toBe(admin.personId);
    expect(JSON.stringify(row.detail)).not.toContain('monsoon-fig-84');
  });

  /** 🔴 The point of the privilege. A support desk that can send a vendor their
   *  own link must not thereby be able to walk into the vendor's account. */
  test('users:write alone cannot set a password', async () => {
    const desk = await backofficeHolding('test_support_desk', ['config.read', 'users.write']);
    const account = await requester({ credential: 'registered' });

    expect((await setPassword(account.id, desk.headers, 'monsoon-fig-84')).statusCode).toBe(403);
    // Proof it was the privilege and not the role: the same caller may still
    // send this account its access link.
    const link = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/users/${account.id}/access-link`,
      headers: desk.headers,
    });
    expect(link.statusCode).toBe(204);
  });

  test('passwords:write alone is enough, and grants nothing else', async () => {
    const desk = await backofficeHolding('test_password_desk', ['config.read', 'passwords.write']);
    const account = await requester({ credential: 'registered' });

    expect((await setPassword(account.id, desk.headers, 'monsoon-fig-84')).statusCode).toBe(204);

    const link = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/users/${account.id}/access-link`,
      headers: desk.headers,
    });
    expect(link.statusCode).toBe(403);
  });

  test('a password under the floor is refused before anything is written', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'registered' });

    expect((await setPassword(account.id, admin.headers, 'short')).statusCode).toBe(400);
    expect(await prisma.activityTrail.count({ where: { subjectRef: account.id } })).toBe(0);
  });

  /** The contact is another account's login — the desk has two rows in front of
   *  them and needs to be told which one is the login. */
  test('a contact another account already signs in with is a 409, not a 500', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const other = await requester({ credential: 'registered' });
    const account = await prisma.stallAccount.create({
      data: { email: 'priya.v@greenleaf.example', phone: '', displayName: 'Priya V' },
    });
    // The same address, moved onto the second account's credential-less row.
    await prisma.stallAccount.update({
      where: { id: other.id },
      data: { email: 'priya.old@greenleaf.example' },
    });
    await prisma.stallAccount.update({
      where: { id: account.id },
      data: { email: 'priya@greenleaf.example' },
    });

    const res = await setPassword(account.id, admin.headers, 'monsoon-fig-84');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already signs in/);
  });

  test('an unknown account is a 404', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const res = await setPassword(
      '11111111-1111-4111-8111-111111111111',
      admin.headers,
      'monsoon-fig-84',
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('editing a requester', () => {
  const patch = (id: string, headers: { cookie: string }, payload: Record<string, string>) =>
    app.inject({ method: 'PATCH', url: `/api/m/stalls/users/${id}`, headers, payload });

  const trailFor = (accountId: string) =>
    prisma.activityTrail.findMany({
      where: { subjectRef: accountId, action: 'stall_account.updated' },
    });

  test('a corrected name, email and number are stored', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    const res = await patch(account.id, admin.headers, {
      displayName: 'Priya Venkatesan',
      email: 'priya@greenleaf.co.in',
      phone: '9840099999',
    });
    expect(res.statusCode).toBe(204);

    const after = await prisma.stallAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after).toMatchObject({
      displayName: 'Priya Venkatesan',
      email: 'priya@greenleaf.co.in',
      phone: '9840099999',
    });
  });

  /** The same normalisation `findOrCreateAccount` applies, for the same
   *  reason: a typed `Priya@X ` must not become a second identity for one
   *  vendor that the next submission then fails to merge into. */
  test('a typed address is stored trimmed and lowercased', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    await patch(account.id, admin.headers, {
      displayName: 'Priya Venkat',
      email: '  Priya@GreenLeaf.CO.IN  ',
      phone: '9840012345',
    });

    const after = await prisma.stallAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.email).toBe('priya@greenleaf.co.in');
  });

  test('a number arrives normalised to its bare ten digits', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    await patch(account.id, admin.headers, {
      displayName: 'Priya Venkat',
      email: 'priya@greenleaf.example',
      phone: '+91 98400 99999',
    });

    const after = await prisma.stallAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.phone).toBe('9840099999');
  });

  test('an account registered on an email alone may keep no number at all', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ phone: '' });

    const res = await patch(account.id, admin.headers, {
      displayName: 'Priya Venkat',
      email: 'priya@greenleaf.example',
      phone: '',
    });
    expect(res.statusCode).toBe(204);
  });

  test('an address another account already holds is a 409 naming who holds it', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();
    await requester({ email: 'arun@spicebox.example', name: 'Arun Kumar' });

    const res = await patch(account.id, admin.headers, {
      displayName: 'Priya Venkat',
      email: 'arun@spicebox.example',
      phone: '9840012345',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Arun Kumar/);
    const after = await prisma.stallAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.email).toBe('priya@greenleaf.example');
  });

  test('an account may be saved under its own address unchanged', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    const res = await patch(account.id, admin.headers, {
      displayName: 'Priya Venkatesan',
      email: 'priya@greenleaf.example',
      phone: '9840012345',
    });
    expect(res.statusCode).toBe(204);
  });

  /** ⚠️ The decision the service documents: the account's address moves, the
   *  password login does not. A vendor whose address is corrected here still
   *  signs in with the one they registered under, and the Sign-in column keeps
   *  telling the truth about it. */
  test('moving the address leaves the password login where it was', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester({ credential: 'registered' });

    await patch(account.id, admin.headers, {
      displayName: 'Priya Venkat',
      email: 'priya@greenleaf.co.in',
      phone: '9840012345',
    });

    const after = await prisma.stallAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.email).toBe('priya@greenleaf.co.in');
    const cred = await authenticate(prisma, {
      contact: 'priya@greenleaf.example',
      password: 'hunter2hunter2',
    });
    expect(cred.accountId).toBe(account.id);
  });

  test('the trail records only what changed, with what it was before', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    await patch(account.id, admin.headers, {
      displayName: 'Priya Venkat',
      email: 'priya@greenleaf.co.in',
      phone: '9840012345',
    });

    const [entry] = await trailFor(account.id);
    expect(entry.actorRef).toBe(admin.personId);
    // `toMatchObject`, not `toEqual`: the forward to the host trail also carries
    // the subject's TYPE, because `subjectRef` alone does not say which table a
    // uuid came from. What this test is about is the change itself.
    expect(entry.detail).toMatchObject({
      email: { from: 'priya@greenleaf.example', to: 'priya@greenleaf.co.in' },
    });
  });

  test('a save that changed nothing writes nothing to the trail', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    const res = await patch(account.id, admin.headers, {
      displayName: 'Priya Venkat',
      email: 'priya@greenleaf.example',
      phone: '9840012345',
    });

    expect(res.statusCode).toBe(204);
    expect(await trailFor(account.id)).toHaveLength(0);
  });

  test('an address that is not one is refused', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    const res = await patch(account.id, admin.headers, {
      displayName: 'Priya Venkat',
      email: 'not-an-address',
      phone: '9840012345',
    });
    expect(res.statusCode).toBe(400);
  });

  test('a name cannot be emptied', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const account = await requester();

    const res = await patch(account.id, admin.headers, {
      displayName: '   ',
      email: 'priya@greenleaf.example',
      phone: '9840012345',
    });
    expect(res.statusCode).toBe(400);
  });

  test('an unknown account is a 404', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const res = await patch('11111111-1111-4111-8111-111111111111', admin.headers, {
      displayName: 'Nobody',
      email: 'nobody@example.com',
      phone: '',
    });
    expect(res.statusCode).toBe(404);
  });

  test('a role without users:write cannot edit a requester', async () => {
    const lead = await seedBackoffice(['stalls_lead']);
    const account = await requester();

    const res = await patch(account.id, lead.headers, {
      displayName: 'Priya Venkatesan',
      email: 'priya@greenleaf.example',
      phone: '9840012345',
    });

    expect(res.statusCode).toBe(403);
    const after = await prisma.stallAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.displayName).toBe('Priya Venkat');
  });
});

/**
 * Putting somebody into the Foundation directory from here.
 *
 * 🔴 The module reads that directory everywhere else and writes it only through
 * this route and the one below. What the suite is pinning down is the shape of
 * that concession: one transaction, a claimable row, and a duplicate address
 * refused rather than merged.
 */
describe('adding somebody to the directory', () => {
  const grant = (headers: { cookie: string }, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/m/stalls/backoffice', headers, payload });

  test('a staged person is created with the role, and marked as not yet arrived', async () => {
    const admin = await seedBackoffice(['stalls_admin']);

    const res = await grant(admin.headers, {
      newPerson: { displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org', phone: '' },
      roleKey: 'stalls_volunteer',
    });
    expect(res.statusCode).toBe(204);

    const person = await prisma.person.findUniqueOrThrow({
      where: { email: 'kavya.n@ishafoundation.org' },
    });
    expect(person).toMatchObject({ displayName: 'Kavya Nair', staged: true, phone: null });
    const grants = await prisma.stallBackofficeRole.findMany({
      where: { personRef: person.personId },
    });
    expect(grants.map((g) => g.roleKey)).toEqual(['stalls_volunteer']);
  });

  test('the address is stored normalised, and a number is kept when one is given', async () => {
    const admin = await seedBackoffice(['stalls_admin']);

    await grant(admin.headers, {
      newPerson: {
        displayName: 'Kavya Nair',
        email: '  Kavya.N@IshaFoundation.ORG ',
        phone: '+91 98400 11111',
      },
      roleKey: 'stalls_volunteer',
    });

    const person = await prisma.person.findUniqueOrThrow({
      where: { email: 'kavya.n@ishafoundation.org' },
    });
    expect(person.phone).toBe('9840011111');
  });

  /** Two rows on one address is a grant made to a human who may never receive
   *  it — one of them claimable, one of them not. The admin searched; they are
   *  being told to look again. */
  test('an address the directory already holds is a 409 naming who holds it', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await seedBackoffice([], 'kavya.n@ishafoundation.org');

    const res = await grant(admin.headers, {
      newPerson: { displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org', phone: '' },
      roleKey: 'stalls_volunteer',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('kavya.n');
    expect(await prisma.person.count({ where: { email: 'kavya.n@ishafoundation.org' } })).toBe(1);
  });

  /** The whole reason the two writes are one request. A refused grant must not
   *  leave a human in the Foundation's directory with nothing to do there. */
  test('a role the caller may not hand out stages nobody', async () => {
    const lead = await seedBackoffice(['stalls_lead']);

    const res = await grant(lead.headers, {
      newPerson: { displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org', phone: '' },
      roleKey: 'stalls_admin',
    });

    expect(res.statusCode).toBe(403);
    expect(await prisma.person.findUnique({ where: { email: 'kavya.n@ishafoundation.org' } })).toBe(
      null,
    );
  });

  test('a body naming both arms, or neither, is refused before anything is written', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const someone = await seedBackoffice([], 'arun.k@ishafoundation.org');

    const both = await grant(admin.headers, {
      personRef: someone.personId,
      newPerson: { displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org', phone: '' },
      roleKey: 'stalls_volunteer',
    });
    expect(both.statusCode).toBe(400);

    const neither = await grant(admin.headers, { roleKey: 'stalls_volunteer' });
    expect(neither.statusCode).toBe(400);
    expect(await prisma.person.count({ where: { email: 'kavya.n@ishafoundation.org' } })).toBe(0);
  });

  test('the directory search marks a staged row rather than hiding it', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await grant(admin.headers, {
      newPerson: { displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org', phone: '' },
      roleKey: 'stalls_volunteer',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/backoffice/search?q=kavya',
      headers: admin.headers,
    });

    expect(res.json()).toMatchObject([{ displayName: 'Kavya Nair', staged: true }]);
  });

  /** `OK` would read as "Active" in the Sign-in column — a claim about somebody
   *  who has never been here. */
  test('a staged person reads as INVITED in the directory, and not as cannot-sign-in', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    await grant(admin.headers, {
      newPerson: { displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org', phone: '' },
      roleKey: 'stalls_volunteer',
    });

    const { body } = await list(admin.headers);
    const row = body.users.find((u) => u.displayName === 'Kavya Nair');
    expect(row?.signInState).toBe('INVITED');
    expect(count(body, 'Cannot sign in')).toBe(0);
  });

  test('a role without users:write cannot add anybody', async () => {
    const lead = await seedBackoffice(['stalls_lead']);

    const res = await grant(lead.headers, {
      newPerson: { displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org', phone: '' },
      roleKey: 'stalls_volunteer',
    });

    expect(res.statusCode).toBe(403);
    expect(await prisma.person.count({ where: { email: 'kavya.n@ishafoundation.org' } })).toBe(0);
  });
});

/** The other half of the same concession: having typed somebody's address into
 *  the directory, this module can correct it. */
describe("editing a backoffice member's details", () => {
  const patch = (personRef: string, headers: { cookie: string }, payload: Record<string, string>) =>
    app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/backoffice/${personRef}`,
      headers,
      payload,
    });

  test('a corrected name, address and number are stored and land in the trail', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const who = await seedBackoffice(['stalls_volunteer'], 'kavya.n@ishafoundation.org');

    const res = await patch(who.personId, admin.headers, {
      displayName: 'Kavya Nair',
      email: 'kavya.nair@ishafoundation.org',
      phone: '+91 98400 11111',
    });
    expect(res.statusCode).toBe(204);

    const after = await prisma.person.findUniqueOrThrow({ where: { personId: who.personId } });
    expect(after).toMatchObject({
      displayName: 'Kavya Nair',
      email: 'kavya.nair@ishafoundation.org',
      phone: '9840011111',
    });
    const trail = await prisma.activityTrail.findMany({
      where: { subjectRef: who.personId, action: 'person.updated' },
    });
    expect(trail).toHaveLength(1);
  });

  test('the phone may be cleared, and it shows on the directory row', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const who = await seedBackoffice(['stalls_volunteer'], 'kavya.n@ishafoundation.org');

    await patch(who.personId, admin.headers, {
      displayName: 'Kavya Nair',
      email: 'kavya.n@ishafoundation.org',
      phone: '9840011111',
    });
    const { body } = await list(admin.headers);
    expect(body.users.find((u) => u.id === who.personId)?.phone).toBe('9840011111');

    await patch(who.personId, admin.headers, {
      displayName: 'Kavya Nair',
      email: 'kavya.n@ishafoundation.org',
      phone: '',
    });
    const after = await prisma.person.findUniqueOrThrow({ where: { personId: who.personId } });
    expect(after.phone).toBe(null);
  });

  /** Moving a staged row's address moves its CLAIM KEY, so the refusal matters
   *  as much here as it does when the row is created. */
  test('an address another person already holds is a 409 naming them', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const who = await seedBackoffice(['stalls_volunteer'], 'kavya.n@ishafoundation.org');
    await seedBackoffice(['stalls_volunteer'], 'arun.k@ishafoundation.org');

    const res = await patch(who.personId, admin.headers, {
      displayName: 'Kavya Nair',
      email: 'arun.k@ishafoundation.org',
      phone: '',
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('arun.k');
    const after = await prisma.person.findUniqueOrThrow({ where: { personId: who.personId } });
    expect(after.email).toBe('kavya.n@ishafoundation.org');
  });

  /** The hierarchy check that guards a grant guards a rename too, and for the
   *  same reason: renaming somebody is editing an account above you. */
  test('somebody above the caller in the hierarchy cannot be renamed', async () => {
    const lead = await seedBackoffice(['stalls_lead']);
    const boss = await seedBackoffice(['stalls_admin'], 'vikram.s@ishafoundation.org');

    const res = await patch(boss.personId, lead.headers, {
      displayName: 'Not Vikram',
      email: 'vikram.s@ishafoundation.org',
      phone: '',
    });

    expect(res.statusCode).toBe(403);
    const after = await prisma.person.findUniqueOrThrow({ where: { personId: boss.personId } });
    expect(after.displayName).not.toBe('Not Vikram');
  });

  test('a role without users:write cannot edit anybody', async () => {
    const lead = await seedBackoffice(['stalls_lead']);
    const who = await seedBackoffice([], 'kavya.n@ishafoundation.org');

    const res = await patch(who.personId, lead.headers, {
      displayName: 'Renamed',
      email: 'kavya.n@ishafoundation.org',
      phone: '',
    });
    expect(res.statusCode).toBe(403);
  });

  test('an unchanged save writes nothing and records nothing', async () => {
    const admin = await seedBackoffice(['stalls_admin']);
    const who = await seedBackoffice(['stalls_volunteer'], 'kavya.n@ishafoundation.org');

    const res = await patch(who.personId, admin.headers, {
      displayName: who.email.split('@')[0],
      email: 'kavya.n@ishafoundation.org',
      phone: '',
    });
    expect(res.statusCode).toBe(204);
    expect(
      await prisma.activityTrail.count({
        where: { subjectRef: who.personId, action: 'person.updated' },
      }),
    ).toBe(0);
  });

  test('an unknown person is a 404', async () => {
    const admin = await seedBackoffice(['stalls_admin']);

    const res = await patch('00000000-0000-4000-8000-000000000000', admin.headers, {
      displayName: 'Nobody',
      email: 'nobody@ishafoundation.org',
      phone: '',
    });
    expect(res.statusCode).toBe(404);
  });
});
