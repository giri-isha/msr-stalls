import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { SubmitRequestInput } from '@msr/stalls';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  type Backoffice,
  LogMailer,
  accountFor,
  prisma,
  resetDatabase,
  seedEdition,
  seedBackoffice,
  vendorBody,
} from './helpers/db';

/**
 * Grant-level scope: which EDITION and which BAY a grant reaches.
 *
 * ⚠️ These two sit on the grant, not the role, because two people can hold the
 * same role for different years or different bays. The requester-type axis is
 * different — it belongs to the role, it is what the role is FOR — and lives in
 * `scope.test.ts`.
 */
let app: FastifyInstance;
let admin: Backoffice;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer(), webOrigin: 'http://web.example' });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
  admin = await seedBackoffice(['stalls_admin'], 'admin@example.org');
});

/** A backoffice member holding one role, scoped as given. */
async function scopedBackoffice(
  roleKey: string,
  scope: { editionScope?: string[]; zoneScope?: string[] },
  email: string,
): Promise<Backoffice> {
  const who = await seedBackoffice([], email);
  await prisma.stallBackofficeRole.create({
    data: {
      personRef: who.personId,
      roleKey,
      grantedBy: admin.personId,
      editionScope: scope.editionScope ?? [],
      zoneScope: scope.zoneScope ?? [],
    },
  });
  return who;
}

const activeEdition = () => prisma.stallEdition.findFirstOrThrow({ where: { isActive: true } });

const listRequests = (who: Backoffice) =>
  app.inject({ method: 'GET', url: '/api/m/stalls/requests', headers: who.headers });

describe('edition scope', () => {
  test('an unscoped grant reaches the edition that is running', async () => {
    const who = await scopedBackoffice('stalls_lead', {}, 'open@example.org');
    expect((await listRequests(who)).statusCode).toBe(200);
  });

  test('a grant naming this edition reaches it', async () => {
    const edition = await activeEdition();
    const who = await scopedBackoffice(
      'stalls_lead',
      { editionScope: [edition.id] },
      'thisyear@example.org',
    );
    expect((await listRequests(who)).statusCode).toBe(200);
  });

  // 🔴 A refusal, not an empty list. A volunteer whose grant covered only last
  // year needs to be told their access has lapsed, not shown an event with
  // nothing in it and left to guess why.
  test('a grant naming only another edition is refused, and says so', async () => {
    const other = await prisma.stallEdition.create({
      data: { year: 2099, name: 'MSR 2099', isActive: false },
    });
    const who = await scopedBackoffice(
      'stalls_lead',
      { editionScope: [other.id] },
      'lastyear@example.org',
    );
    const res = await listRequests(who);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('edition');
  });

  // The whole reason empty means "all": a person given the event must not lose
  // next year the moment somebody creates it, with nothing watching.
  test('an unscoped grant follows the module into an edition created later', async () => {
    const who = await scopedBackoffice('stalls_lead', {}, 'always@example.org');
    const next = await prisma.stallEdition.create({
      data: { year: 2098, name: 'MSR 2098', isActive: false },
    });
    await prisma.stallEdition.updateMany({ data: { isActive: false } });
    await prisma.stallEdition.update({ where: { id: next.id }, data: { isActive: true } });
    expect((await listRequests(who)).statusCode).toBe(200);
  });
});

describe('zone scope', () => {
  /** A submitted request sitting in one bay. */
  async function requestIn(zoneCode: string, stallName: string) {
    const body = vendorBody({
      stallName,
      preferredZoneCode: zoneCode,
      email: `${stallName.toLowerCase().replace(/\W/g, '')}@example.org`,
    });
    return submitRequest(
      prisma,
      SubmitRequestInput.parse(body),
      { mail: new LogMailer(), statusUrl: (t) => t },
      await accountFor(body),
    );
  }

  test('a bay-scoped grant lists only its own bays', async () => {
    await requestIn('A1', 'Bay One Traders');
    await requestIn('B2', 'Bay Two Traders');
    const marshal = await scopedBackoffice('stalls_lead', { zoneScope: ['A1'] }, 'a1@example.org');

    const res = await listRequests(marshal);
    const names = res.json().items.map((r: { stallName: string }) => r.stallName);
    expect(names).toContain('Bay One Traders');
    expect(names).not.toContain('Bay Two Traders');
  });

  test('an unscoped grant lists every bay', async () => {
    await requestIn('A1', 'Bay One Traders');
    await requestIn('B2', 'Bay Two Traders');
    const lead = await scopedBackoffice('stalls_lead', {}, 'all@example.org');

    const names = (await listRequests(lead))
      .json()
      .items.map((r: { stallName: string }) => r.stallName);
    expect(names).toContain('Bay One Traders');
    expect(names).toContain('Bay Two Traders');
  });

  // Addressing a request by id has to refuse what the list hid, or the filter
  // is decoration.
  test('a request in another bay is refused by id, not merely hidden', async () => {
    const elsewhere = await requestIn('B2', 'Bay Two Traders');
    const marshal = await scopedBackoffice('stalls_lead', { zoneScope: ['A1'] }, 'a1@example.org');

    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/requests/${elsewhere.requestId}`,
      headers: marshal.headers,
    });
    expect(res.statusCode).toBe(403);
  });

  // A request nobody has placed yet would otherwise fall outside every
  // bay-scoped person's reach, so the marshal about to receive it could not see
  // it coming.
  test('an unplaced request counts as being in the bay it asked for', async () => {
    const request = await requestIn('A1', 'Bay One Traders');
    const row = await prisma.stallRequest.findUniqueOrThrow({ where: { id: request.requestId } });
    expect(row.agreedZoneCode).toBeNull();

    const marshal = await scopedBackoffice('stalls_lead', { zoneScope: ['A1'] }, 'a1@example.org');
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/requests/${request.requestId}`,
      headers: marshal.headers,
    });
    expect(res.statusCode).toBe(200);
  });

  // Narrowing by type is not permission to leave your own bays.
  test('filtering by requester type does not widen the bays', async () => {
    await requestIn('B2', 'Bay Two Traders');
    const marshal = await scopedBackoffice('stalls_lead', { zoneScope: ['A1'] }, 'a1@example.org');

    const res = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/requests?requestType=VENDOR',
      headers: marshal.headers,
    });
    expect(res.json().items).toEqual([]);
  });
});

describe('granting scope', () => {
  const grant = (by: Backoffice, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/m/stalls/backoffice', headers: by.headers, payload });

  test('an admin grants a bay-scoped role', async () => {
    const who = await seedBackoffice([], 'new@example.org');
    const res = await grant(admin, {
      personRef: who.personId,
      roleKey: 'stalls_volunteer',
      zoneScope: ['A1'],
    });
    expect(res.statusCode).toBe(204);

    const row = await prisma.stallBackofficeRole.findFirstOrThrow({
      where: { personRef: who.personId },
    });
    expect(row.zoneScope).toEqual(['A1']);
  });

  // Re-granting sends the whole picture, so a narrowed grant that silently kept
  // last year's wider reach would be the one failure nobody would look for.
  test('re-granting resets the scope rather than leaving the old one', async () => {
    const who = await seedBackoffice([], 'new@example.org');
    await grant(admin, { personRef: who.personId, roleKey: 'stalls_volunteer', zoneScope: ['A1'] });
    await grant(admin, { personRef: who.personId, roleKey: 'stalls_volunteer', zoneScope: ['B2'] });

    const row = await prisma.stallBackofficeRole.findFirstOrThrow({
      where: { personRef: who.personId },
    });
    expect(row.zoneScope).toEqual(['B2']);
  });

  // Empty means "every bay", so an unscoped grant made by a bay-scoped marshal
  // would reach past the person making it.
  test('a scoped grantor cannot hand out a wider grant than their own', async () => {
    const marshal = await scopedBackoffice(
      'stalls_admin',
      { zoneScope: ['A1'] },
      'a1admin@example.org',
    );
    const who = await seedBackoffice([], 'new@example.org');

    expect(
      (await grant(marshal, { personRef: who.personId, roleKey: 'stalls_volunteer' })).statusCode,
    ).toBe(403);
    expect(
      (
        await grant(marshal, {
          personRef: who.personId,
          roleKey: 'stalls_volunteer',
          zoneScope: ['B2'],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await grant(marshal, {
          personRef: who.personId,
          roleKey: 'stalls_volunteer',
          zoneScope: ['A1'],
        })
      ).statusCode,
    ).toBe(204);
  });
});
