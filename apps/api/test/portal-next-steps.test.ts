// The portal carries every step, not just the email.
//
// Three letters used to drive the whole journey — selection, payment details,
// FSSAI-and-staff — and each unlocked the step after it. A requester who never
// received one, or lost it, was stuck with a chip they could not act on. The
// letters still go out. What these tests pin is that they are no longer the
// only route: the figures and the coupon are reachable from the portal itself.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { updateEditionSettings } from '../src/modules/stalls/config';
import { confirmPayment, setDiscretionaryFee } from '../src/modules/stalls/finance';
import { LogMailer, prisma, resetDatabase, seedEdition, seedRequester, SYSTEM } from './helpers/db';
import { selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

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

const getCoupon = (cookies: Cookies, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/m/stalls/public/requests/coupon', payload, cookies });

/** Priya, logged in, with one selected food stall. Registering first matters:
 *  `register` refuses a contact that already has an account, so `accountFor`
 *  inside `selected` then finds hers rather than making a second. */
async function priyaWithAStall() {
  const me = await seedRequester(app);
  const stall = await selected(['C1-1']);
  return { ...me, ...stall };
}

const firstRequest = async (cookies: Cookies) => (await myRequests(cookies)).json().requests[0];

describe('what a selected requester is told about paying', () => {
  test('names the amount before any payment letter has gone out', async () => {
    const { cookies, requestId } = await priyaWithAStall();

    // The gate this closes: the plan row is written by `freezePaymentPlan` when
    // the letter is sent, and nothing has sent one.
    expect(await prisma.stallPaymentPlan.findUnique({ where: { requestId } })).toBeNull();

    const { payment, pending } = await firstRequest(cookies);
    expect(pending.map((p: { step: string }) => p.step)).toContain('PAYMENT');
    expect(payment.feePaise).toBeGreaterThan(0);
    expect(payment.totalPaise).toBe(payment.feePaise + payment.depositPaise);
  });

  test('carries the arithmetic behind the fee, not just the total', async () => {
    // 🔴 A vendor querying their bill asks about the MULTIPLICATION — "why four
    // thousand?" — and this page used to carry the summed figure alone, so the
    // one question it exists to answer sent them back to the letter it
    // replaced.
    const { cookies } = await priyaWithAStall();

    const { payment } = await firstRequest(cookies);
    const keys = payment.breakdown.lines.map((l: { key: string }) => l.key);
    expect(keys).toContain('stall');
    expect(keys).toContain('plugs15a');
    // Every line carries its own count and unit rate, which is what the
    // multiplication is printed from.
    const stall = payment.breakdown.lines.find((l: { key: string }) => l.key === 'stall');
    expect(stall.count).toBeGreaterThan(0);
    expect(stall.unitRatePaise).toBeGreaterThan(0);
    // The lines and the GST add up to the fee above them.
    expect(payment.breakdown.netPaise + payment.breakdown.gstPaise).toBe(payment.feePaise);
    expect(payment.breakdown.gstPercent).toBe(18);
    // And the deposit arrives split the way it is refunded — a fine comes off
    // one half, unreturned furniture off the other.
    expect(payment.stallDepositPaise + payment.equipmentDepositPaise).toBe(payment.depositPaise);
  });

  test('a concession suppresses the breakdown rather than showing what was quoted', async () => {
    // 🔴 The lines add up to the CARD rate and `feePaise` is what the team
    // agreed to take instead. Sending both shows a trader the figure they were
    // talked down from — which is exactly what `payableFeePaise` exists to
    // avoid — and a breakdown that does not sum to the total above it is worse
    // than none.
    const { cookies, requestId } = await priyaWithAStall();
    expect((await firstRequest(cookies)).payment.breakdown).not.toBeNull();

    await setDiscretionaryFee(
      prisma,
      requestId,
      { discretionaryFeePaise: 500_000, reason: 'Local welfare — agreed by the department' },
      SYSTEM,
    );

    const { payment } = await firstRequest(cookies);
    expect(payment.feePaise).toBe(500_000);
    expect(payment.breakdown).toBeNull();
  });

  test('names the beneficiary the payment letter names', async () => {
    // 🔴 One copy of the bank identity, read by the letter and by this page.
    // Two copies is one bank change away from a letter and a page naming
    // different beneficiaries, and a transfer into a closed account is money
    // somebody has to trace.
    const { cookies } = await priyaWithAStall();
    const edition = await prisma.stallEdition.findFirstOrThrow({ where: { isActive: true } });

    // Nothing configured yet: the page names the accounts without inventing a
    // bank to go with them.
    expect((await firstRequest(cookies)).payment.beneficiary).toBeNull();

    await updateEditionSettings(
      prisma,
      edition.id,
      {
        name: edition.name,
        virtualAccountRentPrefix: edition.virtualAccountRentPrefix,
        virtualAccountDepositPrefix: edition.virtualAccountDepositPrefix,
        maxStallsPerRequest: edition.maxStallsPerRequest,
        beneficiaryName: 'ISHA FOUNDATION',
        bankName: 'HDFC Bank Ltd',
        bankIfsc: 'HDFC0004989',
      },
      SYSTEM,
    );

    const { beneficiary } = (await firstRequest(cookies)).payment;
    expect(beneficiary.accountName).toBe('ISHA FOUNDATION');
    expect(beneficiary.ifsc).toBe('HDFC0004989');
    // A line the team has not filled in is null, not a blank string — the page
    // leaves the row out rather than drawing an empty one.
    expect(beneficiary.branch).toBeNull();
  });

  test('asks for the agreed fee, not the rate the trader was talked down from', async () => {
    const { cookies, requestId } = await priyaWithAStall();
    const quoted = (await firstRequest(cookies)).payment.feePaise;

    await setDiscretionaryFee(
      prisma,
      requestId,
      { discretionaryFeePaise: 500_000, reason: 'Local welfare — agreed by the department' },
      SYSTEM,
    );

    const { payment } = await firstRequest(cookies);
    expect(quoted).not.toBe(500_000);
    expect(payment.feePaise).toBe(500_000);
    // ⚠️ The quoted figure is not returned beside it. The gap between the two is
    // the concession, and that is the team's to see.
    expect(Object.values(payment)).not.toContain(quoted);
  });

  test('the deposit never follows the concession', async () => {
    const { cookies, requestId } = await priyaWithAStall();
    const before = (await firstRequest(cookies)).payment.depositPaise;

    await setDiscretionaryFee(
      prisma,
      requestId,
      { discretionaryFeePaise: 1, reason: 'Hardship' },
      SYSTEM,
    );

    expect((await firstRequest(cookies)).payment.depositPaise).toBe(before);
  });

  test('paying what the page asks for actually clears the step', async () => {
    const { cookies, requestId } = await priyaWithAStall();
    await setDiscretionaryFee(
      prisma,
      requestId,
      { discretionaryFeePaise: 500_000, reason: 'Local welfare' },
      SYSTEM,
    );

    const asked = (await firstRequest(cookies)).payment.feePaise;
    expect(asked).toBe(500_000);

    // 🔴 The bug this replaced: `paymentConfirmed` settled against the QUOTED
    // fee, so a trader who paid the agreed 5,000 against a 10,000 quote sat in
    // "payment pending" for the rest of the edition — and now the page would
    // have been the thing that told them to pay it.
    await confirmPayment(
      prisma,
      requestId,
      {
        purpose: 'RENT',
        referenceNo: 'NEFT12345',
        amountPaise: asked,
        receivedOn: '2026-02-14',
        remitterName: 'GREEN LEAF',
        mode: 'NEFT',
      },
      SYSTEM,
    );

    const { pending } = await firstRequest(cookies);
    expect(pending.map((p: { step: string }) => p.step)).not.toContain('PAYMENT');
  });

  test('says nothing about money on a request that was never selected', async () => {
    const { cookies } = await seedRequester(app, 'nobody@example.org', 'hunter2hunter2', 'Nobody');
    expect((await myRequests(cookies)).json().requests).toEqual([]);
  });
});

describe('POST /public/requests/coupon', () => {
  test('issues a coupon to a vendor no backoffice member has touched', async () => {
    const { cookies, reference, requestId } = await priyaWithAStall();

    // The gate this closes: before, a coupon existed only once an admin pressed
    // Issue Coupon or the FSSAI-and-staff letter went out. So `staffExpected`
    // was 0, `pendingSteps` said nothing, and the vendor's team could not be
    // registered at all.
    const before = await firstRequest(cookies);
    expect(before.staff.coupons).toEqual([]);
    expect(before.pending.map((p: { step: string }) => p.step)).not.toContain('STAFF_REGISTRATION');

    const res = await getCoupon(cookies, { reference });
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toMatch(/^[A-Z]{3}-2026-[0-9A-Z]{8}$/);

    const after = await firstRequest(cookies);
    expect(after.staff.coupons).toHaveLength(1);
    expect(after.staff.coupons[0].code).toBe(res.json().code);
    expect(after.staff.coupons[0].capacity).toBe(8);
    expect(after.staff.coupons[0].registered).toBe(0);
    expect(after.staff.capacity).toBe(8);
    expect(after.staff.registered).toBe(0);
    expect(after.pending.map((p: { step: string }) => p.step)).toContain('STAFF_REGISTRATION');
    expect(await prisma.stallStaffCoupon.findFirst({ where: { requestId } })).not.toBeNull();
  });

  test('a coupon it issues actually registers staff', async () => {
    const { cookies, reference } = await priyaWithAStall();
    const { code } = (await getCoupon(cookies, { reference })).json();

    const res = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/public/staff-registration',
      payload: {
        couponCode: code,
        name: 'Murugan S',
        mobile: '9840011111',
        idType: 'AADHAAR',
        idNumber: '123412341234',
      },
    });
    expect(res.statusCode).toBe(201);
    const staff = (await firstRequest(cookies)).staff;
    expect(staff.registered).toBe(1);
    expect(staff.coupons[0].registered).toBe(1);
  });

  test('pressing it twice hands back the same coupon', async () => {
    const { cookies, reference } = await priyaWithAStall();

    const first = (await getCoupon(cookies, { reference })).json().code;
    const second = (await getCoupon(cookies, { reference })).json().code;

    // ⚠️ Load-bearing rather than tidy: a second code would leave every
    // registration made against the first counting towards nothing anybody is
    // looking at.
    expect(second).toBe(first);
    expect(await prisma.stallStaffCoupon.count()).toBe(1);
  });

  test('returns the coupon the letter already issued rather than a new one', async () => {
    const { cookies, reference, requestId } = await priyaWithAStall();
    const issued = await prisma.stallStaffCoupon.create({
      data: { requestId, code: 'GLO-2026-K7Q4M2X9', issuedBy: SYSTEM, capacity: 12 },
    });

    expect((await getCoupon(cookies, { reference })).json().code).toBe(issued.code);
    expect((await firstRequest(cookies)).staff.coupons[0].capacity).toBe(12);
  });

  test('answers 404 with no session', async () => {
    const { reference } = await priyaWithAStall();
    expect((await getCoupon({}, { reference })).statusCode).toBe(404);
  });

  test('another vendor’s reference reads exactly like one that does not exist', async () => {
    const priya = await priyaWithAStall();
    await seedRequester(app, 'other@example.org', 'hunter2hunter2', 'Other Vendor');
    const other = await selected(['C1-2'], {
      email: 'other@example.org',
      contactNumber: '9840099999',
      stallName: 'Other Stall',
    });

    const stranger = await getCoupon(priya.cookies, { reference: other.reference });
    const nonsense = await getCoupon(priya.cookies, { reference: 'VEN-2026-9999' });

    expect(stranger.statusCode).toBe(404);
    expect(nonsense.statusCode).toBe(404);
    expect(stranger.json()).toEqual(nonsense.json());
    // Nothing was minted for the stall they do not own.
    expect(await prisma.stallStaffCoupon.count()).toBe(0);
  });

  test('refuses a request that has not been selected', async () => {
    const { cookies } = await seedRequester(
      app,
      'hopeful@example.org',
      'hunter2hunter2',
      'Hopeful',
    );
    const submitted = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/public/requests',
      payload: (await import('./helpers/db')).vendorBody({
        email: 'hopeful@example.org',
        contactNumber: '9840088888',
      }),
      cookies,
    });
    const reference = submitted.json().reference;

    // A coupon on a request still under review would leak a decision this route
    // is not entitled to make or to hint at.
    expect((await getCoupon(cookies, { reference })).statusCode).toBe(404);
    expect(await prisma.stallStaffCoupon.count()).toBe(0);
  });
});

describe('the link and the session cannot disagree', () => {
  test('the emailed link reaches the same figures and the same coupon', async () => {
    const { cookies, reference, accountId } = await priyaWithAStall();
    const { code } = (await getCoupon(cookies, { reference })).json();

    const { mintAccessLink } = await import('../src/modules/stalls/accounts');
    const { token } = await mintAccessLink(prisma, { accountId, purpose: 'STATUS', ttlDays: 30 });

    const viaLink = (
      await app.inject({ method: 'GET', url: `/api/m/stalls/public/status/${token}` })
    ).json().requests[0];
    const viaSession = await firstRequest(cookies);

    expect(viaLink).toEqual(viaSession);
    expect(viaLink.staff.coupons[0].code).toBe(code);
  });

  test('the link can ask for a coupon too', async () => {
    const me = await seedRequester(app);
    const { reference } = await selected(['C1-1']);
    const { mintAccessLink } = await import('../src/modules/stalls/accounts');
    const { token } = await mintAccessLink(prisma, {
      accountId: me.accountId,
      purpose: 'STATUS',
      ttlDays: 30,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/public/status/${token}/coupon`,
      payload: { reference },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toMatch(/^[A-Z]{3}-2026-/);
  });
});
