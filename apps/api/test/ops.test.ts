import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput, rupeesToPaise as r } from '@msr/stalls';
import type { StallEdition } from '@prisma/client';
import { buildApp } from '../src/app';
import { mintAccessLink } from '../src/modules/stalls/accounts';
import { confirmPayment, ensureQuote } from '../src/modules/stalls/payments';
import { selectRequest } from '../src/modules/stalls/selection';
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
import { makeStalls } from './helpers/plan';

let app: FastifyInstance;
let edition: StallEdition;
let lead: Staff;
let volunteer: Staff;
let finance: Staff;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 3 });
  lead = await seedStaff(['stalls_lead']);
  volunteer = await seedStaff(['stalls_volunteer']);
  finance = await seedStaff(['stalls_finance']);
});

/** A paid-up food vendor on A4-1 with 2 chairs and 1 table ordered. */
async function paidVendor() {
  const v = await submitRequest(
    prisma,
    SubmitRequestInput.parse(
      vendorBody({
        chairsNeeded: 2,
        tablesNeeded: 1,
        passesStaff: 2,
        appliances: [
          { name: 'Fridge', watts: 1000 },
          { name: 'Mixie', watts: 500 },
        ],
      }),
    ),
    { mail: new LogMailer(), statusUrl: (t) => t },
  );
  await selectRequest(prisma, { requestId: v.requestId, stallNumbers: ['A4-1'] }, SYSTEM);
  await ensureQuote(prisma, v.requestId, SYSTEM);
  await confirmPayment(
    prisma,
    v.requestId,
    { creditDate: '2026-09-10', referenceNo: 'X', mode: 'NEFT', amountReceivedPaise: 0 },
    SYSTEM,
  );
  const row = await prisma.stallRequest.findUniqueOrThrow({ where: { id: v.requestId } });
  return { id: v.requestId, accountId: row.accountId };
}

const post = (staff: Staff, url: string, payload?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/m/stalls${url}`, headers: staff.headers, payload });
const get = (staff: Staff, url: string) =>
  app.inject({ method: 'GET', url: `/api/m/stalls${url}`, headers: staff.headers });

describe('FSSAI', () => {
  test('the vendor uploads by signed link; a lead verifies; the stage moves to READY', async () => {
    const { id, accountId } = await paidVendor();
    const { token } = await mintAccessLink(prisma, {
      accountId,
      requestId: id,
      purpose: 'FSSAI_UPLOAD',
      ttlDays: 30,
    });

    const view = await app.inject({ method: 'GET', url: `/api/m/stalls/public/fssai/${token}` });
    expect(view.statusCode).toBe(200);
    expect(view.json().current).toBeNull();

    const up = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/fssai/${token}`,
      payload: {
        mediaKey: 'stalls/2026/x/fssai-1.pdf',
        fileName: 'fssai.pdf',
        licenseNumber: '12345678901234',
      },
    });
    expect(up.statusCode).toBe(200);
    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id } })).stage).toBe(
      'FSSAI_PENDING',
    );

    const asVolunteer = await post(volunteer, `/requests/${id}/fssai/review`, {
      verdict: 'VERIFY',
    });
    expect(asVolunteer.statusCode).toBe(403);
    const ok = await post(lead, `/requests/${id}/fssai/review`, { verdict: 'VERIFY' });
    expect(ok.statusCode).toBe(200);
    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id } })).stage).toBe('READY');
  });

  test('a rejection is shown to the vendor and cleared by a new upload', async () => {
    const { id, accountId } = await paidVendor();
    const { token } = await mintAccessLink(prisma, {
      accountId,
      requestId: id,
      purpose: 'FSSAI_UPLOAD',
      ttlDays: 30,
    });
    await app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/fssai/${token}`,
      payload: { mediaKey: 'k1', fileName: 'a.pdf' },
    });
    await post(lead, `/requests/${id}/fssai/review`, {
      verdict: 'REJECT',
      reason: 'expired certificate',
    });
    let view = await app.inject({ method: 'GET', url: `/api/m/stalls/public/fssai/${token}` });
    expect(view.json().current.rejectedReason).toBe('expired certificate');
    await app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/fssai/${token}`,
      payload: { mediaKey: 'k2', fileName: 'b.pdf' },
    });
    view = await app.inject({ method: 'GET', url: `/api/m/stalls/public/fssai/${token}` });
    expect(view.json().current.rejectedReason).toBeNull();
    expect(view.json().current.fileName).toBe('b.pdf');
  });
});

describe('staff coupon', () => {
  test('is issued on payment, opens by signed link, and the registered count is tracked', async () => {
    const { id, accountId } = await paidVendor();
    const issued = await post(lead, `/requests/${id}/coupon`, {});
    expect(issued.statusCode).toBe(200);
    expect(issued.json().code).toMatch(/^MSR26-A4-1-/);
    expect(issued.json().maxStaff).toBe(2);

    const { token } = await mintAccessLink(prisma, {
      accountId,
      requestId: id,
      purpose: 'STAFF_REGISTRATION',
      ttlDays: 30,
    });
    const view = await app.inject({ method: 'GET', url: `/api/m/stalls/public/staff/${token}` });
    expect(view.json().couponCode).toBe(issued.json().code);

    const counted = await app.inject({
      method: 'PUT',
      url: `/api/m/stalls/requests/${id}/coupon/registered`,
      headers: volunteer.headers,
      payload: { registeredCount: 2 },
    });
    expect(counted.statusCode).toBe(200);
    expect(counted.json().registeredCount).toBe(2);
  });

  test('re-issuing keeps the same code', async () => {
    const { id } = await paidVendor();
    const a = (await post(lead, `/requests/${id}/coupon`, {})).json().code;
    const b = (await post(lead, `/requests/${id}/coupon`, { maxStaff: 5 })).json();
    expect(b.code).toBe(a);
    expect(b.maxStaff).toBe(5);
  });
});

describe('electrical & venue sheet', () => {
  test('one row per stall, occupied or empty, with the appliance load; clusters are settable', async () => {
    const { id } = await paidVendor();
    const res = await get(lead, '/electrical?zoneCode=A4');
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      stallNumber: 'A4-1',
      stallName: 'Green Leaf Organics',
      totalWatts: 1500,
    });
    expect(rows[1]).toMatchObject({ stallNumber: 'A4-2', stallName: null, totalWatts: 0 });
    void id;

    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/m/stalls/stalls/A4-1/cluster',
          headers: volunteer.headers,
          payload: { cluster: 'P1' },
        })
      ).statusCode,
    ).toBe(403);
    const set = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/stalls/A4-1/cluster',
      headers: lead.headers,
      payload: { cluster: 'P1' },
    });
    expect(set.statusCode).toBe(200);
    expect((await get(lead, '/electrical?zoneCode=A4')).json()[0].cluster).toBe('P1');
  });
});

describe('check-in', () => {
  test('lists what is pending, and a volunteer checks the stall in', async () => {
    const { id } = await paidVendor();
    const list = await get(volunteer, '/checkin?q=A4-1');
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    // Paid through the seams without the bank form; food stall with no FSSAI
    // yet; 2 staff passes, none registered. Everything outstanding is listed.
    expect(list.json()[0].pending).toEqual([
      'Bank details',
      'FSSAI certificate',
      'Staff registered 0/2',
    ]);

    const res = await post(volunteer, `/requests/${id}/checkin`, {
      staffPresent: 2,
      passes2wIssued: 1,
      passes4wIssued: 0,
      passesStaffIssued: 2,
    });
    expect(res.statusCode).toBe(200);
    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id } })).stage).toBe(
      'CHECKED_IN',
    );
    expect((await get(volunteer, '/checkin')).json()[0].checkedInAt).not.toBeNull();
  });
});

describe('chairs & tables', () => {
  test('issue charges extras at the vendor rate for the event days; return computes missing and flags', async () => {
    const { id } = await paidVendor();
    const issue = await post(volunteer, `/requests/${id}/furniture/issue`, {
      chairsIssued: 2,
      tablesIssued: 1,
      extraChairs: 2,
      extraTables: 0,
      cashCollectedPaise: r(400),
    });
    expect(issue.statusCode).toBe(200);
    // 2 extra chairs × ₹100 × 2 days
    expect(issue.json().extraChargePaise).toBe(r(400));

    const early = await post(volunteer, `/requests/${id}/furniture/return`, {
      chairsReturned: 3,
      tablesReturned: 1,
      chairsDamaged: 0,
      tablesDamaged: 0,
    });
    expect(early.statusCode).toBe(200);
    expect(early.json().chairsMissing).toBe(1); // 2 + 2 issued, 3 back
    expect(early.json().tablesMissing).toBe(0);
    expect(early.json().flagged).toBe(true);

    const rows = await get(volunteer, '/furniture');
    expect(rows.json()[0].ledger.chairsMissing).toBe(1);
  });

  test('a return before any issue is refused', async () => {
    const { id } = await paidVendor();
    const res = await post(volunteer, `/requests/${id}/furniture/return`, {
      chairsReturned: 0,
      tablesReturned: 0,
      chairsDamaged: 0,
      tablesDamaged: 0,
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('fines and refunds', () => {
  test('deposit − replacements − active fines = refundable; finance marks it paid', async () => {
    const { id } = await paidVendor();
    await post(volunteer, `/requests/${id}/furniture/issue`, {
      chairsIssued: 2,
      tablesIssued: 1,
      extraChairs: 0,
      extraTables: 0,
      cashCollectedPaise: 0,
    });
    await post(volunteer, `/requests/${id}/furniture/return`, {
      chairsReturned: 1,
      tablesReturned: 1,
      chairsDamaged: 0,
      tablesDamaged: 0,
    });

    expect(
      (
        await post(volunteer, `/requests/${id}/fines`, {
          reason: 'Unclean stall',
          amountPaise: r(500),
        })
      ).statusCode,
    ).toBe(403);
    const fine = await post(lead, `/requests/${id}/fines`, {
      reason: 'Unclean stall',
      amountPaise: r(500),
    });
    expect(fine.statusCode).toBe(201);
    const waived = await post(lead, `/requests/${id}/fines`, {
      reason: 'Late setup',
      amountPaise: r(300),
    });
    await post(lead, `/fines/${waived.json().id}/waive`);

    const prep = await post(lead, `/requests/${id}/refund/prepare`);
    expect(prep.statusCode).toBe(200);
    const payment = await prisma.stallPayment.findUniqueOrThrow({ where: { requestId: id } });
    // 1 chair missing × ₹500 + ₹500 fine (the ₹300 was waived)
    expect(prep.json().furnitureDeductionPaise).toBe(r(500));
    expect(prep.json().finesPaise).toBe(r(500));
    expect(prep.json().refundablePaise).toBe(payment.depositTotalPaise - r(1000));

    const sent = await post(lead, '/refunds/send', { requestIds: [id] });
    expect(sent.json().sent).toBe(1);
    const rows = await get(finance, '/refunds');
    expect(rows.json()[0].sentToFinanceAt).not.toBeNull();
    expect(rows.json()[0].ledgerFlagged).toBe(true);

    expect(
      (await post(lead, `/requests/${id}/refund/paid`, { referenceNo: 'RF1' })).statusCode,
    ).toBe(403);
    const paid = await post(finance, `/requests/${id}/refund/paid`, { referenceNo: 'RF1' });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().referenceNo).toBe('RF1');
  });
});
