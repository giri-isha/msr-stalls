import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput, rupeesToPaise as r } from '@msr/stalls';
import type { StallEdition } from '@prisma/client';
import { buildApp } from '../src/app';
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
let finance: Staff;
const mail = new LogMailer();

beforeAll(async () => {
  app = await buildApp({ logger: false, mail, webOrigin: 'http://web.example' });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 3 });
  await makeStalls(edition.id, 'A4', { ASHRAM_NON_FOOD: 2 });
  lead = await seedStaff(['stalls_lead']);
  finance = await seedStaff(['stalls_finance']);
  mail.sent.length = 0;
});

const submit = (body: Record<string, unknown> = {}) =>
  submitRequest(prisma, SubmitRequestInput.parse(vendorBody(body)), {
    mail: new LogMailer(),
    statusUrl: (t) => t,
  });

/** A vendor selected onto C1-1 asking for 2 chairs, 1 table, 2 × 5 A, 1 × 15 A. */
async function selectedVendor() {
  const v = await submit({
    chairsNeeded: 2,
    tablesNeeded: 1,
    plugs5a: 2,
    plugs15a: 1,
    passesStaff: 3,
  });
  await selectRequest(prisma, { requestId: v.requestId, stallNumbers: ['C1-1'] }, SYSTEM);
  return v.requestId;
}

const tokenFrom = (text: string, kind: string) =>
  text.match(new RegExp(`/stalls/${kind}/([A-Za-z0-9_-]+)`))?.[1] ?? '';

const send = (staff: Staff, body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/m/stalls/comms/send',
    headers: staff.headers,
    payload: body,
  });

const bankBody = {
  invoiceName: 'Green Leaf Organics',
  accountHolder: 'Priya Venkat',
  mobile: '9840012345',
  address: '12 Mettupalayam Road, Coimbatore',
  pincode: '641002',
  bankName: 'HDFC Bank',
  branch: 'RS Puram',
  accountNumber: '50100123456789',
  ifsc: 'HDFC0001234',
  micr: '641240002',
  advanceReturnAck: true,
  panNumber: 'AACCC1234D',
  gstNumber: 'NONE',
  neftAgreed: true,
  tncAgreed: true,
  plugs5a: 2,
  plugs15a: 2,
  gasStoves: 1,
  appliances: [{ name: 'Deep freezer', watts: 900 }],
  tablesNeeded: 1,
  chairsNeeded: 4,
  passes2w: 1,
  passes4w: 0,
  passesStaff: 3,
};

describe('selection confirmation', () => {
  test('sends once, moves the stage, and carries the bank form link', async () => {
    const id = await selectedVendor();
    const res = await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toEqual([id]);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].text).toContain('/stalls/bank/');
    expect(mail.sent[0].text).toContain('C1-1');
    const row = await prisma.stallRequest.findUniqueOrThrow({ where: { id } });
    expect(row.stage).toBe('BANK_FORM_SENT');
  });

  test('is refused the second time, unless forced', async () => {
    const id = await selectedVendor();
    await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    const again = await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    expect(again.json().sent).toEqual([]);
    expect(again.json().skipped[0].reason).toBe('already sent');
    expect(mail.sent).toHaveLength(1);
    const forced = await send(lead, {
      requestIds: [id],
      templateKey: 'SELECTION_VENDOR',
      force: true,
    });
    expect(forced.json().sent).toEqual([id]);
    expect(mail.sent).toHaveLength(2);
  });

  test('the vendor template is not sent to an ashram request, and an unselected request is skipped', async () => {
    const ashram = await submit({
      requestType: 'ASHRAM',
      email: 'pub@ashram.example',
      ashram: {
        departmentHead: 'Ravi',
        departmentHeadContact: '9840012340',
        department: 'Publications',
        requestedBy: 'Meera',
        requesterContact: '9840012341',
        creditCardNeeded: false,
        usage: 'DEPT_SALES',
        wantsThembu: false,
      },
    });
    await selectRequest(prisma, { requestId: ashram.requestId, stallNumbers: ['A4-1'] }, SYSTEM);
    const unselected = await submit({ email: 'b@x.com' });
    const res = await send(lead, {
      requestIds: [ashram.requestId, unselected.requestId],
      templateKey: 'SELECTION_VENDOR',
    });
    expect(res.json().sent).toEqual([]);
    expect(res.json().skipped.map((s: { reason: string }) => s.reason)).toEqual([
      'SELECTION_VENDOR is not the template for a ASHRAM request',
      'not selected',
    ]);
    const ok = await send(lead, {
      requestIds: [ashram.requestId],
      templateKey: 'SELECTION_ASHRAM',
    });
    expect(ok.json().sent).toEqual([ashram.requestId]);
  });

  test('a volunteer may not send', async () => {
    const id = await selectedVendor();
    const volunteer = await seedStaff(['stalls_volunteer']);
    expect(
      (await send(volunteer, { requestIds: [id], templateKey: 'SELECTION_VENDOR' })).statusCode,
    ).toBe(403);
  });

  test('the email log records every send, and the comms rows show the last time', async () => {
    const id = await selectedVendor();
    await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    const log = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/requests/${id}/emails`,
      headers: lead.headers,
    });
    expect(log.json()).toHaveLength(1);
    expect(log.json()[0]).toMatchObject({ templateKey: 'SELECTION_VENDOR', status: 'SENT' });
    const rows = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/comms/rows',
      headers: lead.headers,
    });
    expect(rows.json()[0].lastSent.SELECTION_VENDOR).toBeTruthy();
  });
});

describe('the bank form by signed link', () => {
  test('opens from the token in the email, accepts the form, updates logistics, quotes the bill', async () => {
    const id = await selectedVendor();
    await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    const token = tokenFrom(mail.sent[0].text, 'bank');
    expect(token.length).toBeGreaterThan(20);

    const view = await app.inject({ method: 'GET', url: `/api/m/stalls/public/bank/${token}` });
    expect(view.statusCode).toBe(200);
    expect(view.json().stallNumbers).toEqual(['C1-1']);
    expect(view.json().submitted).toBeNull();
    expect(view.json().prefill.chairsNeeded).toBe(2);

    const post = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/bank/${token}`,
      payload: bankBody,
    });
    expect(post.statusCode).toBe(200);

    const row = await prisma.stallRequest.findUniqueOrThrow({
      where: { id },
      include: { bankDetails: true, payment: true, appliances: true },
    });
    expect(row.stage).toBe('BANK_FORM_FILLED');
    expect(row.bankDetails?.ifsc).toBe('HDFC0001234');
    expect(row.plugs15a).toBe(2);
    expect(row.chairsNeeded).toBe(4);
    expect(row.appliances.map((a) => a.name)).toEqual(['Deep freezer']);
    // C1 food rent 15,000 × 1; 5 A: 2 − 1 included = 1 × 500; 15 A: 2 × 1000;
    // furniture (4 × 100 + 1 × 400) × 2 days = 1600; net 19,100; GST 3,438
    expect(row.payment?.stallFeePaise).toBe(r(15000));
    expect(row.payment?.plugPointsFeePaise).toBe(r(2500));
    expect(row.payment?.furnitureFeePaise).toBe(r(1600));
    expect(row.payment?.gstPaise).toBe(r(3438));
    expect(row.payment?.depositTotalPaise).toBe(r(4000 + 1600));

    const again = await app.inject({ method: 'GET', url: `/api/m/stalls/public/bank/${token}` });
    expect(again.json().submitted.accountNumberMasked).toMatch(/•+6789$/);
  });

  test('a malformed IFSC or PAN is a 400 naming the field', async () => {
    const id = await selectedVendor();
    await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    const token = tokenFrom(mail.sent[0].text, 'bank');
    const bad = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/bank/${token}`,
      payload: { ...bankBody, ifsc: 'nope', panNumber: '123' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('ifsc');
    expect(bad.json().error).toContain('panNumber');
  });

  test('a status link cannot open the bank form, and a wrong token is a 404', async () => {
    const id = await selectedVendor();
    await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    const statusToken = tokenFrom(mail.sent[0].text, 'status');
    expect(
      (await app.inject({ method: 'GET', url: `/api/m/stalls/public/bank/${statusToken}` }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/m/stalls/public/bank/not-a-real-token-value-here',
        })
      ).statusCode,
    ).toBe(404);
  });

  test('uploads are a 503 when no media store is configured', async () => {
    const id = await selectedVendor();
    await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    const token = tokenFrom(mail.sent[0].text, 'bank');
    const res = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/upload/${token}`,
      payload: {
        purpose: 'CHEQUE',
        fileName: 'cheque.jpg',
        contentType: 'image/jpeg',
        bytes: 1000,
      },
    });
    expect(res.statusCode).toBe(503);
  });
});

describe('payment and finance', () => {
  async function throughBank() {
    const id = await selectedVendor();
    await send(lead, { requestIds: [id], templateKey: 'SELECTION_VENDOR' });
    const token = tokenFrom(mail.sent[0].text, 'bank');
    await app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/bank/${token}`,
      payload: bankBody,
    });
    mail.sent.length = 0;
    return id;
  }

  test('the payment email itemises the bill and moves the stage', async () => {
    const id = await throughBank();
    const res = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${id}/payment/send`,
      headers: lead.headers,
    });
    expect(res.statusCode).toBe(204);
    expect(mail.sent[0].text).toContain('Stall rent: ₹15,000');
    expect(mail.sent[0].text).toContain('Total payable');
    const row = await prisma.stallRequest.findUniqueOrThrow({
      where: { id },
      include: { payment: true },
    });
    expect(row.stage).toBe('PAYMENT_SENT');
    expect(row.payment?.emailSentAt).not.toBeNull();
  });

  test('only finance confirms; confirming issues the coupon and sends the post-payment mail', async () => {
    const id = await throughBank();
    const body = {
      creditDate: '2026-09-10',
      referenceNo: 'NEFT123456',
      mode: 'NEFT',
      amountReceivedPaise: r(26638),
    };
    const asLead = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${id}/payment/confirm`,
      headers: lead.headers,
      payload: body,
    });
    expect(asLead.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${id}/payment/confirm`,
      headers: finance.headers,
      payload: body,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().payment.referenceNo).toBe('NEFT123456');
    expect(ok.json().postPaymentMail.sent).toEqual([id]);

    const row = await prisma.stallRequest.findUniqueOrThrow({
      where: { id },
      include: { staffCoupon: true },
    });
    expect(row.stage).toBe('FSSAI_PENDING'); // food stall
    expect(row.staffCoupon?.code).toMatch(/^MSR26-C1-1-[A-Z2-9]{4}$/);
    expect(row.staffCoupon?.maxStaff).toBe(3);
    expect(mail.sent.at(-1)?.text).toContain(row.staffCoupon?.code ?? '?');
    expect(mail.sent.at(-1)?.text).toContain('/stalls/fssai/');

    const twice = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${id}/payment/confirm`,
      headers: finance.headers,
      payload: body,
    });
    expect(twice.statusCode).toBe(409);
  });

  test('the finance list separates pending from confirmed and shows the difference', async () => {
    const id = await throughBank();
    const pending = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/finance?pending=true',
      headers: finance.headers,
    });
    expect(pending.json().map((x: { id: string }) => x.id)).toEqual([id]);
    await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${id}/payment/confirm`,
      headers: finance.headers,
      payload: {
        creditDate: '2026-09-10',
        referenceNo: 'X',
        mode: 'UPI',
        amountReceivedPaise: r(26000),
      },
    });
    const after = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/finance?pending=true',
      headers: finance.headers,
    });
    expect(after.json()).toEqual([]);
    const all = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/finance',
      headers: finance.headers,
    });
    expect(all.json()[0].differencePaise).toBe(r(26000) - all.json()[0].totalPayablePaise);
  });

  test('the vendor status page shows the steps and the payment due', async () => {
    const id = await throughBank();
    await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${id}/payment/send`,
      headers: lead.headers,
    });
    const statusToken = tokenFrom(mail.sent[0].text, 'status');
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/public/status/${statusToken}`,
    });
    const req0 = res.json().requests[0];
    expect(req0.stage).toBe('PAYMENT_SENT');
    expect(
      req0.steps.map((s: { stage: string; state: string }) => `${s.stage}:${s.state}`),
    ).toContain('PAYMENT_SENT:current');
    expect(req0.paymentDue).toMatch(/^₹/);
    expect(req0.bankFormUrl).toBeNull();
  });
});
