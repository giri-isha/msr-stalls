import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@msr/stalls';
import { buildApp } from '../src/app';
import { shortlist } from '../src/modules/stalls/selection';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  LogMailer,
  SYSTEM,
  type Staff,
  prisma,
  resetDatabase,
  seedEdition,
  seedStaff,
  vendorBody,
} from './helpers/db';

let app: FastifyInstance;
let lead: Staff;
let volunteer: Staff;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
  lead = await seedStaff(['stalls_lead']);
  volunteer = await seedStaff(['stalls_volunteer']);
});

const submit = (body: Record<string, unknown>) =>
  submitRequest(prisma, SubmitRequestInput.parse(vendorBody(body)), {
    mail: new LogMailer(),
    statusUrl: (t) => t,
  });

const list = (staff: Staff, qs = '') =>
  app.inject({ method: 'GET', url: `/api/m/stalls/requests${qs}`, headers: staff.headers });

describe('authentication and authorisation', () => {
  test('no session is a 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/m/stalls/requests' });
    expect(res.statusCode).toBe(401);
  });

  test('a signed-in person with no stalls role is a 403, not a 401', async () => {
    const nobody = await seedStaff([]);
    const res = await list(nobody);
    expect(res.statusCode).toBe(403);
  });

  test('a volunteer may read the list but may not flag', async () => {
    const r = await submit({});
    expect((await list(volunteer)).statusCode).toBe(200);
    const flag = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${r.requestId}/flag`,
      headers: volunteer.headers,
      payload: { reason: 'duplicate' },
    });
    expect(flag.statusCode).toBe(403);
  });

  test('a lead may flag and unflag', async () => {
    const r = await submit({});
    const flag = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${r.requestId}/flag`,
      headers: lead.headers,
      payload: { reason: 'duplicate' },
    });
    expect(flag.statusCode).toBe(204);
    const detail = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/requests/${r.requestId}`,
      headers: lead.headers,
    });
    expect(detail.json().flagged).toBe(true);
    expect(detail.json().flagReason).toBe('duplicate');
    const unflag = await app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/requests/${r.requestId}/flag`,
      headers: lead.headers,
    });
    expect(unflag.statusCode).toBe(204);
  });
});

describe('filters and search', () => {
  beforeEach(async () => {
    await submit({ stallName: 'Green Leaf', email: 'a@x.com' });
    await submit({ stallName: 'Coastal Spice', email: 'b@x.com', stallType: 'NON_FOOD' });
    await submit({
      stallName: 'Seva Health Camp',
      email: 'c@x.com',
      requestType: 'LOCAL_WELFARE',
      depositAcknowledged: true,
      preferredZoneCode: 'A3',
    });
  });

  test('filters by request type', async () => {
    const res = await list(lead, '?requestType=LOCAL_WELFARE');
    expect(res.json().items.map((i: { stallName: string }) => i.stallName)).toEqual([
      'Seva Health Camp',
    ]);
  });

  test('filters by status', async () => {
    const all = (await list(lead)).json().items;
    const target = all.find((i: { stallName: string }) => i.stallName === 'Coastal Spice');
    await shortlist(prisma, target.id, SYSTEM);
    const res = await list(lead, '?status=SHORTLISTED');
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].stallName).toBe('Coastal Spice');
  });

  test('filters by preferred zone', async () => {
    const res = await list(lead, '?zoneCode=A3');
    expect(res.json().items).toHaveLength(1);
  });

  test('search matches a reference exactly, case-insensitively', async () => {
    const all = (await list(lead)).json().items;
    const ref: string = all[0].reference;
    const res = await list(lead, `?q=${ref.toLowerCase()}`);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].reference).toBe(ref);
  });

  test('search matches a partial name, case-insensitively', async () => {
    const res = await list(lead, '?q=coastal');
    expect(res.json().items.map((i: { stallName: string }) => i.stallName)).toEqual([
      'Coastal Spice',
    ]);
  });

  test('search matches a phone number typed with spaces', async () => {
    const res = await list(lead, '?q=98400%2012345');
    expect(res.json().items.length).toBe(3);
  });

  test('an unknown filter value is a 400, not an empty list', async () => {
    const res = await list(lead, '?status=WHATEVER');
    expect(res.statusCode).toBe(400);
  });
});

describe('pagination', () => {
  test('walks five rows in pages of two without repeating or skipping', async () => {
    for (let i = 0; i < 5; i++) await submit({ stallName: `Stall ${i}`, email: `s${i}@x.com` });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = cursor ? `?limit=2&cursor=${encodeURIComponent(cursor)}` : '?limit=2';
      const page: { items: Array<{ id: string }>; nextCursor: string | null } = (
        await list(lead, qs)
      ).json();
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
  });
});

describe('detail', () => {
  test('carries every submitted field, appliances and the ashram block', async () => {
    const r = await submit({
      requestType: 'ASHRAM_FOOD',
      appliances: [{ name: 'Deep freezer', watts: 900 }],
      plugs15a: 2,
      ashram: {
        departmentHead: 'Ravi Shankar',
        departmentHeadContact: '9840012345',
        department: 'Annapurna',
        requestedBy: 'Meera Iyer',
        requesterContact: '9840023456',
        creditCardNeeded: true,
        usage: 'DEPT_SALES',
        wantsThembu: false,
        fssaiExpected: true,
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/requests/${r.requestId}`,
      headers: lead.headers,
    });
    const d = res.json();
    expect(d.plugs15a).toBe(2);
    expect(d.appliances).toEqual([{ name: 'Deep freezer', watts: 900 }]);
    expect(d.ashram.department).toBe('Annapurna');
    expect(d.ashram.fssaiExpected).toBe(true);
    expect(d.allocations).toEqual([]);
  });

  test('an unknown id is a 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/requests/${randomUUID()}`,
      headers: lead.headers,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('dashboard', () => {
  test('counts by type and status', async () => {
    await submit({ email: 'a@x.com' });
    await submit({ email: 'b@x.com', requestType: 'LOCAL_WELFARE', depositAcknowledged: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/dashboard',
      headers: lead.headers,
    });
    expect(res.json().total).toBe(2);
    expect(res.json().byType.VENDOR).toBe(1);
    expect(res.json().byStatus.SUBMITTED).toBe(2);
  });
});
