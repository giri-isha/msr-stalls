import type { FastifyInstance } from 'fastify';
import type { ListUsersResponse } from '@msr/stalls';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { authenticate, createCredential } from '../src/modules/stalls/credentials';
import { InvalidCredentialsError } from '../src/modules/stalls/errors';
import { LogMailer, prisma, resetDatabase, seedEdition, seedStaff } from './helpers/db';
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
    credential?: 'confirmed' | 'unconfirmed' | 'locked';
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
    if (opts.credential === 'confirmed') {
      await prisma.stallCredential.update({
        where: { id: cred.id },
        data: { confirmedAt: new Date() },
      });
    }
    if (opts.credential === 'locked') {
      await prisma.stallCredential.update({
        where: { id: cred.id },
        data: {
          confirmedAt: new Date(),
          failedCount: 10,
          lockedUntil: new Date(Date.now() + 15 * 60_000),
        },
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
  test('staff and requesters arrive in one list, each tagged with its kind', async () => {
    const admin = await seedStaff(['stalls_admin'], 'vikram.s@ishafoundation.org');
    await requester();

    const { body } = await list(admin.headers);

    expect(body.users.map((u) => [u.kind, u.email]).sort()).toEqual([
      ['REQUESTER', 'priya@greenleaf.example'],
      ['STAFF', 'vikram.s@ishafoundation.org'],
    ]);
  });

  test('a staff row carries its roles and no request count; a requester the reverse', async () => {
    const admin = await seedStaff(['stalls_admin'], 'vikram.s@ishafoundation.org');
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
    const staffRow = body.users.find((u) => u.kind === 'STAFF');
    const reqRow = body.users.find((u) => u.kind === 'REQUESTER');

    expect(staffRow).toMatchObject({ roleKeys: ['stalls_admin'], requestCount: null, phone: null });
    expect(reqRow).toMatchObject({ roleKeys: [], requestCount: 1, phone: '9840012345' });
  });

  test('a request in another edition is not counted against this one', async () => {
    const admin = await seedStaff(['stalls_admin']);
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

describe('sign-in state', () => {
  test('a requester who never registered is LINK_ONLY, not a fault', async () => {
    const admin = await seedStaff(['stalls_admin']);
    await requester();

    const { body } = await list(admin.headers);

    expect(body.users.find((u) => u.kind === 'REQUESTER')?.signInState).toBe('LINK_ONLY');
    // ⚠️ The whole reason the state exists: most vendors never register, and
    // counting them as stuck would make that tile read as an outage.
    expect(count(body, 'Cannot sign in')).toBe(0);
  });

  test('registered-but-never-confirmed is UNCONFIRMED, and counts as cannot sign in', async () => {
    const admin = await seedStaff(['stalls_admin']);
    await requester({ credential: 'unconfirmed' });

    const { body } = await list(admin.headers);

    expect(body.users.find((u) => u.kind === 'REQUESTER')?.signInState).toBe('UNCONFIRMED');
    expect(count(body, 'Cannot sign in')).toBe(1);
  });

  test('a locked credential reads LOCKED with the time it frees up', async () => {
    const admin = await seedStaff(['stalls_admin']);
    await requester({ credential: 'locked' });

    const { body } = await list(admin.headers);
    const row = body.users.find((u) => u.kind === 'REQUESTER');

    expect(row?.signInState).toBe('LOCKED');
    expect(row?.lockedUntil).toBeTruthy();
    expect(count(body, 'Locked out')).toBe(1);
    // Locked wins over confirmed: it is the one a desk can act on.
    expect(count(body, 'Cannot sign in')).toBe(0);
  });

  test('a staff member the Foundation has disabled cannot sign in', async () => {
    const admin = await seedStaff(['stalls_admin']);
    const other = await seedStaff(['stalls_volunteer'], 'kavya.n@ishafoundation.org');
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
    const admin = await seedStaff(['stalls_admin']);
    await requester();

    const { body } = await list(admin.headers, '?view=Staff');

    expect(body.users).toHaveLength(1);
    expect(body.users[0].kind).toBe('STAFF');
    // ⚠️ The Requesters tile still reads 1 while Staff is the active view — a
    // tile row that zeroed the view you might move to would be useless.
    expect(count(body, 'Requesters')).toBe(1);
    expect(count(body, 'All')).toBe(2);
  });

  test('search narrows both the rows and the counts, across both populations', async () => {
    const admin = await seedStaff(['stalls_admin'], 'vikram.s@ishafoundation.org');
    await requester({ name: 'Priya Venkat' });

    const { body } = await list(admin.headers, '?q=priya');

    expect(body.users).toHaveLength(1);
    expect(count(body, 'All')).toBe(1);
    expect(count(body, 'Staff')).toBe(0);
  });

  test('a phone number finds the requester who carries it', async () => {
    const admin = await seedStaff(['stalls_admin']);
    await requester({ phone: '9840012345' });

    const { body } = await list(admin.headers, '?q=98400');
    expect(body.users.map((u) => u.kind)).toEqual(['REQUESTER']);
  });

  test('a role filter narrows to the staff holding it', async () => {
    const admin = await seedStaff(['stalls_admin']);
    await seedStaff(['stalls_lead'], 'deepa.r@ishafoundation.org');
    await requester();

    const { body } = await list(admin.headers, '?roleKey=stalls_lead');

    expect(body.users.map((u) => u.email)).toEqual(['deepa.r@ishafoundation.org']);
  });

  test('pages, sorted by name, with the total counting the whole view', async () => {
    const admin = await seedStaff(['stalls_admin'], 'zz@ishafoundation.org');
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
    const lead = await seedStaff(['stalls_lead']);
    expect((await list(lead.headers)).status).toBe(200);
  });

  test('a role without config:read does not', async () => {
    const volunteer = await seedStaff(['stalls_volunteer']);
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
    const admin = await seedStaff(['stalls_admin']);
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
    const admin = await seedStaff(['stalls_admin']);
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
    const admin = await seedStaff(['stalls_admin']);
    const account = await requester({ credential: 'locked' });

    expect((await post(`${account.id}/unlock`, admin.headers)).statusCode).toBe(204);

    const again = await post(`${account.id}/unlock`, admin.headers);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/not locked/);
  });

  test('an unlock that did nothing writes nothing to the activity trail', async () => {
    const admin = await seedStaff(['stalls_admin']);
    const account = await requester({ credential: 'confirmed' });

    await post(`${account.id}/unlock`, admin.headers);

    const trail = await prisma.activityTrail.count({
      where: { subjectRef: account.id, action: 'stall_account.unlocked' },
    });
    expect(trail).toBe(0);
  });

  test('resend-confirmation mails a fresh link to the registered address', async () => {
    const admin = await seedStaff(['stalls_admin']);
    const account = await requester({ credential: 'unconfirmed' });

    expect((await post(`${account.id}/resend-confirmation`, admin.headers)).statusCode).toBe(204);

    const sent = mail.sent.at(-1);
    expect(sent?.to).toBe('priya@greenleaf.example');
    expect(sent?.subject).toMatch(/confirm/i);
    const links = await prisma.stallAccessLink.count({
      where: { accountId: account.id, purpose: 'REGISTER_CONFIRM' },
    });
    expect(links).toBe(1);
  });

  test('an account registered on a number is confirmed over WhatsApp, not to its placeholder address', async () => {
    const admin = await seedStaff(['stalls_admin']);
    const account = await requester({
      email: 'mobile+9840012345@stalls.invalid',
      credential: 'unconfirmed',
      mobileLogin: true,
    });

    await post(`${account.id}/resend-confirmation`, admin.headers);

    expect(whatsapp.sent.at(-1)?.to).toBe('9840012345');
    expect(mail.sent.some((m) => m.to.endsWith('@stalls.invalid'))).toBe(false);
  });

  test('resending to somebody already confirmed is a 409', async () => {
    const admin = await seedStaff(['stalls_admin']);
    const account = await requester({ credential: 'confirmed' });

    const res = await post(`${account.id}/resend-confirmation`, admin.headers);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already confirmed/);
  });

  test('resending to somebody who never registered points at the access link instead', async () => {
    const admin = await seedStaff(['stalls_admin']);
    const account = await requester();

    const res = await post(`${account.id}/resend-confirmation`, admin.headers);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/access link/);
  });

  test('access-link mints a STATUS link and mails it to the account', async () => {
    const admin = await seedStaff(['stalls_admin']);
    const account = await requester();

    expect((await post(`${account.id}/access-link`, admin.headers)).statusCode).toBe(204);

    expect(mail.sent.at(-1)?.to).toBe('priya@greenleaf.example');
    const link = await prisma.stallAccessLink.findFirstOrThrow({
      where: { accountId: account.id },
    });
    expect(link.purpose).toBe('STATUS');
  });

  /** ⚠️ The rule the whole access-link design rests on: staff can cause a
   *  vendor to receive their link; they can never read it. */
  test('no support action returns the link to the caller', async () => {
    const admin = await seedStaff(['stalls_admin']);
    const account = await requester();

    const res = await post(`${account.id}/access-link`, admin.headers);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  test('every support action is written to the activity trail with its actor', async () => {
    const admin = await seedStaff(['stalls_admin']);
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
    const admin = await seedStaff(['stalls_admin']);
    const res = await post('11111111-1111-4111-8111-111111111111/unlock', admin.headers);
    expect(res.statusCode).toBe(404);
  });

  test('config:read alone cannot run a support action', async () => {
    const lead = await seedStaff(['stalls_lead']);
    const account = await requester();

    expect((await post(`${account.id}/access-link`, lead.headers)).statusCode).toBe(403);
    expect(mail.sent).toHaveLength(0);
  });
});
