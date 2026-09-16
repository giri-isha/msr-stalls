import type { Prisma, PrismaClient, StallRequestType } from '@prisma/client';
import {
  formatReference,
  isPlaceholderEmail,
  type SubmitRequestInput,
  validateAgainstForm,
} from '@stalls/core';
import { mintAccessLink, normalizeEmail } from './accounts';
import { allowedCustomValues } from './custom-values';
import { declarationsForForm, recordConsent, sameDeclarations } from './declarations';
import { formFor } from './form-builder';
import { ValidationFailedError } from '../../errors';
import { type Db, activeEdition } from './editions';
import { DeclarationsChangedError, TooManyStallsRequestedError } from './errors';
import type { Mailer } from './mailer';
import type { WhatsAppSender } from './whatsapp';

/** How long a status link stays live. Long: the vendor comes back to it in
 *  Phase 2 for the bank form and in Phase 3 for FSSAI, months after submitting. */
export const STATUS_LINK_TTL_DAYS = 365;

export interface SubmitDeps {
  mail: Mailer;
  /** Optional: only reached for an account registered on a mobile, which has
   *  no address to mail the receipt to. */
  whatsapp?: WhatsAppSender;
  /** Builds the absolute URL the receipt email carries. The module does not
   *  know its own public origin — the shell does. */
  statusUrl(token: string): string;
  now?(): Date;
}

export interface SubmitResult {
  requestId: string;
  reference: string;
  statusToken: string;
}

/** The next sequence number for this edition and type, taken with a row lock
 *  inside the caller's transaction. `update` with `increment` is atomic in
 *  Postgres — two concurrent callers serialise on the row and cannot both read
 *  the same value. The row itself is created by `ensureEditionDefaults`; the
 *  fallback below covers an edition created another way. */
async function nextSequence(
  tx: Prisma.TransactionClient,
  editionId: string,
  requestType: StallRequestType,
): Promise<number> {
  const where = { editionId_requestType: { editionId, requestType } };
  const existing = await tx.stallReferenceSequence.findUnique({ where });
  if (!existing) {
    await tx.stallReferenceSequence.create({ data: { editionId, requestType, next: 1 } });
  }
  const bumped = await tx.stallReferenceSequence.update({
    where,
    data: { next: { increment: 1 } },
  });
  return bumped.next - 1;
}

/** The ONE write the public can reach. Everything it touches lands in a single
 *  transaction; the receipt email goes out only after commit, so a failed
 *  insert never produces a confirmation for a request that does not exist. */
/**
 * The submission keyed the way the FORM names its fields.
 *
 * 🔴 The ashram form does not use the contract's names. It asks for the
 * requester under `requestedBy` and their number under `requesterContact`, and
 * everything about the department is nested under `ashram` — because the
 * printed 2025 form asks it that way and the transcription kept its words.
 * The contract flattens all of that into `requesterName`, `contactNumber` and a
 * nested block, which is the right shape for the columns and the wrong shape
 * for looking a field up by the name the form gave it.
 *
 * ⚠️ The web has the INVERSE of this — `fieldNameFor` in `RequestForm.tsx`,
 * which puts a server error back onto the input that caused it. The two have to
 * agree about which names are renamed, and this comment is the pointer between
 * them; there is no third place.
 */
function formValues(input: SubmitRequestInput): Record<string, unknown> {
  const ashram = (input.ashram ?? {}) as Record<string, unknown>;
  return {
    ...(input as unknown as Record<string, unknown>),
    // The department block, flattened: `departmentHead`, `department`, `usage`
    // and the rest are asked at the top level of the ashram forms.
    ...ashram,
    requestedBy: ashram.requestedBy ?? input.requesterName,
    requesterContact: ashram.requesterContact ?? input.contactNumber,
  };
}

export async function submitRequest(
  db: PrismaClient,
  input: SubmitRequestInput,
  deps: SubmitDeps,
  /** The logged-in requester. NOT derived from `input`.
   *
   *  🔴 This used to be `findOrCreateAccount(input.email)`, which meant the
   *  account was chosen by the address TYPED INTO THE FORM — so typing a known
   *  vendor's address attached the request to their account and sent the
   *  receipt, carrying a status link, to them. The session decides now, and
   *  the contact fields on the form are per-request facts that select nothing. */
  accountId: string,
): Promise<SubmitResult> {
  const now = deps.now?.() ?? new Date();

  const result = await db.$transaction(async (tx) => {
    const edition = await activeEdition(tx);

    // 🔴 The cap is per BAY, and that is the whole point of it: "a vendor can
    // select only a maximum of two stalls from one side or one area. If they
    // want another area, they raise another request — that will be better for
    // us, to individually accept one and reject the other." A form asking for
    // six stalls in A3 is one decision the team cannot split.
    //
    // Enforced here rather than in the Zod schema because the number is the
    // edition's, editable in Admin, and a schema is a constant.
    if (input.numStallsRequested > edition.maxStallsPerRequest) {
      throw new TooManyStallsRequestedError(input.numStallsRequested, edition.maxStallsPerRequest);
    }

    const account = await tx.stallAccount.findUniqueOrThrow({ where: { id: accountId } });
    const seq = await nextSequence(tx, edition.id, input.requestType);
    const reference = formatReference(input.requestType, edition.year, seq);

    // 🔴 What the EDITION'S OWN FORM insists on, checked before anything is
    // written. `SubmitRequestInput` can only say what a field's type is — it is
    // a constant, and it has to accept everything any of the forms might
    // send — so almost everything in it is optional. Which questions must be
    // answered moved into the rows when forms became data, and this is where
    // that half is enforced.
    //
    // ⚠️ Skipped when the edition has no definition yet: one seeded before
    // forms became data validates exactly as it did before, which is what keeps
    // the fallback on the page honest.
    const form = await formFor(tx, edition.id, input.requestType);
    if (form) {
      // ⚠️ `isFood` goes in, because one question depends on it: the ashram
      // form asks `fssaiExpected` only of a food stall. The page hides it; if
      // this did not skip it too, a non-food ashram request would be refused
      // over a question that was never on screen.
      const violations = validateAgainstForm(
        form,
        { builtIn: formValues(input), custom: input.customFields },
        { isFood: input.stallType === 'FOOD' },
      );
      if (violations.length > 0) {
        throw new ValidationFailedError(violations.map((v) => ({ row: 0, ...v })));
      }
    }

    // Only fields that belong to THIS form type, this edition, and are active.
    // A value posted against any other field id is dropped, not stored.
    //
    // 🔴 `isBuiltIn: false` is not a tidy-up. The appended fields and the form's
    // own questions became ONE table when forms became data, and a built-in's
    // answer belongs in its own column on `stall_request` — so without this
    // clause, posting `customFields[<id of the Stall Name field>]` would write a
    // second, shadow copy of the stall name into `stall_custom_field_value`,
    // where the record page would then show it as an extra answer nobody asked
    // for.
    const customValues = await allowedCustomValues(
      tx,
      edition.id,
      input.requestType,
      input.customFields,
    );

    const request = await tx.stallRequest.create({
      data: {
        editionId: edition.id,
        accountId: account.id,
        reference,
        requestType: input.requestType,
        stallType: input.stallType,
        stallName: input.stallName,
        requesterName: input.requesterName,
        contactNumber: input.contactNumber,
        // The typed address, not the account's: a department files for several
        // contact people under one login, and this is the one for THIS request.
        // It is a fact on the row, never a credential — see the receipt below.
        email: normalizeEmail(input.email),
        address: input.address ?? null,
        itemsSelling: input.itemsSelling,
        numStallsRequested: input.numStallsRequested,
        preferredZoneCode: input.preferredZoneCode,
        remarks: input.remarks ?? null,
        plugs5a: input.plugs5a ?? 0,
        plugs15a: input.plugs15a ?? 0,
        gasStoves: input.gasStoves ?? 0,
        tablesNeeded: input.tablesNeeded ?? 0,
        chairsNeeded: input.chairsNeeded ?? 0,
        passes2w: input.passes2w ?? 0,
        passes4w: input.passes4w ?? 0,
        passesStaff: input.passesStaff ?? 0,
        agreedAt: now,
        depositAcknowledgedAt: input.depositAcknowledged ? now : null,
        // status and stage take their column defaults — SUBMITTED / NEW. There
        // is no path from the input to either, whatever the body carried.
        submittedAt: now,
        ashramDetail: input.ashram
          ? {
              create: {
                departmentHead: input.ashram.departmentHead,
                departmentHeadContact: input.ashram.departmentHeadContact,
                department: input.ashram.department,
                requestedBy: input.ashram.requestedBy,
                requesterContact: input.ashram.requesterContact,
                creditCardNeeded: input.ashram.creditCardNeeded,
                usage: input.ashram.usage,
                usageOther: input.ashram.usageOther ?? null,
                wantsThembu: input.ashram.wantsThembu,
                // ⚠️ Null for a non-food stall, whatever the body carried. The
                // question is not asked of one — see `isFoodOnlyField` — and
                // storing an answer to it would be recording a reply nobody
                // made.
                fssaiExpected:
                  input.stallType === 'FOOD' ? (input.ashram.fssaiExpected ?? null) : null,
              },
            }
          : undefined,
        appliances: input.appliances?.length
          ? {
              create: input.appliances.map((a, i) => ({
                name: a.name,
                watts: a.watts,
                sortOrder: i,
              })),
            }
          : undefined,
        customValues: customValues.length ? { create: customValues } : undefined,
      },
    });

    // 🔴 What they agreed to, by VERSION, in the same transaction that creates
    // the request. `agreedAt` above records that somebody ticked a box; these
    // rows record which words were beside it — the thing that has to be
    // producible if a stall is ever in dispute, and the thing a constant in
    // `forms.ts` could never answer once somebody had edited it.
    //
    // ⚠️ The versions LOGGED are the live ones, resolved here — a posted id is
    // never trusted into the record. What the post is for is the CHECK above
    // it: if the page displayed a different set from the one live now, the
    // wording moved while the form sat open, and agreeing on their behalf to a
    // paragraph they never saw is the one outcome this whole feature exists to
    // prevent. So it is refused and they re-read it.
    const live = await declarationsForForm(tx, edition.id, input.requestType);
    if (!sameDeclarations(live, input.declarationIds)) throw new DeclarationsChangedError();
    await recordConsent(tx, { requestId: request.id, formType: input.requestType }, live);

    const { token } = await mintAccessLink(tx, {
      accountId: account.id,
      requestId: request.id,
      purpose: 'STATUS',
      ttlDays: STATUS_LINK_TTL_DAYS,
      now,
    });

    return {
      requestId: request.id,
      reference,
      statusToken: token,
      account: { email: account.email, phone: account.phone },
    };
  });

  // After commit. A mail failure must not roll back a request that is already
  // real — the vendor can be re-sent the link by backoffice. Swallowed deliberately.
  //
  // ⚠️ To the ACCOUNT's contact, never to `input.email`. This letter carries a
  // status link, and a status link is a credential for the whole account — so
  // it goes to the contact the requester proved they hold when they registered,
  // not to an address they typed a moment ago.
  const statusUrl = deps.statusUrl(result.statusToken);
  try {
    if (!isPlaceholderEmail(result.account.email)) {
      await deps.mail.send(receiptMail(result.account.email, input, result.reference, statusUrl));
    } else if (deps.whatsapp && result.account.phone) {
      // Registered on a mobile: there is no address to write to.
      await deps.whatsapp.send({
        to: result.account.phone,
        text: `Your stall request ${result.reference} has been received. ${statusUrl}`,
      });
    }
  } catch {
    // logged by the adapter; the submission stands
  }

  return {
    requestId: result.requestId,
    reference: result.reference,
    statusToken: result.statusToken,
  };
}

function receiptMail(to: string, input: SubmitRequestInput, reference: string, statusUrl: string) {
  const text = [
    `Your stall request has been received.`,
    ``,
    `Reference: ${reference}`,
    `Stall name: ${input.stallName}`,
    `Preferred location: ${input.preferredZoneCode}`,
    `Stalls requested: ${input.numStallsRequested}`,
    ``,
    `You can check the status of this request at any time here:`,
    statusUrl,
    ``,
    `Please keep this link private — anyone with it can see your request.`,
    ``,
    `Submission of a stall request does not guarantee allocation. Allocation is at the`,
    `sole discretion of the Isha Stall Team. Only selected stalls will be informed.`,
  ].join('\n');
  return { to, subject: `Stall request received — ${reference}`, text };
}

export type { Db };
