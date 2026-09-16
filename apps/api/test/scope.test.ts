// What the Local Welfare role reaches, and what it does not.
//
// The role exists because the local welfare team files requests inside this
// application on behalf of village traders who have no email address — which
// makes them backoffice members, holding real `requests:write`. `rbac.ts` says they reach
// only LOCAL_WELFARE; these are the tests that the API agrees, on every door
// rather than on the list alone.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@stalls/core';
import { buildApp } from '../src/app';
import { selectRequest } from '../src/modules/stalls/selection';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  accountFor,
  LogMailer,
  prisma,
  resetDatabase,
  seedEdition,
  seedBackoffice,
  SYSTEM,
  type Backoffice,
  vendorBody,
} from './helpers/db';
import { makeStalls } from './helpers/plan';

let app: FastifyInstance;
let lw: Backoffice;
let lead: Backoffice;
let vendorId: string;
let welfareId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());

const submit = async (body: Record<string, unknown>) =>
  submitRequest(
    prisma,
    SubmitRequestInput.parse(vendorBody(body)),
    {
      mail: new LogMailer(),
      statusUrl: (t) => t,
    },
    await accountFor(body),
  );

beforeEach(async () => {
  await resetDatabase();
  const edition = await seedEdition();
  await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 4 });
  lw = await seedBackoffice(['stalls_local_welfare']);
  lead = await seedBackoffice(['stalls_lead']);
  vendorId = (await submit({ stallName: 'Green Leaf', email: 'v@x.com' })).requestId;
  welfareId = (
    await submit({
      stallName: 'Thondamuthur Weavers',
      email: 'w@x.com',
      requestType: 'LOCAL_WELFARE',
      preferredZoneCode: 'A3',
      depositAcknowledged: true,
    })
  ).requestId;
});

const get = (backoffice: Backoffice, url: string) =>
  app.inject({ method: 'GET', url: `/api/m/stalls${url}`, headers: backoffice.headers });

describe('the list a scoped role sees', () => {
  test('carries their own requester type and nobody else’s', async () => {
    const res = await get(lw, '/requests');
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((i: { stallName: string }) => i.stallName)).toEqual([
      'Thondamuthur Weavers',
    ]);
  });

  test('an unscoped role still sees both', async () => {
    const res = await get(lead, '/requests');
    expect(res.json().items).toHaveLength(2);
  });

  test('asking for a type outside the scope is an empty page, not an error', async () => {
    // A filter matching nothing the caller may see IS "no results". A 403 here
    // would answer a question about rows they cannot read.
    const res = await get(lw, '/requests?requestType=VENDOR');
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });

  test('the dashboard counts only what the scope covers', async () => {
    const res = await get(lw, '/dashboard');
    expect(res.json().total).toBe(1);
    expect(res.json().byType).toEqual({ LOCAL_WELFARE: 1 });
    // The venue is not anybody's private fact: how much ground exists stays
    // whole even when whose it is does not.
    expect(res.json().stallsPlanned).toBe(4);
  });
});

describe('one request, addressed by id', () => {
  test('reading another type’s request is a 403', async () => {
    expect((await get(lw, `/requests/${vendorId}`)).statusCode).toBe(403);
  });

  test('reading their own is a 200', async () => {
    expect((await get(lw, `/requests/${welfareId}`)).statusCode).toBe(200);
  });

  test('writing to another type’s request is a 403, not a silent no-op', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/m/stalls/requests/${vendorId}`,
      headers: lw.headers,
      payload: { remarks: 'not mine to touch' },
    });
    expect(res.statusCode).toBe(403);
    const after = await prisma.stallRequest.findUniqueOrThrow({ where: { id: vendorId } });
    expect(after.remarks).not.toBe('not mine to touch');
  });

  test('flagging another type’s request is a 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${vendorId}/flag`,
      headers: lw.headers,
      payload: { reason: 'curious' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('the onboarding record of another type’s stall is a 403', async () => {
    await selectRequest(prisma, { requestId: vendorId, stallNumbers: ['A4-1'] }, SYSTEM);
    expect((await get(lw, `/onboarding/${vendorId}`)).statusCode).toBe(403);
  });

  test('a child row belonging to another type’s request is a 403', async () => {
    // ⚠️ `:id` here is the registration's, not the request's — the check has to
    // walk to the stall it hangs off before it can answer.
    await selectRequest(prisma, { requestId: vendorId, stallNumbers: ['A4-1'] }, SYSTEM);
    const backofficeRow = await prisma.stallVendorStaff.create({
      data: {
        requestId: vendorId,
        name: 'Murugan',
        mobile: '9840011111',
        idType: 'AADHAAR',
        idNumber: '1234',
      },
    });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/staff-registrations/${backofficeRow.id}`,
      headers: lw.headers,
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.stallVendorStaff.count({ where: { id: backofficeRow.id } })).toBe(1);
  });

  test('an id that matches nothing is a 404, not a 403', async () => {
    // Answering 403 would say an id exists to somebody not allowed to know it.
    const res = await get(lw, '/requests/11111111-1111-4111-8111-111111111111');
    expect(res.statusCode).toBe(404);
  });
});

describe('the finance and counter lists', () => {
  beforeEach(async () => {
    await selectRequest(prisma, { requestId: vendorId, stallNumbers: ['A4-1'] }, SYSTEM);
    await selectRequest(prisma, { requestId: welfareId, stallNumbers: ['A4-2'] }, SYSTEM);
  });

  test('payments are narrowed to the scope', async () => {
    const res = await get(lw, '/finance/payments');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: { stallName: string }) => r.stallName)).toEqual([
      'Thondamuthur Weavers',
    ]);
  });

  test('check-in is narrowed to the scope', async () => {
    const res = await get(lw, '/checkin');
    expect(res.json().map((r: { stallName: string }) => r.stallName)).toEqual([
      'Thondamuthur Weavers',
    ]);
  });

  test('a lead sees both on the same screens', async () => {
    expect((await get(lead, '/finance/payments')).json()).toHaveLength(2);
    expect((await get(lead, '/checkin')).json()).toHaveLength(2);
  });
});
