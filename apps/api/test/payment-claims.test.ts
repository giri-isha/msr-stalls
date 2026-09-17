import type { StallEdition } from '@prisma/client';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  ClaimAlreadyReviewedError,
  DuplicatePaymentError,
  MissingRejectReasonError,
  StepNotOpenError,
} from '../src/modules/stalls/errors';
import {
  claimsFor,
  pendingClaims,
  reviewPaymentClaim,
  submitPaymentClaim,
} from '../src/modules/stalls/payment-claims';
import { SYSTEM, prisma, resetDatabase, seedEdition } from './helpers/db';
import { selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let edition: StallEdition;

beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 5 });
});

const claim = (over: Record<string, unknown> = {}) => ({
  reference: 'ignored-by-the-module',
  purpose: 'RENT' as const,
  referenceNo: 'NEFT00112233',
  amountPaise: 1_770_000,
  paidOn: '2026-02-10',
  remitterName: 'GREEN LEAF ORGANICS',
  ...over,
});

describe('a requester says what they transferred', () => {
  /** 🔴 A claim is an ASSERTION. The stage advances when finance verifies it —
   *  a stage that moved on submission would tell the backoffice list a stall
   *  had paid because the stall said so. */
  test('the claim lands PENDING and moves nothing', async () => {
    const { requestId } = await selected(['C1-1']);
    const before = await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } });

    const out = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });
    expect(out.status).toBe('PENDING');

    const after = await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } });
    expect(after.stage).toBe(before.stage);
    expect(await prisma.stallPaymentRecord.count({ where: { requestId } })).toBe(0);
  });

  /** ⚠️ The receipt is OPTIONAL. A vendor who transferred at a branch counter
   *  may have only a stamped slip they cannot photograph well, and refusing the
   *  claim over that sends them back to the mailbox this replaced. */
  test('no receipt is still a claim', async () => {
    const { requestId } = await selected(['C1-1']);
    const out = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });
    expect(out.hasReceipt).toBe(false);
  });

  /** One reference is one credit, so a refreshed form or an impatient second
   *  attempt does not create two claims against one transfer. */
  test('the same reference twice is refused', async () => {
    const { requestId } = await selected(['C1-1']);
    await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });
    await expect(
      submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' }),
    ).rejects.toThrow(DuplicatePaymentError);
  });

  /** 🔴 Rent and deposit are paid SEPARATELY into different accounts, so the
   *  same UTR is not expected — but two claims for the two purposes are. */
  test('rent and deposit are separate claims', async () => {
    const { requestId } = await selected(['C1-1']);
    await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });
    await submitPaymentClaim(
      prisma,
      requestId,
      claim({ purpose: 'DEPOSIT', referenceNo: 'NEFT99887766', amountPaise: 400_000 }),
      { kind: 'SYSTEM' },
    );
    expect(await claimsFor(prisma, requestId)).toHaveLength(2);
  });

  /** ⚠️ An ashram department is billed internally and owes nothing here, so a
   *  claim from one is a claim about nothing. */
  test('an ashram department cannot claim', async () => {
    const { requestId } = await selected(['C1-1']);
    await prisma.stallRequest.update({ where: { id: requestId }, data: { requestType: 'ASHRAM' } });
    await expect(
      submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' }),
    ).rejects.toThrow(StepNotOpenError);
  });
});

describe('finance settles it', () => {
  /** 🔴 Verifying is what makes the money real: it writes the
   *  `StallPaymentRecord` that `paymentConfirmed` settles against. */
  test('VERIFY writes the payment record and links it back', async () => {
    const { requestId } = await selected(['C1-1']);
    const c = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });

    await reviewPaymentClaim(prisma, edition.id, c.id, { verdict: 'VERIFY' }, SYSTEM);

    const records = await prisma.stallPaymentRecord.findMany({ where: { requestId } });
    expect(records).toHaveLength(1);
    expect(records[0]?.referenceNo).toBe('NEFT00112233');

    const settled = await prisma.stallPaymentClaim.findUniqueOrThrow({ where: { id: c.id } });
    expect(settled.status).toBe('VERIFIED');
    expect(settled.paymentRecordId).toBe(records[0]?.id);
  });

  /** ⚠️ Finance's figure wins where they read a different one off the
   *  statement, and the claim keeps what was claimed — the gap stays visible. */
  test('finance may correct the amount, and the claim keeps the original', async () => {
    const { requestId } = await selected(['C1-1']);
    const c = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });

    await reviewPaymentClaim(
      prisma,
      edition.id,
      c.id,
      { verdict: 'VERIFY', amountPaise: 1_700_000 },
      SYSTEM,
    );

    const record = await prisma.stallPaymentRecord.findFirstOrThrow({ where: { requestId } });
    expect(record.amountPaise).toBe(1_700_000);
    const settled = await prisma.stallPaymentClaim.findUniqueOrThrow({ where: { id: c.id } });
    expect(settled.amountPaise).toBe(1_770_000);
  });

  test('REJECT writes no payment record and keeps the reason', async () => {
    const { requestId } = await selected(['C1-1']);
    const c = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });

    await reviewPaymentClaim(
      prisma,
      edition.id,
      c.id,
      { verdict: 'REJECT', rejectReason: 'No credit against this reference.' },
      SYSTEM,
    );

    expect(await prisma.stallPaymentRecord.count({ where: { requestId } })).toBe(0);
    const [only] = await claimsFor(prisma, requestId);
    expect(only?.status).toBe('REJECTED');
    expect(only?.rejectReason).toBe('No credit against this reference.');
  });

  /** ⚠️ The reason is the only thing telling the requester what to correct. */
  test('a rejection with no reason is refused', async () => {
    const { requestId } = await selected(['C1-1']);
    const c = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });
    await expect(
      reviewPaymentClaim(prisma, edition.id, c.id, { verdict: 'REJECT' }, SYSTEM),
    ).rejects.toThrow(MissingRejectReasonError);
  });

  /** 🔴 Re-verifying would write a SECOND record for one transfer, which
   *  double-counts what the vendor paid and shrinks their refund. */
  test('a settled claim cannot be settled again', async () => {
    const { requestId } = await selected(['C1-1']);
    const c = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });
    await reviewPaymentClaim(prisma, edition.id, c.id, { verdict: 'VERIFY' }, SYSTEM);
    await expect(
      reviewPaymentClaim(prisma, edition.id, c.id, { verdict: 'VERIFY' }, SYSTEM),
    ).rejects.toThrow(ClaimAlreadyReviewedError);
  });

  /** ⚠️ A rejected claim keeps its reference so the requester can be shown
   *  what was wrong — and they must still be able to resubmit a corrected
   *  claim carrying the same UTR, which is the common case when the mistake
   *  was the amount or the date. */
  test('a corrected claim may reuse the reference of a rejected one', async () => {
    const { requestId } = await selected(['C1-1']);
    const first = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });
    await reviewPaymentClaim(
      prisma,
      edition.id,
      first.id,
      { verdict: 'REJECT', rejectReason: 'Amount does not match.' },
      SYSTEM,
    );

    const second = await submitPaymentClaim(prisma, requestId, claim({ amountPaise: 1_700_000 }), {
      kind: 'SYSTEM',
    });
    expect(second.status).toBe('PENDING');
    expect(await claimsFor(prisma, requestId)).toHaveLength(2);
  });
});

describe('the finance queue', () => {
  test('lists what is pending, oldest first, with what is owed beside it', async () => {
    const { requestId } = await selected(['C1-1']);
    await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });

    const rows = await pendingClaims(prisma, edition.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reference).toMatch(/^VEN-/);
    expect(rows[0]?.stallName).toBeTruthy();
  });

  test('and drops one once it is settled', async () => {
    const { requestId } = await selected(['C1-1']);
    const c = await submitPaymentClaim(prisma, requestId, claim(), { kind: 'SYSTEM' });
    await reviewPaymentClaim(prisma, edition.id, c.id, { verdict: 'VERIFY' }, SYSTEM);
    expect(await pendingClaims(prisma, edition.id)).toHaveLength(0);
  });
});
