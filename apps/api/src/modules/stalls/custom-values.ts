// Answers to questions an ADMIN appended, as opposed to the built-ins that land
// in typed columns.
//
// ⚠️ Shared by all four public submit paths. Each one used to be free to decide
// what counted as an allowed field; four answers to "may this id be written?"
// is three chances for one of them to accept a field belonging to another form.
import type { Prisma, PrismaClient, StallFormType } from '@prisma/client';
import {
  checkFieldValue,
  type DateWindow,
  type FieldType,
  isBlankAnswer,
  todayISO,
} from '@msr/stalls';
import { ValidationFailedError } from '../../errors';

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
    select: {
      id: true,
      label: true,
      fieldType: true,
      isRequired: true,
      min: true,
      max: true,
      minLen: true,
      maxLen: true,
      decimals: true,
      pattern: true,
      patternHint: true,
      dateWindow: true,
    },
  });
  const allowed = new Map(fields.map((f) => [f.id, f]));

  /**
   * 🔴 What the QUESTION accepts, checked before the answer is stored.
   *
   * The request form's built-ins go through `validateAgainstForm` in
   * `submit.ts`; this is the same enforcement for the appended questions on all
   * four forms, and it lives here because this is the one function all four
   * already share. Without it, "GST Number — fifteen characters" was a rule the
   * bank form's page mentioned and the API did not, and the page is the half a
   * determined poster can skip.
   *
   * ⚠️ Every violation at once, not the first. Somebody who got two answers
   * wrong should be told about both rather than shown the second only after
   * fixing the first.
   */
  const today = todayISO();
  const violations = Object.entries(posted).flatMap(([id, value]) => {
    const field = allowed.get(id);
    if (!field) return [];
    const wrong = checkFieldValue(
      {
        label: field.label,
        type: field.fieldType as FieldType,
        required: field.isRequired,
        min: field.min,
        max: field.max,
        minLen: field.minLen,
        maxLen: field.maxLen,
        decimals: field.decimals,
        pattern: field.pattern,
        patternHint: field.patternHint,
        window: (field.dateWindow as DateWindow | null) ?? null,
      },
      value,
      today,
    );
    return wrong ? [{ row: 0, fieldKey: `customFields.${id}`, message: wrong }] : [];
  });
  if (violations.length > 0) throw new ValidationFailedError(violations);

  // ⚠️ Blank answers are dropped rather than stored as empty strings, and
  // `isBlankAnswer` is the same function the validators read — "asked and left
  // blank" and "never asked" are the same thing to every reader downstream, and
  // a row of empty string is the one that looks like an answer.
  return Object.entries(posted)
    .filter(([id, v]) => {
      const field = allowed.get(id);
      return field !== undefined && !isBlankAnswer(v, field.fieldType as FieldType);
    })
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
