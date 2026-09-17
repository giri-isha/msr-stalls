// Filing a requester's forms FROM the backoffice: the bodies the five filing
// routes take, and the lookup that precedes the first of them.
//
// ⚠️ Each body is the PUBLIC contract plus an attestation, never a copy of it.
// The rules — shape here, required-ness in the edition's own field rows — are
// the same rules the requester meets, enforced by the same function. A second
// set of shapes for the backoffice is how a question an admin switched off
// goes on being demanded of the desk filing for somebody.
import { z } from 'zod';
import {
  IndianMobile,
  RegisterStaffInput,
  SubmitBankDetailsInput,
  SubmitFssaiInput,
  SubmitPaymentClaimInput,
  SubmitRequestInput,
} from './contracts';

/** Who the form is for.
 *
 *  A name and at least one contact. The account is found by either contact or
 *  created with it, following the convention `register` already uses: an
 *  account with no address carries a placeholder one, and nothing sends to it.
 *
 *  ⚠️ `''` is accepted and read as absent, because the page sends an empty
 *  string for the box that was left blank rather than omitting the key. */
export const FilingRequester = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().toLowerCase().pipe(z.email().max(320)).optional().or(z.literal('')),
    phone: IndianMobile.optional().or(z.literal('')),
  })
  .transform((v) => ({
    displayName: v.displayName,
    email: v.email || undefined,
    phone: v.phone || undefined,
  }))
  .refine((v) => !!v.email || !!v.phone, {
    message: 'an email address or a mobile number is needed to file for somebody',
    path: ['phone'],
  });
export type FilingRequester = z.infer<typeof FilingRequester>;

export const FileRequestInput = z.object({
  requester: FilingRequester,
  request: SubmitRequestInput,
  /** 🔴 The filer's word that the declarations were READ OUT and agreed to.
   *  Declarations are never skipped on a form filed for somebody; the consent
   *  rows record `attestedBy`, so the record says a desk ticked them. */
  attestation: z.literal(true),
});
export type FileRequestInput = z.infer<typeof FileRequestInput>;

/** ⚠️ No token, no link. The receipt goes to the ACCOUNT's own contact; the
 *  filer learns the reference and where the record is, and nothing that would
 *  let them into the account. Same rule as the support routes. */
export interface FileRequestResponse {
  requestId: string;
  reference: string;
  accountId: string;
  /** True when this filing created the account rather than attaching to one. */
  accountCreated: boolean;
}

export const RequesterLookupQuery = z.object({ contact: z.string().trim().min(1).max(254) });
export type RequesterLookupQuery = z.infer<typeof RequesterLookupQuery>;

export interface RequesterLookupResponse {
  match: {
    accountId: string;
    displayName: string;
    /** `''` for an account whose address is a placeholder. */
    email: string;
    phone: string;
    requesterType: string | null;
    /** In the ACTIVE edition, which is the one the filer is working in. */
    requestCount: number;
  } | null;
}

export const FileBankInput = SubmitBankDetailsInput.extend({ attestation: z.literal(true) });
export type FileBankInput = z.infer<typeof FileBankInput>;

export const FileFssaiInput = SubmitFssaiInput.extend({ attestation: z.literal(true) });
export type FileFssaiInput = z.infer<typeof FileFssaiInput>;

/** ⚠️ No `couponCode`: the request in the path names the stall, and the route
 *  finds or issues that stall's own coupon. A code in the body would let a
 *  filing against one request register somebody on another. */
export const FileStaffInput = RegisterStaffInput.omit({ couponCode: true }).extend({
  attestation: z.literal(true),
});
export type FileStaffInput = z.infer<typeof FileStaffInput>;

/** ⚠️ No attestation — a claim carries no declarations — and no `reference`,
 *  because the path names the request. */
export const FileClaimInput = SubmitPaymentClaimInput.omit({ reference: true });
export type FileClaimInput = z.infer<typeof FileClaimInput>;
