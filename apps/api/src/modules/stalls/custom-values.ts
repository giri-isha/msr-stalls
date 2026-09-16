// Answers to questions an ADMIN appended, as opposed to the built-ins that land
// in typed columns.
//
// ⚠️ Shared by all four public submit paths. Each one used to be free to decide
// what counted as an allowed field; four answers to "may this id be written?"
// is three chances for one of them to accept a field belonging to another form.
import type { Prisma, PrismaClient, StallFormType } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The appended answers that may actually be stored.
 *
 * 🔴 Filtered against the fields THIS form is currently asking — active,
 * appended, and on this form type. Without it a caller could post any field id
 * and have an answer filed under a question the form never asked, including one
 * belonging to a different form in the same edition.
 *
 * ⚠️ Blank answers are dropped rather than stored as empty strings. "Asked and
 * left blank" and "never asked" are the same thing to every reader downstream,
 * and a row of empty string is the one that looks like an answer.
 */
export async function allowedCustomValues(
  db: Db,
  editionId: string,
  formType: StallFormType,
  posted: Record<string, string> | undefined,
): Promise<Array<{ customFieldId: string; value: string }>> {
  if (!posted || Object.keys(posted).length === 0) return [];

  const fields = await db.stallFormField.findMany({
    where: { editionId, formType, isActive: true, isBuiltIn: false },
    select: { id: true },
  });
  const allowed = new Set(fields.map((f) => f.id));

  return Object.entries(posted)
    .filter(([id, v]) => allowed.has(id) && v.trim().length > 0)
    .map(([customFieldId, value]) => ({ customFieldId, value }));
}

/**
 * Writes them, replacing whatever was there.
 *
 * ⚠️ `staffId` is what separates eight people registering against one coupon.
 * They share a `requestId`, so a request-keyed write would have seven of their
 * answers collapse into the first person's row — see the partial indexes on
 * `stall_custom_field_value`.
 *
 * Replaced wholesale rather than merged: the submitter is restating their
 * answers, and a merge would leave an answer to a question they cleared.
 */
export async function replaceCustomValues(
  db: Db,
  where: { requestId: string; staffId?: string | null },
  values: ReadonlyArray<{ customFieldId: string; value: string }>,
): Promise<void> {
  const staffId = where.staffId ?? null;
  await db.stallCustomFieldValue.deleteMany({
    where: { requestId: where.requestId, staffId },
  });
  if (values.length === 0) return;
  await db.stallCustomFieldValue.createMany({
    data: values.map((v) => ({ ...v, requestId: where.requestId, staffId })),
  });
}
