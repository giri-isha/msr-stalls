// Filing a requester's forms from the backoffice: who may, whose account it
// lands on, what goes out to the requester, and what the log says afterwards.
import type { StallEdition } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import {
  type Backoffice,
  LogMailer,
  prisma,
  resetDatabase,
  seedBackoffice,
  seedEdition,
  vendorBody,
} from './helpers/db';
import { fakeStore, recordingWhatsApp, selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let app: FastifyInstance;
let edition: StallEdition;
let lead: Backoffice;
let lw: Backoffice;
let finance: Backoffice;
let mail: LogMailer;
let whatsapp: ReturnType<typeof recordingWhatsApp>;

beforeAll(async () => {
  mail = new LogMailer();
  whatsapp = recordingWhatsApp();
  app = await buildApp({ logger: false, mail, whatsapp, files: fakeStore() });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  mail.sent.length = 0;
  whatsapp.sent.length = 0;
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
  lead = await seedBackoffice(['stalls_lead'], 'lead@example.org');
  lw = await seedBackoffice(['stalls_local_welfare'], 'lw@example.org');
  finance = await seedBackoffice(['stalls_finance'], 'finance@example.org');
});

const get = (url: string, who: Backoffice) =>
  app.inject({ method: 'GET', url: `/api/m/stalls${url}`, headers: who.headers });
const post = (url: string, payload: Record<string, unknown>, who: Backoffice) =>
  app.inject({ method: 'POST', url: `/api/m/stalls${url}`, headers: who.headers, payload });

const lwRequest = (over: Record<string, unknown> = {}) =>
  vendorBody({
    requestType: 'LOCAL_WELFARE',
    depositAcknowledged: true,
    preferredZoneCode: 'A3',
    ...over,
  });

const filing = (requester: Record<string, unknown>, request: Record<string, unknown>) => ({
  requester,
  request,
  attestation: true,
});

describe('POST /requests/file', () => {
  test('a finance member holds no filing privilege', async () => {
    const res = await post(
      '/requests/file',
      filing({ displayName: 'K', phone: '9840012345' }, vendorBody()),
      finance,
    );
    expect(res.statusCode).toBe(403);
  });

  test('a local welfare member may file their own form and not a vendor one', async () => {
    const no = await post(
      '/requests/file',
      filing({ displayName: 'K', phone: '9840012345' }, vendorBody()),
      lw,
    );
    expect(no.statusCode).toBe(403);

    const yes = await post(
      '/requests/file',
      filing({ displayName: 'Kumar', phone: '9840012345' }, lwRequest()),
      lw,
    );
    expect(yes.statusCode).toBe(201);
    expect(yes.json()).toMatchObject({
      reference: expect.stringMatching(/^LWS-2026-/),
      accountCreated: true,
    });
    // 🔴 No token, ever. A status link is a credential for the whole account.
    expect(yes.json()).not.toHaveProperty('statusToken');
  });

  test('a phone-only requester gets a placeholder address, a WhatsApp receipt and no email', async () => {
    const res = await post(
      '/requests/file',
      filing({ displayName: 'Kumar', phone: '9840012345' }, lwRequest()),
      lw,
    );
    expect(res.statusCode).toBe(201);
    const account = await prisma.stallAccount.findUniqueOrThrow({
      where: { id: res.json().accountId },
    });
    expect(account.email).toBe('mobile+9840012345@stalls.invalid');
    expect(account.phone).toBe('9840012345');
    expect(account.requesterType).toBe('LOCAL_WELFARE');
    expect(mail.sent).toHaveLength(0);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0].text).toContain(res.json().reference);
  });

  test('an email requester is mailed, and a second filing attaches to the same account', async () => {
    const a = await post(
      '/requests/file',
      filing({ displayName: 'Priya', email: 'Priya@GreenLeaf.example' }, vendorBody()),
      lead,
    );
    expect(a.statusCode).toBe(201);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('priya@greenleaf.example');

    const b = await post(
      '/requests/file',
      filing(
        { displayName: 'Priya', email: 'priya@greenleaf.example' },
        vendorBody({ stallName: 'Second' }),
      ),
      lead,
    );
    expect(b.json().accountId).toBe(a.json().accountId);
    expect(b.json().accountCreated).toBe(false);
    expect(await prisma.stallAccount.count()).toBe(1);
  });

  test('two contacts naming two different accounts is refused, with both names', async () => {
    await post(
      '/requests/file',
      filing({ displayName: 'Alpha', email: 'alpha@example.org' }, vendorBody()),
      lead,
    );
    await post(
      '/requests/file',
      filing({ displayName: 'Beta', phone: '9840099999' }, vendorBody({ stallName: 'B' })),
      lead,
    );
    const res = await post(
      '/requests/file',
      filing(
        { displayName: 'Gamma', email: 'alpha@example.org', phone: '9840099999' },
        vendorBody({ stallName: 'C' }),
      ),
      lead,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/Alpha/);
    expect(res.json().error).toMatch(/Beta/);
  });

  test('an account registered for another form is refused as the public write refuses it', async () => {
    await post(
      '/requests/file',
      filing({ displayName: 'Priya', email: 'priya@example.org' }, vendorBody()),
      lead,
    );
    const res = await post(
      '/requests/file',
      filing({ displayName: 'Priya', email: 'priya@example.org' }, lwRequest()),
      lead,
    );
    expect(res.statusCode).toBe(403);
  });

  test('the attestation is required', async () => {
    const res = await post(
      '/requests/file',
      { requester: { displayName: 'K', phone: '9840012345' }, request: lwRequest() },
      lw,
    );
    expect(res.statusCode).toBe(400);
  });

  test('the log names the member as actor and the account as on-behalf-of, and the consent is attested', async () => {
    const res = await post(
      '/requests/file',
      filing({ displayName: 'Kumar', phone: '9840012345' }, lwRequest()),
      lw,
    );
    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { action: 'stall_request.filed' },
    });
    expect(row.actorRef).toBe(lw.personId);
    expect(row.onBehalfOfAccountId).toBe(res.json().accountId);
    expect(row.channel).toBe('BACKOFFICE');
    expect(row.detail).toMatchObject({ filedBy: 'BACKOFFICE' });

    const consents = await prisma.stallDeclarationConsent.findMany({
      where: { requestId: res.json().requestId },
    });
    expect(consents.length).toBeGreaterThan(0);
    expect(consents.every((c) => c.attestedBy === lw.personId)).toBe(true);
  });

  test('a receipt that cannot be sent does not fail the filing', async () => {
    const failing = await buildApp({
      logger: false,
      mail: {
        send: async () => {
          throw new Error('smtp down');
        },
      },
      files: fakeStore(),
    });
    try {
      const res = await failing.inject({
        method: 'POST',
        url: '/api/m/stalls/requests/file',
        headers: lead.headers,
        payload: filing({ displayName: 'P', email: 'p@example.org' }, vendorBody()),
      });
      expect(res.statusCode).toBe(201);
      expect(await prisma.stallAuditEvent.count({ where: { action: 'stall_email.failed' } })).toBe(
        1,
      );
    } finally {
      await failing.close();
    }
  });
});

describe('GET /requests/file/lookup', () => {
  test('resolves a contact to an account, or to nothing, on filing.request', async () => {
    expect((await get('/requests/file/lookup?contact=k@example.org', finance)).statusCode).toBe(
      403,
    );
    expect((await get('/requests/file/lookup?contact=k@example.org', lw)).json()).toEqual({
      match: null,
    });

    const filed = await post(
      '/requests/file',
      filing({ displayName: 'Kumar', phone: '9840012345' }, lwRequest()),
      lw,
    );
    const hit = (await get('/requests/file/lookup?contact=98400%2012345', lw)).json();
    expect(hit.match).toMatchObject({
      accountId: filed.json().accountId,
      displayName: 'Kumar',
      // A placeholder address reads as no address.
      email: '',
      phone: '9840012345',
      requesterType: 'LOCAL_WELFARE',
      requestCount: 1,
    });
  });
});

describe('the four request-addressed filings', () => {
  test('bank: filing.bank, and the form view to draw it from', async () => {
    const { requestId } = await selected(['C1-1']);
    // A local welfare member holds every filing privilege but this one.
    expect((await get(`/requests/${requestId}/bank-form`, lw)).statusCode).toBe(403);
    expect((await get(`/requests/${requestId}/bank-form`, finance)).statusCode).toBe(403);
    const view = await get(`/requests/${requestId}/bank-form`, lead);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      reference: expect.stringMatching(/^VEN-/),
      submittedAt: null,
    });
  });

  test('fssai: the view and the write, on behalf', async () => {
    const { requestId } = await selected(['C1-1']);
    const view = await get(`/requests/${requestId}/fssai-form`, lead);
    expect(view.statusCode).toBe(200);
    expect(view.json().uploadedAt).toBeNull();

    const presigned = await post(
      '/uploads',
      { purpose: 'FSSAI', fileName: 'c.pdf', contentType: 'application/pdf', bytes: 10 },
      lead,
    );
    expect(presigned.statusCode).toBe(200);

    const res = await post(
      `/requests/${requestId}/fssai`,
      {
        stallName: 'Green Leaf Organics',
        files: [{ key: presigned.json().key, name: 'c.pdf' }],
        declarationIds: view.json().declarations.map((d: { id: string }) => d.id),
        attestation: true,
      },
      lead,
    );
    expect(res.statusCode).toBe(204);
    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { action: 'stall_fssai.submitted' },
    });
    expect(row.actorRef).toBe(lead.personId);
    expect(row.onBehalfOfAccountId).not.toBeNull();
  });

  test('staff: the stall’s own coupon is found or issued, and reused on a second visit', async () => {
    const { requestId } = await selected(['C1-1']);
    const view = await get(`/requests/${requestId}/staff-form`, lead);
    expect(view.statusCode).toBe(200);
    expect(view.json().couponCode).toMatch(/-2026-/);

    const res = await post(
      `/requests/${requestId}/staff`,
      {
        name: 'Arun',
        mobile: '9840099999',
        idType: 'AADHAAR',
        idNumber: '1234',
        declarationIds: view.json().declarations.map((d: { id: string }) => d.id),
        attestation: true,
      },
      lead,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().registered).toBe(1);

    const again = await get(`/requests/${requestId}/staff-form`, lead);
    expect(again.json().couponCode).toBe(view.json().couponCode);
    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { action: 'stall_vendor_staff.registered' },
    });
    expect(row.onBehalfOfAccountId).not.toBeNull();
  });

  test('claim: recorded PENDING, for Finance, with the member as actor', async () => {
    const { requestId } = await selected(['C1-1']);
    const body = { purpose: 'RENT', referenceNo: 'UTR1', amountPaise: 100, paidOn: '2026-09-01' };
    // 🔴 Finance holds `finance.write` and still may not file for somebody.
    expect((await post(`/requests/${requestId}/payment-claim`, body, finance)).statusCode).toBe(
      403,
    );

    const res = await post(`/requests/${requestId}/payment-claim`, body, lead);
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('PENDING');
    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { action: 'stall_payment_claim.submitted' },
    });
    expect(row.actorRef).toBe(lead.personId);
  });

  test('scope: a local welfare member cannot file against a vendor’s request', async () => {
    const { requestId } = await selected(['C1-1']);
    const res = await post(
      `/requests/${requestId}/payment-claim`,
      { purpose: 'RENT', referenceNo: 'UTR1', amountPaise: 100, paidOn: '2026-09-01' },
      lw,
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('uploads for a filed form', () => {
  test('a bank document presigns on filing.bank, a certificate on filing.fssai', async () => {
    const body = {
      purpose: 'BANK_CHEQUE',
      fileName: 'c.pdf',
      contentType: 'application/pdf',
      bytes: 10,
    };
    expect((await post('/uploads', body, lw)).statusCode).toBe(403);
    expect((await post('/uploads', body, lead)).statusCode).toBe(200);
    expect((await post('/uploads', { ...body, purpose: 'FSSAI' }, lw)).statusCode).toBe(200);
  });
});

describe('GET /me', () => {
  test('carries the requester-type scope, so the filing page offers only what it may', async () => {
    expect((await get('/me', lw)).json().requestTypeScope).toEqual(['LOCAL_WELFARE']);
    expect((await get('/me', lead)).json().requestTypeScope).toBeNull();
  });
});
