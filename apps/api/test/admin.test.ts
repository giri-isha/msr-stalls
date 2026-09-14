import { randomUUID } from 'node:crypto';
import type { StallEdition } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { type RateCardEntry, SubmitRequestInput } from '@msr/stalls';
import { buildApp } from '../src/app';
import { planCategoriesFor, rateCardFor } from '../src/modules/stalls/config';
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
import { makeStalls } from './helpers/plan';

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
    const entries = card.map((e) => (e.zoneCode === 'C1' ? { ...e, depositPaise: 200_000 } : e));
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

// ════════════════════════════════════════════════════════════════════════════
// The write paths that had no door
//
// The services, their guards and their contracts all existed; nothing routed
// to them, so a bay could be added only by a migration and the whole signature
// flow was unreachable over HTTP.
// ════════════════════════════════════════════════════════════════════════════

describe('bays are added and removed from the screen', () => {
  test('an admin adds a bay for a redrawn venue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/config/zones',
      headers: admin.headers,
      payload: { code: 'D1', name: 'D1 — new lawn', expectedCrowd: 8000 },
    });
    expect(res.statusCode).toBe(201);

    const cfg = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config',
      headers: admin.headers,
    });
    expect(cfg.json().zones.map((z: { code: string }) => z.code)).toContain('D1');
  });

  test('a duplicate bay code is refused rather than silently merged', async () => {
    const body = { code: 'D1', name: 'D1', expectedCrowd: 0 };
    await app.inject({
      method: 'POST',
      url: '/api/m/stalls/config/zones',
      headers: admin.headers,
      payload: body,
    });
    const again = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/config/zones',
      headers: admin.headers,
      payload: body,
    });
    expect(again.statusCode).toBe(409);
  });

  test('an empty bay is deleted', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/m/stalls/config/zones',
      headers: admin.headers,
      payload: { code: 'D1', name: 'D1', expectedCrowd: 0 },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/m/stalls/config/zones/D1',
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(204);
  });

  // ⚠️ 409, not 500. The screen has to be able to say "this bay has stalls
  // standing in it" rather than showing a vendor-facing error page.
  test('a bay with stalls in it refuses deletion with a 409 the screen explains', async () => {
    await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 2 });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/m/stalls/config/zones/C1',
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('C1');
  });

  test('a lead may not add or remove a bay', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/config/zones',
      headers: lead.headers,
      payload: { code: 'D2', name: 'D2', expectedCrowd: 0 },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/m/stalls/config/zones/C1',
      headers: lead.headers,
    });
    expect(post.statusCode).toBe(403);
    expect(del.statusCode).toBe(403);
  });
});

describe('the planning grid’s columns', () => {
  const put = (categories: Array<Record<string, unknown>>, who = admin) =>
    app.inject({
      method: 'PUT',
      url: '/api/m/stalls/config/plan-categories',
      headers: who.headers,
      payload: { categories },
    });

  test('an admin adds a column the 2025 sheet carried and the enum never had', async () => {
    const current = await planCategoriesFor(prisma, edition.id);
    const res = await put([
      ...current.map((c) => ({
        key: c.key,
        name: c.name,
        isFood: c.isFood,
        sortOrder: c.sortOrder,
      })),
      { key: 'VIP_LOUNGE', name: 'VIP lounge', isFood: false, sortOrder: 90 },
    ]);
    expect(res.statusCode).toBe(200);
    expect((await planCategoriesFor(prisma, edition.id)).map((c) => c.key)).toContain('VIP_LOUNGE');
  });

  test('a column with stalls planned against it cannot be dropped', async () => {
    await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 2 });
    const current = await planCategoriesFor(prisma, edition.id);
    const res = await put(
      current
        .filter((c) => c.key !== 'VENDOR_FOOD')
        .map((c) => ({ key: c.key, name: c.name, isFood: c.isFood, sortOrder: c.sortOrder })),
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('VENDOR_FOOD');
  });

  test('a lead may not redraw the grid', async () => {
    expect((await put([], lead)).statusCode).toBe(403);
  });
});

describe('the season’s own settings', () => {
  test('an admin sets the name, the account prefixes and the stall cap', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/editions/${edition.id}/settings`,
      headers: admin.headers,
      payload: {
        name: 'Maha Shivratri 2026',
        virtualAccountRentPrefix: 'MSRRENT',
        virtualAccountDepositPrefix: 'MSRDEP',
        maxStallsPerRequest: 2,
      },
    });
    expect(res.statusCode).toBe(200);

    // The cap reaches the public form, which is the only place it is enforced
    // against a requester.
    const pub = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    expect(pub.json().maxStallsPerRequest).toBe(2);
    expect(pub.json().edition.name).toBe('Maha Shivratri 2026');
  });

  test('a lead may not change them', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/editions/${edition.id}/settings`,
      headers: lead.headers,
      payload: {
        name: 'x',
        virtualAccountRentPrefix: null,
        virtualAccountDepositPrefix: null,
        maxStallsPerRequest: 1,
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
