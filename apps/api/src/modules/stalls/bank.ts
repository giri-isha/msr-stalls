import type { PrismaClient } from '@prisma/client';
import type { BankFormView, SubmitBankDetailsInput } from '@msr/stalls';
import { recordActivity } from '../../activity';
import { flowFor } from './config';
import type { Db } from './editions';
import { BankDetailsLockedError, StepNotOpenError, UnknownRequestError } from './errors';
import { allocatedNumbers, allocatedZone, factsInclude, refreshStage } from './facts';
import { MODULE_KEY } from './roles';
import { isOurKey } from './uploads';

/** The Bank Details and Requirements form — the one Phase 2 surface a vendor
 *  fills in themselves.
 *
 *  Reached only through a `BANK_FORM` access link, which the selection letter
 *  carries. The link identifies the request; nothing in the body does. A body
 *  that named its own request id would let anyone holding one link write bank
 *  details onto any request in the system.
 */

export async function getBankForm(db: Db, requestId: string): Promise<BankFormView> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: { ...factsInclude, edition: true, appliances: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!r) throw new UnknownRequestError(requestId);
  return {
    reference: r.reference,
    stallName: r.stallName,
    requesterName: r.requesterName,
    email: r.email,
    stallNumbers: allocatedNumbers(r),
    zoneCode: allocatedZone(r),
    editionName: r.edition.name,
    termsUrl: r.edition.termsUrl,
    current: {
      plugs5a: r.plugs5a,
      plugs15a: r.plugs15a,
      gasStoves: r.gasStoves,
      tablesNeeded: r.tablesNeeded,
      chairsNeeded: r.chairsNeeded,
      passes2w: r.passes2w,
      passes4w: r.passes4w,
      passesStaff: r.passesStaff,
      appliances: r.appliances.map((a) => ({ name: a.name, watts: a.watts })),
    },
    submittedAt: r.bankDetail?.submittedAt.toISOString() ?? null,
  };
}

/** Writes the bank details AND the vendor's final requirements.
 *
 *  The second half matters as much as the first: a request made in November is
 *  stale by February, and the 2025 form asks for plug points, chairs, tables
 *  and passes again for that reason. Those answers overwrite the request's, so
 *  the electrical sheet, the quote and the chairs counter all read one set of
 *  numbers — the latest ones the vendor stands behind.
 */
export async function submitBankDetails(
  db: PrismaClient,
  requestId: string,
  input: SubmitBankDetailsInput,
): Promise<void> {
  const r = await db.stallRequest.findUnique({
    where: { id: requestId },
    include: { bankDetail: true },
  });
  if (!r) throw new UnknownRequestError(requestId);
  if (r.bankDetail) throw new BankDetailsLockedError();
  if (r.status !== 'SELECTED') throw new StepNotOpenError('bank details');

  const flow = await flowFor(db, r.editionId);
  if (!flow.bankStepEnabled) throw new StepNotOpenError('bank details');
  if (r.requestType !== 'VENDOR') throw new StepNotOpenError('bank details');

  // Keys the browser sends back must be ones this module handed out, for this
  // purpose. See `isOurKey`.
  if (!isOurKey(input.chequeKey, 'BANK_CHEQUE')) throw new StepNotOpenError('cheque upload');
  if (!isOurKey(input.panKey, 'BANK_PAN')) throw new StepNotOpenError('PAN upload');
  if (input.gstKey && !isOurKey(input.gstKey, 'BANK_GST')) throw new StepNotOpenError('GST upload');

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.stallBankDetail.create({
      data: {
        requestId,
        email: input.email.trim().toLowerCase(),
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
        panNumber: input.panNumber,
        gstNumber: input.gstNumber,
        chequeKey: input.chequeKey,
        panKey: input.panKey,
        gstKey: input.gstKey || null,
        agreedNeftAt: now,
        agreedTermsAt: now,
        remarks: input.remarks ?? null,
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
      },
    });

    // Appliances are replaced wholesale rather than merged: the vendor is
    // restating the list, and a merge would leave a fryer they dropped on the
    // electrical load sheet.
    await tx.stallRequestAppliance.deleteMany({ where: { requestId } });
    if (input.appliances.length > 0) {
      await tx.stallRequestAppliance.createMany({
        data: input.appliances.map((a, i) => ({
          requestId,
          name: a.name,
          watts: a.watts,
          sortOrder: i,
        })),
      });
    }

    await recordActivity(tx, {
      // The vendor acted, not a backoffice member. The trail records the request as
      // its own actor rather than attributing this to whoever looks at it next.
      actorRef: requestId,
      moduleKey: MODULE_KEY,
      action: 'stall_bank_detail.submitted',
      subjectRef: requestId,
      detail: { gst: input.gstNumber.toUpperCase() !== 'NONE' },
    });
  });

  await refreshStage(db, requestId);
}
