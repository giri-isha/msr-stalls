// What the team actually agreed to collect, beside what was quoted.
//
// "For A3 the cost is 10,000 — for the coconut wala, probably we will give that
// stall at 5,000." A local welfare pitch is priced off the rate card and then
// settled at what the local welfare team judged that trader could give. The
// quote is what the requester was told; this is what they owe.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@stalls/core';
import { buildApp } from '../src/app';
import { selectRequest } from '../src/modules/stalls/selection';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  accountFor,
  LogMailer,
  prisma,
  resetDatabase,
  seedEdition,
  seedBackoffice,
  SYSTEM,
  type Backoffice,
  vendorBody,
} from './helpers/db';
import { makeStalls } from './helpers/plan';

let app: FastifyInstance;
let finance: Backoffice;
let lead: Backoffice;
let requestId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  const edition = await seedEdition();
  await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 3 });
  finance = await seedBackoffice(['stalls_finance']);
  lead = await seedBackoffice(['stalls_lead']);
  const r = await submitRequest(
    prisma,
    SubmitRequestInput.parse(
      vendorBody({
        requestType: 'LOCAL_WELFARE',
        stallName: 'Thondamuthur Weavers',
        preferredZoneCode: 'A3',
        depositAcknowledged: true,
      }),
    ),
    { mail: new LogMailer(), statusUrl: (t) => t },
    await accountFor(),
  );
  requestId = r.requestId;
  await selectRequest(prisma, { requestId, stallNumbers: ['A4-1'] }, SYSTEM);
});

const put = (backoffice: Backoffice, body: Record<string, unknown>) =>
  app.inject({
    method: 'PUT',
    url: `/api/m/stalls/finance/payments/${requestId}/discretionary-fee`,
    headers: backoffice.headers,
    payload: body,
  });

const rowNow = async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/m/stalls/finance/payments',
    headers: finance.headers,
  });
  return res.json().find((r: { requestId: string }) => r.requestId === requestId);
};

describe('recording the agreed fee', () => {
  test('keeps the quote and records what is owed beside it', async () => {
    const before = await rowNow();
    expect(before.quote.feeTotalPaise).toBeGreaterThan(0);
    expect(before.quote.payableFeePaise).toBe(before.quote.feeTotalPaise);

    const res = await put(finance, {
      discretionaryFeePaise: 500_000,
      reason: 'Local welfare — agreed by the department',
    });
    expect(res.statusCode).toBe(204);

    const after = await rowNow();
    // What they were told is untouched; what they owe is the agreed figure.
    expect(after.quote.feeTotalPaise).toBe(before.quote.feeTotalPaise);
    expect(after.quote.payableFeePaise).toBe(500_000);
    expect(after.quote.discretionaryReason).toBe('Local welfare — agreed by the department');
  });

  test('the deposit never follows the concession', async () => {
    const before = await rowNow();
    await put(finance, { discretionaryFeePaise: 100_000, reason: 'Hardship' });
    const after = await rowNow();
    // A deposit comes back in full, so conceding it would refund money that was
    // never taken.
    expect(after.quote.depositTotalPaise).toBe(before.quote.depositTotalPaise);
    expect(after.quote.grandTotalPaise).toBe(100_000 + before.quote.depositTotalPaise);
  });

  test('paying the agreed figure settles the stall', async () => {
    await put(finance, { discretionaryFeePaise: 500_000, reason: 'Local welfare' });
    const row = await rowNow();
    for (const [purpose, amountPaise] of [
      ['RENT', 500_000],
      ['DEPOSIT', row.quote.depositTotalPaise],
    ] as const) {
      await app.inject({
        method: 'POST',
        url: `/api/m/stalls/finance/payments/${requestId}`,
        headers: finance.headers,
        payload: {
          purpose,
          referenceNo: `REF-${purpose}`,
          amountPaise,
          receivedOn: '2026-02-01',
          mode: 'CASH',
        },
      });
    }
    // Against the quote this stall would read as short by the concession and
    // stay on Finance's list for ever.
    expect((await rowNow()).fullySettled).toBe(true);
  });

  test('a figure with no reason is refused', async () => {
    const res = await put(finance, { discretionaryFeePaise: 500_000, reason: null });
    expect(res.statusCode).toBe(422);
    expect((await rowNow()).quote.discretionaryFeePaise).toBeNull();
  });

  test('null clears it and puts the quoted figure back in force', async () => {
    await put(finance, { discretionaryFeePaise: 500_000, reason: 'Local welfare' });
    expect((await put(finance, { discretionaryFeePaise: null, reason: null })).statusCode).toBe(
      204,
    );
    const after = await rowNow();
    expect(after.quote.discretionaryFeePaise).toBeNull();
    expect(after.quote.discretionaryReason).toBeNull();
    expect(after.quote.payableFeePaise).toBe(after.quote.feeTotalPaise);
  });

  test('a lead may see the figure but not agree one', async () => {
    // Preparing the concession is Finance's act, the same as every other
    // money-moving write on this screen.
    expect((await put(lead, { discretionaryFeePaise: 1, reason: 'x' })).statusCode).toBe(403);
  });

  test('it is on the activity trail with both figures', async () => {
    await put(finance, { discretionaryFeePaise: 500_000, reason: 'Local welfare' });
    const entry = await prisma.activityTrail.findFirst({
      where: { subjectRef: requestId, action: 'stall_payment_plan.concession_set' },
    });
    expect(entry).not.toBeNull();
    const detail = entry?.detail as { agreedPaise: number; quotedPaise: number };
    expect(detail.agreedPaise).toBe(500_000);
    // Both figures on the trail: "reduced to 5,000" is not answerable six
    // months later without knowing what it was reduced from.
    expect(detail.quotedPaise).toBeGreaterThan(500_000);
  });
});
