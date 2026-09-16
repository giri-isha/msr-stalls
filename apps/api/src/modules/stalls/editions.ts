import type { Prisma, PrismaClient, StallEdition } from '@prisma/client';
import { NoActiveEditionError, UnknownEditionError } from './errors';
import { type BackofficeCaller, requireEditionReach } from './roles';

/** A client or a transaction — every seam accepts either so a route can compose
 *  several inside one transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** The edition every public write and most backoffice reads target. Throws rather
 *  than guessing when none is active — see `NoActiveEditionError`. */
export async function activeEdition(db: Db): Promise<StallEdition> {
  const edition = await db.stallEdition.findFirst({ where: { isActive: true } });
  if (!edition) throw new NoActiveEditionError();
  return edition;
}

/** The active edition, refused if this caller's grants do not cover it.
 *
 *  Every backoffice route resolves the edition through here rather than through
 *  `activeEdition` directly, so grant-level edition scope is enforced in one
 *  place instead of at seventy-six guards. */
export async function activeEditionFor(db: Db, caller: BackofficeCaller): Promise<StallEdition> {
  const edition = await activeEdition(db);
  requireEditionReach(caller, edition.id);
  return edition;
}

/**
 * One named edition, or the active one when nothing is named — refused either
 * way if this caller's grants do not reach it.
 *
 * ⚠️ READS ONLY. The Admin screen can be pointed at a past edition to compare
 * it against this year, and to copy a section out of it, but every write still
 * resolves its edition through `activeEditionFor`. A write that took an edition
 * from the caller would let a stale selector edit a closed year, and a closed
 * year is what the comparison is FOR.
 */
export async function editionFor(
  db: Db,
  caller: BackofficeCaller,
  editionId?: string,
): Promise<StallEdition> {
  if (!editionId) return activeEditionFor(db, caller);
  const edition = await db.stallEdition.findUnique({ where: { id: editionId } });
  if (!edition) throw new UnknownEditionError(editionId);
  requireEditionReach(caller, edition.id);
  return edition;
}

export async function listEditions(db: Db): Promise<StallEdition[]> {
  return db.stallEdition.findMany({ orderBy: { year: 'desc' } });
}

/** Exactly one edition is active at a time. Activating one deactivates the
 *  rest in the same transaction, so there is never a window with two. */
export async function activateEdition(db: PrismaClient, editionId: string): Promise<void> {
  await db.$transaction([
    db.stallEdition.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    db.stallEdition.update({ where: { id: editionId }, data: { isActive: true } }),
  ]);
}
