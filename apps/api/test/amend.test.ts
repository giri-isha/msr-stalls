// Amending a request after it was filed, and the bay that amendment settles.
//
// Two rules from the requirement meeting that the schema carried and no route
// reached: the bay agreed with a requester ("we may have to talk to them saying
// that side is already filled up — why don't you look at this side"), and the
// cap on how many stalls one request may ask for in one bay.
import type { StallRequestStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@stalls/core';
import { buildApp } from '../src/app';
import {
  TooManyOpenRequestsError,
  TooManyStallsRequestedError,
} from '../src/modules/stalls/errors';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  accountFor,
  LogMailer,
  prisma,
  resetDatabase,
  seedEdition,
  seedRequester,
  seedBackoffice,
  type Backoffice,
  vendorBody,
} from './helpers/db';
import { makeStalls } from './helpers/plan';

let app: FastifyInstance;
let lead: Backoffice;
let volunteer: Backoffice;
let editionId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());

const submit = async (body: Record<string, unknown> = {}) =>
  submitRequest(
    prisma,
    SubmitRequestInput.parse(vendorBody(body)),
    {
      mail: new LogMailer(),
      statusUrl: (t) => t,
    },
    await accountFor(body),
  );

beforeEach(async () => {
  await resetDatabase();
  const edition = await seedEdition();
  editionId = edition.id;
  await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 4 });
  lead = await seedBackoffice(['stalls_lead']);
  volunteer = await seedBackoffice(['stalls_volunteer']);
});

const patch = (backoffice: Backoffice, id: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'PATCH',
    url: `/api/m/stalls/requests/${id}`,
    headers: backoffice.headers,
    payload,
  });

describe('the cap on stalls in one bay', () => {
  // ⚠️ Set here rather than taken from the default. The edition ships at ten —
  // "users can choose up to 10 stalls in a request" — and a test that read the
  // default would be asserting the seed rather than the rule.
  const capAt = (n: number) =>
    prisma.stallEdition.update({ where: { id: editionId }, data: { maxStallsPerRequest: n } });

  test('a request above the edition’s cap is refused with a 422', async () => {
    await capAt(2);
    const res = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/public/requests',
      payload: vendorBody({ numStallsRequested: 5 }),
      cookies: (await seedRequester(app)).cookies,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('at most 2');
    expect(await prisma.stallRequest.count()).toBe(0);
  });

  test('the cap is the edition’s, so raising it in Admin admits the same request', async () => {
    const { cookies } = await seedRequester(app);
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/m/stalls/public/requests',
        payload: vendorBody({ numStallsRequested: 5 }),
        cookies,
      });
    await capAt(2);
    expect((await send()).statusCode).toBe(422);

    await capAt(5);
    expect((await send()).statusCode).toBe(201);
  });

  test('at the cap exactly is accepted', async () => {
    await capAt(2);
    await expect(submit({ numStallsRequested: 2 })).resolves.toBeTruthy();
    await expect(submit({ numStallsRequested: 3, email: 'b@x.com' })).rejects.toBeInstanceOf(
      TooManyStallsRequestedError,
    );
  });

  test('a new edition ships at ten, so a request for ten stalls stands', async () => {
    // The rule the team stated, asserted against the default an edition is
    // actually created with — not against a figure the test sets itself.
    const edition = await prisma.stallEdition.findUniqueOrThrow({ where: { id: editionId } });
    expect(edition.maxStallsPerRequest).toBe(10);
    await expect(submit({ numStallsRequested: 10 })).resolves.toBeTruthy();
  });
});

/**
 * "Only two requests at a time" — the half of the rule that had no enforcement
 * at all. The per-bay cap bounds ONE request; nothing bounded how many an
 * account could file, so a vendor wanting six bays filed six and every one of
 * them stood.
 */
describe('the cap on requests at a time', () => {
  const capScope = (scope: 'UNDECIDED' | 'OPEN' | 'ALL', max = 2) =>
    prisma.stallEdition.update({
      where: { id: editionId },
      data: { requestCapScope: scope, maxOpenRequests: max },
    });

  /** The same account each time — `accountFor` keys off the body's email, and
   *  the cap is per account, so these have to share one. */
  const mine = (body: Record<string, unknown> = {}) => submit({ email: 'same@x.com', ...body });

  const setStatus = async (reference: string, status: StallRequestStatus) => {
    await prisma.stallRequest.update({ where: { reference }, data: { status } });
  };

  test('a third request is refused once two are open', async () => {
    await mine();
    await mine();
    await expect(mine()).rejects.toBeInstanceOf(TooManyOpenRequestsError);
    expect(await prisma.stallRequest.count()).toBe(2);
  });

  test('the refusal is a 422 naming the rule, not the requests', async () => {
    const requester = await seedRequester(app);
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/m/stalls/public/requests',
        payload: vendorBody(),
        cookies: requester.cookies,
      });
    expect((await send()).statusCode).toBe(201);
    expect((await send()).statusCode).toBe(201);
    const third = await send();
    expect(third.statusCode).toBe(422);
    expect(third.json().error).toContain('the limit is 2 at a time');
    // Which requests they are is on My Requests. A backoffice member filing for
    // a requester raises this too and may not be able to see all of them.
    expect(third.json().error).not.toContain('MSR');
  });

  test('another account is unaffected — the cap is per account, not per edition', async () => {
    await mine();
    await mine();
    await expect(submit({ email: 'other@x.com' })).resolves.toBeTruthy();
  });

  test('under OPEN a rejection frees a slot and a selection does not', async () => {
    await capScope('OPEN');
    const first = await mine();
    await mine();
    await expect(mine()).rejects.toBeInstanceOf(TooManyOpenRequestsError);

    // Selected is still live — it holds its slot.
    await setStatus(first.reference, 'SELECTED');
    await expect(mine()).rejects.toBeInstanceOf(TooManyOpenRequestsError);

    await setStatus(first.reference, 'REJECTED');
    await expect(mine()).resolves.toBeTruthy();
  });

  test('under UNDECIDED being selected frees the slot', async () => {
    await capScope('UNDECIDED');
    const first = await mine();
    await mine();
    await expect(mine()).rejects.toBeInstanceOf(TooManyOpenRequestsError);

    await setStatus(first.reference, 'SELECTED');
    await expect(mine()).resolves.toBeTruthy();
  });

  test('under ALL a rejection frees nothing — the cap is attempts a year', async () => {
    await capScope('ALL');
    const first = await mine();
    await mine();
    await setStatus(first.reference, 'REJECTED');
    await expect(mine()).rejects.toBeInstanceOf(TooManyOpenRequestsError);
  });

  test('the cap is the edition’s, so raising it in Admin admits the third', async () => {
    await mine();
    await mine();
    await expect(mine()).rejects.toBeInstanceOf(TooManyOpenRequestsError);
    await capScope('OPEN', 3);
    await expect(mine()).resolves.toBeTruthy();
  });

  test('last year’s requests are not spent against this year’s allowance', async () => {
    await mine();
    await mine();
    // A second edition, activated — the count is scoped to the edition being
    // filed into, so the two above are history rather than an allowance used up.
    await seedEdition(2027);
    await expect(mine()).resolves.toBeTruthy();
  });
});

describe('the agreed bay', () => {
  test('selecting records the bay the team and the vendor settled on', async () => {
    const r = await submit({ preferredZoneCode: 'A3' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${r.requestId}/select`,
      headers: lead.headers,
      payload: { stallNumbers: ['A4-1'], agreedZoneCode: 'A4' },
    });
    expect(res.statusCode).toBe(200);
    const after = await prisma.stallRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(after.preferredZoneCode).toBe('A3');
    expect(after.agreedZoneCode).toBe('A4');
  });

  test('the bay can be agreed with no stall number, which is the usual order', async () => {
    // "The side will be decided, but the stall number may not be still put at
    // the time of the payment."
    const r = await submit({ preferredZoneCode: 'A3' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${r.requestId}/select`,
      headers: lead.headers,
      payload: { agreedZoneCode: 'B2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().allocated).toEqual([]);
    const after = await prisma.stallRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(after.status).toBe('SELECTED');
    expect(after.agreedZoneCode).toBe('B2');
  });

  test('a bay this edition does not have is a 404, and nothing is selected', async () => {
    const r = await submit({});
    const res = await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${r.requestId}/select`,
      headers: lead.headers,
      payload: { stallNumbers: ['A4-1'], agreedZoneCode: 'Z9' },
    });
    expect(res.statusCode).toBe(404);
    const after = await prisma.stallRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(after.status).toBe('SUBMITTED');
    expect(after.agreedZoneCode).toBeNull();
  });

  test('the agreed bay prices the payment letter, months before a number exists', async () => {
    // The defect this closes: the letter goes out after selection and before
    // allocation, so with no agreed bay the quote falls back to the bay the
    // vendor ASKED for. A vendor moved from C1 to A4 was billed C1's rent.
    const rate = (zoneCode: string) =>
      prisma.stallRateCard.findFirstOrThrow({
        where: { editionId, zoneCode, isFood: true, scope: 'VENDOR' },
      });
    const [c1, a4] = await Promise.all([rate('C1'), rate('A4')]);
    expect(c1.amountPaise).not.toBe(a4.amountPaise);

    const r = await submit({ preferredZoneCode: 'C1', stallType: 'FOOD' });
    await app.inject({
      method: 'POST',
      url: `/api/m/stalls/requests/${r.requestId}/select`,
      headers: lead.headers,
      payload: { agreedZoneCode: 'A4' },
    });

    const payments = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/finance/payments',
      headers: lead.headers,
    });
    const row = payments.json().find((p: { requestId: string }) => p.requestId === r.requestId);
    expect(row.stallNumbers).toEqual([]);
    expect(row.quote.stallFeePaise).toBe(a4.amountPaise);
    expect(row.quote.stallDepositPaise).toBe(a4.depositPaise);
  });
});

describe('amending a request', () => {
  test('a lead corrects what the requester told them over the phone', async () => {
    const r = await submit({});
    const res = await patch(lead, r.requestId, {
      contactNumber: '9876543210',
      chairsNeeded: 12,
      remarks: 'Wants the corner pitch if one frees up',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().contactNumber).toBe('9876543210');
    expect(res.json().chairsNeeded).toBe(12);
    // Untouched fields stay as filed.
    expect(res.json().stallName).toBe('Green Leaf Organics');
  });

  test('the agreed bay can be cleared when the conversation falls through', async () => {
    const r = await submit({});
    await patch(lead, r.requestId, { agreedZoneCode: 'A4' });
    const res = await patch(lead, r.requestId, { agreedZoneCode: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().agreedZoneCode).toBeNull();
  });

  test('appliances arrive whole — the list sent is the list kept', async () => {
    const r = await submit({
      appliances: [
        { name: 'Idli steamer', watts: 1500 },
        { name: 'Mixer', watts: 750 },
      ],
    });
    const res = await patch(lead, r.requestId, {
      appliances: [{ name: 'Idli steamer', watts: 2000 }],
    });
    expect(res.json().appliances).toEqual([{ name: 'Idli steamer', watts: 2000 }]);
  });

  test('a bay this edition does not have is refused', async () => {
    const r = await submit({});
    expect((await patch(lead, r.requestId, { preferredZoneCode: 'Z9' })).statusCode).toBe(404);
  });

  test('a volunteer may not amend', async () => {
    const r = await submit({});
    expect((await patch(volunteer, r.requestId, { remarks: 'x' })).statusCode).toBe(403);
  });

  test('status is not reachable through the patch', async () => {
    // Every status change has its own route and its own guard; a general patch
    // that could set one would be a way around all of them.
    const r = await submit({});
    const res = await patch(lead, r.requestId, { status: 'SELECTED' });
    expect(res.statusCode).toBe(200);
    const after = await prisma.stallRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(after.status).toBe('SUBMITTED');
  });

  test('the amendment is on the activity trail', async () => {
    const r = await submit({});
    await patch(lead, r.requestId, { chairsNeeded: 4 });
    const entry = await prisma.activityTrail.findFirst({
      where: { subjectRef: r.requestId, action: 'stall_request.amended' },
    });
    expect(entry).not.toBeNull();
  });
});
