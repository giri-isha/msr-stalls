import type { Prisma, PrismaClient, StallRequestType } from '@prisma/client';
import { type SubmitRequestInput, formatReference } from '@msr/stalls';
import { mintAccessLink, normalizeEmail } from './accounts';
import { type Db, activeEdition } from './editions';
import { TooManyStallsRequestedError } from './errors';
import type { Mailer } from './mailer';
import { isPlaceholderEmail } from './registration';
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

    // Only fields that belong to THIS form type, this edition, and are active.
    // A value posted against any other field id is dropped, not stored.
    const allowedFields = await tx.stallCustomField.findMany({
      where: { editionId: edition.id, formType: input.requestType, isActive: true },
      select: { id: true },
    });
    const allowed = new Set(allowedFields.map((f) => f.id));
    const customValues = Object.entries(input.customFields)
      .filter(([id, v]) => allowed.has(id) && v.trim().length > 0)
      .map(([customFieldId, value]) => ({ customFieldId, value }));

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
                fssaiExpected: input.ashram.fssaiExpected ?? null,
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
  // real — the vendor can be re-sent the link by staff. Swallowed deliberately.
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
        text: `Your MSR stall request ${result.reference} has been received. ${statusUrl}`,
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
    `Your MSR stall request has been received.`,
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
  return { to, subject: `MSR stall request received — ${reference}`, text };
}

export type { Db };
