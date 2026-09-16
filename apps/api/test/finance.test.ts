import { rupeesToPaise } from '@msr/stalls';
import type { StallEdition } from '@prisma/client';
import { beforeEach, describe, expect, test } from 'vitest';
import { sendTemplate } from '../src/modules/stalls/comms';
import { DuplicatePaymentError, RefundAlreadySubmittedError } from '../src/modules/stalls/errors';
import {
  confirmPayment,
  deletePayment,
  listPayments,
  listRefunds,
  setVoucherRef,
  submitRefund,
} from '../src/modules/stalls/finance';
import { patchEquipment } from '../src/modules/stalls/equipment';
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

const rowFor = async (requestId: string) =>
  (await listPayments(prisma, edition.id)).find((r) => r.requestId === requestId);

const credit = (overrides: Record<string, unknown> = {}) => ({
  purpose: 'RENT' as const,
  referenceNo: 'NEFT12345',
  amountPaise: rupeesToPaise(25_960),
  receivedOn: '2026-02-14',
  mode: 'NEFT' as const,
  ...overrides,
});

describe('what is owed', () => {
  test('quotes a selected vendor from the live rate card', async () => {
    const { requestId } = await selected(['C1-1'], { plugs5a: 4, plugs15a: 5 });
    const row = await rowFor(requestId);
    expect(row?.quote.stallFeePaise).toBe(rupeesToPaise(15_000));
    expect(row?.quote.feeTotalPaise).toBe(rupeesToPaise(25_960));
    expect(row?.quote.depositTotalPaise).toBe(rupeesToPaise(4_000));
    expect(row?.quote.unpriced).toBe(false);
  });

  test('ashram departments are absent, not present with a row of zeros', async () => {
    await selected(['C1-1']);
    const { requestId } = await selected(['C1-2'], {
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
        // Required by the ashram FOOD form, and by nothing else. Since the form
        // definition became what the API validates against, omitting it is an
        // unanswered question rather than a field the contract will default.
        fssaiExpected: false,
      },
    });
    expect(await rowFor(requestId)).toBeUndefined();
  });

  test('once the payment email is out, Finance sees the frozen figure', async () => {
    const { requestId } = await selected(['C1-1']);
    await sendTemplate(
      prisma,
      edition.id,
      { templateKey: 'PAYMENT_DETAILS', requestIds: [requestId] },
      deps,
      SYSTEM,
    );
    const before = await rowFor(requestId);

    await prisma.stallRateCard.updateMany({
      where: { editionId: edition.id, zoneCode: 'C1', scope: 'VENDOR', isFood: true },
      data: { amountPaise: rupeesToPaise(99_999) },
    });
    const after = await rowFor(requestId);

    expect(after?.quote.stallFeePaise).toBe(before?.quote.stallFeePaise);
    expect(after?.paymentEmailSentAt).not.toBeNull();
  });

  test('a zone with no rate reads as unpriced, never as free', async () => {
    await makeStalls(edition.id, 'A3', { VENDOR_FOOD: 2 });
    const { requestId } = await selected(['A3-1'], { preferredZoneCode: 'A3' });
    const row = await rowFor(requestId);
    expect(row?.quote.unpriced).toBe(true);
    expect(row?.quote.feeTotalPaise).toBe(0);
  });
});

describe('confirming a payment', () => {
  test('records the reference, amount and credit date', async () => {
    const { requestId } = await selected(['C1-1'], { plugs5a: 4, plugs15a: 5 });
    await confirmPayment(prisma, requestId, credit({ remitterName: 'GREEN LEAF' }), SYSTEM);

    const row = await rowFor(requestId);
    expect(row?.records).toHaveLength(1);
    expect(row?.records[0].referenceNo).toBe('NEFT12345');
    expect(row?.records[0].receivedOn).toBe('2026-02-14');
    expect(row?.receivedRentPaise).toBe(rupeesToPaise(25_960));
  });

  test('the same reference cannot be entered twice', async () => {
    const { requestId } = await selected(['C1-1']);
    await confirmPayment(prisma, requestId, credit(), SYSTEM);
    await expect(confirmPayment(prisma, requestId, credit(), SYSTEM)).rejects.toBeInstanceOf(
      DuplicatePaymentError,
    );
  });

  test('rent and deposit settle separately and both are tracked', async () => {
    const { requestId } = await selected(['C1-1'], { plugs5a: 4, plugs15a: 5 });
    await confirmPayment(prisma, requestId, credit(), SYSTEM);
    await confirmPayment(
      prisma,
      requestId,
      credit({ purpose: 'DEPOSIT', referenceNo: 'NEFT99', amountPaise: rupeesToPaise(4_000) }),
      SYSTEM,
    );

    const row = await rowFor(requestId);
    expect(row?.receivedDepositPaise).toBe(rupeesToPaise(4_000));
    expect(row?.fullySettled).toBe(true);
  });

  test('a short payment does not count as settled', async () => {
    const { requestId } = await selected(['C1-1'], { plugs5a: 4, plugs15a: 5 });
    await confirmPayment(prisma, requestId, credit({ amountPaise: rupeesToPaise(1_000) }), SYSTEM);
    expect((await rowFor(requestId))?.fullySettled).toBe(false);
  });

  test('a mistaken entry can be removed', async () => {
    const { requestId } = await selected(['C1-1']);
    await confirmPayment(prisma, requestId, credit(), SYSTEM);
    const record = await prisma.stallPaymentRecord.findFirstOrThrow({ where: { requestId } });
    await deletePayment(prisma, record.id, SYSTEM);
    expect((await rowFor(requestId))?.records).toEqual([]);
  });

  test('confirming the rent moves a food stall on to the FSSAI step', async () => {
    const { requestId } = await selected(['C1-1'], { plugs5a: 4, plugs15a: 5 });
    await sendTemplate(
      prisma,
      edition.id,
      { templateKey: 'SELECTION_VENDOR', requestIds: [requestId] },
      deps,
      SYSTEM,
    );
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
    await sendTemplate(
      prisma,
      edition.id,
      { templateKey: 'PAYMENT_DETAILS', requestIds: [requestId] },
      deps,
      SYSTEM,
    );
    await confirmPayment(prisma, requestId, credit(), SYSTEM);

    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } })).stage).toBe(
      'FSSAI_PENDING',
    );
  });
});

describe('refunds', () => {
  const deposit = (requestId: string) =>
    confirmPayment(
      prisma,
      requestId,
      credit({ purpose: 'DEPOSIT', referenceNo: 'DEP1', amountPaise: rupeesToPaise(8_000) }),
      SYSTEM,
    );

  test('suggests a deduction from what the chairs counter recorded', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6, tablesNeeded: 2 });
    await deposit(requestId);
    await patchEquipment(
      prisma,
      requestId,
      { missingChairs: 2, missingTables: 1, damaged: true },
      SYSTEM,
    );

    const row = (await listRefunds(prisma, edition.id)).find((r) => r.requestId === requestId);
    // 2 × Rs.400 + 1 × Rs.900 + Rs.250 damage
    expect(row?.suggestedEquipmentDeductionPaise).toBe(rupeesToPaise(1_950));
    expect(row?.depositHeldPaise).toBe(rupeesToPaise(8_000));
  });

  test('the team may overrule the suggestion', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6 });
    await deposit(requestId);
    await patchEquipment(prisma, requestId, { missingChairs: 2 }, SYSTEM);

    const out = await submitRefund(
      prisma,
      requestId,
      {
        equipmentDeductionPaise: rupeesToPaise(500),
        fineTypeIds: [],
        extraFinePaise: 0,
      },
      SYSTEM,
    );
    expect(out.equipmentDeductionPaise).toBe(rupeesToPaise(500));
    expect(out.refundDuePaise).toBe(rupeesToPaise(7_500));
  });

  test('a ticked fine is itemised on the row, not just summed', async () => {
    const { requestId } = await selected(['C1-1']);
    await deposit(requestId);
    const fine = await prisma.stallFineType.findFirstOrThrow({
      where: { editionId: edition.id, reason: 'Unclean stall' },
    });

    const out = await submitRefund(
      prisma,
      requestId,
      { equipmentDeductionPaise: 0, fineTypeIds: [fine.id], extraFinePaise: 0 },
      SYSTEM,
    );
    expect(out.fines).toEqual([{ reason: 'Unclean stall', amountPaise: rupeesToPaise(500) }]);
    expect(out.refundDuePaise).toBe(rupeesToPaise(7_500));
  });

  test('a one-off fine can be added beside the configured ones', async () => {
    const { requestId } = await selected(['C1-1']);
    await deposit(requestId);
    const out = await submitRefund(
      prisma,
      requestId,
      {
        equipmentDeductionPaise: 0,
        fineTypeIds: [],
        extraFinePaise: rupeesToPaise(1_000),
        extraFineReason: 'Blocked the fire lane',
      },
      SYSTEM,
    );
    expect(out.fines).toEqual([
      { reason: 'Blocked the fire lane', amountPaise: rupeesToPaise(1_000) },
    ]);
  });

  test('deductions beyond the deposit floor the refund and keep the shortfall visible', async () => {
    // Everything lost on both counts: nothing comes back, and the excess on each
    // deposit is carried rather than rounded away.
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6, tablesNeeded: 2 });
    await deposit(requestId);
    const out = await submitRefund(
      prisma,
      requestId,
      {
        equipmentDeductionPaise: rupeesToPaise(6_000),
        fineTypeIds: [],
        extraFinePaise: rupeesToPaise(6_000),
        extraFineReason: 'Stall left uncleaned',
      },
      SYSTEM,
    );
    expect(out.refundDuePaise).toBe(0);
    expect(out.shortfallPaise).toBe(rupeesToPaise(4_000));
  });

  test('an over-run on one deposit does not eat the other', async () => {
    // 🔴 The requirement charges each deduction to its own deposit: "the chairs
    // & tables not returned and damaged ... deducted from deposit against chairs
    // and tables", "any penalty against unclean stalls ... deducted from stall
    // deposit". Pooled, this stall's ₹2,000 furniture over-run would have been
    // taken out of the stall deposit — the vendor's money — and reported no
    // shortfall, so nobody would have chased it either.
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6, tablesNeeded: 2 });
    await deposit(requestId);
    const out = await submitRefund(
      prisma,
      requestId,
      { equipmentDeductionPaise: rupeesToPaise(6_000), fineTypeIds: [], extraFinePaise: 0 },
      SYSTEM,
    );
    expect(out.equipmentDepositPaise).toBe(rupeesToPaise(4_000));
    expect(out.stallDepositPaise).toBe(rupeesToPaise(4_000));
    expect(out.equipmentRefundPaise).toBe(0);
    expect(out.equipmentShortfallPaise).toBe(rupeesToPaise(2_000));
    // The stall deposit comes back whole.
    expect(out.stallRefundPaise).toBe(rupeesToPaise(4_000));
    expect(out.refundDuePaise).toBe(rupeesToPaise(4_000));
    expect(out.shortfallPaise).toBe(rupeesToPaise(2_000));
  });

  test('a submitted refund is frozen', async () => {
    const { requestId } = await selected(['C1-1']);
    await deposit(requestId);
    await submitRefund(
      prisma,
      requestId,
      { equipmentDeductionPaise: 0, fineTypeIds: [], extraFinePaise: 0 },
      SYSTEM,
    );
    await expect(
      submitRefund(
        prisma,
        requestId,
        { equipmentDeductionPaise: rupeesToPaise(1_000), fineTypeIds: [], extraFinePaise: 0 },
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(RefundAlreadySubmittedError);
  });

  test('Finance records the voucher number once it has paid', async () => {
    const { requestId } = await selected(['C1-1']);
    await deposit(requestId);
    await submitRefund(
      prisma,
      requestId,
      { equipmentDeductionPaise: 0, fineTypeIds: [], extraFinePaise: 0 },
      SYSTEM,
    );
    await setVoucherRef(prisma, requestId, 'VCH-2026-0012', SYSTEM);

    const row = (await listRefunds(prisma, edition.id)).find((r) => r.requestId === requestId);
    expect(row?.voucherRef).toBe('VCH-2026-0012');
    expect(row?.submittedAt).not.toBeNull();
  });
});

describe('a zone with no rate', () => {
  test('never reads as settled — nothing is known about what is owed', async () => {
    // A3 is closed to TRADE. A vendor standing in it is the case with no rate.
    await makeStalls(edition.id, 'A3', { VENDOR_FOOD: 2 });
    const { requestId } = await selected(['A3-1'], { preferredZoneCode: 'A3' });
    const row = (await listPayments(prisma, edition.id)).find((r) => r.requestId === requestId);
    expect(row?.quote.unpriced).toBe(true);
    expect(row?.fullySettled).toBe(false);
  });

  // 🔴 The same bay, the same ground, a different requester — and a figure
  // rather than nothing. A3 and B2 carry the VAP traders, who pay the most of
  // any local welfare stall; quoting them nothing is what left the stalls that
  // pay the most unbillable all edition.
  test('the same bay IS priced for local welfare, and can settle', async () => {
    await makeStalls(edition.id, 'A3', { LW_FOOD: 2 });
    const { requestId } = await selected(['A3-1'], {
      requestType: 'LOCAL_WELFARE',
      depositAcknowledged: true,
      preferredZoneCode: 'A3',
    });
    const row = (await listPayments(prisma, edition.id)).find((r) => r.requestId === requestId);
    expect(row?.quote.unpriced).toBe(false);
    expect(row?.quote.stallFeePaise).toBeGreaterThan(0);
  });
});
