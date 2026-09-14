import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { StallEdition } from '@prisma/client';
import { buildApp } from '../src/app';
import { mintAccessLink } from '../src/modules/stalls/accounts';
import { ensureCoupon } from '../src/modules/stalls/onboarding';
import {
  LogMailer,
  type Staff,
  prisma,
  resetDatabase,
  seedEdition,
  seedStaff,
} from './helpers/db';
import { fakeStore, selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

/** The HTTP edge for Phases 2 and 3: who may call what, and what a vendor can
 *  reach with nothing but a link or a coupon. The domain behaviour itself is
 *  covered in comms/bank/finance/onboarding/ops; this file is about the
 *  boundary. */

let app: FastifyInstance;
let edition: StallEdition;
let admin: Staff;
let volunteer: Staff;
let finance: Staff;
let lead: Staff;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer(), files: fakeStore() });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
  admin = await seedStaff(['stalls_admin'], 'admin@example.org');
  lead = await seedStaff(['stalls_lead'], 'lead@example.org');
  volunteer = await seedStaff(['stalls_volunteer'], 'volunteer@example.org');
  finance = await seedStaff(['stalls_finance'], 'finance@example.org');
});

const get = (url: string, who?: Staff) =>
  app.inject({ method: 'GET', url: `/api/m/stalls${url}`, headers: who?.headers });
const post = (url: string, payload: Record<string, unknown>, who?: Staff) =>
  app.inject({ method: 'POST', url: `/api/m/stalls${url}`, headers: who?.headers, payload });
const pub = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url: `/api/m/stalls/public${url}`, payload });

/** A live link of the given purpose, the way a vendor receives one. */
async function link(requestId: string, purpose: 'BANK_FORM' | 'FSSAI_UPLOAD' | 'STATUS') {
  const r = await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } });
  const { token } = await mintAccessLink(prisma, {
    accountId: r.accountId,
    requestId,
    purpose,
    ttlDays: 30,
  });
  return token;
}

describe('who may reach the new staff surfaces', () => {
  test('a volunteer may run check-in and the chairs counter but not send letters', async () => {
    expect((await get('/checkin', volunteer)).statusCode).toBe(200);
    expect((await get('/equipment', volunteer)).statusCode).toBe(200);
    expect((await get('/comms/recipients', volunteer)).statusCode).toBe(403);
  });

  test('a lead may send letters but not confirm a payment', async () => {
    expect((await get('/comms/recipients', lead)).statusCode).toBe(200);
    expect((await get('/finance/payments', lead)).statusCode).toBe(200);

    const { requestId } = await selected(['C1-1']);
    const res = await post(
      `/finance/payments/${requestId}`,
      { purpose: 'RENT', referenceNo: 'N1', amountPaise: 100, receivedOn: '2026-02-14' },
      lead,
    );
    expect(res.statusCode).toBe(403);
  });

  test('Finance may confirm a payment', async () => {
    const { requestId } = await selected(['C1-1']);
    const res = await post(
      `/finance/payments/${requestId}`,
      { purpose: 'RENT', referenceNo: 'N1', amountPaise: 100, receivedOn: '2026-02-14' },
      finance,
    );
    expect(res.statusCode).toBe(204);
  });

  test('Finance cannot edit a letter', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/comms/templates/SELECTION_VENDOR',
      headers: finance.headers,
      payload: { subject: 'x', body: 'y' },
    });
    expect(res.statusCode).toBe(403);
  });

  test('signed out is 401, not 403 — "sign in" and "you may not" are different', async () => {
    expect((await get('/comms/recipients')).statusCode).toBe(401);
    expect((await get('/electrical')).statusCode).toBe(401);
  });

  test('an unknown template key is a 400 from the schema, never a 500', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/comms/templates/NOPE',
      headers: admin.headers,
      payload: { subject: 'x', body: 'y' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the bank form, reached with nothing but a link', () => {
  test('opens the vendor’s own form and accepts it once', async () => {
    const { requestId, reference } = await selected(['C1-1']);
    const token = await link(requestId, 'BANK_FORM');

    const view = await pub('GET', `/bank/${token}`);
    expect(view.statusCode).toBe(200);
    expect(view.json().reference).toBe(reference);
    expect(view.json().stallNumbers).toEqual(['C1-1']);

    const cheque = await pub('POST', `/uploads/${token}`, {
      purpose: 'BANK_CHEQUE',
      fileName: 'c.jpg',
      contentType: 'image/jpeg',
      bytes: 1000,
    });
    const pan = await pub('POST', `/uploads/${token}`, {
      purpose: 'BANK_PAN',
      fileName: 'p.pdf',
      contentType: 'application/pdf',
      bytes: 1000,
    });
    expect(cheque.statusCode).toBe(200);

    const submitted = await pub('POST', `/bank/${token}`, {
      chequeKey: cheque.json().key,
      panKey: pan.json().key,
      email: 'priya@greenleaf.example',
      invoiceName: 'Green Leaf Organics Pvt Ltd',
      accountHolder: 'Green Leaf Organics Pvt Ltd',
      mobile: '9840012345',
      address: '12 Mettupalayam Road',
      pincode: '641043',
      bankName: 'HDFC Bank',
      branch: 'RS Puram',
      accountNumber: '50100123456789',
      ifsc: 'HDFC0001234',
      panNumber: 'ABCDE1234F',
      gstNumber: 'None',
      agreeNeft: true,
      agreeTerms: true,
      plugs5a: 2,
      plugs15a: 1,
      gasStoves: 0,
      tablesNeeded: 0,
      chairsNeeded: 0,
      passes2w: 1,
      passes4w: 0,
      passesStaff: 2,
    });
    expect(submitted.statusCode).toBe(204);
    expect(await prisma.stallBankDetail.count({ where: { requestId } })).toBe(1);
  });

  test('a status link cannot open the bank form', async () => {
    const { requestId } = await selected(['C1-1']);
    const token = await link(requestId, 'STATUS');
    expect((await pub('GET', `/bank/${token}`)).statusCode).toBe(404);
  });

  test('an FSSAI link cannot presign a cheque', async () => {
    const { requestId } = await selected(['C1-1']);
    const token = await link(requestId, 'FSSAI_UPLOAD');
    const res = await pub('POST', `/uploads/${token}`, {
      purpose: 'BANK_CHEQUE',
      fileName: 'c.jpg',
      contentType: 'image/jpeg',
      bytes: 1000,
    });
    expect(res.statusCode).toBe(404);
  });

  test('nobody can presign a template attachment from the public surface', async () => {
    const { requestId } = await selected(['C1-1']);
    const token = await link(requestId, 'BANK_FORM');
    const res = await pub('POST', `/uploads/${token}`, {
      purpose: 'TEMPLATE_ATTACHMENT',
      fileName: 'x.pdf',
      contentType: 'application/pdf',
      bytes: 10,
    });
    expect(res.statusCode).toBe(404);
  });

  test('an expired link answers exactly like an unknown one', async () => {
    const { requestId } = await selected(['C1-1']);
    const token = await link(requestId, 'BANK_FORM');
    await prisma.stallAccessLink.updateMany({
      where: { requestId, purpose: 'BANK_FORM' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await pub('GET', `/bank/${token}`);
    const unknown = await pub('GET', '/bank/0123456789abcdef0123456789abcdef');
    expect(expired.statusCode).toBe(404);
    expect(expired.json()).toEqual(unknown.json());
  });
});

describe('FSSAI upload, reached with nothing but a link', () => {
  test('uploads and reads back, and a key from elsewhere is refused', async () => {
    const { requestId } = await selected(['C1-1']);
    const token = await link(requestId, 'FSSAI_UPLOAD');

    const up = await pub('POST', `/uploads/${token}`, {
      purpose: 'FSSAI',
      fileName: 'cert.pdf',
      contentType: 'application/pdf',
      bytes: 4000,
    });
    const key = up.json().key;

    expect(
      (
        await pub('POST', `/fssai/${token}`, {
          stallName: 'Green Leaf Organics',
          files: [{ key: 'stalls/fssai/not-ours.pdf', name: 'x.pdf' }],
        })
      ).statusCode,
    ).toBe(404);

    const ok = await pub('POST', `/fssai/${token}`, {
      stallName: 'Green Leaf Organics',
      files: [{ key, name: 'cert.pdf' }],
    });
    expect(ok.statusCode).toBe(204);

    const view = await pub('GET', `/fssai/${token}`);
    expect(view.json().files).toHaveLength(1);
    expect(view.json().verifiedAt).toBeNull();
  });
});

describe('staff registration, reached with nothing but a coupon', () => {
  const coupon = async (requestId: string) => {
    const r = await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } });
    return (await ensureCoupon(prisma, requestId, r.stallName, edition.year, admin.personId)).code;
  };

  test('shows the stall and accepts a registration', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 2 });
    const code = await coupon(requestId);

    const view = await pub('GET', `/staff-registration/${code}`);
    expect(view.statusCode).toBe(200);
    expect(view.json().stallName).toBe('Green Leaf Organics');
    expect(view.json().maxStaff).toBe(2);

    const res = await pub('POST', '/staff-registration', {
      couponCode: code,
      name: 'Ravi Kumar',
      mobile: '9840055555',
      idType: 'AADHAAR',
      idNumber: '123456789012',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().registered).toBe(1);
  });

  test('a wrong coupon is a 404 that reveals nothing', async () => {
    expect((await pub('GET', '/staff-registration/GRE-2026-ZZZZZZZZ')).statusCode).toBe(404);
  });

  test('the cap is enforced at the edge, with a 409 the page can explain', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 1 });
    const code = await coupon(requestId);
    await pub('POST', '/staff-registration', {
      couponCode: code,
      name: 'A',
      mobile: '9840055555',
      idType: 'OTHER',
      idNumber: 'X123',
    });
    const second = await pub('POST', '/staff-registration', {
      couponCode: code,
      name: 'B',
      mobile: '9840066666',
      idType: 'OTHER',
      idNumber: 'Y123',
    });
    expect(second.statusCode).toBe(409);
  });
});

describe('the ops surfaces over HTTP', () => {
  test('the electrical sheet filters by cluster', async () => {
    await selected(['C1-1'], { plugs5a: 3 });
    const res = await get('/electrical?zoneCode=C1', lead);
    expect(res.statusCode).toBe(200);
    expect(res.json().rows[0].plugs5aTotal).toBe(4);
  });

  test('a volunteer can check a stall in and print its challan', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 4 });
    expect((await post(`/checkin/${requestId}`, { note: 'ok' }, volunteer)).statusCode).toBe(200);

    const slip = await get(`/equipment/${requestId}/challan`, volunteer);
    expect(slip.statusCode).toBe(200);
    expect(slip.json().chairsOnline).toBe(4);
  });

  test('a bulk send reports per row over HTTP', async () => {
    const a = await selected(['C1-1'], { email: 'a@x.example' });
    const b = await selected(['C1-2'], { email: 'b@x.example' });
    const first = await post(
      '/comms/send',
      { templateKey: 'SELECTION_VENDOR', requestIds: [a.requestId] },
      lead,
    );
    expect(first.json().sent).toEqual([a.requestId]);

    const second = await post(
      '/comms/send',
      { templateKey: 'SELECTION_VENDOR', requestIds: [a.requestId, b.requestId] },
      lead,
    );
    expect(second.json().sent).toEqual([b.requestId]);
    expect(second.json().skipped[0].reason).toBe('already sent');
  });
});
