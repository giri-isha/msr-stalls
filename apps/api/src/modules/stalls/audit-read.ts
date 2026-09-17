// The audit log, read back. Two questions: the edition's log with filters, and
// one request's timeline.
//
// ⚠️ Scope is applied to REQUEST-BOUND rows only. A row about a role, a bay or
// an account has no requester type to narrow by, and hiding it from a scoped
// reader would hide the config changes that explain what they are looking at.
// Whether they may read at all is `audit.read`, checked by the route.
import type { Prisma, StallAuditEvent } from '@prisma/client';
import {
  type AuditEventView,
  type AuditPage,
  type ListAuditQuery,
  describeAuditAction,
} from '@stalls/core';
import type { Db } from './editions';
import { type RequestScope, scopeWhere } from './scope';

type Row = StallAuditEvent & {
  request: { reference: string; requestType: string } | null;
};

const INCLUDE = { request: { select: { reference: true, requestType: true } } } as const;

async function toViews(db: Db, rows: Row[]): Promise<AuditEventView[]> {
  // One lookup for every on-behalf-of name on the page, not one per row.
  const behalfIds = [
    ...new Set(rows.map((r) => r.onBehalfOfAccountId).filter((x): x is string => !!x)),
  ];
  const names = new Map(
    behalfIds.length
      ? (
          await db.stallAccount.findMany({
            where: { id: { in: behalfIds } },
            select: { id: true, displayName: true },
          })
        ).map((a) => [a.id, a.displayName] as const)
      : [],
  );
  return rows.map((r) => {
    const info = describeAuditAction(r.action);
    return {
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      action: r.action,
      label: info.label,
      family: info.family,
      glyph: info.glyph,
      tone: info.tone,
      actorKind: r.actorKind,
      actorRef: r.actorRef,
      actorName: r.actorName,
      onBehalfOf: r.onBehalfOfAccountId
        ? {
            accountId: r.onBehalfOfAccountId,
            displayName: names.get(r.onBehalfOfAccountId) ?? 'a requester',
          }
        : null,
      channel: r.channel,
      subjectType: r.subjectType,
      subjectRef: r.subjectRef,
      requestId: r.requestId,
      reference: r.request?.reference ?? null,
      requestType: r.request?.requestType ?? null,
      changes: (r.changes as AuditEventView['changes']) ?? null,
      detail: (r.detail as Record<string, unknown>) ?? {},
      outcome: r.outcome,
    };
  });
}

/** Start of the day, inclusive. A date filter is the server's day: the log is
 *  read where it is written. */
const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`);
const dayEnd = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);

export async function listAudit(
  db: Db,
  editionId: string,
  scope: RequestScope,
  q: ListAuditQuery,
): Promise<AuditPage> {
  const and: Prisma.StallAuditEventWhereInput[] = [
    // This edition's rows, and the rows that belong to no edition — roles,
    // people, accounts — which every reader of the log has reason to see.
    { OR: [{ editionId }, { editionId: null }] },
  ];
  const scoped = scope.requestTypes !== null || scope.zones !== null;
  if (scoped) and.push({ OR: [{ requestId: null }, { request: scopeWhere(scope) }] });
  if (q.action) and.push({ action: q.action });
  if (q.actorKind) and.push({ actorKind: q.actorKind });
  if (q.actorRef) and.push({ actorRef: q.actorRef });
  if (q.requestId) and.push({ requestId: q.requestId });
  if (q.from) and.push({ occurredAt: { gte: dayStart(q.from) } });
  if (q.to) and.push({ occurredAt: { lt: dayEnd(q.to) } });
  if (q.q) {
    const contains = { contains: q.q, mode: 'insensitive' as const };
    and.push({
      OR: [{ actorName: contains }, { action: contains }, { request: { reference: contains } }],
    });
  }
  const where: Prisma.StallAuditEventWhereInput = { AND: and };

  const [total, rows] = await Promise.all([
    db.stallAuditEvent.count({ where }),
    db.stallAuditEvent.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: q.page * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { items: await toViews(db, rows), total, page: q.page, pageSize: q.pageSize };
}

/** One request's rows, newest first. The route has already checked scope.
 *
 *  `actionPrefix` narrows the trail to one screen's own actions — what the
 *  chairs-and-tables counter is shown, which it may read on `equipment.read`
 *  because it is the counter's own work rather than the request's whole life.
 *  The unnarrowed call is the Activity Log tab, and that one is `audit.read`. */
export async function requestAudit(
  db: Db,
  requestId: string,
  actionPrefix?: string,
): Promise<AuditEventView[]> {
  const rows = await db.stallAuditEvent.findMany({
    where: { requestId, ...(actionPrefix ? { action: { startsWith: actionPrefix } } : {}) },
    include: INCLUDE,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
  });
  return toViews(db, rows);
}
