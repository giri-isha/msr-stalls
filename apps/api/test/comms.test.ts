import type { StallEdition } from '@prisma/client';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  clearSendLog,
  listRecipients,
  listReminders,
  listTemplates,
  logReminder,
  sendTemplate,
  updateTemplate,
} from '../src/modules/stalls/comms';
import { checkIn } from '../src/modules/stalls/checkin';
import { WrongTemplateError } from '../src/modules/stalls/errors';
import { updateEditionSettings } from '../src/modules/stalls/config';
import { SYSTEM, prisma, resetDatabase, seedEdition } from './helpers/db';
import { selected, type TestDeps, testDeps } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let edition: StallEdition;
let deps: TestDeps;

beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5, ASHRAM_FOOD: 5 });
  deps = testDeps();
});

const send = (templateKey: Parameters<typeof sendTemplate>[2]['templateKey'], ids: string[]) =>
  sendTemplate(prisma, edition.id, { templateKey, requestIds: ids }, deps, SYSTEM);

describe('templates', () => {
  test('an edition is seeded with all four letters', async () => {
    const templates = await listTemplates(prisma, edition.id);
    expect(templates.map((t) => t.key).sort()).toEqual([
      'ONBOARDING_FSSAI_STAFF',
      'PAYMENT_DETAILS',
      'SELECTION_ASHRAM',
      'SELECTION_VENDOR',
    ]);
    // Never edited yet, so the screen can show "seeded wording".
    expect(templates.every((t) => t.updatedAt === null)).toBe(true);
  });

  test('an edited letter is what actually goes out', async () => {
    const { requestId } = await selected(['C1-1']);
    await updateTemplate(
      prisma,
      edition.id,
      'SELECTION_VENDOR',
      { subject: 'Confirmed: {{stallName}}', body: 'Bay {{zoneCode}}. Bye.' },
      SYSTEM,
    );
    await send('SELECTION_VENDOR', [requestId]);
    expect(deps.mail.sent[0].subject).toBe('Confirmed: Green Leaf Organics');
    expect(deps.mail.sent[0].text).toBe('Bay C1. Bye.');
  });

  // 🔴 The team asked that the stall NUMBER not go out before the vendor is
  // standing at the counter: "some of them will come back saying I want to
  // change this location". The AREA is told early and has to be, because the
  // rent depends on it. So the placeholder exists, and renders blank until
  // check-in rather than being refused — a letter an admin writes afterwards
  // can still carry it.
  test('the stall number renders blank before check-in and fills after it', async () => {
    const { requestId } = await selected(['C1-1']);
    await updateTemplate(
      prisma,
      edition.id,
      'SELECTION_VENDOR',
      { subject: 'x', body: 'Number [{{stallNumbers}}] in bay {{zoneCode}}.' },
      SYSTEM,
    );

    await send('SELECTION_VENDOR', [requestId]);
    expect(deps.mail.sent[0].text).toBe('Number [] in bay C1.');

    await checkIn(prisma, requestId, undefined, SYSTEM);
    await clearSendLog(prisma, requestId, 'SELECTION_VENDOR', SYSTEM);
    await send('SELECTION_VENDOR', [requestId]);
    expect(deps.mail.sent[1].text).toBe('Number [C1-1] in bay C1.');
  });
});

describe('sending', () => {
  test('the selection letter carries a working bank-form link for a vendor', async () => {
    const { requestId } = await selected(['C1-1']);
    const result = await send('SELECTION_VENDOR', [requestId]);

    expect(result.sent).toEqual([requestId]);
    expect(deps.links.bank).toHaveLength(1);
    expect(deps.mail.sent[0].text).toContain(`https://web.test/stalls/bank/${deps.links.bank[0]}`);

    // The link is a real BANK_FORM access link on this request, not a string.
    const link = await prisma.stallAccessLink.findFirst({
      where: { requestId, purpose: 'BANK_FORM' },
    });
    expect(link).not.toBeNull();
  });

  test('a letter is never sent twice, and the second attempt says why', async () => {
    const { requestId } = await selected(['C1-1']);
    await send('SELECTION_VENDOR', [requestId]);
    const again = await send('SELECTION_VENDOR', [requestId]);

    expect(again.sent).toEqual([]);
    expect(again.skipped).toEqual([{ requestId, reason: 'already sent' }]);
    expect(deps.mail.sent).toHaveLength(1);
  });

  test('two senders racing on one request deliver exactly one letter', async () => {
    const { requestId } = await selected(['C1-1']);
    await Promise.all([
      send('SELECTION_VENDOR', [requestId]),
      send('SELECTION_VENDOR', [requestId]),
    ]);
    expect(deps.mail.sent).toHaveLength(1);
    expect(await prisma.stallMessageLog.count({ where: { requestId, channel: 'EMAIL' } })).toBe(1);
  });

  test('the vendor letter is refused for an ashram department', async () => {
    const { requestId } = await selected(['C1-6'], {
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
        // Asked only of a FOOD ashram stall, which this body is — `stallType`
        // defaults to FOOD. Since the form definition became what the API
        // validates against, omitting it is an unanswered question rather than
        // a field the contract will default.
        fssaiExpected: false,
      },
    });
    const result = await send('SELECTION_VENDOR', [requestId]);

    expect(result.sent).toEqual([]);
    expect(result.skipped[0].reason).toContain('not for a ashram request');
    expect(deps.mail.sent).toHaveLength(0);
  });

  test('a bulk send reports each row rather than failing as a batch', async () => {
    const a = await selected(['C1-1'], { email: 'a@x.example' });
    const b = await selected(['C1-2'], { email: 'b@x.example' });
    await send('SELECTION_VENDOR', [a.requestId]);

    const result = await send('SELECTION_VENDOR', [a.requestId, b.requestId]);
    expect(result.sent).toEqual([b.requestId]);
    expect(result.skipped).toEqual([{ requestId: a.requestId, reason: 'already sent' }]);
  });

  test('a request that is not selected is skipped, not mailed', async () => {
    const { requestId } = await selected(['C1-1']);
    await prisma.stallRequest.update({ where: { id: requestId }, data: { status: 'SUBMITTED' } });
    const result = await send('SELECTION_VENDOR', [requestId]);
    expect(result.skipped[0].reason).toContain('not selected');
  });

  // ⚠️ Two channels now, so "the send failed" and "a send failed" are different
  // events. One channel getting through is enough to move the request on — a
  // vendor who read the WhatsApp is waiting to pay, and holding onboarding back
  // for the mail server would strand them. Either way the channel that failed
  // keeps no log row, so it is still offered for sending.
  test('a channel that fails is re-sendable while the one that worked stands', async () => {
    const { requestId } = await selected(['C1-1']);
    deps.mail.send = async () => {
      throw new Error('smtp down');
    };
    const partial = await send('SELECTION_VENDOR', [requestId]);

    expect(partial.skipped[0].reason).toBe('sent, but email failed');
    expect(deps.whatsapp.sent).toHaveLength(1);
    expect(await prisma.stallMessageLog.count({ where: { requestId, channel: 'EMAIL' } })).toBe(0);
    expect(await prisma.stallMessageLog.count({ where: { requestId, channel: 'WHATSAPP' } })).toBe(
      1,
    );
  });

  test('when every channel fails the letter is not counted as sent at all', async () => {
    const { requestId } = await selected(['C1-1']);
    deps.mail.send = async () => {
      throw new Error('smtp down');
    };
    deps.whatsapp.send = async () => {
      throw new Error('provider down');
    };
    const failed = await send('SELECTION_VENDOR', [requestId]);

    expect(failed.skipped[0].reason).toContain('try again');
    expect(await prisma.stallMessageLog.count({ where: { requestId } })).toBe(0);
  });

  test('the payment letter freezes the amount the vendor was told', async () => {
    const { requestId } = await selected(['C1-1'], { plugs5a: 4, plugs15a: 5 });
    await send('PAYMENT_DETAILS', [requestId]);

    const plan = await prisma.stallPaymentPlan.findUnique({ where: { requestId } });
    expect(plan?.stallFeePaise).toBe(1_500_000); // C1 food: Rs 15,000
    expect(plan?.plugFeePaise).toBe(700_000); // 4×500 + 5×1000
    expect(plan?.feeTotalPaise).toBe(2_596_000); // +18% GST
    expect(deps.mail.sent[0].text).toContain('₹25,960');

    // An admin editing the rate afterwards does not move the frozen figure.
    await prisma.stallRateCard.updateMany({
      where: { editionId: edition.id, zoneCode: 'C1', scope: 'VENDOR', isFood: true },
      data: { amountPaise: 9_999_900 },
    });
    const after = await prisma.stallPaymentPlan.findUnique({ where: { requestId } });
    expect(after?.stallFeePaise).toBe(1_500_000);
  });

  test('the payment letter names the beneficiary the edition was configured with', async () => {
    // 🔴 The bank identity used to be PROSE in the template body, which was
    // fine while the letter was the only place a vendor read it. Their payment
    // page prints the same table now, and two copies is one bank change away
    // from a letter and a page naming different beneficiaries.
    const { requestId } = await selected(['C1-1']);
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
        bankBranch: 'Kanjurmarg Branch, Mumbai',
      },
      SYSTEM,
    );

    await send('PAYMENT_DETAILS', [requestId]);

    const text = deps.mail.sent[0].text;
    expect(text).toContain('ISHA FOUNDATION');
    expect(text).toContain('HDFC0004989');
    expect(text).toContain('Kanjurmarg Branch, Mumbai');
    // ⚠️ No brace survives into an inbox. A placeholder the module cannot fill
    // renders empty — a gap a reader can query, where a stray `{{oops}}` is a
    // mistake they cannot act on.
    expect(text).not.toContain('{{');
  });

  test('the onboarding letter mints one coupon and reuses it', async () => {
    const { requestId } = await selected(['C1-1']);
    await send('ONBOARDING_FSSAI_STAFF', [requestId]);
    const first = await prisma.stallStaffCoupon.findFirstOrThrow({ where: { requestId } });
    expect(deps.mail.sent[0].text).toContain(first.code);

    await clearSendLog(prisma, requestId, 'ONBOARDING_FSSAI_STAFF', SYSTEM);
    await send('ONBOARDING_FSSAI_STAFF', [requestId]);
    const second = await prisma.stallStaffCoupon.findFirstOrThrow({ where: { requestId } });
    expect(second.code).toBe(first.code);
  });

  test('an attachment travels with the letter as a short-lived link', async () => {
    const { requestId } = await selected(['C1-1']);
    await prisma.stallEmailTemplate.update({
      where: { editionId_key: { editionId: edition.id, key: 'SELECTION_VENDOR' } },
      data: { attachmentKey: 'stalls/templates/map.pdf', attachmentName: 'Zone map.pdf' },
    });
    await send('SELECTION_VENDOR', [requestId]);
    expect(deps.mail.sent[0].attachments).toEqual([
      { filename: 'Zone map.pdf', url: 'https://store.test/view/stalls/templates/map.pdf' },
    ]);
  });

  test('clearing a send log that does not exist is refused', async () => {
    const { requestId } = await selected(['C1-1']);
    await expect(clearSendLog(prisma, requestId, 'PAYMENT_DETAILS', SYSTEM)).rejects.toBeInstanceOf(
      WrongTemplateError,
    );
  });
});

describe('recipients and reminders', () => {
  test('the recipients list suggests the right letter per requester type', async () => {
    const vendor = await selected(['C1-1']);
    const ashram = await selected(['C1-6'], {
      requestType: 'ASHRAM',
      // Non-food, so the ashram form's FSSAI question is not asked of it.
      stallType: 'NON_FOOD',
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
      },
    });
    const rows = await listRecipients(prisma, edition.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(vendor.requestId)?.suggestedTemplate).toBe('SELECTION_VENDOR');
    expect(byId.get(ashram.requestId)?.suggestedTemplate).toBe('SELECTION_ASHRAM');
  });

  test('a vendor drops off the bank reminder list once the form is in', async () => {
    const { requestId } = await selected(['C1-1']);
    expect((await listReminders(prisma, edition.id, 'BANK')).map((r) => r.requestId)).toEqual([
      requestId,
    ]);

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
    expect(await listReminders(prisma, edition.id, 'BANK')).toEqual([]);
  });

  test('a logged call shows as a count and a date, not just a flag', async () => {
    const { requestId } = await selected(['C1-1']);
    await logReminder(prisma, requestId, { kind: 'BANK', note: 'no answer' }, SYSTEM);
    await logReminder(prisma, requestId, { kind: 'BANK' }, SYSTEM);

    const [row] = await listReminders(prisma, edition.id, 'BANK');
    expect(row.callCount).toBe(2);
    expect(row.lastCalledAt).not.toBeNull();
  });
});
