import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { mintAccessLink } from '../src/modules/stalls/accounts';
import {
  LogMailer,
  prisma,
  resetDatabase,
  seedEdition,
  seedRequester,
  vendorBody,
} from './helpers/db';
import { selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

/** The other way into the vendor's own portal: the session they already hold,
 *  rather than the link in their inbox.
 *
 *  The view itself is `portal.test.ts`'s subject and is not re-tested here.
 *  What these tests pin is the credential — that the cookie reaches exactly
 *  that account's requests and no further, and that the two ways in cannot
 *  disagree about what a request still owes. */

let app: FastifyInstance;
const mail = new LogMailer();
beforeAll(async () => {
  app = await buildApp({ logger: false, mail, webOrigin: 'http://web.example' });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  const edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
  mail.sent.length = 0;
});

type Cookies = Record<string, string>;

const myRequests = (cookies: Cookies) =>
  app.inject({ method: 'GET', url: '/api/m/stalls/public/requests', cookies });

const openStep = (cookies: Cookies, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/m/stalls/public/requests/continue', payload, cookies });

/** Priya, logged in, with one selected food stall. The order matters: the
 *  account has to be made by REGISTERING, because `register` refuses a contact
 *  that already has an account — `accountFor` inside `selected` then finds the
 *  account rather than making a second one. */
async function priyaWithAStall() {
  const me = await seedRequester(app);
  const stall = await selected(['C1-1']);
  return { ...me, ...stall };
}

async function otherVendorWithAStall() {
  const me = await seedRequester(app, 'other@example.org', 'hunter2hunter2', 'Other Vendor');
  const stall = await selected(['C1-2'], {
    email: 'other@example.org',
    contactNumber: '9840099999',
    stallName: 'Other Stall',
  });
  return { ...me, ...stall };
}

describe('GET /public/requests', () => {
  test('shows a logged-in requester their own requests', async () => {
    const { cookies, reference } = await priyaWithAStall();

    const res = await myRequests(cookies);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.displayName).toBe('Priya Venkat');
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].reference).toBe(reference);
    expect(body.requests[0].status).toBe('SELECTED');
    expect(body.requests[0].pending.map((p: { step: string }) => p.step)).toContain('BANK_FORM');
  });

  test('answers 404 with no session at all', async () => {
    expect((await myRequests({})).statusCode).toBe(404);
  });

  test('answers 404 for a session that has been logged out', async () => {
    const { cookies } = await priyaWithAStall();
    await app.inject({ method: 'POST', url: '/api/m/stalls/public/logout', cookies });

    expect((await myRequests(cookies)).statusCode).toBe(404);
  });

  test('refuses a bank-form token presented as a session', async () => {
    const { accountId } = await priyaWithAStall();
    const { token } = await mintAccessLink(prisma, {
      accountId,
      purpose: 'BANK_FORM',
      ttlDays: 30,
    });

    expect((await myRequests({ stall_requester: token })).statusCode).toBe(404);
  });

  test('shows a requester nothing of anybody else’s', async () => {
    const priya = await priyaWithAStall();
    const other = await otherVendorWithAStall();

    const hers = (await myRequests(priya.cookies)).json();
    const theirs = (await myRequests(other.cookies)).json();

    expect(hers.requests.map((r: { reference: string }) => r.reference)).toEqual([priya.reference]);
    expect(theirs.requests.map((r: { reference: string }) => r.reference)).toEqual([
      other.reference,
    ]);
  });

  test('answers with an empty list for an account that has not applied', async () => {
    const { cookies } = await seedRequester(app);

    const body = (await myRequests(cookies)).json();
    expect(body.displayName).toBe('Priya Venkat');
    expect(body.requests).toEqual([]);
  });

  test('lists a request that has only been submitted, with nothing outstanding', async () => {
    const { cookies } = await seedRequester(app);
    await app.inject({
      method: 'POST',
      url: '/api/m/stalls/public/requests',
      payload: vendorBody(),
      cookies,
    });

    const body = (await myRequests(cookies)).json();
    expect(body.requests[0].status).toBe('SUBMITTED');
    expect(body.requests[0].pending).toEqual([]);
  });
});

describe('POST /public/requests/continue', () => {
  test('mints a working bank-form link for an outstanding step', async () => {
    const { cookies, reference } = await priyaWithAStall();

    const res = await openStep(cookies, { reference, step: 'BANK_FORM' });
    expect(res.statusCode).toBe(200);

    const url: string = res.json().url;
    expect(url.startsWith('http://web.example/stalls/bank/')).toBe(true);

    const form = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/public/bank/${url.split('/').pop()}`,
    });
    expect(form.statusCode).toBe(200);
    expect(form.json().reference).toBe(reference);
  });

  test('answers 404 with no session', async () => {
    const { reference } = await priyaWithAStall();
    expect((await openStep({}, { reference, step: 'BANK_FORM' })).statusCode).toBe(404);
  });

  test('another vendor’s reference reads exactly like one that does not exist', async () => {
    const priya = await priyaWithAStall();
    const other = await otherVendorWithAStall();

    const stranger = await openStep(priya.cookies, {
      reference: other.reference,
      step: 'BANK_FORM',
    });
    const nonsense = await openStep(priya.cookies, {
      reference: 'VEN-2026-9999',
      step: 'BANK_FORM',
    });

    expect(stranger.statusCode).toBe(404);
    expect(nonsense.statusCode).toBe(404);
    expect(stranger.json()).toEqual(nonsense.json());
  });

  test('refuses a step that is not outstanding', async () => {
    const { cookies, requestId, reference } = await priyaWithAStall();
    await prisma.stallFssaiCertificate.create({
      data: { requestId, files: { create: { fileKey: 'k', fileName: 'cert.pdf' } } },
    });

    expect((await openStep(cookies, { reference, step: 'FSSAI' })).statusCode).toBe(409);
  });

  test('refuses a step that is nobody’s to open — payment is Finance’s to move', async () => {
    const { cookies, reference } = await priyaWithAStall();
    // Not a valid value at all: the contract lists only the self-serve steps.
    expect((await openStep(cookies, { reference, step: 'PAYMENT' })).statusCode).toBe(400);
  });

  test('a link it mints is not itself a way back to the portal', async () => {
    const { cookies, reference } = await priyaWithAStall();
    const res = await openStep(cookies, { reference, step: 'BANK_FORM' });
    const bankToken = res.json().url.split('/').pop();

    expect((await myRequests({ stall_requester: bankToken })).statusCode).toBe(404);
  });
});

describe('the two ways in agree', () => {
  test('the session and the emailed link show the same requests', async () => {
    const { cookies } = await priyaWithAStall();

    mail.sent.length = 0;
    await app.inject({
      method: 'POST',
      url: '/api/m/stalls/public/access-link',
      payload: { contact: 'priya@greenleaf.example' },
    });
    const emailed = mail.sent.at(-1)?.text.match(/stalls\/status\/([\w-]+)/)?.[1];
    if (!emailed) throw new Error('no status link was sent');

    const byLink = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/public/status/${emailed}`,
    });
    const bySession = await myRequests(cookies);

    expect(bySession.statusCode).toBe(200);
    expect(byLink.statusCode).toBe(200);
    expect(bySession.json()).toEqual(byLink.json());
  });
});
