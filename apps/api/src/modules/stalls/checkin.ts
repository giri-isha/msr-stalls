import type { PrismaClient } from '@prisma/client';
import type { CheckInRow } from '@msr/stalls';
import { recordActivity } from '../../activity';
import { flowFor } from './config';
import type { Db } from './editions';
import { UnknownRequestError } from './errors';
import {
  allocatedNumbers,
  factsInclude,
  pendingFor,
  refreshStage,
  type RequestWithFacts,
  staffExpected,
} from './facts';
import { MODULE_KEY } from './roles';
import { type RequestScope, UNSCOPED, scopeWhere } from './scope';

/** The check-in counter.
 *
 *  From the requirement: the volunteer must see "the vendor name, stall number,
 *  number of staff registered in the system, number of vehicle passes" and
 *  "whether any process is pending like payment, FSSAI certificate, all staff
 *  registered".
 *
 *  The pending list is NOT computed here — it is `pendingSteps` from
 *  `@msr/stalls`, the same function the vendor's own portal and the Onboarding
 *  table call. A volunteer at a counter at six in the morning and the vendor
 *  standing in front of them must be looking at the same answer.
 *
 *  Nothing here BLOCKS a check-in. The counter needs to let a stall in with an
 *  outstanding item and a note far more often than it needs to turn one away,
 *  and a volunteer who cannot record what happened stops recording anything.
 */

function toRow(r: RequestWithFacts, flow: Awaited<ReturnType<typeof flowFor>>): CheckInRow {
  return {
    requestId: r.id,
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    contactNumber: r.contactNumber,
    requestType: r.requestType,
    stallNumbers: allocatedNumbers(r),
    staffRegistered: r.staff.length,
    staffExpected: staffExpected(r),
    passes2w: r.passes2w,
    passes4w: r.passes4w,
    passesStaff: r.passesStaff,
    pending: pendingFor(r, flow),
    checkedInAt: r.checkIn?.checkedInAt.toISOString() ?? null,
    checkedInBy: r.checkIn?.checkedInBy ?? null,
    note: r.checkIn?.note ?? null,
  };
}

export async function listCheckIns(
  db: Db,
  editionId: string,
  q?: string,
  scope: RequestScope = UNSCOPED,
): Promise<CheckInRow[]> {
  const term = q?.trim();
  const [rows, flow] = await Promise.all([
    db.stallRequest.findMany({
      where: {
        editionId,
        status: 'SELECTED',
        ...scopeWhere(scope),
        ...(term
          ? {
              OR: [
                { stallName: { contains: term, mode: 'insensitive' } },
                { requesterName: { contains: term, mode: 'insensitive' } },
                { reference: { equals: term, mode: 'insensitive' } },
                { contactNumber: { contains: term.replace(/\D/g, '') || term } },
                {
                  allocations: {
                    some: {
                      releasedAt: null,
                      stall: { number: { contains: term, mode: 'insensitive' } },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: factsInclude,
      orderBy: { stallName: 'asc' },
    }),
    flowFor(db, editionId),
  ]);
  return rows.map((r) => toRow(r, flow));
}

export async function checkIn(
  db: PrismaClient,
  requestId: string,
  note: string | undefined,
  by: string,
): Promise<CheckInRow> {
  const exists = await db.stallRequest.findUnique({
    where: { id: requestId },
    select: { id: true, editionId: true },
  });
  if (!exists) throw new UnknownRequestError(requestId);

  await db.$transaction(async (tx) => {
    await tx.stallCheckIn.upsert({
      where: { requestId },
      create: { requestId, checkedInBy: by, note: note ?? null },
      update: { checkedInAt: new Date(), checkedInBy: by, note: note ?? null },
    });
    // CHECKED_IN is the one stage that is recorded rather than derived, so it
    // is written here and `refreshStage` leaves it alone afterwards.
    await tx.stallRequest.update({ where: { id: requestId }, data: { stage: 'CHECKED_IN' } });
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_request.checked_in',
      subjectRef: requestId,
      detail: note ? { note } : {},
    });
  });

  const fresh = await db.stallRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: factsInclude,
  });
  return toRow(fresh, await flowFor(db, exists.editionId));
}

/** Undoing a check-in — the wrong stall was ticked, which happens at a counter.
 *  The stage falls back to whatever the facts say it should be. */
export async function undoCheckIn(
  db: PrismaClient,
  requestId: string,
  by: string,
): Promise<CheckInRow> {
  const row = await db.stallRequest.findUnique({
    where: { id: requestId },
    select: { id: true, editionId: true, checkIn: { select: { requestId: true } } },
  });
  if (!row) throw new UnknownRequestError(requestId);

  await db.stallCheckIn.deleteMany({ where: { requestId } });
  // Put the stage somewhere derivable before asking for a refresh — otherwise
  // `refreshStage` sees CHECKED_IN and declines to touch it.
  await db.stallRequest.update({ where: { id: requestId }, data: { stage: 'NEW' } });
  await refreshStage(db, requestId);
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_request.check_in_undone',
    subjectRef: requestId,
  });

  const fresh = await db.stallRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: factsInclude,
  });
  return toRow(fresh, await flowFor(db, row.editionId));
}
