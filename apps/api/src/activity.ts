// FOUNDATION STUB — the host's activity-trail seam, `recordActivity(client,
// event)`, with the host's signature. Discarded at migration.
//
// In the host every write of consequence leaves a row the Admin Console can
// read back. The stalls module calls this on every status transition so the
// trail exists from day one; here it writes to a small table of the same shape
// so the calls are real and the tests can assert on them.
import type { Prisma, PrismaClient } from '@prisma/client';

export type TrailClient = PrismaClient | Prisma.TransactionClient;

export interface ActivityEvent {
  /** Who did it — a `person_id` in the host, a stub id here. */
  actorRef: string;
  /** The module that owns the thing acted on. */
  moduleKey: string;
  /** `stall_request.selected`, `stall_allocation.released`, … — dot-separated,
   *  noun first, so a trail can be filtered by subject. */
  action: string;
  /** The primary subject's id, as text — the trail outlives any one table. */
  subjectRef: string;
  /** Anything the reader needs to make sense of the entry, kept small. */
  detail?: Record<string, unknown>;
}

export async function recordActivity(client: TrailClient, event: ActivityEvent): Promise<void> {
  await client.activityTrail.create({
    data: {
      actorRef: event.actorRef,
      moduleKey: event.moduleKey,
      action: event.action,
      subjectRef: event.subjectRef,
      detail: (event.detail ?? {}) as Prisma.InputJsonValue,
    },
  });
}
