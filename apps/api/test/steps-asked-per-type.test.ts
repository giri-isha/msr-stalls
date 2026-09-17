// Which steps are asked is a question about the REQUESTER TYPE.
//
// The Flow Builder's three switches were edition-wide. They could say "this
// edition does not do FSSAI"; they could not say "we do not ask an ashram for
// FSSAI, and we do not ask a local welfare stall to register staff", which is
// the question the stall team actually asks. The answer now lives per type, per
// step, beside the stage number that says when the step opens.
//
// What these tests pin is that OFF MEANS OFF on every way in. A step switched
// off for a type is gone from the portal, refused by the writers the backoffice
// shares with the public forms, refused by a coupon code forwarded from an old
// letter, and left out of the letters — and still asked, untouched, of the
// other two types.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { submitBankDetails } from '../src/modules/stalls/bank';
import { sendTemplate } from '../src/modules/stalls/comms';
import { flowFor, flowView, updateFlow } from '../src/modules/stalls/config';
import { StepNotOpenError } from '../src/modules/stalls/errors';
import { factsInclude, pendingFor } from '../src/modules/stalls/facts';
import { ensureCoupon } from '../src/modules/stalls/onboarding';
import { submitPaymentClaim } from '../src/modules/stalls/payment-claims';
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
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5, ASHRAM_FOOD: 5 });
  mail.sent.length = 0;
});

const EVERY_STEP = {
  BANK_FORM: true,
  PAYMENT: true,
  FSSAI: true,
  STAFF_REGISTRATION: true,
} as const;

/** Switches steps off for ONE requester type, leaving the other two asking
 *  everything — which is the shape every test here needs, because the claim
 *  being made is always about one type and not about the edition. */
const askOf = (
  type: 'VENDOR' | 'LOCAL_WELFARE' | 'ASHRAM',
  off: Partial<Record<keyof typeof EVERY_STEP, boolean>>,
) =>
  updateFlow(
    prisma,
    editionId,
    {
      asked: {
        VENDOR: { ...EVERY_STEP },
        LOCAL_WELFARE: { ...EVERY_STEP },
        ASHRAM: { ...EVERY_STEP },
        [type]: { ...EVERY_STEP, ...off },
      },
    } as Parameters<typeof updateFlow>[2],
    SYSTEM,
  );

/** The 2025 ashram sheet's answers, as `comms.test.ts` files them. */
const ASHRAM_BODY = {
  requestType: 'ASHRAM',
  email: 'dept@ashram.example',
  ashram: {
    departmentHead: 'R Iyer',
    departmentHeadContact: '9840011111',
    department: 'Annadanam',
    requestedBy: 'S Kumar',
    requesterContact: '9840022222',
    creditCardNeeded: false,
    usage: 'DEPT_SALES',
    wantsThembu: false,
    fssaiExpected: false,
  },
};

const pendingOf = async (requestId: string) => {
  const r = await prisma.stallRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: factsInclude,
  });
  return pendingFor(r, await flowFor(prisma, editionId)).map((p) => p.step);
};

describe('a step is switched off for one type and not the others', () => {
  test('the ashram stops being asked for FSSAI while the vendor beside it still is', async () => {
    const ashram = await selected(['C1-6'], ASHRAM_BODY);
    const vendor = await selected(['C1-1'], { email: 'priya@greenleaf.example' });
    await askOf('ASHRAM', { FSSAI: false });

    expect(await pendingOf(ashram.requestId)).not.toContain('FSSAI');
    // 🔴 The other type is untouched. An edition-wide switch could only have
    // taken FSSAI off both, which is the whole reason the answer moved here.
    expect(await pendingOf(vendor.requestId)).toContain('FSSAI');
  });

  test('staff registration can be switched off, which it never used to be', async () => {
    // ⚠️ The rule it was exempted by — "an unregistered person cannot be let
    // onto the venue" — is a fact about a vendor's outside workers, not about an
    // ashram department whose people are already on campus.
    const { requestId } = await selected(['C1-6'], ASHRAM_BODY);
    await ensureCoupon(prisma, requestId, 'Annadanam', 2026, SYSTEM);
    expect(await pendingOf(requestId)).toContain('STAFF_REGISTRATION');

    await askOf('ASHRAM', { STAFF_REGISTRATION: false });
    expect(await pendingOf(requestId)).not.toContain('STAFF_REGISTRATION');
  });

  test('an edition nobody has configured asks everything, exactly as before', async () => {
    const { requestId } = await selected(['C1-1']);
    expect(await pendingOf(requestId)).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI']);
  });
});

describe('off means off on every way in', () => {
  test('the bank form refuses, through the one writer the backoffice shares', async () => {
    const { requestId } = await selected(['C1-1']);
    await askOf('VENDOR', { BANK_FORM: false });

    // 🔴 `submitBankDetails` is what both the public form and filing-on-behalf
    // come through, so this is one refusal covering both doors.
    await expect(
      submitBankDetails(
        prisma,
        requestId,
        { agreedNeft: true, agreedTerms: true } as unknown as Parameters<
          typeof submitBankDetails
        >[2],
        { actor: { kind: 'SYSTEM' } },
      ),
    ).rejects.toThrow(StepNotOpenError);
  });

  test('a payment claim refuses for a type this edition does not charge', async () => {
    const { requestId } = await selected(['C1-1']);
    await askOf('VENDOR', { PAYMENT: false });

    await expect(
      submitPaymentClaim(
        prisma,
        requestId,
        {
          purpose: 'RENT',
          referenceNo: 'NEFT12341234',
          amountPaise: 100_000,
          paidOn: '2026-01-05',
        } as Parameters<typeof submitPaymentClaim>[2],
        { actor: { kind: 'SYSTEM' } },
      ),
    ).rejects.toThrow(StepNotOpenError);
  });

  test('no coupon is minted for a type that is not asked to register staff', async () => {
    const { requestId } = await selected(['C1-6'], ASHRAM_BODY);
    await askOf('ASHRAM', { STAFF_REGISTRATION: false });

    // 🔴 On the MINT, not on the routes above it. A coupon is its own
    // credential, so a code that exists is a way in whatever screen made it —
    // and there are five screens that make one.
    await expect(ensureCoupon(prisma, requestId, 'Annadanam', 2026, SYSTEM)).rejects.toThrow(
      StepNotOpenError,
    );
    expect(await prisma.stallStaffCoupon.count({ where: { requestId } })).toBe(0);
  });

  test('a coupon minted before the switch stops working after it', async () => {
    const { requestId } = await selected(['C1-6'], ASHRAM_BODY);
    const coupon = await ensureCoupon(prisma, requestId, 'Annadanam', 2026, SYSTEM);
    await askOf('ASHRAM', { STAFF_REGISTRATION: false });

    // ⚠️ This route is why hiding a tab is never enough: the code never passes
    // through the portal, and one forwarded from a letter sent months ago
    // reaches the form on its own.
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

  test('the vendor’s own Get Your Coupon button refuses too', async () => {
    const { cookies } = await seedRequester(app);
    const { reference } = await selected(['C1-1']);
    await askOf('VENDOR', { STAFF_REGISTRATION: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/public/requests/coupon',
      payload: { reference },
      cookies,
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('the letters leave out what is not asked', () => {
  const send = (templateKey: string, requestIds: string[]) =>
    sendTemplate(
      prisma,
      editionId,
      { templateKey, requestIds, channels: ['EMAIL'] } as Parameters<typeof sendTemplate>[2],
      testDeps({ mail }),
      SYSTEM,
    );

  test('the ashram selection letter still goes out, carrying no coupon', async () => {
    const { requestId } = await selected(['C1-6'], ASHRAM_BODY);
    await askOf('ASHRAM', { STAFF_REGISTRATION: false });

    const out = await send('SELECTION_ASHRAM', [requestId]);
    // 🔴 It SENDS. This is the letter that tells a department it was selected
    // and merely happens to carry a coupon; refusing it would mean nobody is
    // told, in the name of not offering a step.
    expect(out.sent).toEqual([requestId]);
    expect(await prisma.stallStaffCoupon.count({ where: { requestId } })).toBe(0);
  });

  test('a letter whose every step is switched off is refused', async () => {
    const { requestId } = await selected(['C1-6'], ASHRAM_BODY);
    await askOf('ASHRAM', { FSSAI: false, STAFF_REGISTRATION: false });

    const out = await send('ONBOARDING_FSSAI_STAFF', [requestId]);
    expect(out.sent).toEqual([]);
    expect(out.skipped[0]?.reason).toContain('not open');
  });
});

describe('what the Admin screen saves and reads back', () => {
  test('the grid is written per type and read back per type', async () => {
    await askOf('LOCAL_WELFARE', { STAFF_REGISTRATION: false });

    const flow = await flowFor(prisma, editionId);
    expect(flow.asked.LOCAL_WELFARE.STAFF_REGISTRATION).toBe(false);
    expect(flow.asked.VENDOR.STAFF_REGISTRATION).toBe(true);
    expect(flow.asked.ASHRAM.STAFF_REGISTRATION).toBe(true);
  });

  test('saving the switches leaves the ordering alone, and the reverse', async () => {
    const stages = { BANK_FORM: 1, PAYMENT: 2, FSSAI: 3, STAFF_REGISTRATION: 4 };
    await updateFlow(
      prisma,
      editionId,
      {
        stages: { VENDOR: stages, LOCAL_WELFARE: stages, ASHRAM: stages },
      } as Parameters<typeof updateFlow>[2],
      SYSTEM,
    );
    await askOf('VENDOR', { FSSAI: false });

    // ⚠️ Half a payload must not reset the other half. A caller flipping one
    // switch would otherwise silently renumber the whole grid to all-at-once.
    const flow = await flowFor(prisma, editionId);
    expect(flow.stages.VENDOR).toEqual(stages);
    expect(flow.asked.VENDOR.FSSAI).toBe(false);
  });

  test('a page served before this change still says what it meant', async () => {
    // ⚠️ The web and the API deploy separately. Such a page PUTs the three
    // booleans and nothing else, and it means them for every requester type,
    // because that is all it could ever mean.
    await updateFlow(
      prisma,
      editionId,
      {
        bankStepEnabled: true,
        paymentStepEnabled: true,
        fssaiStepEnabled: false,
      } as Parameters<typeof updateFlow>[2],
      SYSTEM,
    );

    const flow = await flowFor(prisma, editionId);
    expect(flow.asked.VENDOR.FSSAI).toBe(false);
    expect(flow.asked.LOCAL_WELFARE.FSSAI).toBe(false);
    expect(flow.asked.ASHRAM.FSSAI).toBe(false);
  });

  test('the read carries the three booleans, derived, for such a page to render', async () => {
    await askOf('ASHRAM', { FSSAI: false });

    const view = await flowView(prisma, editionId);
    // "Asked of ANY type" is the truthful summary for a control that cannot say
    // anything finer: FSSAI is off for one type only, so that page reads it on.
    expect(view.fssaiStepEnabled).toBe(true);

    await updateFlow(
      prisma,
      editionId,
      {
        asked: {
          VENDOR: { ...EVERY_STEP, FSSAI: false },
          LOCAL_WELFARE: { ...EVERY_STEP, FSSAI: false },
          ASHRAM: { ...EVERY_STEP, FSSAI: false },
        },
      } as Parameters<typeof updateFlow>[2],
      SYSTEM,
    );
    expect((await flowView(prisma, editionId)).fssaiStepEnabled).toBe(false);
  });

  test('the change is audited with what was asked', async () => {
    await askOf('ASHRAM', { FSSAI: false });
    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { editionId, action: 'stall_flow.updated' },
    });
    expect(
      (row.detail as { asked: Record<string, Record<string, boolean>> }).asked.ASHRAM.FSSAI,
    ).toBe(false);
  });
});
