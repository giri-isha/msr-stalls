import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { shortlist } from '../src/modules/stalls/selection';
import { LogMailer, SYSTEM, prisma, resetDatabase, seedEdition, vendorBody } from './helpers/db';

let app: FastifyInstance;
const mail = new LogMailer();
beforeAll(async () => {
  app = await buildApp({ logger: false, mail, webOrigin: 'http://web.example' });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
  mail.sent.length = 0;
});

const post = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/m/stalls/public/requests', payload: body });

describe('GET /public/config', () => {
  test('answers the form what it needs, and nothing staff-only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.edition.year).toBe(2026);
    expect(body.zones).toHaveLength(7);
    expect(Object.keys(body).sort()).toEqual(['charges', 'customFields', 'edition', 'zones']);
  });

  test('is 503, not 500, when no edition is active', async () => {
    await prisma.stallEdition.updateMany({ data: { isActive: false } });
    const res = await app.inject({ method: 'GET', url: '/api/m/stalls/public/config' });
    expect(res.statusCode).toBe(503);
  });
});

describe('POST /public/requests', () => {
  test('creates a request and returns its reference and status token', async () => {
    const res = await post(vendorBody());
    expect(res.statusCode).toBe(201);
    expect(res.json().reference).toMatch(/^VEN-2026-\d{4}$/);
    expect(res.json().statusToken.length).toBeGreaterThan(30);
    expect(mail.sent).toHaveLength(1);
  });

  test('a malformed body is a 400 naming the field, never a 500', async () => {
    const res = await post(vendorBody({ contactNumber: '12345' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('contactNumber');
  });

  test('refuses a submission that did not agree to the disclaimer', async () => {
    const res = await post(vendorBody({ agreed: false }));
    expect(res.statusCode).toBe(400);
  });

  test('refuses a local welfare request without the deposit acknowledgement', async () => {
    const res = await post(vendorBody({ requestType: 'LOCAL_WELFARE' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('depositAcknowledged');
  });

  test('ignores an attempt to set status from the public form', async () => {
    const res = await post(vendorBody({ status: 'SELECTED' }));
    expect(res.statusCode).toBe(201);
    const row = await prisma.stallRequest.findUniqueOrThrow({
      where: { reference: res.json().reference },
    });
    expect(row.status).toBe('SUBMITTED');
  });
});

describe('GET /public/status/:token', () => {
  test("shows that vendor's own requests", async () => {
    const a = await post(vendorBody({ stallName: 'First' }));
    await post(vendorBody({ stallName: 'Second' }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/public/status/${a.json().statusToken}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe('Priya Venkat');
    expect(
      res
        .json()
        .requests.map((r: { stallName: string }) => r.stallName)
        .sort(),
    ).toEqual(['First', 'Second']);
  });

  test('a wrong token is a 404, not a 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/public/status/definitely-not-a-real-token-value',
    });
    expect(res.statusCode).toBe(404);
  });

  test("account A's token cannot see account B's request", async () => {
    const a = await post(vendorBody({ email: 'a@example.com', stallName: 'A stall' }));
    await post(vendorBody({ email: 'b@example.com', stallName: 'B stall' }));
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/public/status/${a.json().statusToken}`,
    });
    const names = res.json().requests.map((r: { stallName: string }) => r.stallName);
    expect(names).toEqual(['A stall']);
  });

  test('leaks no internal fields, and no stall number before selection', async () => {
    const a = await post(vendorBody());
    const row = await prisma.stallRequest.findUniqueOrThrow({
      where: { reference: a.json().reference },
    });
    await prisma.stallRequest.update({
      where: { id: row.id },
      data: { flaggedAt: new Date(), flagReason: 'duplicate of VEN-2026-0007' },
    });
    await shortlist(prisma, row.id, SYSTEM);
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/public/status/${a.json().statusToken}`,
    });
    const r = res.json().requests[0];
    expect(r.status).toBe('SHORTLISTED');
    expect(r.allocatedStalls).toEqual([]);
    expect(JSON.stringify(res.json())).not.toContain('duplicate');
    expect('flagReason' in r).toBe(false);
  });
});
