import { randomUUID } from 'node:crypto';
import type { StallEdition } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { type RateCardEntry, SubmitRequestInput } from '@msr/stalls';
import { buildApp } from '../src/app';
import { rateCardFor } from '../src/modules/stalls/config';
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
let edition: StallEdition;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  admin = await seedStaff(['stalls_admin'], 'admin@example.org');
  lead = await seedStaff(['stalls_lead'], 'lead@example.org');
});

const charges = {
  chairRatePaise: 5000,
  tableRatePaise: 15000,
  lwChairRatePaise: 10000,
  lwTableRatePaise: 30000,
  plug5aRatePaise: 50000,
  plug15aRatePaise: 100000,
  gstPercent: 18,
  crowdPerStall: 1200,
  vendorChairRatePaise: 10000,
  vendorTableRatePaise: 40000,
  chairTableDepositPaise: 400000,
  equipmentDays: 2,
  chairReplacementPaise: 50000,
  tableReplacementPaise: 150000,
  damagePenaltyPaise: 25000,
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
  /** The whole card is sent on every save: a row left out is a bay this scope
   *  no longer prices, and the public form then says "not available this year"
   *  rather than quoting a stale figure. So a test that changes one bay has to
   *  send the rest back unchanged, exactly as the Admin screen does. */
  const putCard = (entries: RateCardEntry[]) =>
    app.inject({
      method: 'PUT',
      url: '/api/m/stalls/config/rate-card',
      headers: admin.headers,
      payload: { entries },
    });

  test('replaces the amount for one bay and leaves its neighbours alone', async () => {
    const card = await rateCardFor(prisma, edition.id);
    const entries = card.map((e) =>
      e.zoneCode === 'C1' && e.isFood && e.scope === 'VENDOR'
        ? { ...e, amountPaise: 1_600_000 }
        : e,
    );
    expect((await putCard(entries)).statusCode).toBe(200);

    const pub = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    const zones = pub.json().zones;
    expect(zones.find((z: { code: string }) => z.code === 'C1').rentFoodPaise).toBe(1_600_000);
    expect(zones.find((z: { code: string }) => z.code === 'C1').rentNonFoodPaise).toBe(1_200_000);
    // C2 shares the printed band with C1 and must NOT move with it — pricing
    // two bays apart is the reason the card is per bay rather than per band.
    expect(zones.find((z: { code: string }) => z.code === 'C2').rentFoodPaise).toBe(1_500_000);
  });

  test('the advance rides on the row, so it is set per bay too', async () => {
    const card = await rateCardFor(prisma, edition.id);
    const entries = card.map((e) =>
      e.zoneCode === 'C1' ? { ...e, depositPaise: 200_000 } : e,
    );
    expect((await putCard(entries)).statusCode).toBe(200);

    const pub = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    const zones = pub.json().zones;
    expect(zones.find((z: { code: string }) => z.code === 'C1').depositPaise).toBe(200_000);
    expect(zones.find((z: { code: string }) => z.code === 'C2').depositPaise).toBe(400_000);
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
