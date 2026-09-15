// Consent declarations: reads, writes, and the versioning rule.
//
// ⚠️ Nothing here decides WHICH declaration a form shows — `declarationsFor`
// in `@msr/stalls` does, so the public form, the submit validator and the
// backoffice preview cannot answer it differently. This file resolves rows and
// applies the one rule that needs a transaction: a new version arriving must
// archive the old one and take its place, atomically.
import type { Prisma, PrismaClient, StallRequestType } from '@prisma/client';
import {
  type Declaration,
  FORM_DEFINITIONS,
  declarationsFor,
  isDeclarationKey,
  needsNewVersion,
} from '@msr/stalls';
import {
  ArchivedDeclarationError,
  BadDeclarationKeyError,
  DeclarationExistsError,
  UnknownDeclarationError,
} from './errors';

type Db = PrismaClient | Prisma.TransactionClient;

const SELECT = {
  id: true,
  key: true,
  requestType: true,
  version: true,
  title: true,
  body: true,
  bodyTa: true,
  isActive: true,
  isCurrent: true,
  createdAt: true,
  archivedAt: true,
} as const;

/** Every version of every declaration on this edition, newest first within a
 *  key — the backoffice screen shows the history, not just what is live. */
export async function listDeclarations(db: Db, editionId: string) {
  return db.stallDeclaration.findMany({
    where: { editionId },
    select: SELECT,
    orderBy: [{ key: 'asc' }, { requestType: 'asc' }, { version: 'desc' }],
  });
}

/** What one form asks, resolved. Used by the public form and by submit. */
export async function declarationsForForm(
  db: Db,
  editionId: string,
  requestType: StallRequestType,
): Promise<Declaration[]> {
  const rows = await db.stallDeclaration.findMany({
    where: { editionId, isCurrent: true, isActive: true },
    select: SELECT,
  });
  return declarationsFor(rows as Declaration[], requestType);
}

export interface DeclarationInput {
  key: string;
  requestType: StallRequestType | null;
  title: string;
  body: string;
  bodyTa: string | null;
  isActive: boolean;
}

/**
 * Creates a declaration, or a new VARIANT of one that already exists.
 *
 * ⚠️ Reusing a key with a different `requestType` is the documented way to add
 * a form-specific wording — the same key, one row per form — so a clash is only
 * a clash when the key AND the variant both already exist.
 */
export async function createDeclaration(
  db: PrismaClient,
  editionId: string,
  input: DeclarationInput,
  by: string,
) {
  if (!isDeclarationKey(input.key)) throw new BadDeclarationKeyError(input.key);
  const clash = await db.stallDeclaration.findFirst({
    where: { editionId, key: input.key, requestType: input.requestType, isCurrent: true },
    select: { id: true },
  });
  if (clash) throw new DeclarationExistsError(input.key, input.requestType);
  return db.stallDeclaration.create({
    data: { editionId, ...input, version: 1, isCurrent: true, createdBy: by },
    select: SELECT,
  });
}

/**
 * Saves an edit.
 *
 * 🔴 A changed BODY writes a new version and archives the one it replaces,
 * inside one transaction. Updating the row in place would rewrite what every
 * requester who already ticked it is recorded as having agreed to — which is
 * the whole reason declarations stopped being a constant in `forms.ts`.
 *
 * A changed title, or a flipped `isActive`, edits the row: neither changes what
 * anybody agreed to. `needsNewVersion` is the rule, and it lives in
 * `@msr/stalls` so the screen can warn about it before the save.
 *
 * ⚠️ The archive and the insert are one transaction because the database
 * enforces ONE current version per variant (a partial unique index). Two
 * statements outside a transaction would leave the old row current while the
 * new one is refused — and the refusal is the good case; the bad one is the
 * window in between, where a form could load either.
 */
export async function updateDeclaration(
  db: PrismaClient,
  editionId: string,
  id: string,
  input: Omit<DeclarationInput, 'key' | 'requestType'>,
  by: string,
) {
  const current = await db.stallDeclaration.findFirst({
    where: { id, editionId },
    select: { ...SELECT, editionId: true },
  });
  if (!current) throw new UnknownDeclarationError(id);
  // An archived version is a record, not a draft — see the error's own note.
  if (!current.isCurrent) throw new ArchivedDeclarationError(id);

  if (!needsNewVersion(current, input)) {
    return db.stallDeclaration.update({
      where: { id },
      data: { title: input.title, isActive: input.isActive },
      select: SELECT,
    });
  }

  return db.$transaction(async (tx) => {
    await tx.stallDeclaration.update({
      where: { id },
      data: { isCurrent: false, archivedAt: new Date() },
    });
    return tx.stallDeclaration.create({
      data: {
        editionId: current.editionId,
        key: current.key,
        requestType: current.requestType,
        version: current.version + 1,
        title: input.title,
        body: input.body,
        bodyTa: input.bodyTa,
        isActive: input.isActive,
        isCurrent: true,
        createdBy: by,
      },
      select: SELECT,
    });
  });
}

/* ── Consent ────────────────────────────────────────────────────────────────*/

/**
 * Records what this requester agreed to, by version.
 *
 * ⚠️ Takes the rows rather than resolving them, so the caller can compare the
 * live set against what the page displayed BEFORE writing anything — see
 * `submitRequest`, which refuses the submission when the two differ rather than
 * logging agreement to wording that was never on screen.
 *
 * `skipDuplicates` makes a retry idempotent: the unique index on
 * (request, declaration) is what actually guarantees one row per consent.
 */
export async function recordConsent(
  db: Db,
  requestId: string,
  declarations: readonly { id: string }[],
): Promise<void> {
  if (declarations.length === 0) return;
  await db.stallDeclarationConsent.createMany({
    data: declarations.map((d) => ({ requestId, declarationId: d.id })),
    skipDuplicates: true,
  });
}

/** What one requester agreed to, with the wording as it stood. For the record
 *  page, and for the day somebody has to produce it. */
export async function consentsFor(db: Db, requestId: string) {
  const rows = await db.stallDeclarationConsent.findMany({
    where: { requestId },
    orderBy: { agreedAt: 'asc' },
    select: {
      agreedAt: true,
      declaration: { select: { key: true, version: true, title: true, body: true, bodyTa: true } },
    },
  });
  return rows.map((r) => ({
    key: r.declaration.key,
    version: r.declaration.version,
    title: r.declaration.title,
    body: r.declaration.body,
    bodyTa: r.declaration.bodyTa,
    agreedAt: r.agreedAt.toISOString(),
  }));
}

/* ── Seeding ────────────────────────────────────────────────────────────────*/

/**
 * The 2025 disclaimers, as version 1.
 *
 * ⚠️ Read out of `FORM_DEFINITIONS` rather than retyped. Those strings were
 * transcribed character-for-character from the printed forms, Tamil included,
 * and the note at the top of `forms.ts` says none of it is machine-translated
 * or guessed — retyping them here would be the one place that claim stops being
 * true. The constants stay as the SEED; what a form shows now comes from these
 * rows.
 *
 * Idempotent: an edition that already has a `request_submission` is left alone,
 * so this can run on every boot beside the rest of the reference data.
 */
export async function seedDeclarations(db: Db, editionId: string): Promise<number> {
  const existing = await db.stallDeclaration.count({ where: { editionId, key: KEY } });
  if (existing > 0) return 0;

  // ⚠️ One row per DISTINCT wording, not one per form. The two public forms
  // share a disclaimer and the two ashram forms share another, so seeding four
  // would mean an admin fixing a typo in the vendor wording and finding local
  // welfare still says the old thing.
  const byBody = new Map<string, StallRequestType[]>();
  for (const [type, def] of Object.entries(FORM_DEFINITIONS)) {
    const seen = byBody.get(def.disclaimer) ?? [];
    seen.push(type as StallRequestType);
    byBody.set(def.disclaimer, seen);
  }

  let made = 0;
  for (const [body, types] of byBody) {
    const def = FORM_DEFINITIONS[types[0] as StallRequestType];
    for (const requestType of types) {
      await db.stallDeclaration.create({
        data: {
          editionId,
          key: KEY,
          requestType,
          version: 1,
          title: 'Stall request',
          body,
          bodyTa: def.disclaimerTa,
          isActive: true,
          isCurrent: true,
        },
      });
      made += 1;
    }
  }
  return made;
}

/** The declaration every request form carries. Named once: the seed writes it,
 *  and the submit path looks for it. */
export const KEY = 'request_submission';
