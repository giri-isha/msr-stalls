import type { Prisma, PrismaClient, StallEdition } from '@prisma/client';
import { NoActiveEditionError } from './errors';

/** A client or a transaction — every seam accepts either so a route can compose
 *  several inside one transaction. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** The edition every public write and most staff reads target. Throws rather
 *  than guessing when none is active — see `NoActiveEditionError`. */
export async function activeEdition(db: Db): Promise<StallEdition> {
  const edition = await db.stallEdition.findFirst({ where: { isActive: true } });
  if (!edition) throw new NoActiveEditionError();
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
