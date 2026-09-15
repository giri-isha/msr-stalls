import { DEFAULT_STAFF_COUPON_CAPACITY, RegisterStaffInput } from '@msr/stalls';
import type { StallEdition } from '@prisma/client';
import { beforeEach, describe, expect, test } from 'vitest';
import { CouponFullError, UnknownCouponError } from '../src/modules/stalls/errors';
import {
  ensureCoupon,
  getOnboarding,
  listOnboarding,
  listStaffFor,
  registerStaff,
  removeStaff,
  resolveCoupon,
  setCouponCapacity,
  submitFssai,
  verifyFssai,
} from '../src/modules/stalls/onboarding';
import { presignUpload } from '../src/modules/stalls/uploads';
import { SYSTEM, prisma, resetDatabase, seedEdition } from './helpers/db';
import { selected, type TestDeps, testDeps } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let edition: StallEdition;
let deps: TestDeps;

beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5, LW_FOOD: 5 });
  deps = testDeps();
});

const couponFor = async (requestId: string) => {
  const r = await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } });
  return ensureCoupon(prisma, requestId, r.stallName, edition.year, SYSTEM);
};

const staffBody = (overrides: Record<string, unknown> = {}) =>
  RegisterStaffInput.parse({
    couponCode: 'PLACEHOLDER',
    name: 'Ravi Kumar',
    mobile: '9840055555',
    idType: 'AADHAAR',
    idNumber: '1234 5678 9012',
    ...overrides,
  });

describe('staff coupons', () => {
  test('a coupon carries the stall’s initials and the edition year', async () => {
    const { requestId } = await selected(['C1-1']);
    const coupon = await couponFor(requestId);
    expect(coupon.code).toMatch(/^GRE-2026-[0-9A-Z]{8}$/);
  });

  test('minting twice returns the same coupon', async () => {
    const { requestId } = await selected(['C1-1']);
    const a = await couponFor(requestId);
    const b = await couponFor(requestId);
    expect(b.code).toBe(a.code);
  });

  test('two stalls get different coupons even with the same initials', async () => {
    const a = await selected(['C1-1'], { email: 'a@x.example' });
    const b = await selected(['C1-2'], { email: 'b@x.example' });
    expect((await couponFor(a.requestId)).code).not.toBe((await couponFor(b.requestId)).code);
  });

  test('an unknown, malformed or revoked coupon all answer the same way', async () => {
    const { requestId } = await selected(['C1-1']);
    const coupon = await couponFor(requestId);

    await expect(resolveCoupon(prisma, 'nonsense')).rejects.toBeInstanceOf(UnknownCouponError);
    await expect(resolveCoupon(prisma, 'GRE-2026-ZZZZZZZZ')).rejects.toBeInstanceOf(
      UnknownCouponError,
    );

    await prisma.stallStaffCoupon.update({
      where: { requestId },
      data: { revokedAt: new Date() },
    });
    await expect(resolveCoupon(prisma, coupon.code)).rejects.toBeInstanceOf(UnknownCouponError);
  });

  test('a coupon stops working when the request stops being selected', async () => {
    const { requestId } = await selected(['C1-1']);
    const coupon = await couponFor(requestId);
    await prisma.stallRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
    await expect(resolveCoupon(prisma, coupon.code)).rejects.toBeInstanceOf(UnknownCouponError);
  });
});

describe('staff registration', () => {
  test('registers a person against the coupon’s stall', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 3 });
    const coupon = await couponFor(requestId);

    const view = await registerStaff(prisma, staffBody({ couponCode: coupon.code }));
    expect(view.registered).toBe(1);
    // 🔴 The coupon's own capacity, not the 3 this vendor asked for on a form
    // months earlier. Eight is the team's default and the back office moves it
    // case by case; the vendor's answer is a request, not the gate's rule.
    expect(view.maxStaff).toBe(DEFAULT_STAFF_COUPON_CAPACITY);
    expect(view.stallName).toBe('Green Leaf Organics');
  });

  test('keeps only the last four digits of an Aadhaar', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 3 });
    const coupon = await couponFor(requestId);
    await registerStaff(prisma, staffBody({ couponCode: coupon.code }));

    const [row] = await listStaffFor(prisma, requestId);
    expect(row.idNumber).toBe('9012');
  });

  test('stores another id type whole', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 3 });
    const coupon = await couponFor(requestId);
    await registerStaff(
      prisma,
      staffBody({ couponCode: coupon.code, idType: 'PASSPORT', idNumber: 'M1234567' }),
    );
    expect((await listStaffFor(prisma, requestId))[0].idNumber).toBe('M1234567');
  });

  test('masks the numbers on the list the whole team can see', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 3 });
    const coupon = await couponFor(requestId);
    const view = await registerStaff(prisma, staffBody({ couponCode: coupon.code }));
    expect(view.staff[0].mobile).toBe('98••••555');
    // Backoffice themselves see the full number.
    expect((await listStaffFor(prisma, requestId))[0].mobile).toBe('9840055555');
  });

  test('re-submitting the same person updates rather than inflating the count', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 3 });
    const coupon = await couponFor(requestId);
    await registerStaff(prisma, staffBody({ couponCode: coupon.code }));
    const view = await registerStaff(
      prisma,
      staffBody({ couponCode: coupon.code, name: 'Ravi K Kumar' }),
    );
    expect(view.registered).toBe(1);
    expect((await listStaffFor(prisma, requestId))[0].name).toBe('Ravi K Kumar');
  });

  test('refuses more staff than the coupon was raised for', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 1 });
    const coupon = await couponFor(requestId);
    await setCouponCapacity(prisma, requestId, 1, SYSTEM);

    await registerStaff(prisma, staffBody({ couponCode: coupon.code }));
    await expect(
      registerStaff(prisma, staffBody({ couponCode: coupon.code, mobile: '9840066666' })),
    ).rejects.toBeInstanceOf(CouponFullError);
  });

  // "If they want more staff members, in the back end we raise that capacity to
  // 10, 12." The raise has to take effect on a coupon already in a vendor's
  // hands, without minting a new code they would have to be sent again.
  test('the back office raises a coupon that is already out, and it lets more in', async () => {
    const { requestId } = await selected(['C1-1']);
    const coupon = await couponFor(requestId);
    await setCouponCapacity(prisma, requestId, 1, SYSTEM);
    await registerStaff(prisma, staffBody({ couponCode: coupon.code }));

    await setCouponCapacity(prisma, requestId, 2, SYSTEM);
    const view = await registerStaff(
      prisma,
      staffBody({ couponCode: coupon.code, mobile: '9840066666' }),
    );
    expect(view.registered).toBe(2);
    expect(view.maxStaff).toBe(2);
  });

  // ⚠️ A cap of zero is a cap, not an absence of one. Reading it as "unlimited"
  // is how a stall with eight passes registered eighty, and it would have been
  // every local welfare coupon, whose form never asks for a staff count.
  test('a capacity of zero admits nobody rather than everybody', async () => {
    const { requestId } = await selected(['C1-1']);
    const coupon = await couponFor(requestId);
    await setCouponCapacity(prisma, requestId, 0, SYSTEM);
    await expect(
      registerStaff(prisma, staffBody({ couponCode: coupon.code })),
    ).rejects.toBeInstanceOf(CouponFullError);
  });

  test('a backoffice member can be removed by the team', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 3 });
    const coupon = await couponFor(requestId);
    await registerStaff(prisma, staffBody({ couponCode: coupon.code }));
    const [row] = await listStaffFor(prisma, requestId);

    await removeStaff(prisma, row.id, SYSTEM);
    expect(await listStaffFor(prisma, requestId)).toEqual([]);
  });
});

describe('FSSAI', () => {
  const upload = async () => {
    const p = await presignUpload(deps.files, {
      purpose: 'FSSAI',
      fileName: 'cert.pdf',
      contentType: 'application/pdf',
      bytes: 5000,
    });
    return { key: p.key, name: 'cert.pdf' };
  };

  test('an upload lands against the request', async () => {
    const { requestId } = await selected(['C1-1']);
    await submitFssai(prisma, requestId, {
      stallName: 'Green Leaf Organics',
      files: [await upload()],
    });
    const row = await prisma.stallFssaiCertificate.findUniqueOrThrow({
      where: { requestId },
      include: { files: true },
    });
    expect(row.files).toHaveLength(1);
    expect(row.verifiedAt).toBeNull();
  });

  test('re-uploading clears a previous verification', async () => {
    const { requestId } = await selected(['C1-1']);
    await submitFssai(prisma, requestId, { stallName: 'X', files: [await upload()] });
    await verifyFssai(prisma, requestId, true, SYSTEM);
    expect(
      (await prisma.stallFssaiCertificate.findUniqueOrThrow({ where: { requestId } })).verifiedAt,
    ).not.toBeNull();

    await submitFssai(prisma, requestId, { stallName: 'X', files: [await upload()] });
    expect(
      (await prisma.stallFssaiCertificate.findUniqueOrThrow({ where: { requestId } })).verifiedAt,
    ).toBeNull();
  });

  test('re-uploading replaces the old files rather than piling up', async () => {
    const { requestId } = await selected(['C1-1']);
    await submitFssai(prisma, requestId, {
      stallName: 'X',
      files: [await upload(), await upload()],
    });
    await submitFssai(prisma, requestId, { stallName: 'X', files: [await upload()] });
    expect(await prisma.stallFssaiFile.count({ where: { requestId } })).toBe(1);
  });
});

describe('the onboarding table', () => {
  test('says what applies to whom rather than showing everything as pending', async () => {
    const vendor = await selected(['C1-1'], { passesStaff: 2 });
    const lw = await selected(['C1-6'], {
      requestType: 'LOCAL_WELFARE',
      email: 'lw@x.example',
      depositAcknowledged: true,
      stallType: 'NON_FOOD',
    });

    const rows = await listOnboarding(prisma, edition.id);
    const byId = new Map(rows.map((r) => [r.requestId, r]));

    expect(byId.get(vendor.requestId)?.bankDetails).toBe('PENDING');
    expect(byId.get(vendor.requestId)?.fssai).toBe('PENDING');
    // Local welfare is never asked for bank details, and a non-food stall is
    // never asked for FSSAI.
    expect(byId.get(lw.requestId)?.bankDetails).toBe('NOT_APPLICABLE');
    expect(byId.get(lw.requestId)?.fssai).toBe('NOT_APPLICABLE');
    expect(byId.get(lw.requestId)?.payment).toBe('PENDING');
  });

  test('a vendor with no GST registration is not left pending forever', async () => {
    const { requestId } = await selected(['C1-1']);
    await prisma.stallBankDetail.create({
      data: {
        requestId,
        email: 'a@x.example',
        invoiceName: 'X',
        accountHolder: 'X',
        mobile: '9840012345',
        address: 'A',
        pincode: '641114',
        bankName: 'B',
        branch: 'C',
        accountNumber: '123456',
        ifsc: 'HDFC0001234',
        panNumber: 'ABCDE1234F',
        gstNumber: 'NONE',
        chequeKey: 'k',
        panKey: 'k',
        agreedNeftAt: new Date(),
        agreedTermsAt: new Date(),
      },
    });
    const row = (await listOnboarding(prisma, edition.id)).find((r) => r.requestId === requestId);
    expect(row?.bankDetails).toBe('RECEIVED');
    expect(row?.gst).toBe('NOT_APPLICABLE');
  });

  test('the detail view hands back short-lived links, never raw keys', async () => {
    const { requestId } = await selected(['C1-1']);
    await prisma.stallBankDetail.create({
      data: {
        requestId,
        email: 'a@x.example',
        invoiceName: 'Green Leaf Organics Pvt Ltd',
        accountHolder: 'X',
        mobile: '9840012345',
        address: 'A',
        pincode: '641114',
        bankName: 'HDFC',
        branch: 'C',
        accountNumber: '123456',
        ifsc: 'HDFC0001234',
        panNumber: 'ABCDE1234F',
        gstNumber: '33ABCDE1234F1Z5',
        chequeKey: 'stalls/bank/cheque/x.jpg',
        panKey: 'stalls/bank/pan/y.pdf',
        agreedNeftAt: new Date(),
        agreedTermsAt: new Date(),
      },
    });

    const detail = await getOnboarding(prisma, requestId, deps.files);
    expect(detail.bank?.invoiceName).toBe('Green Leaf Organics Pvt Ltd');
    expect(detail.bank?.files).toHaveLength(2);
    expect(detail.bank?.files[0].url).toContain('https://store.test/view/');
  });

  test('the pending list is the same one the vendor and check-in see', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 2 });
    const pending = async () =>
      (await listOnboarding(prisma, edition.id))
        .find((r) => r.requestId === requestId)
        ?.pending.map((p) => p.step);

    // Staff registration is not pending on anybody until a coupon exists —
    // there is nothing for the vendor to do and no capacity to fill.
    expect(await pending()).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI']);

    await couponFor(requestId);
    expect(await pending()).toEqual(['BANK_FORM', 'PAYMENT', 'FSSAI', 'STAFF_REGISTRATION']);
  });
});
