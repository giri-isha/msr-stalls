import { Prisma, type PrismaClient, type StallRequestStatus } from '@prisma/client';
import { parseStallNumber } from '@stalls/core';
import { recordActivity } from '../../activity';
import {
  InvalidTransitionError,
  StallAlreadyAllocatedError,
  StallBlockedError,
  TooManyStallsError,
  UnknownRequestError,
  UnknownStallError,
  UnknownZoneError,
} from './errors';
import { MODULE_KEY } from './roles';

/** The selection status machine. Anything not listed is an
 *  `InvalidTransitionError`. Rejecting is allowed from any live status — the
 *  team does reject after selecting when a vendor drops out. */
const ALLOWED: Record<StallRequestStatus, StallRequestStatus[]> = {
  SUBMITTED: ['SHORTLISTED', 'SELECTED', 'BACKUP', 'REJECTED'],
  SHORTLISTED: ['SELECTED', 'BACKUP', 'REJECTED', 'SUBMITTED'],
  BACKUP: ['SELECTED', 'REJECTED', 'SHORTLISTED'],
  SELECTED: ['REJECTED', 'CANCELLED'],
  REJECTED: ['SHORTLISTED'],
  CANCELLED: [],
};

function assertTransition(from: StallRequestStatus, to: StallRequestStatus): void {
  if (!ALLOWED[from].includes(to)) throw new InvalidTransitionError(from, to);
}

async function transition(
  db: PrismaClient,
  id: string,
  to: StallRequestStatus,
  by: string,
  extra: { rejectReason?: string } = {},
): Promise<void> {
  await db.$transaction(async (tx) => {
    const req = await tx.stallRequest.findUnique({ where: { id }, select: { status: true } });
    if (!req) throw new UnknownRequestError(id);
    assertTransition(req.status, to);
    await tx.stallRequest.update({
      where: { id },
      data: { status: to, rejectReason: extra.rejectReason ?? null },
    });
    // Leaving SELECTED frees the stalls — a rejected or cancelled request must
    // not keep holding positions another vendor could take.
    if (req.status === 'SELECTED' && to !== 'SELECTED') {
      await releaseAllForRequest(tx, id, by);
    }
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: `stall_request.${to.toLowerCase()}`,
      subjectRef: id,
      detail: { from: req.status, ...extra },
    });
  });
}

export const shortlist = (db: PrismaClient, id: string, by: string) =>
  transition(db, id, 'SHORTLISTED', by);
export const backupRequest = (db: PrismaClient, id: string, by: string) =>
  transition(db, id, 'BACKUP', by);
export const unshortlist = (db: PrismaClient, id: string, by: string) =>
  transition(db, id, 'SUBMITTED', by);
export const rejectRequest = (db: PrismaClient, id: string, reason: string, by: string) =>
  transition(db, id, 'REJECTED', by, { rejectReason: reason });
export const cancelRequest = (db: PrismaClient, id: string, by: string) =>
  transition(db, id, 'CANCELLED', by);

async function releaseAllForRequest(tx: Prisma.TransactionClient, requestId: string, by: string) {
  const live = await tx.stallAllocation.findMany({ where: { requestId, releasedAt: null } });
  for (const a of live) {
    await tx.stallAllocation.update({
      where: { id: a.id },
      data: { activeStallId: null, releasedAt: new Date(), releasedBy: by },
    });
    await tx.stall.update({ where: { id: a.stallId }, data: { status: 'AVAILABLE' } });
  }
}

/** Select a request and allocate it stalls, atomically.
 *
 *  The single-occupant guarantee is the UNIQUE constraint on
 *  `StallAllocation.activeStallId`. This function does check the stall's
 *  status first — so the common case gets a clear error before touching the
 *  constraint — but it does not RELY on that check: two backoffice members can both read
 *  AVAILABLE and both proceed, and then exactly one insert succeeds. The
 *  other's P2002 becomes `StallAlreadyAllocatedError`, and its transaction
 *  rolls back, so it never half-selects. */
export async function selectRequest(
  db: PrismaClient,
  input: { requestId: string; stallNumbers: string[]; agreedZoneCode?: string },
  by: string,
): Promise<{ allocated: string[] }> {
  try {
    return await db.$transaction(async (tx) => {
      const req = await tx.stallRequest.findUnique({
        where: { id: input.requestId },
        include: { allocations: { where: { releasedAt: null } } },
      });
      if (!req) throw new UnknownRequestError(input.requestId);
      if (req.status !== 'SELECTED') assertTransition(req.status, 'SELECTED');

      // 🔴 The bay is agreed BEFORE a stall number exists — "the side will be
      // decided, but the stall number may not be still put at the time of the
      // payment" — and the bay is what the stall is PRICED at. Recording it
      // here is what stops a vendor moved from A3 to B2 being quoted A3's rent
      // in a payment letter that goes out days before any number exists.
      if (input.agreedZoneCode) {
        const zone = await tx.stallZone.findFirst({
          where: { editionId: req.editionId, code: input.agreedZoneCode },
          select: { code: true },
        });
        if (!zone) throw new UnknownZoneError(input.agreedZoneCode);
        await tx.stallRequest.update({
          where: { id: req.id },
          data: { agreedZoneCode: zone.code },
        });
      }

      const offered = req.allocations.length + input.stallNumbers.length;
      if (offered > req.numStallsRequested) {
        throw new TooManyStallsError(req.numStallsRequested, offered);
      }

      const allocated: string[] = [];
      for (const number of input.stallNumbers) {
        const parsed = parseStallNumber(number);
        if (!parsed) throw new UnknownStallError(number);
        const stall = await tx.stall.findFirst({
          where: { number, zone: { editionId: req.editionId, code: parsed.zone } },
        });
        if (!stall) throw new UnknownStallError(number);
        if (stall.status === 'BLOCKED') throw new StallBlockedError(number);
        if (stall.status === 'ALLOCATED') throw new StallAlreadyAllocatedError(number);

        await tx.stallAllocation.create({
          data: {
            requestId: req.id,
            stallId: stall.id,
            activeStallId: stall.id,
            allocatedBy: by,
          },
        });
        await tx.stall.update({ where: { id: stall.id }, data: { status: 'ALLOCATED' } });
        allocated.push(number);
      }

      await tx.stallRequest.update({ where: { id: req.id }, data: { status: 'SELECTED' } });
      await recordActivity(tx, {
        actorRef: by,
        moduleKey: MODULE_KEY,
        action: 'stall_request.selected',
        subjectRef: req.id,
        detail: {
          from: req.status,
          stalls: allocated,
          ...(input.agreedZoneCode ? { agreedZone: input.agreedZoneCode } : {}),
        },
      });
      return { allocated };
    });
  } catch (err) {
    // The constraint fired: someone else took a stall between our read and our
    // insert. Which one is in the error's target; the first requested number
    // is the best we can name if Prisma does not say.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new StallAlreadyAllocatedError(input.stallNumbers[0] ?? '?');
    }
    throw err;
  }
}

/** Move a live allocation onto another stall, atomically.
 *
 *  ⚠️ NOT a release followed by a select, which is what the screens would
 *  otherwise have to do. Between those two calls the stall being moved TO is
 *  free for another coordinator to take, and the request sits holding one stall
 *  fewer than it was given — so a typo correction can cost a vendor their
 *  pitch. One transaction gives the old stall back and takes the new one
 *  together, and the unique constraint on `activeStallId` decides the race the
 *  same way it decides a selection's.
 *
 *  The old row is NOT rewritten: an allocation row is history, and the record
 *  has to keep saying that this request once stood on that stall. */
export async function moveAllocation(
  db: PrismaClient,
  allocationId: string,
  stallNumber: string,
  by: string,
): Promise<{ stallNumber: string }> {
  try {
    return await db.$transaction(async (tx) => {
      const a = await tx.stallAllocation.findUnique({
        where: { id: allocationId },
        include: { stall: true, request: { select: { editionId: true } } },
      });
      if (!a || a.releasedAt) throw new UnknownRequestError(allocationId);
      // Moving a stall onto itself is what a dialog does when nothing was
      // changed. It is not an error, and it must not write a trail entry.
      if (a.stall.number === stallNumber) return { stallNumber };

      const parsed = parseStallNumber(stallNumber);
      if (!parsed) throw new UnknownStallError(stallNumber);
      const target = await tx.stall.findFirst({
        where: {
          number: stallNumber,
          zone: { editionId: a.request.editionId, code: parsed.zone },
        },
      });
      if (!target) throw new UnknownStallError(stallNumber);
      if (target.status === 'BLOCKED') throw new StallBlockedError(stallNumber);
      if (target.status === 'ALLOCATED') throw new StallAlreadyAllocatedError(stallNumber);

      await tx.stallAllocation.update({
        where: { id: a.id },
        data: { activeStallId: null, releasedAt: new Date(), releasedBy: by },
      });
      await tx.stall.update({ where: { id: a.stallId }, data: { status: 'AVAILABLE' } });
      await tx.stallAllocation.create({
        data: {
          requestId: a.requestId,
          stallId: target.id,
          activeStallId: target.id,
          allocatedBy: by,
        },
      });
      await tx.stall.update({ where: { id: target.id }, data: { status: 'ALLOCATED' } });
      await recordActivity(tx, {
        actorRef: by,
        moduleKey: MODULE_KEY,
        action: 'stall_allocation.moved',
        subjectRef: a.requestId,
        detail: { from: a.stall.number, to: stallNumber },
      });
      return { stallNumber };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new StallAlreadyAllocatedError(stallNumber);
    }
    throw err;
  }
}

export async function releaseAllocation(db: PrismaClient, allocationId: string, by: string) {
  await db.$transaction(async (tx) => {
    const a = await tx.stallAllocation.findUnique({
      where: { id: allocationId },
      include: { stall: true },
    });
    if (!a || a.releasedAt) throw new UnknownRequestError(allocationId);
    await tx.stallAllocation.update({
      where: { id: a.id },
      data: { activeStallId: null, releasedAt: new Date(), releasedBy: by },
    });
    await tx.stall.update({ where: { id: a.stallId }, data: { status: 'AVAILABLE' } });
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_allocation.released',
      subjectRef: a.requestId,
      detail: { stall: a.stall.number },
    });
  });
}
