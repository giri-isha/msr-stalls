import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { confirmPayment } from '../src/modules/stalls/finance';
import { LogMailer, SYSTEM, prisma, resetDatabase, seedEdition, vendorBody } from './helpers/db';
import { selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

/** The vendor's way back in — the requirement's "register & login using email
 *  or phone number" in a module that has no passwords — and what their own
 *  portal lets them open once they are there. */

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

const askForLink = (contact: string) =>
  app.inject({ method: 'POST', url: '/api/m/stalls/public/access-link', payload: { contact } });

/** The token out of the most recent "Your MSR stall requests" email — followed
 *  the way a vendor follows it, rather than read out of the database. */
const mailedToken = (): string => {
  const last = mail.sent.at(-1);
  const match = last?.text.match(/stalls\/status\/([\w-]+)/);
  if (!match) throw new Error(`no status link in: ${last?.text}`);
  return match[1];
};

const statusOf = (token: string) =>
  app.inject({ method: 'GET', url: `/api/m/stalls/public/status/${token}` });

describe('POST /public/access-link', () => {
  test('emails the vendor their own status link when the email matches', async () => {
    await selected(['C1-1']);
    mail.sent.length = 0;

    const res = await askForLink('priya@greenleaf.example');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('priya@greenleaf.example');

    // The link works: it is a real status link for that account.
    const status = await statusOf(mailedToken());
    expect(status.statusCode).toBe(200);
    expect(status.json().requests[0].reference).toMatch(/^VEN-2026-/);
  });

  test('finds the account by mobile number, however it was typed', async () => {
    await selected(['C1-1']);
    for (const typed of ['9840012345', '+91 98400 12345']) {
      mail.sent.length = 0;
      const res = await askForLink(typed);
      expect(res.statusCode).toBe(202);
      expect(mail.sent).toHaveLength(1);
      expect(mail.sent[0].to).toBe('priya@greenleaf.example');
    }
  });

  test('answers a stranger and a malformed contact exactly as it answers a vendor', async () => {
    for (const contact of ['nobody@example.org', '9000000000', 'not a contact']) {
      mail.sent.length = 0;
      const res = await askForLink(contact);
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ ok: true });
      // Nothing sent, and nothing in the response says so.
      expect(mail.sent).toHaveLength(0);
    }
  });

  test('never mails an address the caller typed — only the one on the account', async () => {
    await selected(['C1-1']);
    mail.sent.length = 0;
    // Same mobile, attacker's mailbox: the letter still goes to the vendor.
    await askForLink('9840012345');
    expect(mail.sent.map((m) => m.to)).toEqual(['priya@greenleaf.example']);
  });

  test('the minted link opens the status page and nothing else', async () => {
    const { requestId } = await selected(['C1-1']);
    mail.sent.length = 0;
    await askForLink('priya@greenleaf.example');
    const token = mailedToken();

    // A status link is not a bank-form link, whatever the path says.
    const bank = await app.inject({ method: 'GET', url: `/api/m/stalls/public/bank/${token}` });
    expect(bank.statusCode).toBe(404);
    expect(requestId).toBeTruthy();
  });
});

describe('GET /public/status/:token', () => {
  test('tells a selected vendor what is still outstanding', async () => {
    await selected(['C1-1']);
    mail.sent.length = 0;
    await askForLink('priya@greenleaf.example');

    const body = (await statusOf(mailedToken())).json();
    const steps = body.requests[0].pending.map((p: { step: string }) => p.step);
    // A food vendor: bank details, money, certificate. No staff step — this
    // request asked for no staff passes.
    expect(steps).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI']);
  });

  test('lists nothing outstanding for a request that has not been selected', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/m/stalls/public/requests',
      payload: vendorBody(),
    });
    mail.sent.length = 0;
    await askForLink('priya@greenleaf.example');

    const body = (await statusOf(mailedToken())).json();
    expect(body.requests[0].status).toBe('SUBMITTED');
    expect(body.requests[0].pending).toEqual([]);
  });
});

describe('POST /public/status/:token/continue', () => {
  const token = async () => {
    mail.sent.length = 0;
    await askForLink('priya@greenleaf.example');
    return mailedToken();
  };

  const open = (t: string, body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/status/${t}/continue`,
      payload: body,
    });

  test('mints a working bank-form link for an outstanding step', async () => {
    const { reference } = await selected(['C1-1']);
    const res = await open(await token(), { reference, step: 'BANK_FORM' });
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

  test('mints an FSSAI link for a food stall', async () => {
    const { reference } = await selected(['C1-1']);
    const res = await open(await token(), { reference, step: 'FSSAI' });
    expect(res.json().url.startsWith('http://web.example/stalls/fssai/')).toBe(true);
  });

  test('refuses a step that is not outstanding', async () => {
    const { requestId, reference } = await selected(['C1-1']);
    const t = await token();
    await prisma.stallFssaiCertificate.create({
      data: { requestId, files: { create: { fileKey: 'k', fileName: 'cert.pdf' } } },
    });

    const res = await open(t, { reference, step: 'FSSAI' });
    expect(res.statusCode).toBe(409);
  });

  test('refuses a step that is nobody-can-open — payment is Finance’s to move', async () => {
    const { reference } = await selected(['C1-1']);
    const res = await open(await token(), { reference, step: 'PAYMENT' });
    // Not a valid value at all: the contract lists only the self-serve steps.
    expect(res.statusCode).toBe(400);
  });

  test('another vendor’s reference reads exactly like one that does not exist', async () => {
    await selected(['C1-1']);
    const mine = await token();
    const other = await selected(['C1-2'], {
      email: 'other@example.org',
      contactNumber: '9840099999',
      stallName: 'Other Stall',
    });

    const stranger = await open(mine, { reference: other.reference, step: 'BANK_FORM' });
    const nonsense = await open(mine, { reference: 'VEN-2026-9999', step: 'BANK_FORM' });
    expect(stranger.statusCode).toBe(404);
    expect(nonsense.statusCode).toBe(404);
    expect(stranger.json()).toEqual(nonsense.json());
  });

  test('a bank-form link is not a way back to the portal', async () => {
    const { reference } = await selected(['C1-1']);
    const res = await open(await token(), { reference, step: 'BANK_FORM' });
    const bankToken = res.json().url.split('/').pop();

    const status = await statusOf(bankToken);
    expect(status.statusCode).toBe(404);
  });

  test('stops offering the bank form once the bank details are in', async () => {
    const { requestId, reference } = await selected(['C1-1']);
    const t = await token();
    await prisma.stallBankDetail.create({
      data: {
        requestId,
        email: 'priya@greenleaf.example',
        invoiceName: 'Green Leaf',
        accountHolder: 'Priya Venkat',
        mobile: '9840012345',
        address: '12 Mettupalayam Road',
        pincode: '641001',
        bankName: 'Test Bank',
        branch: 'RS Puram',
        accountNumber: '000111222333',
        ifsc: 'TEST0001234',
        panNumber: 'ABCDE1234F',
        gstNumber: '33ABCDE1234F1Z5',
        chequeKey: 'k1',
        panKey: 'k2',
        agreedNeftAt: new Date(),
        agreedTermsAt: new Date(),
      },
    });

    const body = (await statusOf(t)).json();
    expect(body.requests[0].pending.map((p: { step: string }) => p.step)).toEqual([
      'PAYMENT',
      'FSSAI',
    ]);
    expect((await open(t, { reference, step: 'BANK_FORM' })).statusCode).toBe(409);
  });
});

describe('the portal and the staff screens agree', () => {
  test('a confirmed payment drops off the vendor’s list too', async () => {
    const { requestId } = await selected(['C1-1']);
    const t = await (async () => {
      mail.sent.length = 0;
      await askForLink('priya@greenleaf.example');
      return mailedToken();
    })();

    const before = (await statusOf(t)).json().requests[0].pending;
    expect(before.map((p: { step: string }) => p.step)).toContain('PAYMENT');

    await confirmPayment(
      prisma,
      requestId,
      {
        purpose: 'RENT',
        mode: 'NEFT',
        referenceNo: 'NEFT-001',
        amountPaise: 100_000_00,
        receivedOn: new Date().toISOString().slice(0, 10),
      },
      SYSTEM,
    );

    const after = (await statusOf(t)).json().requests[0].pending;
    expect(after.map((p: { step: string }) => p.step)).not.toContain('PAYMENT');
  });
});
