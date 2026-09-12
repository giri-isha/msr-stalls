import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@msr/stalls';
import { buildApp } from '../src/app';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  LogMailer,
  type Staff,
  prisma,
  resetDatabase,
  seedEdition,
  seedStaff,
  vendorBody,
} from './helpers/db';

let app: FastifyInstance;
let admin: Staff;
let lead: Staff;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
  admin = await seedStaff(['stalls_admin'], 'admin@example.org');
  lead = await seedStaff(['stalls_lead'], 'lead@example.org');
});

const charges = {
  chairRatePaise: 5000,
  tableRatePaise: 15000,
  lwChairRatePaise: 10000,
  lwTableRatePaise: 30000,
  vendorDepositPaise: 400000,
  localWelfareDepositPaise: 400000,
  plug5aRatePaise: 50000,
  plug15aRatePaise: 100000,
  gstPercent: 18,
  crowdPerStall: 1200,
};

describe('authorisation', () => {
  test('a lead may read config but every write is a 403', async () => {
    const read = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config',
      headers: lead.headers,
    });
    expect(read.statusCode).toBe(200);
    const writes = await Promise.all([
      app.inject({
        method: 'PUT',
        url: '/api/m/stalls/config/charges',
        headers: lead.headers,
        payload: charges,
      }),
      app.inject({
        method: 'PUT',
        url: '/api/m/stalls/config/flow',
        headers: lead.headers,
        payload: { bankStepEnabled: false, paymentStepEnabled: true, fssaiStepEnabled: true },
      }),
      app.inject({
        method: 'POST',
        url: '/api/m/stalls/staff',
        headers: lead.headers,
        payload: { personRef: lead.personId, roleKey: 'stalls_admin' },
      }),
    ]);
    for (const w of writes) expect(w.statusCode).toBe(403);
  });
});

describe('charges and flow', () => {
  test('an admin updates charges and the change is visible in config', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/config/charges',
      headers: admin.headers,
      payload: charges,
    });
    expect(put.statusCode).toBe(200);
    const cfg = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config',
      headers: admin.headers,
    });
    expect(cfg.json().charges.crowdPerStall).toBe(1200);
  });

  test('a float amount is refused — money is integer paise', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/config/charges',
      headers: admin.headers,
      payload: { ...charges, chairRatePaise: 50.5 },
    });
    expect(put.statusCode).toBe(400);
  });

  test('flow toggles round-trip', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/config/flow',
      headers: admin.headers,
      payload: { bankStepEnabled: false, paymentStepEnabled: true, fssaiStepEnabled: false },
    });
    const cfg = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config',
      headers: admin.headers,
    });
    expect(cfg.json().flow).toMatchObject({ bankStepEnabled: false, fssaiStepEnabled: false });
  });
});

describe('rate card', () => {
  test('replaces amounts by zone group and food type', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/config/rate-card',
      headers: admin.headers,
      payload: { entries: [{ zoneGroup: 'C', isFood: true, amountPaise: 1_600_000 }] },
    });
    expect(put.statusCode).toBe(200);
    const pub = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    const c1 = pub.json().zones.find((z: { code: string }) => z.code === 'C1');
    expect(c1.rentFoodPaise).toBe(1_600_000);
    expect(c1.rentNonFoodPaise).toBe(1_200_000); // untouched
  });
});

describe('custom fields', () => {
  const create = () =>
    app.inject({
      method: 'POST',
      url: '/api/m/stalls/config/custom-fields',
      headers: admin.headers,
      payload: { formType: 'VENDOR', label: 'Instagram handle', fieldType: 'text' },
    });

  test('create, then delete while unused', async () => {
    const c = await create();
    expect(c.statusCode).toBe(201);
    const d = await app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/config/custom-fields/${c.json().id}`,
      headers: admin.headers,
    });
    expect(d.statusCode).toBe(204);
  });

  test('once answered, delete is a 409 and deactivate is the way', async () => {
    const c = await create();
    const id = c.json().id;
    await submitRequest(
      prisma,
      SubmitRequestInput.parse(vendorBody({ customFields: { [id]: '@x' } })),
      {
        mail: new LogMailer(),
        statusUrl: (t) => t,
      },
    );
    const d = await app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/config/custom-fields/${id}`,
      headers: admin.headers,
    });
    expect(d.statusCode).toBe(409);
    const p = await app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/config/custom-fields/${id}`,
      headers: admin.headers,
      payload: { isActive: false },
    });
    expect(p.statusCode).toBe(200);
    const pub = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    expect(pub.json().customFields).toEqual([]);
  });
});

describe('staff roles', () => {
  test('lists who holds what', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/staff',
      headers: admin.headers,
    });
    const byEmail = new Map(
      res.json().map((s: { email: string; roleKeys: string[] }) => [s.email, s.roleKeys]),
    );
    expect(byEmail.get('admin@example.org')).toEqual(['stalls_admin']);
    expect(byEmail.get('lead@example.org')).toEqual(['stalls_lead']);
  });

  test('grants and revokes', async () => {
    const grant = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/staff',
      headers: admin.headers,
      payload: { personRef: lead.personId, roleKey: 'stalls_finance' },
    });
    expect(grant.statusCode).toBe(204);
    const revoke = await app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/staff/${lead.personId}/stalls_finance`,
      headers: admin.headers,
    });
    expect(revoke.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/api/m/stalls/me', headers: lead.headers });
    expect(me.json().roleKeys).toEqual(['stalls_lead']);
  });

  test('refuses to remove the last admin', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/staff/${admin.personId}/stalls_admin`,
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(409);
    const me = await app.inject({ method: 'GET', url: '/api/m/stalls/me', headers: admin.headers });
    expect(me.json().roleKeys).toContain('stalls_admin');
  });

  test('with two admins, one may step down', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/m/stalls/staff',
      headers: admin.headers,
      payload: { personRef: lead.personId, roleKey: 'stalls_admin' },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/staff/${admin.personId}/stalls_admin`,
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(204);
  });

  test('an unknown person cannot be granted a role', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/staff',
      headers: admin.headers,
      payload: { personRef: randomUUID(), roleKey: 'stalls_lead' },
    });
    expect(res.statusCode).toBe(404);
  });

  test('/me reports the union of actions the roles grant', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/m/stalls/me', headers: lead.headers });
    expect(me.json().actions).toContain('selection:write');
    expect(me.json().actions).not.toContain('config:write');
  });
});

describe('editions', () => {
  test('creating a new active edition deactivates the current one, and seeds it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/editions',
      headers: admin.headers,
      payload: { year: 2027, name: 'MSR 2027', activate: true },
    });
    expect(res.statusCode).toBe(201);
    const pub = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    expect(pub.json().edition.year).toBe(2027);
    expect(pub.json().zones).toHaveLength(7);
  });
});
