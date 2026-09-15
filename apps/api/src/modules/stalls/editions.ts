import type { Prisma, PrismaClient, StallEdition } from '@prisma/client';
import { NoActiveEditionError } from './errors';
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
