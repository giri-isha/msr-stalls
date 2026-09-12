import { beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@msr/stalls';
import type { StallEdition } from '@prisma/client';
import {
  InvalidTransitionError,
  StallAlreadyAllocatedError,
  StallBlockedError,
  TooManyStallsError,
  UnknownStallError,
} from '../src/modules/stalls/errors';
import {
  backupRequest,
  cancelRequest,
  rejectRequest,
  releaseAllocation,
  selectRequest,
  shortlist,
} from '../src/modules/stalls/selection';
import { submitRequest } from '../src/modules/stalls/submit';
import { LogMailer, SYSTEM, prisma, resetDatabase, seedEdition, vendorBody } from './helpers/db';
import { makeStalls } from './helpers/plan';

let edition: StallEdition;
beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 5 });
});

const submit = (body: Record<string, unknown> = {}) =>
  submitRequest(prisma, SubmitRequestInput.parse(vendorBody(body)), {
    mail: new LogMailer(),
    statusUrl: (t) => t,
  });

const statusOf = async (id: string) =>
  (await prisma.stallRequest.findUniqueOrThrow({ where: { id } })).status;
const liveAllocations = (stallNumber: string) =>
  prisma.stallAllocation.count({ where: { stall: { number: stallNumber }, releasedAt: null } });

describe('the single-occupant guarantee', () => {
  test('two staff selecting the same stall at once: exactly one succeeds', async () => {
    const a = await submit({ email: 'a@x.com' });
    const b = await submit({ email: 'b@x.com' });

    const results = await Promise.allSettled([
      selectRequest(prisma, { requestId: a.requestId, stallNumbers: ['A4-1'] }, 'staff-1'),
      selectRequest(prisma, { requestId: b.requestId, stallNumbers: ['A4-1'] }, 'staff-2'),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(StallAlreadyAllocatedError);
    expect(await liveAllocations('A4-1')).toBe(1);
    // The loser's transaction rolled back entirely — it is not half-selected.
    const statuses = await Promise.all([statusOf(a.requestId), statusOf(b.requestId)]);
    expect(statuses.sort()).toEqual(['SELECTED', 'SUBMITTED']);
  });

  test('a stall already allocated is refused with a clear error, not a constraint dump', async () => {
    const a = await submit({ email: 'a@x.com' });
    const b = await submit({ email: 'b@x.com' });
    await selectRequest(prisma, { requestId: a.requestId, stallNumbers: ['A4-2'] }, SYSTEM);
    await expect(
      selectRequest(prisma, { requestId: b.requestId, stallNumbers: ['A4-2'] }, SYSTEM),
    ).rejects.toBeInstanceOf(StallAlreadyAllocatedError);
  });
});

describe('selectRequest', () => {
  test('allocates, marks the stall, and moves the request to SELECTED', async () => {
    const r = await submit({ numStallsRequested: 2 });
    const out = await selectRequest(
      prisma,
      { requestId: r.requestId, stallNumbers: ['A4-1', 'A4-2'] },
      SYSTEM,
    );
    expect(out.allocated).toEqual(['A4-1', 'A4-2']);
    expect(await statusOf(r.requestId)).toBe('SELECTED');
    const s = await prisma.stall.findFirstOrThrow({ where: { number: 'A4-1' } });
    expect(s.status).toBe('ALLOCATED');
  });

  test('fewer stalls than requested is fine; more is refused', async () => {
    const r = await submit({ numStallsRequested: 2 });
    await selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-1'] }, SYSTEM);
    await expect(
      selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-2', 'A4-3'] }, SYSTEM),
    ).rejects.toBeInstanceOf(TooManyStallsError);
    expect(await liveAllocations('A4-2')).toBe(0);
  });

  test('a blocked stall cannot be allocated', async () => {
    await prisma.stall.updateMany({ where: { number: 'A4-3' }, data: { status: 'BLOCKED' } });
    const r = await submit();
    await expect(
      selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-3'] }, SYSTEM),
    ).rejects.toBeInstanceOf(StallBlockedError);
  });

  test('an unknown stall number is refused', async () => {
    const r = await submit();
    await expect(
      selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-99'] }, SYSTEM),
    ).rejects.toBeInstanceOf(UnknownStallError);
    await expect(
      selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['Z9-1'] }, SYSTEM),
    ).rejects.toBeInstanceOf(UnknownStallError);
  });

  test('a rejected request cannot be selected', async () => {
    const r = await submit();
    await rejectRequest(prisma, r.requestId, 'no FSSAI', SYSTEM);
    await expect(
      selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-1'] }, SYSTEM),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  test('writes an activity trail entry naming the stalls', async () => {
    const r = await submit();
    await selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-1'] }, 'lead-1');
    const trail = await prisma.activityTrail.findMany({
      where: { subjectRef: r.requestId, action: 'stall_request.selected' },
    });
    expect(trail).toHaveLength(1);
    expect(trail[0].actorRef).toBe('lead-1');
    expect(trail[0].detail).toMatchObject({ stalls: ['A4-1'] });
  });
});

describe('status machine', () => {
  test('submitted → shortlisted → backup → selected', async () => {
    const r = await submit();
    await shortlist(prisma, r.requestId, SYSTEM);
    expect(await statusOf(r.requestId)).toBe('SHORTLISTED');
    await backupRequest(prisma, r.requestId, SYSTEM);
    expect(await statusOf(r.requestId)).toBe('BACKUP');
    await selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-1'] }, SYSTEM);
    expect(await statusOf(r.requestId)).toBe('SELECTED');
  });

  test('rejecting a selected request releases its stalls', async () => {
    const r = await submit({ numStallsRequested: 2 });
    await selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-1', 'A4-2'] }, SYSTEM);
    await rejectRequest(prisma, r.requestId, 'vendor withdrew', SYSTEM);
    expect(await statusOf(r.requestId)).toBe('REJECTED');
    expect(await liveAllocations('A4-1')).toBe(0);
    expect(await liveAllocations('A4-2')).toBe(0);
    const s = await prisma.stall.findFirstOrThrow({ where: { number: 'A4-1' } });
    expect(s.status).toBe('AVAILABLE');
    // The history row survives release.
    expect(await prisma.stallAllocation.count({ where: { requestId: r.requestId } })).toBe(2);
  });

  test('a cancelled request is terminal', async () => {
    const r = await submit();
    await selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-1'] }, SYSTEM);
    await cancelRequest(prisma, r.requestId, SYSTEM);
    await expect(shortlist(prisma, r.requestId, SYSTEM)).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  test('shortlisting a selected request is not allowed', async () => {
    const r = await submit();
    await selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-1'] }, SYSTEM);
    await expect(shortlist(prisma, r.requestId, SYSTEM)).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });
});

describe('releaseAllocation', () => {
  test('frees one stall and keeps the request selected with the rest', async () => {
    const r = await submit({ numStallsRequested: 2 });
    await selectRequest(prisma, { requestId: r.requestId, stallNumbers: ['A4-1', 'A4-2'] }, SYSTEM);
    const a = await prisma.stallAllocation.findFirstOrThrow({
      where: { requestId: r.requestId, stall: { number: 'A4-1' } },
    });
    await releaseAllocation(prisma, a.id, SYSTEM);
    expect(await liveAllocations('A4-1')).toBe(0);
    expect(await liveAllocations('A4-2')).toBe(1);
    expect(await statusOf(r.requestId)).toBe('SELECTED');
    // And the freed stall can be taken by someone else.
    const other = await submit({ email: 'other@x.com' });
    await selectRequest(prisma, { requestId: other.requestId, stallNumbers: ['A4-1'] }, SYSTEM);
    expect(await liveAllocations('A4-1')).toBe(1);
  });
});
