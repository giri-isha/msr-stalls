// What this module declares to the Foundation, and how a route checks a caller.
//
// Host ADR 0016: the Foundation stores a module's KEY and NAME and nothing
// else. Roles, and what each permits, are this module's own fact — declared in
// `@msr/stalls` (pure, testable) and granted on this module's own table
// (`StallStaffRole`). The host's `module-roles.ts` will read `ROLES` from here
// to learn which keys are grantable, exactly as it reads the other modules'.
import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { MODULE_KEY, ROLES, type StallAction, can } from '@msr/stalls';
import { getCurrentPerson } from '../../auth';
import { NotAuthorizedError } from '../../errors';

export { MODULE_KEY, ROLES };
export const MODULE_NAME = 'Stalls';

export interface StaffCaller {
  personId: string;
  displayName: string;
  roleKeys: string[];
}

/** Thrown by `requireStaff` when there is no session at all. Mapped to 401 —
 *  distinct from `NotAuthorizedError` (403), because "sign in" and "you may
 *  not" are different instructions to the caller. */
export class NotSignedInError extends Error {
  constructor() {
    super('sign in required');
    this.name = 'NotSignedInError';
  }
}

/** Who is calling, and what this module has granted them. A signed-in person
 *  with NO stalls grants is a valid caller who can do nothing — that is a 403
 *  from `requireAction`, not a 401 from here. */
export async function requireStaff(req: FastifyRequest, db: PrismaClient): Promise<StaffCaller> {
  const person = await getCurrentPerson(req, db);
  if (!person) throw new NotSignedInError();
  const grants = await db.stallStaffRole.findMany({
    where: { personRef: person.personId },
    select: { roleKey: true },
  });
  return {
    personId: person.personId,
    displayName: person.displayName,
    roleKeys: grants.map((g) => g.roleKey),
  };
}

export function requireAction(caller: StaffCaller, action: StallAction): void {
  if (!can(caller.roleKeys, action)) {
    throw new NotAuthorizedError(`${action} requires a stalls role that grants it`);
  }
}

/** For a read several roles reach by different routes — the bay list, which
 *  every screen that filters by bay needs and no role should have to hold
 *  `config:read` for. Not a general escape hatch: a write always names one
 *  action, because "any of these may change it" is how a guard stops meaning
 *  anything. */
export function requireAnyAction(caller: StaffCaller, actions: StallAction[]): void {
  if (!actions.some((a) => can(caller.roleKeys, a))) {
    throw new NotAuthorizedError(`${actions.join(' or ')} requires a stalls role that grants it`);
  }
}
