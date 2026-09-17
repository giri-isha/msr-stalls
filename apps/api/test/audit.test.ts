// The audit log: what `audit()` writes, what the requester's own actions
// leave behind, what every letter out records, and what the two read routes
// answer.
import { beforeEach, describe, expect, test } from 'vitest';
import { SYSTEM_ACTOR_REF } from '@stalls/core';
import {
  actorFrom,
  audit,
  auditBackofficeSignIn,
  requesterActor,
} from '../src/modules/stalls/audit';
import { accountFor, prisma, resetDatabase, seedBackoffice, seedEdition } from './helpers/db';
import { selected } from './helpers/onboarding';
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
