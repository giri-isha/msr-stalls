// The steps open in an order the edition chooses.
//
// A selected requester used to be handed all four steps at once — bank details,
// payment, FSSAI and staff registration became outstanding together the moment
// SELECTED was written. `stall_flow_step` gives each step a stage number per
// requester type, and the lowest stage still outstanding is the only one the
// requester may act on.
//
// What these tests pin is that hiding is never the whole of it. The portal
// draws no tab for a locked step, but the form mint, the coupon, the staff
// registration route and the letters each have their own way in — a forwarded
// email, a saved URL — and every one of them refuses.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { sendTemplate } from '../src/modules/stalls/comms';
import { updateFlow } from '../src/modules/stalls/config';
import { refreshStage } from '../src/modules/stalls/facts';
import { ensureCoupon } from '../src/modules/stalls/onboarding';
import { LogMailer, prisma, resetDatabase, seedEdition, seedRequester, SYSTEM } from './helpers/db';
import { selected, testDeps } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let app: FastifyInstance;
let editionId: string;
const mail = new LogMailer();

beforeAll(async () => {
  app = await buildApp({ logger: false, mail, webOrigin: 'http://web.example' });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  const edition = await seedEdition();
  editionId = edition.id;
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
  mail.sent.length = 0;
});

const SWITCHES = { bankStepEnabled: true, paymentStepEnabled: true, fssaiStepEnabled: true };

const ALL_AT_ONCE = { BANK_FORM: 1, PAYMENT: 1, FSSAI: 1, STAFF_REGISTRATION: 1 };
const ONE_AT_A_TIME = { BANK_FORM: 1, PAYMENT: 2, FSSAI: 3, STAFF_REGISTRATION: 4 };

/** Numbers every requester type the same way, which is what the tests below
 *  care about; the per-type difference is covered in `@stalls/core`. */
const order = (stages: Record<string, number>) =>
  updateFlow(
    prisma,
    editionId,
    {
      ...SWITCHES,
      stages: {
        VENDOR: stages,
        LOCAL_WELFARE: stages,
        ASHRAM: stages,
      },
    } as Parameters<typeof updateFlow>[2],
    SYSTEM,
  );

type Cookies = Record<string, string>;

const firstRequest = async (cookies: Cookies) =>
  (await app.inject({ method: 'GET', url: '/api/m/stalls/public/requests', cookies })).json()
    .requests[0];

const openStep = (cookies: Cookies, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/m/stalls/public/requests/continue', payload, cookies });

const getCoupon = (cookies: Cookies, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/m/stalls/public/requests/coupon', payload, cookies });

async function priyaWithAStall() {
  const me = await seedRequester(app);
  const stall = await selected(['C1-1']);
  return { ...me, ...stall };
}

describe('what the requester is told', () => {
  test('all four open together when nothing is numbered apart', async () => {
    const { cookies } = await priyaWithAStall();
    await order(ALL_AT_ONCE);

    const { pending } = await firstRequest(cookies);
    expect(pending.map((p: { step: string }) => p.step)).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI']);
    // 🔴 Every one of them open — this is today's behaviour, and the default,
    // so an edition nobody has configured behaves exactly as it did.
    expect(pending.every((p: { open: boolean }) => p.open)).toBe(true);
  });

  test('a locked step stays in the list, marked shut and saying what opens it', async () => {
    const { cookies } = await priyaWithAStall();
    await order(ONE_AT_A_TIME);

    const { pending } = await firstRequest(cookies);
    const byStep = new Map(pending.map((p: { step: string }) => [p.step, p]));

    // ⚠️ The whole list is still sent. The requester reads the whole road; the
    // portal draws a tab only for the part they can walk.
    expect(byStep.get('BANK_FORM')).toMatchObject({ open: true, blockedBy: [] });
    expect(byStep.get('PAYMENT')).toMatchObject({ open: false, blockedBy: ['BANK_FORM'] });
    expect(byStep.get('FSSAI')).toMatchObject({ open: false, blockedBy: ['BANK_FORM'] });
  });

  test('the next step opens as the one before it is satisfied', async () => {
    const { cookies, requestId } = await priyaWithAStall();
    await order(ONE_AT_A_TIME);

    // ⚠️ The FACT is written directly. `bankDetailsReceived` is "a row exists",
    // and what the bank form validates is `bank.test.ts`'s subject — going
    // through it here would make this test fail for reasons about field rules.
    await prisma.stallBankDetail.create({
      data: { requestId, agreedNeftAt: new Date(), agreedTermsAt: new Date() },
    });
    await refreshStage(prisma, requestId);

    const { pending } = await firstRequest(cookies);
    const byStep = new Map(pending.map((p: { step: string }) => [p.step, p]));
    expect(byStep.has('BANK_FORM')).toBe(false);
    expect(byStep.get('PAYMENT')).toMatchObject({ open: true });
    expect(byStep.get('FSSAI')).toMatchObject({ open: false, blockedBy: ['PAYMENT'] });
  });
});

describe('hiding a step is never the whole of it', () => {
  test('the form link is refused for a step the ordering has not reached', async () => {
    const { cookies, reference } = await priyaWithAStall();
    await order(ONE_AT_A_TIME);

    // Bank details are open, so this one is minted.
    expect((await openStep(cookies, { reference, step: 'BANK_FORM' })).statusCode).toBe(200);

    // FSSAI is outstanding but numbered behind it. A 409, and the message names
    // what comes first — a requester told only "not open" goes looking for a
    // problem that does not exist.
    const blocked = await openStep(cookies, { reference, step: 'FSSAI' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toContain('BANK_FORM');
  });

  test('the coupon is refused — and not minted — while staff registration is locked', async () => {
    const { cookies, reference, requestId } = await priyaWithAStall();
    await order(ONE_AT_A_TIME);

    const blocked = await getCoupon(cookies, { reference });
    expect(blocked.statusCode).toBe(409);

    // 🔴 The refusal comes BEFORE the mint. `ensureCoupon` is a write, and a
    // coupon is its own credential: minting one and hiding the code would leave
    // a live code the staff route is about to refuse.
    expect(await prisma.stallStaffCoupon.count({ where: { requestId } })).toBe(0);
  });

  test('a coupon code from an old letter does not walk past the gate', async () => {
    const { requestId } = await priyaWithAStall();
    // Minted while everything was open…
    await order(ALL_AT_ONCE);
    const coupon = await ensureCoupon(prisma, requestId, 'Green Leaf', 2026, SYSTEM);
    // …and the ordering tightened afterwards.
    await order(ONE_AT_A_TIME);

    // This route is the reason hiding the portal tab is not enough: the code is
    // its own credential and never passes through the portal.
    const page = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/public/staff-registration/${coupon.code}`,
    });
    expect(page.statusCode).toBe(409);

    const post = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/public/staff-registration',
      payload: { couponCode: coupon.code, name: 'Ravi', mobile: '9876500022' },
    });
    expect(post.statusCode).toBe(409);
    expect(await prisma.stallVendorStaff.count({ where: { requestId } })).toBe(0);
  });
});

describe('the letters follow the same ordering', () => {
  const send = (templateKey: string, requestIds: string[]) =>
    sendTemplate(
      prisma,
      editionId,
      { templateKey, requestIds, channels: ['EMAIL'] } as Parameters<typeof sendTemplate>[2],
      testDeps({ mail }),
      SYSTEM,
    );

  test('the selection letter still goes out, without the link to a locked form', async () => {
    const { requestId } = await priyaWithAStall();
    // Bank details numbered behind payment, so the letter's own link is shut.
    await order({ BANK_FORM: 2, PAYMENT: 1, FSSAI: 3, STAFF_REGISTRATION: 4 });

    const out = await send('SELECTION_VENDOR', [requestId]);
    // 🔴 It SENDS. This is the letter that tells a vendor they were selected and
    // merely happens to carry the bank-form link; refusing it would mean a
    // selected vendor is never told they were selected.
    expect(out.sent).toEqual([requestId]);
    expect(await prisma.stallAccessLink.count({ where: { requestId, purpose: 'BANK_FORM' } })).toBe(
      0,
    );
  });

  test('a letter that is nothing but a locked step is not sent at all', async () => {
    const { requestId } = await priyaWithAStall();
    await order(ONE_AT_A_TIME);

    const out = await send('PAYMENT_DETAILS', [requestId]);
    expect(out.sent).toEqual([]);
    expect(out.skipped[0]?.reason).toContain('not open');
  });

  test('the FSSAI-and-staff letter mints no coupon while staff is locked', async () => {
    const { requestId } = await priyaWithAStall();
    // FSSAI open, staff behind it.
    await order({ BANK_FORM: 1, PAYMENT: 1, FSSAI: 1, STAFF_REGISTRATION: 2 });

    const out = await send('ONBOARDING_FSSAI_STAFF', [requestId]);
    // It carries two steps and one of them is open, so the letter goes.
    expect(out.sent).toEqual([requestId]);
    // ⚠️ But the coupon is a WRITE, and it does not happen.
    expect(await prisma.stallStaffCoupon.count({ where: { requestId } })).toBe(0);
  });

  test('all-at-once leaves every letter exactly as it was', async () => {
    const { requestId } = await priyaWithAStall();
    await order(ALL_AT_ONCE);

    expect((await send('SELECTION_VENDOR', [requestId])).sent).toEqual([requestId]);
    expect(
      await prisma.stallAccessLink.count({ where: { requestId, purpose: 'BANK_FORM' } }),
    ).toBeGreaterThan(0);
    expect((await send('ONBOARDING_FSSAI_STAFF', [requestId])).sent).toEqual([requestId]);
    expect(await prisma.stallStaffCoupon.count({ where: { requestId } })).toBe(1);
  });
});

describe('what the team still sees', () => {
  test('Onboarding keeps the whole picture of a stall, locked steps included', async () => {
    const { requestId } = await priyaWithAStall();
    await order(ONE_AT_A_TIME);

    const rows = await prisma.stallRequest.findMany({ where: { id: requestId } });
    expect(rows).toHaveLength(1);

    // 🔴 `pendingSteps` is untouched by the ordering. A stall waiting behind an
    // unpaid step must not read as "nothing else outstanding" on the Onboarding
    // table or at the check-in counter, and the derived stage must not come to
    // mean "done so far".
    const { flowFor } = await import('../src/modules/stalls/config');
    const { factsInclude, pendingFor } = await import('../src/modules/stalls/facts');
    const r = await prisma.stallRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: factsInclude,
    });
    const flow = await flowFor(prisma, editionId);
    expect(pendingFor(r, flow).map((p) => p.step)).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI']);
  });
});
