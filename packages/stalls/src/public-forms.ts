import type { FieldOption, FormField } from './forms';

/**
 * The three public forms that are not applications: the bank details form, the
 * FSSAI upload and staff registration.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * 🔴 `forms.ts` is the seed for the four REQUEST forms. These three were never
 * in it, because they were never rows — their questions lived in JSX, in
 * `BankForm.tsx`, `FssaiForm.tsx` and `StaffRegistration.tsx`. Rewording a
 * label, adding the Tamil beside it, or ceasing to ask a question was a
 * redeploy, which is exactly the problem the Form Builder was built to end.
 *
 * This is the same thing `FORM_DEFINITIONS` is: the SEED, not the form. An edit
 * here reaches no existing edition. What a form asks now is whatever its rows
 * say, and the Form Builder is where that is changed.
 *
 * ── On the Tamil ────────────────────────────────────────────────────────────
 * Every `labelTa` below is transcribed from the 2025 sheets, character for
 * character, by way of the JSX it was already in. None of it is
 * machine-translated and none of it is guessed — the same claim `forms.ts`
 * makes, and it stays true because this file is read by the seed rather than
 * retyped into a migration.
 */

/** Which record a built-in field's answer lands on.
 *
 *  ⚠️ A REQUEST form's built-ins all write to `stall_request`, so `forms.ts`
 *  never had to say. These three write to three different tables, so "which
 *  column does this name mean" has three answers and the form has to carry
 *  which one. The submit path does the writing; this is what tells the BUILDER
 *  that a name is spoken for and cannot be reused by an appended question. */
export type PublicFormTarget = 'BANK_DETAIL' | 'FSSAI_CERTIFICATE' | 'VENDOR_STAFF';

export type PublicFormType = 'BANK' | 'FSSAI' | 'STAFF';

export interface PublicFormDefinition {
  formType: PublicFormType;
  title: string;
  titleTa: string | null;
  target: PublicFormTarget;
  fields: FormField[];
}

const t = (
  name: string,
  label: string,
  labelTa: string | null,
  over: Partial<FormField> = {},
): FormField => ({ name, label, labelTa, type: 'text', required: false, ...over });

/** A count the vendor restates on the bank form.
 *
 *  ⚠️ Required with a floor of zero, not optional. "How many 15 amp points"
 *  answered zero is an answer; left blank it is a question nobody asked, and
 *  the electrical sheet cannot tell those apart. The same reasoning
 *  `validateAgainstForm` already applies to the local welfare plug counts. */
const count = (name: string, label: string, max: number): FormField => ({
  name,
  label,
  labelTa: null,
  type: 'number',
  required: true,
  min: 0,
  max,
});

/* ── Bank details ───────────────────────────────────────────────────────────*/

/**
 * "MSR Stalls Bank Details and Requirements".
 *
 * 🔴 The second half is not bookkeeping. A request made in November is stale by
 * February, so the 2025 form asks for plug points, chairs, tables and passes
 * AGAIN — and those answers overwrite the request's, because the electrical
 * sheet, the quote and the chairs counter must all read one set of numbers.
 */
export const BANK_FORM: PublicFormDefinition = {
  formType: 'BANK',
  title: 'MSR Stalls Bank Details and Requirements',
  titleTa: null,
  target: 'BANK_DETAIL',
  fields: [
    t('email', 'Email', null, { type: 'email', required: true }),
    t('invoiceName', 'Name as Required on Invoice', 'விலைப்பட்டியலில் குறிப்பிடப்பட வேண்டிய பெயர்', {
      required: true,
      help: 'Individual name or company name.',
    }),
    t('accountHolder', 'Name of the Bank Account Holder', 'வங்கி கணக்கு வைத்திருப்பவரின் பெயர்', {
      required: true,
      help: 'The receipt is issued in this name.',
    }),
    t('mobile', 'Mobile Number', 'கைபேசி எண்', { type: 'tel', required: true }),
    t('address', 'Address', 'முகவரி', { type: 'textarea', required: true }),
    t('pincode', 'Pincode', 'பின்கோடு', { required: true }),
    t('bankName', 'Bank Name', 'வங்கி பெயர்', { required: true }),
    t('branch', 'Bank Branch', 'வங்கிக்கிளை', { required: true }),
    t('accountNumber', 'Account Number', 'வங்கி கணக்கு எண்', {
      required: true,
      help: 'The refundable deposit is returned to this account only. No cash is given.',
    }),
    t('ifsc', 'IFSC Code', null, { required: true }),
    t('micr', 'MICR Code', null),
    t('panNumber', 'PAN Card Number', 'பான் கார்டு எண்', { required: true }),
    t('gstNumber', 'GST Number', 'ஜிஎஸ்டி எண்', {
      required: true,
      help: "Enter 'None' if not applicable.",
    }),

    // ⚠️ `file`, and built-in: each of these three answers a typed column that
    // the document viewer dereferences, so they keep their own upload purposes
    // (`BANK_CHEQUE`, `BANK_PAN`, `BANK_GST`) rather than `FORM_FIELD`.
    t('chequeKey', 'Cancelled Cheque or Bank Passbook Front Page', null, {
      type: 'file',
      required: true,
      help: 'The name and account details on it must match the ones given above.',
    }),
    t('panKey', 'PAN Card', 'பான் கார்டு', {
      type: 'file',
      required: true,
      help: 'The name on it must match the invoice name given above.',
    }),
    t('gstKey', 'GST Certificate', null, { type: 'file' }),

    count('plugs5a', '5 Amp Plug Points Needed', 50),
    count('plugs15a', '15 Amp Plug Points Needed', 50),
    count('gasStoves', 'Number of Gas Stoves', 10),
    {
      name: 'appliances',
      label: 'Electrical Appliances',
      labelTa: null,
      type: 'appliances',
      required: false,
      max: 20,
    },
    count('tablesNeeded', 'Tables Needed', 50),
    count('chairsNeeded', 'Chairs Needed', 200),
    count('passes2w', '2-Wheeler Passes', 50),
    count('passes4w', '4-Wheeler Passes', 50),
    count('passesStaff', 'Staff Passes', 200),
    t('remarks', 'Any Additional Remarks', 'எந்தவொரு கூடுதல் கருத்துகள்', { type: 'textarea' }),
  ],
};

/* ── FSSAI ──────────────────────────────────────────────────────────────────*/

/**
 * The FSSAI certificate upload.
 *
 * ⚠️ `files`, plural, with a max of five. A certificate is routinely
 * photographed a page at a time, and a single-file question would have a vendor
 * choosing which page to send.
 */
export const FSSAI_FORM: PublicFormDefinition = {
  formType: 'FSSAI',
  title: 'FSSAI Certificate',
  titleTa: null,
  target: 'FSSAI_CERTIFICATE',
  fields: [
    t('ownerName', 'Name of the Licence Holder', null),
    t('mobile', 'Mobile Number', 'கைபேசி எண்', { type: 'tel' }),
    {
      name: 'files',
      label: 'FSSAI Certificate',
      labelTa: null,
      type: 'files',
      required: true,
      max: 5,
      help: 'Up to five files. Photograph the certificate a page at a time if it runs to more than one.',
    },
  ],
};

/* ── Staff registration ─────────────────────────────────────────────────────*/

const ID_TYPES: FieldOption[] = [
  { value: 'AADHAAR', label: 'Aadhaar', labelTa: null },
  { value: 'VOTER_ID', label: 'Voter ID', labelTa: null },
  { value: 'DRIVING_LICENCE', label: 'Driving Licence', labelTa: null },
  { value: 'PASSPORT', label: 'Passport', labelTa: null },
  { value: 'OTHER', label: 'Other', labelTa: null },
];

/**
 * One person on a stall's roster, registered against a coupon.
 *
 * 🔴 The answers here belong to the PERSON, not to the stall. Eight people
 * register against one coupon and share a request, which is why an appended
 * question on this form stores its answer against `staff_id` — see the partial
 * indexes on `stall_custom_field_value`.
 *
 * ⚠️ `idNumber` is narrowed for an Aadhaar: only the last four digits are kept,
 * which is enough to match the card at the gate and not enough to be a copy of
 * it. That narrowing lives in the submit path and is not something the builder
 * can switch off.
 */
export const STAFF_FORM: PublicFormDefinition = {
  formType: 'STAFF',
  title: 'Staff Registration',
  titleTa: null,
  target: 'VENDOR_STAFF',
  fields: [
    t('name', 'Full Name', null, { required: true }),
    t('mobile', 'Mobile Number', 'கைபேசி எண்', { type: 'tel', required: true }),
    {
      name: 'idType',
      label: 'ID Proof',
      labelTa: null,
      type: 'select',
      required: true,
      options: ID_TYPES,
    },
    t('idNumber', 'ID Number', null, {
      required: true,
      help: 'For an Aadhaar, only the last four digits are stored.',
    }),
    t('role', 'Role on the Stall', null),
  ],
};

export const PUBLIC_FORM_DEFINITIONS: Record<PublicFormType, PublicFormDefinition> = {
  BANK: BANK_FORM,
  FSSAI: FSSAI_FORM,
  STAFF: STAFF_FORM,
};

export const PUBLIC_FORM_TYPES = [
  'BANK',
  'FSSAI',
  'STAFF',
] as const satisfies readonly PublicFormType[];

/** The built-in names each of these forms already spends, so the builder can
 *  refuse an appended question that would shadow one. */
export function builtInNames(formType: PublicFormType): string[] {
  return PUBLIC_FORM_DEFINITIONS[formType].fields
    .map((f) => f.name)
    .filter((n): n is string => n !== null && n !== undefined);
}

/** Which upload purpose a file question uses.
 *
 *  🔴 A BUILT-IN file field keeps the purpose whose folder already holds its
 *  data — retyping `chequeKey` to `FORM_FIELD` would orphan every cancelled
 *  cheque already uploaded. Everything an admin APPENDED is `FORM_FIELD`,
 *  scoped by its own field id. */
const BUILT_IN_PURPOSE: Record<string, string> = {
  chequeKey: 'BANK_CHEQUE',
  panKey: 'BANK_PAN',
  gstKey: 'BANK_GST',
  files: 'FSSAI',
};

export function uploadPurposeFor(field: { name: string | null; isBuiltIn: boolean }): string {
  if (!field.isBuiltIn || field.name === null) return 'FORM_FIELD';
  return BUILT_IN_PURPOSE[field.name] ?? 'FORM_FIELD';
}
