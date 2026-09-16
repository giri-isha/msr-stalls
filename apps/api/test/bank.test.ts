import { SubmitBankDetailsInput } from '@stalls/core';
import type { StallEdition } from '@prisma/client';
import { beforeEach, describe, expect, test } from 'vitest';
import { getBankForm, submitBankDetails } from '../src/modules/stalls/bank';
import { declarationsForForm } from '../src/modules/stalls/declarations';
import { DeclarationsChangedError } from '../src/modules/stalls/errors';
import { sendTemplate } from '../src/modules/stalls/comms';
import {
  BankDetailsLockedError,
  StepNotOpenError,
  UploadsUnavailableError,
} from '../src/modules/stalls/errors';
import { updateFlow } from '../src/modules/stalls/config';
import { presignUpload, UnsupportedFileTypeError, isOurKey } from '../src/modules/stalls/uploads';
import { SYSTEM, prisma, resetDatabase, seedEdition } from './helpers/db';
import { fakeStore, selected, type TestDeps, testDeps } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let edition: StallEdition;
let deps: TestDeps;

beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
  deps = testDeps();
});

/** Two real presigned keys, the way the browser gets them. */
async function keys() {
  const cheque = await presignUpload(deps.files, {
    purpose: 'BANK_CHEQUE',
    fileName: 'cheque.jpg',
    contentType: 'image/jpeg',
    bytes: 120_000,
  });
  const pan = await presignUpload(deps.files, {
    purpose: 'BANK_PAN',
    fileName: 'pan.pdf',
    contentType: 'application/pdf',
    bytes: 90_000,
  });
  return { chequeKey: cheque.key, panKey: pan.key };
}

async function body(overrides: Record<string, unknown> = {}) {
  return SubmitBankDetailsInput.parse({
    ...(await keys()),
    email: 'priya@greenleaf.example',
    invoiceName: 'Green Leaf Organics Pvt Ltd',
    accountHolder: 'Green Leaf Organics Pvt Ltd',
    mobile: '9840012345',
    address: '12 Mettupalayam Road, Coimbatore',
    pincode: '641043',
    bankName: 'HDFC Bank',
    branch: 'RS Puram',
    accountNumber: '50100123456789',
    ifsc: 'HDFC0001234',
    micr: '641240002',
    panNumber: 'ABCDE1234F',
    gstNumber: '33ABCDE1234F1Z5',
    plugs5a: 4,
    plugs15a: 5,
    gasStoves: 1,
    appliances: [{ name: 'Deep fryer', watts: 2500 }],
    tablesNeeded: 2,
    chairsNeeded: 6,
    passes2w: 1,
    passes4w: 1,
    passesStaff: 3,
    ...overrides,
  });
}

describe('uploads', () => {
  test('a key is minted from a UUID, never from what the vendor called the file', async () => {
    const out = await presignUpload(deps.files, {
      purpose: 'BANK_CHEQUE',
      fileName: '../../etc/passwd.jpg',
      contentType: 'image/jpeg',
      bytes: 1000,
    });
    expect(out.key).not.toContain('passwd');
    expect(out.key).not.toContain('..');
    expect(out.key.startsWith('stalls/bank/cheque/')).toBe(true);
    expect(isOurKey(out.key, 'BANK_CHEQUE')).toBe(true);
  });

  test('a key minted for one purpose is not accepted for another', async () => {
    const out = await presignUpload(deps.files, {
      purpose: 'FSSAI',
      fileName: 'cert.pdf',
      contentType: 'application/pdf',
      bytes: 1000,
    });
    expect(isOurKey(out.key, 'FSSAI')).toBe(true);
    expect(isOurKey(out.key, 'BANK_PAN')).toBe(false);
  });

  test('only images and PDFs get through', async () => {
    await expect(
      presignUpload(deps.files, {
        purpose: 'FSSAI',
        fileName: 'x.html',
        contentType: 'text/html',
        bytes: 100,
      }),
    ).rejects.toBeInstanceOf(UnsupportedFileTypeError);
  });

  test('an unconfigured store says so rather than throwing a credential error', async () => {
    const off = { ...fakeStore(), configured: () => false };
    await expect(
      presignUpload(off, {
        purpose: 'FSSAI',
        fileName: 'x.pdf',
        contentType: 'application/pdf',
        bytes: 10,
      }),
    ).rejects.toBeInstanceOf(UploadsUnavailableError);
  });
});

describe('the bank form', () => {
  test('prefills what the vendor asked for at request time', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 4, passesStaff: 2 });
    const view = await getBankForm(prisma, requestId);
    expect(view.stallNumbers).toEqual(['C1-1']);
    expect(view.current.chairsNeeded).toBe(4);
    expect(view.submittedAt).toBeNull();
  });

  test('carries the terms the vendor is asked to accept', async () => {
    // 🔴 This form records `agreedTermsAt`. Without the document beside the
    // tick-box the requester accepts terms they were never shown, which is the
    // one consent here that has to be producible if a stall is in dispute.
    const { requestId } = await selected(['C1-1']);
    expect((await getBankForm(prisma, requestId)).termsUrl).toBeNull();

    const r = await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } });
    await prisma.stallEdition.update({
      where: { id: r.editionId },
      data: { termsUrl: 'https://isha.test/terms-2026.pdf' },
    });
    expect((await getBankForm(prisma, requestId)).termsUrl).toBe(
      'https://isha.test/terms-2026.pdf',
    );
  });

  test('stores the details and overwrites the stale requirements', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 0, plugs5a: 0, passesStaff: 0 });
    await submitBankDetails(prisma, requestId, await body());

    const saved = await prisma.stallBankDetail.findUniqueOrThrow({ where: { requestId } });
    expect(saved.ifsc).toBe('HDFC0001234');
    expect(saved.accountNumber).toBe('50100123456789');

    // The February answers replace the November ones, everywhere they are read.
    const r = await prisma.stallRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { appliances: true },
    });
    expect(r.chairsNeeded).toBe(6);
    expect(r.plugs5a).toBe(4);
    expect(r.passesStaff).toBe(3);
    expect(r.appliances.map((a) => a.name)).toEqual(['Deep fryer']);
  });

  test('appliances are replaced, not merged — a dropped fryer stays dropped', async () => {
    const { requestId } = await selected(['C1-1'], {
      appliances: [
        { name: 'Old fryer', watts: 3000 },
        { name: 'Old griller', watts: 2000 },
      ],
    });
    await submitBankDetails(prisma, requestId, await body({ appliances: [] }));
    expect(await prisma.stallRequestAppliance.count({ where: { requestId } })).toBe(0);
  });

  test('a second submission is refused — bank details change by phone call', async () => {
    const { requestId } = await selected(['C1-1']);
    await submitBankDetails(prisma, requestId, await body());
    await expect(submitBankDetails(prisma, requestId, await body())).rejects.toBeInstanceOf(
      BankDetailsLockedError,
    );
  });

  test('a key the module never issued is refused', async () => {
    const { requestId } = await selected(['C1-1']);
    await expect(
      submitBankDetails(
        prisma,
        requestId,
        await body({ chequeKey: 'stalls/bank/cheque/../x.jpg' }),
      ),
    ).rejects.toBeInstanceOf(StepNotOpenError);
  });

  test('the form is closed when an admin switches the bank step off', async () => {
    const { requestId } = await selected(['C1-1']);
    await updateFlow(
      prisma,
      edition.id,
      { bankStepEnabled: false, paymentStepEnabled: true, fssaiStepEnabled: true },
      SYSTEM,
    );
    await expect(submitBankDetails(prisma, requestId, await body())).rejects.toBeInstanceOf(
      StepNotOpenError,
    );
  });

  test('a local welfare stall is never asked for bank details', async () => {
    const { requestId } = await selected(['C1-2'], {
      requestType: 'LOCAL_WELFARE',
      email: 'lw@x.example',
      depositAcknowledged: true,
    });
    await expect(submitBankDetails(prisma, requestId, await body())).rejects.toBeInstanceOf(
      StepNotOpenError,
    );
  });

  test('submitting moves the request on to the payment step', async () => {
    const { requestId } = await selected(['C1-1']);
    await sendTemplate(
      prisma,
      edition.id,
      { templateKey: 'SELECTION_VENDOR', requestIds: [requestId] },
      deps,
      SYSTEM,
    );
    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } })).stage).toBe(
      'BANK_FORM_SENT',
    );

    await submitBankDetails(prisma, requestId, await body());
    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } })).stage).toBe(
      'BANK_FORM_FILLED',
    );
  });
});

describe('what the form accepts', () => {
  const parse = async (overrides: Record<string, unknown>) =>
    SubmitBankDetailsInput.safeParse({ ...(await body()), ...overrides });

  test('an IFSC that is not an IFSC is rejected with a message that names the shape', async () => {
    const r = await parse({ ifsc: 'HDFC1234' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toContain('11-character IFSC');
  });

  test('PAN and pincode are checked', async () => {
    expect((await parse({ panNumber: 'ABC1234' })).success).toBe(false);
    expect((await parse({ pincode: '64104' })).success).toBe(false);
  });

  test("'None' is a valid GST number, exactly as the 2025 form says", async () => {
    const r = await parse({ gstNumber: 'none' });
    expect(r.success).toBe(true);
    expect(r.data?.gstNumber).toBe('NONE');
  });

  /** 🔴 The NEFT and terms agreements used to be `z.literal(true)` here, with
   *  their wording in JSX and their record two bare timestamps. They are
   *  declaration rows now, so what the CONTRACT enforces is the shape of the
   *  ids — the wording, and whether it is still the wording that was on screen,
   *  is enforced by `submitBankDetails` against the live rows. */
  test('declaration ids must be uuids, and the list is optional', async () => {
    expect((await parse({ declarationIds: ['not-a-uuid'] })).success).toBe(false);
    expect((await parse({ declarationIds: [] })).success).toBe(true);
    // ⚠️ Absent is not a claim about what was displayed and must pass — the
    // seed and every server-side caller send nothing.
    expect((await parse({})).data?.declarationIds).toBeUndefined();
  });
});

describe('consent', () => {
  /** 🔴 The whole point: the bank form's consents are versioned rows now, and
   *  submitting records one per live declaration against THIS form. */
  test('a submission records a consent per live bank declaration', async () => {
    const { requestId } = await selected(['C1-1']);
    const live = await declarationsForForm(prisma, edition.id, 'BANK');
    expect(live.length).toBeGreaterThan(0);

    await submitBankDetails(prisma, requestId, {
      ...(await body()),
      declarationIds: live.map((d) => d.id),
    });

    const rows = await prisma.stallDeclarationConsent.findMany({
      where: { requestId, formType: 'BANK' },
    });
    expect(rows).toHaveLength(live.length);
    expect(rows.every((r) => r.staffId === null)).toBe(true);
  });

  /** ⚠️ Wording that moved while the form sat open. Agreeing on the vendor's
   *  behalf to a paragraph they never saw is what this refusal prevents. */
  test('a stale declaration set is refused', async () => {
    const { requestId } = await selected(['C1-1']);
    await expect(
      submitBankDetails(prisma, requestId, {
        ...(await body()),
        declarationIds: ['11111111-1111-4111-8111-111111111111'],
      }),
    ).rejects.toThrow(DeclarationsChangedError);
  });
});
