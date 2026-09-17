// The ONE place the module records that something happened.
//
// 🔴 Two tables, one call. `audit()` inserts the module's own
// `StallAuditEvent` — what the Audit Logs page and a request's Activity Log
// read — and forwards the same event to the host's `recordActivity`, so the
// host's console goes on seeing everything this module does. This file is the
// only one allowed to import `../../activity`; the boundary rule says so.
//
// ⚠️ Runs on whatever client it is handed. Inside a transaction the row commits
// with the write it describes or not at all; a write with no audit row cannot
// happen from a seam that passes its `tx` here.
import type { Prisma, StallAuditActorKind, StallAuditChannel } from '@prisma/client';
import {
  type AuditAction,
  type AuditChange,
  type AuditChannel,
  SYSTEM_ACTOR_REF,
} from '@stalls/core';
import { recordActivity } from '../../activity';
import type { Db } from './editions';
import { MODULE_KEY } from './roles';

export type AuditActor =
  | { kind: 'BACKOFFICE'; personId: string; name?: string }
  | { kind: 'REQUESTER'; accountId: string; name?: string }
  | { kind: 'SYSTEM' };

/** The `by` string every seam already takes, read as an actor. The seed and
 *  the tests pass the all-zero uuid for "nobody in particular", and that is
 *  the SYSTEM actor; anything else is a backoffice member's `person_id`. */
export function actorFrom(by: string): AuditActor {
  return by === SYSTEM_ACTOR_REF ? { kind: 'SYSTEM' } : { kind: 'BACKOFFICE', personId: by };
}

export function requesterActor(accountId: string, name?: string): AuditActor {
  return { kind: 'REQUESTER', accountId, name };
}

export interface AuditInput {
  actor: AuditActor;
  action: AuditAction;
  /** Defaults to the request when `requestId` is set. */
  subject?: { type: string; ref: string };
  requestId?: string | null;
  accountId?: string | null;
  /** Resolved from the request when absent and a request is named. */
  editionId?: string | null;
  onBehalfOfAccountId?: string | null;
  /** Defaults from the actor: a member acts from the BACKOFFICE, a requester
   *  from the PORTAL, and the system from nowhere in particular. */
  channel?: AuditChannel;
  changes?: AuditChange[];
  detail?: Record<string, unknown>;
  outcome?: 'OK' | 'FAILED';
}

const CHANNEL_OF: Record<AuditActor['kind'], StallAuditChannel> = {
  BACKOFFICE: 'BACKOFFICE',
  REQUESTER: 'PORTAL',
  SYSTEM: 'SYSTEM',
};

/** 🔴 The name is looked up ONLY for a ref shaped like an id, and a ref that
 *  matches nothing falls back to itself.
 *
 *  The audit row must never be the thing that fails a write. A `by` that is
 *  not a person — a seeded constant, a fixture's `'lead-1'`, a stale id whose
 *  row is gone — would otherwise raise inside `findUnique` and, because the
 *  call runs in the caller's transaction, roll back the very write it was
 *  recording. Same rule as `rbac.ts`'s unknown role key: an actor nobody can
 *  name reads as that name, not as a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function nameOf(ref: string, look: () => Promise<{ displayName: string } | null>) {
  if (!UUID.test(ref)) return ref;
  try {
    return (await look())?.displayName ?? ref;
  } catch {
    return ref;
  }
}

async function resolveActor(
  db: Db,
  actor: AuditActor,
): Promise<{ kind: StallAuditActorKind; ref: string; name: string }> {
  if (actor.kind === 'SYSTEM') return { kind: 'SYSTEM', ref: SYSTEM_ACTOR_REF, name: 'System' };
  if (actor.kind === 'BACKOFFICE') {
    const name =
      actor.name ??
      (await nameOf(actor.personId, () =>
        db.person.findUnique({
          where: { personId: actor.personId },
          select: { displayName: true },
        }),
      ));
    return { kind: 'BACKOFFICE', ref: actor.personId, name };
  }
  const name =
    actor.name ??
    (await nameOf(actor.accountId, () =>
      db.stallAccount.findUnique({
        where: { id: actor.accountId },
        select: { displayName: true },
      }),
    ));
  return { kind: 'REQUESTER', ref: actor.accountId, name };
}

export async function audit(db: Db, input: AuditInput): Promise<void> {
  const actor = await resolveActor(db, input.actor);
  const requestId = input.requestId ?? null;
  const subject = input.subject ?? (requestId ? { type: 'request', ref: requestId } : null);
  if (!subject) throw new Error(`audit(${input.action}) needs a subject or a requestId`);

  const editionId =
    input.editionId ??
    (requestId
      ? ((
          await db.stallRequest.findUnique({
            where: { id: requestId },
            select: { editionId: true },
          })
        )?.editionId ?? null)
      : null);
  // ⚠️ A relation column, so only a real id may go in it. An actor ref that is
  // not one still names the actor in `actor_ref`, which is text — the row says
  // who without claiming a row that is not there.
  const claimed =
    input.accountId ?? (input.actor.kind === 'REQUESTER' ? input.actor.accountId : null);
  const accountId = claimed && UUID.test(claimed) ? claimed : null;
  const detail = input.detail ?? {};

  await db.stallAuditEvent.create({
    data: {
      editionId,
      requestId,
      accountId,
      actorKind: actor.kind,
      actorRef: actor.ref,
      actorName: actor.name,
      onBehalfOfAccountId: input.onBehalfOfAccountId ?? null,
      channel: input.channel ?? CHANNEL_OF[input.actor.kind],
      action: input.action,
      subjectType: subject.type,
      subjectRef: subject.ref,
      changes: input.changes ? (input.changes as unknown as Prisma.InputJsonValue) : undefined,
      detail: detail as Prisma.InputJsonValue,
      outcome: input.outcome ?? 'OK',
    },
  });

  // The host's trail has no columns for on-behalf-of or a change set, so they
  // ride in `detail` — where its console already shows whatever is there.
  await recordActivity(db, {
    actorRef: actor.ref,
    moduleKey: MODULE_KEY,
    action: input.action,
    subjectRef: subject.ref,
    detail: {
      ...detail,
      subjectType: subject.type,
      ...(input.onBehalfOfAccountId ? { onBehalfOfAccountId: input.onBehalfOfAccountId } : {}),
      ...(input.changes ? { changes: input.changes } : {}),
      ...(input.outcome === 'FAILED' ? { outcome: 'FAILED' } : {}),
    },
  });
}

/** A backoffice member signing in.
 *
 *  ⚠️ Exported for the SHELL to call — `app.ts` after `devLogin`. The module
 *  cannot see the sign-in itself; here it is a dev route, in the host it is
 *  Isha SSO's callback, and whichever composition root owns it calls this. See
 *  `docs/migration-to-host.md`. */
export async function auditBackofficeSignIn(
  db: Db,
  person: { personId: string; displayName: string },
): Promise<void> {
  await audit(db, {
    actor: { kind: 'BACKOFFICE', personId: person.personId, name: person.displayName },
    action: 'stall_backoffice.signed_in',
    subject: { type: 'person', ref: person.personId },
  });
}
