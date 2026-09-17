// Consent declarations: reads, writes, and the versioning rule.
//
// ⚠️ Nothing here decides WHICH declaration a form shows — `declarationsFor`
// in `@stalls/core` does, so the public form, the submit validator and the
// backoffice preview cannot answer it differently. This file resolves rows and
// applies the one rule that needs a transaction: a new version arriving must
// archive the old one and take its place, atomically.
import type { Prisma, PrismaClient, StallFormType } from '@prisma/client';
import {
  type Declaration,
  FORM_DEFINITIONS,
  declarationsFor,
  isDeclarationKey,
  needsNewVersion,
} from '@stalls/core';
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
  formType: true,
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
    orderBy: [{ key: 'asc' }, { formType: 'asc' }, { version: 'desc' }],
  });
}

/** What one form asks, resolved. Used by the public form and by submit. */
export async function declarationsForForm(
  db: Db,
  editionId: string,
  formType: StallFormType,
): Promise<Declaration[]> {
  const rows = await db.stallDeclaration.findMany({
    where: { editionId, isCurrent: true, isActive: true },
    select: SELECT,
  });
  return declarationsFor(rows as Declaration[], formType);
}

export interface DeclarationInput {
  key: string;
  formType: StallFormType | null;
  title: string;
  body: string;
  bodyTa: string | null;
  isActive: boolean;
}

/**
 * Creates a declaration, or a new VARIANT of one that already exists.
 *
 * ⚠️ Reusing a key with a different `formType` is the documented way to add
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
    where: { editionId, key: input.key, formType: input.formType, isCurrent: true },
    select: { id: true },
  });
  if (clash) throw new DeclarationExistsError(input.key, input.formType);
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
 * `@stalls/core` so the screen can warn about it before the save.
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
  input: Omit<DeclarationInput, 'key' | 'formType'>,
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
        formType: current.formType,
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

/** Whether the page displayed exactly the declarations that are live now.
 *
 *  Set equality, not order: the page renders them in key order and so does
 *  `declarationsFor`, but nothing should depend on two sorts agreeing.
 *
 *  ⚠️ `undefined` is not a claim and passes. A caller that does not send the
 *  field has not said what it displayed — the seed, a script, anything
 *  server-side — and refusing those would be refusing them for not
 *  participating in a check that exists to catch a stale BROWSER. An empty
 *  array IS a claim: "I showed none", which is wrong the moment one is live.
 */
export function sameDeclarations(
  live: readonly { id: string }[],
  posted: readonly string[] | undefined,
): boolean {
  if (posted === undefined) return true;
  if (live.length !== posted.length) return false;
  const seen = new Set(posted);
  return live.every((d) => seen.has(d.id));
}

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
export interface ConsentWhere {
  requestId: string;
  /** WHICH form the tick was on. The same key can be ticked on the request form
   *  and again on the bank form — two consents, months apart, possibly to
   *  different versions of the wording. */
  formType: StallFormType;
  /** Set when the consent is one STAFF MEMBER'S rather than the requester's.
   *
   *  ⚠️ Eight people register against one coupon and share a request id. The
   *  consent is the individual's — they are the one carrying the photo ID
   *  through the gate — so without this, seven of the eight collapse into the
   *  first person's row. */
  staffId?: string | null;
}

export async function recordConsent(
  db: Db,
  where: ConsentWhere,
  declarations: readonly { id: string }[],
  /** The backoffice member who ticked these on the requester's word, when one
   *  did. Absent — the ordinary case — means the requester ticked them. */
  attestedBy?: string,
): Promise<void> {
  if (declarations.length === 0) return;
  await db.stallDeclarationConsent.createMany({
    data: declarations.map((d) => ({
      requestId: where.requestId,
      formType: where.formType,
      staffId: where.staffId ?? null,
      declarationId: d.id,
      attestedBy: attestedBy ?? null,
    })),
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
      formType: true,
      declaration: { select: { key: true, version: true, title: true, body: true, bodyTa: true } },
    },
  });
  return rows.map((r) => ({
    // Which form it was given on. The record page is where somebody produces
    // what was agreed, and "on which form" is part of that answer.
    formType: r.formType,
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
  const byBody = new Map<string, StallFormType[]>();
  for (const [type, def] of Object.entries(FORM_DEFINITIONS)) {
    const seen = byBody.get(def.disclaimer) ?? [];
    seen.push(type as StallFormType);
    byBody.set(def.disclaimer, seen);
  }

  let made = 0;
  for (const [body, types] of byBody) {
    const def = FORM_DEFINITIONS[types[0] as keyof typeof FORM_DEFINITIONS];
    for (const formType of types) {
      await db.stallDeclaration.create({
        data: {
          editionId,
          key: KEY,
          formType,
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

/**
 * The bank form's two consents, as version 1.
 *
 * 🔴 These were `z.literal(true)` in `SubmitBankDetailsInput` with their wording
 * in JSX, landing in `agreed_neft_at` and `agreed_terms_at`. Two timestamps
 * record THAT somebody agreed and never WHAT — the failure this whole table
 * exists to end, still live on the form that collects an account number.
 *
 * ⚠️ The strings are the ones vendors have ACTUALLY been agreeing to, lifted
 * from `BankForm.tsx` rather than rewritten. The 2025 Google Form worded this as
 * three separate agreements and the code had already condensed them to two;
 * restoring the original wording would change what the consent SAYS, and that is
 * an authoring decision for the team on the Declarations screen. A seed is not
 * the place to make it.
 *
 * ⚠️ No link in the terms body. The form used to splice the edition's `termsUrl`
 * into the sentence at render time, which a seeded constant cannot do. A
 * declaration body carries its own links — `[label](https://…)` — so the team
 * adds the document link by editing the wording, which also makes it versioned
 * along with the text it belongs to. Until they do, the consent stands on its
 * own words rather than promising a document that may not exist.
 */
const BANK_NEFT_BODY =
  "I agree — Isha Foundation's bank account details will be sent to me by email " +
  'or SMS, and I will transfer the amount online using NEFT.';

const BANK_TERMS_BODY =
  'I agree that the deposit will be returned only to the bank account given ' +
  'above, and that deductions may be made for unreturned or damaged chairs and ' +
  'tables or for an unclean stall.';

export const BANK_KEYS = { neft: 'neft_transfer', terms: 'terms_and_conditions' } as const;

/** Idempotent, like `seedDeclarations`: an edition that already has either key
 *  is left entirely alone, so this runs on every boot beside the rest of the
 *  reference data without resurrecting wording somebody retired. */
export async function seedBankDeclarations(db: Db, editionId: string): Promise<number> {
  const existing = await db.stallDeclaration.count({
    where: { editionId, key: { in: [BANK_KEYS.neft, BANK_KEYS.terms] } },
  });
  if (existing > 0) return 0;

  const rows = [
    [BANK_KEYS.neft, 'NEFT transfer', BANK_NEFT_BODY],
    [BANK_KEYS.terms, 'Terms and conditions', BANK_TERMS_BODY],
  ] as const;

  for (const [key, title, body] of rows) {
    await db.stallDeclaration.create({
      data: {
        editionId,
        key,
        formType: 'BANK',
        version: 1,
        title,
        body,
        // The 2025 bank form had no Tamil for either consent.
        bodyTa: null,
        isActive: true,
        isCurrent: true,
      },
    });
  }
  return rows.length;
}
