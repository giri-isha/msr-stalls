// The audit log: what `audit()` writes, what the requester's own actions
// leave behind, what every letter out records, and what the two read routes
// answer.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SYSTEM_ACTOR_REF } from '@stalls/core';
import {
  actorFrom,
  audit,
  auditBackofficeSignIn,
  requesterActor,
} from '../src/modules/stalls/audit';
import { SubmitRequestInput } from '@stalls/core';
import { buildApp } from '../src/app';
import { auditedMailer, auditedWhatsApp } from '../src/modules/stalls/audit-senders';
import { submitRequest } from '../src/modules/stalls/submit';
import { ensureCoupon, registerStaff, submitFssai } from '../src/modules/stalls/onboarding';
import { submitPaymentClaim } from '../src/modules/stalls/payment-claims';
import {
  accountFor,
  LogMailer,
  prisma,
  resetDatabase,
  seedBackoffice,
  seedEdition,
  seedRequester,
  vendorBody,
} from './helpers/db';
import { fakeStore, selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

beforeEach(resetDatabase);

/** An edition with stalls in C1, which is where `selected(['C1-1'])` puts one. */
async function edition() {
  const e = await seedEdition();
  await makeStalls(e.id, 'C1', { VENDOR_FOOD: 5 });
  return e;
}

describe('audit()', () => {
  test('writes the row AND forwards the same action to the host trail', async () => {
    await edition();
    const { requestId } = await selected(['C1-1']);
    const lead = await seedBackoffice(['stalls_lead']);

    await audit(prisma, {
      actor: actorFrom(lead.personId),
      action: 'stall_request.flagged',
      requestId,
      detail: { reason: 'call back' },
    });

    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { requestId, action: 'stall_request.flagged' },
    });
    expect(row.action).toBe('stall_request.flagged');
    expect(row.actorKind).toBe('BACKOFFICE');
    expect(row.actorRef).toBe(lead.personId);
    expect(row.channel).toBe('BACKOFFICE');
    expect(row.subjectType).toBe('request');
    expect(row.subjectRef).toBe(requestId);
    expect(row.detail).toEqual({ reason: 'call back' });

    const trail = await prisma.activityTrail.findFirstOrThrow({
      where: { subjectRef: requestId, action: 'stall_request.flagged' },
    });
    expect(trail.actorRef).toBe(lead.personId);
  });

  test('resolves the actor’s display name at write time, and the edition from the request', async () => {
    const e = await edition();
    const { requestId } = await selected(['C1-1']);
    const lead = await seedBackoffice(['stalls_lead'], 'deepa@example.org');

    await audit(prisma, {
      actor: actorFrom(lead.personId),
      action: 'stall_request.flagged',
      requestId,
    });

    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { requestId, action: 'stall_request.flagged' },
    });
    expect(row.actorName).toBe('deepa');
    expect(row.editionId).toBe(e.id);
  });

  test('a requester actor is a PORTAL row carrying the account', async () => {
    await edition();
    const { requestId } = await selected(['C1-1']);
    const accountId = await accountFor();

    await audit(prisma, {
      actor: requesterActor(accountId),
      action: 'stall_bank_detail.submitted',
      requestId,
    });

    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { requestId, action: 'stall_bank_detail.submitted' },
    });
    expect(row.actorKind).toBe('REQUESTER');
    expect(row.actorRef).toBe(accountId);
    expect(row.accountId).toBe(accountId);
    expect(row.actorName).toBe('Priya Venkat');
    expect(row.channel).toBe('PORTAL');
  });

  test('the all-zero uuid is the SYSTEM actor', async () => {
    await edition();
    await audit(prisma, {
      actor: actorFrom(SYSTEM_ACTOR_REF),
      action: 'stall_zone.created',
      subject: { type: 'zone', ref: 'C1' },
    });
    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { action: 'stall_zone.created' },
    });
    expect(row.actorKind).toBe('SYSTEM');
    expect(row.actorName).toBe('System');
    expect(row.channel).toBe('SYSTEM');
    expect(row.requestId).toBeNull();
  });

  test('on-behalf-of and a change set land in the row and in the host trail’s detail', async () => {
    await edition();
    const { requestId } = await selected(['C1-1']);
    const lead = await seedBackoffice(['stalls_lead']);
    const accountId = await accountFor();

    await audit(prisma, {
      actor: actorFrom(lead.personId),
      action: 'stall_request.amended',
      requestId,
      onBehalfOfAccountId: accountId,
      changes: [{ field: 'stallName', before: 'A', after: 'B' }],
    });

    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { requestId, action: 'stall_request.amended' },
    });
    expect(row.onBehalfOfAccountId).toBe(accountId);
    expect(row.changes).toEqual([{ field: 'stallName', before: 'A', after: 'B' }]);
    const trail = await prisma.activityTrail.findFirstOrThrow({
      where: { subjectRef: requestId, action: 'stall_request.amended' },
    });
    expect(trail.detail).toMatchObject({
      onBehalfOfAccountId: accountId,
      changes: [{ field: 'stallName', before: 'A', after: 'B' }],
    });
  });

  test('runs inside the caller’s transaction, so a rolled-back write leaves no row', async () => {
    await edition();
    const { requestId } = await selected(['C1-1']);
    const lead = await seedBackoffice(['stalls_lead']);
    const before = await prisma.stallAuditEvent.count();
    await expect(
      prisma.$transaction(async (tx) => {
        await audit(tx, {
          actor: actorFrom(lead.personId),
          action: 'stall_request.flagged',
          requestId,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.stallAuditEvent.count()).toBe(before);
  });

  test('a backoffice sign-in is its own row with no subject but the person', async () => {
    const lead = await seedBackoffice(['stalls_lead']);
    await auditBackofficeSignIn(prisma, { personId: lead.personId, displayName: 'Deepa' });
    const row = await prisma.stallAuditEvent.findFirstOrThrow({
      where: { action: 'stall_backoffice.signed_in' },
    });
    expect(row.actorRef).toBe(lead.personId);
    expect(row.actorName).toBe('Deepa');
    expect(row.subjectType).toBe('person');
    expect(row.subjectRef).toBe(lead.personId);
  });
});

describe('the requester’s own actions are recorded against their account', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false, mail: new LogMailer(), files: fakeStore() });
  });
  afterAll(() => app.close());

  const pub = (
    method: 'GET' | 'POST',
    url: string,
    payload?: Record<string, unknown>,
    cookies?: Record<string, string>,
  ) => app.inject({ method, url: `/api/m/stalls/public${url}`, payload, cookies });

  const rows = (action: string) => prisma.stallAuditEvent.findMany({ where: { action } });

  test('register, log in, fail a login, log out', async () => {
    await edition();
    const { accountId, cookies } = await seedRequester(app);

    const registered = await rows('stall_account.registered');
    expect(registered).toHaveLength(1);
    expect(registered[0].actorRef).toBe(accountId);
    expect(registered[0].channel).toBe('PORTAL');

    expect(await rows('stall_account.logged_in')).toHaveLength(1);

    const bad = await pub('POST', '/login', {
      contact: 'priya@greenleaf.example',
      password: 'wrong-wrong',
    });
    expect(bad.statusCode).toBe(401);
    const failed = await rows('stall_account.login_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].actorKind).toBe('SYSTEM');
    expect(failed[0].outcome).toBe('FAILED');
    // The contact is a hint, never a way to read who tried.
    expect(failed[0].detail).toEqual({ contact: 'p…@greenleaf.example' });

    await pub('POST', '/logout', {}, cookies);
    expect(await rows('stall_account.logged_out')).toHaveLength(1);
  });

  test('filing a request is stall_request.filed, by the account, on the request', async () => {
    await edition();
    const { accountId, cookies } = await seedRequester(app);
    const res = await pub('POST', '/requests', vendorBody(), cookies);
    expect(res.statusCode).toBe(201);
    const [row] = await rows('stall_request.filed');
    expect(row.actorKind).toBe('REQUESTER');
    expect(row.actorRef).toBe(accountId);
    expect(row.requestId).not.toBeNull();
    expect(row.onBehalfOfAccountId).toBeNull();
    expect(row.detail).toMatchObject({
      reference: expect.stringMatching(/^VEN-/),
      requestType: 'VENDOR',
    });
  });

  test('asking for the access link is recorded only when it matched', async () => {
    await edition();
    await seedRequester(app);
    await pub('POST', '/access-link', { contact: 'priya@greenleaf.example' });
    await pub('POST', '/access-link', { contact: 'nobody@example.org' });
    const asked = await rows('stall_account.access_link_requested');
    expect(asked).toHaveLength(1);
    expect(asked[0].actorKind).toBe('REQUESTER');

    await pub('POST', '/password-reset', { contact: 'priya@greenleaf.example' });
    expect(await rows('stall_account.password_reset_requested')).toHaveLength(1);
  });

  test('the FSSAI upload, a staff registration and a payment claim each leave a PORTAL row', async () => {
    await edition();
    const { requestId } = await selected(['C1-1']);
    const r = await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } });
    const who = requesterActor(r.accountId);

    await submitFssai(
      prisma,
      requestId,
      {
        stallName: r.stallName,
        files: [{ key: 'stalls/fssai/00000000-0000-4000-8000-000000000000.pdf', name: 'c.pdf' }],
        declarationIds: [],
      },
      who,
    );
    const coupon = await ensureCoupon(prisma, requestId, r.stallName, 2026, who);
    await registerStaff(
      prisma,
      {
        couponCode: coupon.code,
        name: 'Arun',
        mobile: '9840099999',
        idType: 'AADHAAR',
        idNumber: '1234',
        declarationIds: [],
      },
      who,
    );
    await submitPaymentClaim(
      prisma,
      requestId,
      {
        reference: r.reference,
        purpose: 'RENT',
        referenceNo: 'UTR12345',
        amountPaise: 100,
        paidOn: '2026-09-01',
      },
      who,
    );

    for (const action of [
      'stall_fssai.submitted',
      'stall_vendor_staff.registered',
      'stall_payment_claim.submitted',
    ]) {
      const [row] = await rows(action);
      expect(row, action).toBeDefined();
      expect(row.actorKind, action).toBe('REQUESTER');
      expect(row.requestId, action).toBe(requestId);
    }
    const [staff] = await rows('stall_vendor_staff.registered');
    expect(staff.subjectType).toBe('vendor_staff');
    expect(staff.detail).toMatchObject({ mobile: '9840099999' });
  });
});

describe('outbound mail and WhatsApp leave a row each', () => {
  test('a sent email is OK and filed against the request it names', async () => {
    await edition();
    const { requestId } = await selected(['C1-1']);
    const inner = new LogMailer();
    const mail = auditedMailer(prisma, inner);
    await mail.send({ to: 'v@example.org', subject: 'Hello', text: 'x', about: { requestId } });
    expect(inner.sent).toHaveLength(1);
    const [row] = await prisma.stallAuditEvent.findMany({ where: { action: 'stall_email.sent' } });
    expect(row.requestId).toBe(requestId);
    expect(row.actorKind).toBe('SYSTEM');
    expect(row.outcome).toBe('OK');
    expect(row.detail).toEqual({ to: 'v@example.org', subject: 'Hello' });
  });

  test('a failed send is FAILED, the row still lands, and the error still propagates', async () => {
    await edition();
    const failing = {
      send: async () => {
        throw new Error('smtp down');
      },
    };
    const mail = auditedMailer(prisma, failing);
    await expect(mail.send({ to: 'v@example.org', subject: 'Hello', text: 'x' })).rejects.toThrow(
      'smtp down',
    );
    const [row] = await prisma.stallAuditEvent.findMany({
      where: { action: 'stall_email.failed' },
    });
    expect(row.outcome).toBe('FAILED');
    expect(row.detail).toEqual({ to: 'v@example.org', subject: 'Hello', error: 'smtp down' });
  });

  test('WhatsApp is recorded the same way, by number', async () => {
    await edition();
    const sent: unknown[] = [];
    const wa = auditedWhatsApp(prisma, {
      send: async (m) => {
        sent.push(m);
      },
    });
    await wa.send({ to: '9840012345', text: 'hi' });
    expect(sent).toHaveLength(1);
    const [row] = await prisma.stallAuditEvent.findMany({
      where: { action: 'stall_whatsapp.sent' },
    });
    expect(row.detail).toEqual({ to: '9840012345' });
  });

  test('the receipt a submission sends is filed against the new request', async () => {
    await edition();
    const inner = new LogMailer();
    const r = await submitRequest(
      prisma,
      SubmitRequestInput.parse(vendorBody()),
      { mail: auditedMailer(prisma, inner), statusUrl: (t) => t },
      await accountFor(),
    );
    const [row] = await prisma.stallAuditEvent.findMany({ where: { action: 'stall_email.sent' } });
    expect(row.requestId).toBe(r.requestId);
  });

  test('the dev sign-in records a backoffice sign-in', async () => {
    const signin = await buildApp({ logger: false, mail: new LogMailer(), files: fakeStore() });
    try {
      const lead = await seedBackoffice(['stalls_lead'], 'signin-lead@example.org');
      const res = await signin.inject({
        method: 'POST',
        url: '/api/dev/signin',
        payload: { email: 'signin-lead@example.org' },
      });
      expect(res.statusCode).toBe(200);
      const [row] = await prisma.stallAuditEvent.findMany({
        where: { action: 'stall_backoffice.signed_in' },
      });
      expect(row.actorRef).toBe(lead.personId);
    } finally {
      await signin.close();
    }
  });
});
