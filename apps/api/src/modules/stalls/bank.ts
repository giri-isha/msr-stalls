import type { PrismaClient } from '@prisma/client';
import type {
  BankDetailsInput,
  PresignUploadInput,
  PresignedUploadResponse,
  PublicBankView,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import type { MediaStore } from '../../storage/media-namespace';
import { resolveAccessLink } from './accounts';
import { chargesFor, linksFor } from './config';
import type { Db } from './editions';
import { UploadsUnavailableError } from './errors';
import { ensureQuote } from './payments';
import { MODULE_KEY } from './roles';
import { advanceStage } from './stage';

const mask = (n: string) =>
  n.length <= 4 ? n : `${'•'.repeat(Math.max(0, n.length - 4))}${n.slice(-4)}`;

/** What the bank form page needs: who this is for, what they already told us,
 *  and a read-only summary if it was already submitted. */
export async function bankView(db: Db, token: string): Promise<PublicBankView> {
  const link = await resolveAccessLink(db, token, 'BANK_FORM');
  const r = await db.stallRequest.findUniqueOrThrow({
    where: { id: link.requestId ?? '' },
    include: {
      allocations: { where: { releasedAt: null }, include: { stall: true } },
      edition: true,
      bankDetails: true,
      appliances: { orderBy: { sortOrder: 'asc' } },
    },
  });
  const [links, charges] = await Promise.all([
    linksFor(db, r.editionId),
    chargesFor(db, r.editionId),
  ]);
  return {
    reference: r.reference,
    stallName: r.stallName,
    requestType: r.requestType,
    stallNumbers: r.allocations.map((a) => a.stall.number),
    editionName: r.edition.name,
    termsUrl: links.termsUrl,
    depositPaise:
      r.requestType === 'LOCAL_WELFARE'
        ? charges.localWelfareDepositPaise
        : charges.vendorDepositPaise,
    submitted: r.bankDetails
      ? {
          submittedAt: r.bankDetails.submittedAt.toISOString(),
          invoiceName: r.bankDetails.invoiceName,
          accountHolder: r.bankDetails.accountHolder,
          bankName: r.bankDetails.bankName,
          accountNumberMasked: mask(r.bankDetails.accountNumber),
        }
      : null,
    prefill: {
      plugs5a: r.plugs5a,
      plugs15a: r.plugs15a,
      gasStoves: r.gasStoves,
      tablesNeeded: r.tablesNeeded,
      chairsNeeded: r.chairsNeeded,
      passes2w: r.passes2w,
      passes4w: r.passes4w,
      passesStaff: r.passesStaff,
      appliances: r.appliances.map((a) => ({ name: a.name, watts: a.watts })),
      mobile: r.bankDetails?.mobile ?? r.contactNumber,
      address: r.bankDetails?.address ?? r.address,
    },
  };
}

/** The vendor's one write after selection. Bank details, and the electrical
 *  and logistics block, in one transaction; then the stage moves and a
 *  payment quote is computed so staff can send the payment email at once. */
export async function submitBank(
  db: PrismaClient,
  token: string,
  input: BankDetailsInput,
): Promise<{ reference: string }> {
  const link = await resolveAccessLink(db, token, 'BANK_FORM');
  const requestId = link.requestId ?? '';
  const reference = await db.$transaction(async (tx) => {
    const r = await tx.stallRequest.findUniqueOrThrow({ where: { id: requestId } });
    await tx.stallBankDetails.upsert({
      where: { requestId },
      create: {
        requestId,
        invoiceName: input.invoiceName,
        accountHolder: input.accountHolder,
        mobile: input.mobile,
        address: input.address,
        pincode: input.pincode,
        bankName: input.bankName,
        branch: input.branch,
        accountNumber: input.accountNumber,
        ifsc: input.ifsc,
        micr: input.micr || null,
        chequeMediaKey: input.chequeMediaKey ?? null,
        advanceReturnAck: input.advanceReturnAck,
        panNumber: input.panNumber,
        panMediaKey: input.panMediaKey ?? null,
        gstNumber: input.gstNumber,
        gstMediaKey: input.gstMediaKey ?? null,
        neftAgreed: input.neftAgreed,
        tncAgreed: input.tncAgreed,
      },
      update: {
        invoiceName: input.invoiceName,
        accountHolder: input.accountHolder,
        mobile: input.mobile,
        address: input.address,
        pincode: input.pincode,
        bankName: input.bankName,
        branch: input.branch,
        accountNumber: input.accountNumber,
        ifsc: input.ifsc,
        micr: input.micr || null,
        chequeMediaKey: input.chequeMediaKey ?? undefined,
        panNumber: input.panNumber,
        panMediaKey: input.panMediaKey ?? undefined,
        gstNumber: input.gstNumber,
        gstMediaKey: input.gstMediaKey ?? undefined,
      },
    });
    await tx.stallRequest.update({
      where: { id: requestId },
      data: {
        plugs5a: input.plugs5a,
        plugs15a: input.plugs15a,
        gasStoves: input.gasStoves,
        tablesNeeded: input.tablesNeeded,
        chairsNeeded: input.chairsNeeded,
        passes2w: input.passes2w,
        passes4w: input.passes4w,
        passesStaff: input.passesStaff,
        remarks: input.remarks ?? r.remarks,
        appliances: {
          deleteMany: {},
          create: input.appliances.map((a, i) => ({ name: a.name, watts: a.watts, sortOrder: i })),
        },
      },
    });
    await tx.stallAccessLink.update({ where: { id: link.id }, data: { usedAt: new Date() } });
    await recordActivity(tx, {
      actorRef: 'vendor',
      moduleKey: MODULE_KEY,
      action: 'stall_bank_details.submitted',
      subjectRef: requestId,
    });
    return r.reference;
  });
  await advanceStage(db, requestId, 'BANK_SUBMITTED');
  await ensureQuote(db, requestId, 'vendor');
  return { reference };
}

/** Full bank details for staff. */
export async function bankDetailsFor(db: Db, requestId: string) {
  return db.stallBankDetails.findUnique({ where: { requestId } });
}

const SAFE = /[^a-zA-Z0-9._-]+/g;

/** An upload slot for a cheque, PAN, GST certificate or FSSAI certificate,
 *  under this request's own prefix. The token decides which purposes are
 *  allowed: a bank-form link may not upload an FSSAI certificate and vice
 *  versa. */
export async function presignUpload(
  db: Db,
  token: string,
  input: PresignUploadInput,
  files: MediaStore,
): Promise<PresignedUploadResponse> {
  if (!files.configured()) throw new UploadsUnavailableError();
  const purpose = input.purpose === 'FSSAI' ? 'FSSAI_UPLOAD' : 'BANK_FORM';
  const link = await resolveAccessLink(db, token, purpose);
  const r = await db.stallRequest.findUniqueOrThrow({
    where: { id: link.requestId ?? '' },
    include: { edition: { select: { year: true } } },
  });
  const name = input.fileName.replace(SAFE, '_').slice(0, 80);
  const key = `stalls/${r.edition.year}/${r.id}/${input.purpose.toLowerCase()}-${Date.now()}-${name}`;
  const p = await files.presignUpload({ key, contentType: input.contentType, bytes: input.bytes });
  return { key, url: p.url, headers: p.headers };
}
