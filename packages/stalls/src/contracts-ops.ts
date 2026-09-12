import { z } from 'zod';
import type { Bill } from './billing';
import { ApplianceInput, IndianMobile, type RequestStage, type RequestStatus } from './contracts';
import type { FormField } from './forms';
import { TEMPLATE_KEYS } from './templates';

/** Phase 2 and 3 wire contracts — onboarding, money, event-day operations. */

// ── Public: bank / GST / contract form (reached by signed link) ────────────

const Count = (max: number) => z.number().int().min(0).max(max);

/** The 2025 "MSR stalls bank details and requirements" form. */
export const BankDetailsInput = z.object({
  invoiceName: z.string().trim().min(1).max(200),
  accountHolder: z.string().trim().min(1).max(200),
  mobile: IndianMobile,
  address: z.string().trim().min(1).max(1000),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'expected a 6-digit PIN code'),
  bankName: z.string().trim().min(1).max(200),
  branch: z.string().trim().min(1).max(200),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{9,18}$/, 'expected a 9–18 digit account number'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'expected an IFSC like HDFC0001234'),
  micr: z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'expected a 9-digit MICR code')
    .optional()
    .or(z.literal('')),
  chequeMediaKey: z.string().max(400).optional(),
  advanceReturnAck: z.literal(true),
  panNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'expected a PAN like ABCDE1234F'),
  panMediaKey: z.string().max(400).optional(),
  gstNumber: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      (s) => s === 'NONE' || /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s),
      'expected a 15-character GSTIN, or NONE',
    ),
  gstMediaKey: z.string().max(400).optional(),
  neftAgreed: z.literal(true),
  tncAgreed: z.literal(true),
  // The electrical and logistics block the vendor gives at this step.
  plugs5a: Count(50),
  plugs15a: Count(50),
  gasStoves: Count(10),
  appliances: z.array(ApplianceInput).max(20).default([]),
  tablesNeeded: Count(50),
  chairsNeeded: Count(200),
  passes2w: Count(50),
  passes4w: Count(50),
  passesStaff: Count(200),
  remarks: z.string().trim().max(2000).optional(),
});
export type BankDetailsInput = z.infer<typeof BankDetailsInput>;

/** Ask the store for an upload slot. The server chooses the key. */
export const PresignUploadInput = z.object({
  purpose: z.enum(['CHEQUE', 'PAN', 'GST', 'FSSAI']),
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
});
export type PresignUploadInput = z.infer<typeof PresignUploadInput>;

export interface PresignedUploadResponse {
  key: string;
  url: string;
  headers: Record<string, string>;
}

export const FssaiUploadInput = z.object({
  mediaKey: z.string().min(1).max(400),
  fileName: z.string().trim().min(1).max(200),
  licenseNumber: z
    .string()
    .trim()
    .regex(/^\d{14}$/, 'expected a 14-digit FSSAI number')
    .optional()
    .or(z.literal('')),
  validTill: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('')),
});
export type FssaiUploadInput = z.infer<typeof FssaiUploadInput>;

/** Bilingual labels for the public bank form. Transcribed from the 2025 PDF;
 *  where the Tamil did not render legibly in the source it is null. */
export const BANK_FORM_FIELDS: FormField[] = [
  {
    name: 'invoiceName',
    label: 'Name as required on Invoice',
    labelTa: null,
    help: 'Individual Name or Company Name',
    helpTa: 'தனிநபர் அல்லது கம்பெனி பெயர்',
    type: 'text',
    required: true,
  },
  {
    name: 'accountHolder',
    label: 'Name of the Bank Account holder',
    labelTa: 'வங்கி கணக்கு வைத்திருப்பவரின் பெயர்',
    help: 'Receipt will be issued in this name',
    helpTa: 'கட்டணம் செலுத்துவதற்கான ரசீது இந்த பெயரில் வழங்கப்படும்',
    type: 'text',
    required: true,
  },
  { name: 'mobile', label: 'Mobile Number', labelTa: 'கைபேசி எண்', type: 'tel', required: true },
  { name: 'address', label: 'Address', labelTa: 'முகவரி', type: 'textarea', required: true },
  { name: 'pincode', label: 'Pincode', labelTa: 'பின்கோடு', type: 'text', required: true },
  { name: 'bankName', label: 'Bank Name', labelTa: 'வங்கி பெயர்', type: 'text', required: true },
  { name: 'branch', label: 'Bank Branch', labelTa: 'வங்கிக்கிளை', type: 'text', required: true },
  {
    name: 'accountNumber',
    label: 'Account Number',
    labelTa: 'வங்கி கணக்கு எண்',
    help: 'Deposit amount will be returned to this account only. No cash will be given',
    helpTa: null,
    type: 'text',
    required: true,
  },
  { name: 'ifsc', label: 'IFSC Code', labelTa: null, type: 'text', required: true },
  { name: 'micr', label: 'MICR Code', labelTa: null, type: 'text', required: false },
  {
    name: 'chequeMediaKey',
    label: 'Cancelled Cheque or Bank Passbook front page with Name',
    labelTa: 'ரத்து செய்யப்பட்ட காசோலை அல்லது வங்கி பாஸ்புக் முதல் பக்கம்',
    help: 'Cancelled cheque should have the same Name and bank details as above',
    helpTa:
      'காசோலையில் இருக்கும் பெயரும் வங்கி கணக்கு விவரங்களில் கொடுக்கப்பட்டுள்ள பெயரும் ஒரே மாதிரி இருக்க வேண்டும்',
    type: 'text',
    required: true,
  },
  {
    name: 'advanceReturnAck',
    label: 'Please return the caution deposit to above given bank account',
    labelTa: 'தயவுசெய்து எச்சரிக்கை வைப்புத்தொகையை மேலே கொடுக்கப்பட்ட வங்கி கணக்கில் திருப்பி தரவும்',
    help: 'Advance money will be returned to the above mentioned bank account only. No cash will be given',
    helpTa:
      'டெபாசிட் தொகையை மேலே கொடுக்கப்பட்டுள்ள வங்கி கணக்கில் மட்டும்தான் திரும்பி செலுத்தப்படும். டெபாசிட் தொகையை பணமாக திருப்பி தர இயலாது',
    type: 'checkbox',
    required: true,
  },
  {
    name: 'panNumber',
    label: 'PAN Card Number',
    labelTa: null,
    help: 'PAN card should have the same Name as mentioned for Invoice Name',
    helpTa: null,
    type: 'text',
    required: true,
  },
  { name: 'panMediaKey', label: 'PAN Card upload', labelTa: null, type: 'text', required: false },
  {
    name: 'gstNumber',
    label: 'GST Number',
    labelTa: 'ஜிஎஸ்டி எண்',
    help: "If you don't have GST Number, please mention as None",
    helpTa: 'உங்களிடம் ஜிஎஸ்டி எண் இல்லையென்றால், இல்லை என குறிப்பிடவும்',
    type: 'text',
    required: true,
  },
  { name: 'gstMediaKey', label: 'GST Certificate', labelTa: null, type: 'text', required: false },
  {
    name: 'neftAgreed',
    label: 'I agree.',
    labelTa: null,
    help: "Isha Foundation's Bank account details will be sent you through email or SMS. Plz transfer money online using NEFT mode",
    helpTa:
      'ஈஷா ஃபவுண்டேஷனின் வங்கி கணக்கு விவரங்கள் உங்களுக்கு மின்னஞ்சல் அல்லது எஸ்எம்எஸ் மூலம் அனுப்பப்படும். NEFT பயன்முறையை பயன்படுத்தி ஆன்லைனில் பணம் செலுத்தவும்',
    type: 'checkbox',
    required: true,
  },
  {
    name: 'plugs5a',
    label: 'Number of 5 Amp Plug Points needed',
    labelTa: 'தேவையான 5 ஆம்ப் மின்சாதனங்கள் எண்ணிக்கை',
    help: 'One 5 Amp plug comes with the stall; each additional plug will cost Rs.500',
    helpTa:
      'ஒரு 5 ஆம்ப் மின் பெட்டி மண்டபத்துடன் சேர்ந்து வழங்கப்படும். அதற்கு அதிகமாக ஒவ்வொரு கூடுதல் மின் பெட்டிக்கும் ரூ.500 கட்டணமாகும்',
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'plugs15a',
    label: 'Number of 15 Amp Plug Points needed',
    labelTa: 'தேவையான 15 ஆம்ப் மின்சாதனங்கள் எண்ணிக்கை',
    help: 'Each 15 Amp connection will cost Rs. 1000',
    helpTa: 'ஒவ்வொரு 15 ஆம்ப் இணைப்பிற்கும் ரூ.1000 கட்டணமாகும்',
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'tablesNeeded',
    label: 'Do you need Tables?',
    labelTa: 'உங்களுக்கு மேசைகள் தேவையா?',
    help: 'Each table: Rs.400/day. For staff use only, not for customers',
    helpTa: 'ஒவ்வொரு மேசைக்கும் ரூ.400/நாள். இது பணியாளர்கள் பயன்பாட்டிற்கு மட்டும், வாடிக்கையாளர்களுக்கு அல்ல',
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'chairsNeeded',
    label: 'Do you need Chairs?',
    labelTa: 'உங்களுக்கு நாற்காலிகள் தேவையா?',
    help: 'Each chair: Rs.100/day. For staff use only, not for customers',
    helpTa: 'ஒவ்வொரு நாற்காலிக்கும் ரூ.100/நாள். இது பணியாளர்கள் பயன்பாட்டிற்கு மட்டும், வாடிக்கையாளர்களுக்கு அல்ல',
    type: 'number',
    required: true,
    min: 0,
    max: 200,
  },
  {
    name: 'gasStoves',
    label: 'How many Gas stoves you will be bringing?',
    labelTa: 'நீங்கள் எத்தனை எரிவாயு அடுப்புகளை கொண்டு வருவீர்கள்?',
    type: 'number',
    required: true,
    min: 0,
    max: 10,
  },
  {
    name: 'appliances',
    label: 'Electrical Appliances and their Wattage',
    labelTa: 'மின்சாதனம் மற்றும் அதன் வாட்டேஜ் குறிப்பிடவும்',
    type: 'appliances',
    required: false,
    max: 20,
  },
  {
    name: 'passes2w',
    label: 'Number of 2 wheeler passes needed',
    labelTa: 'தேவையான 2 சக்கர வாகன பாஸ்கள் எண்ணிக்கை',
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'passes4w',
    label: 'Number of 4 wheeler passes needed',
    labelTa: 'தேவையான 4 சக்கர வாகன பாஸ்கள் எண்ணிக்கை',
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'passesStaff',
    label: 'Number of Staff passes needed',
    labelTa: 'தேவையான பணியாளர் பாஸ்கள் எண்ணிக்கை',
    type: 'number',
    required: true,
    min: 0,
    max: 200,
  },
  {
    name: 'remarks',
    label: 'Any additional remarks',
    labelTa: 'ஏதேனும் கூடுதல் கருத்துகள்',
    type: 'textarea',
    required: false,
  },
  {
    name: 'tncAgreed',
    label: 'I have read and understood the T&C for stalls and accept the same',
    labelTa: 'நான் ஸ்டால்களுக்கான விதிமுறைகள் மற்றும் நிபந்தனைகளைப் படித்து புரிந்து கொண்டேன், அதை ஏற்றுக்கொள்கிறேன்',
    type: 'checkbox',
    required: true,
  },
];

// ── Public: responses ──────────────────────────────────────────────────────

export interface StatusStep {
  stage: RequestStage;
  label: string;
  state: 'done' | 'current' | 'todo';
}

export interface PublicBankView {
  reference: string;
  stallName: string;
  requestType: string;
  stallNumbers: string[];
  editionName: string;
  termsUrl: string | null;
  depositPaise: number;
  /** Present when already submitted — the form shows a read-only summary. */
  submitted: {
    submittedAt: string;
    invoiceName: string;
    accountHolder: string;
    bankName: string;
    accountNumberMasked: string;
  } | null;
  /** What the request already carries, to prefill the logistics block. */
  prefill: {
    plugs5a: number;
    plugs15a: number;
    gasStoves: number;
    tablesNeeded: number;
    chairsNeeded: number;
    passes2w: number;
    passes4w: number;
    passesStaff: number;
    appliances: Array<{ name: string; watts: number }>;
    mobile: string;
    address: string | null;
  };
}

export interface PublicFssaiView {
  reference: string;
  stallName: string;
  fssaiProcessUrl: string | null;
  current: {
    fileName: string;
    uploadedAt: string;
    verifiedAt: string | null;
    rejectedReason: string | null;
  } | null;
}

export interface PublicStaffView {
  reference: string;
  stallName: string;
  stallNumbers: string[];
  couponCode: string | null;
  maxStaff: number;
  registeredCount: number;
  staffRegistrationUrl: string | null;
}

// ── Staff: communication ───────────────────────────────────────────────────

export const TemplateKeyValue = z.enum(TEMPLATE_KEYS);

export const TemplateInput = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().min(1).max(20_000),
  attachmentKey: z.string().max(400).nullable().optional(),
});
export type TemplateInput = z.infer<typeof TemplateInput>;

export const SendEmailInput = z.object({
  requestIds: z.array(z.uuid()).min(1).max(500),
  templateKey: TemplateKeyValue,
  /** Re-send a selection confirmation that was already sent. Off by default —
   *  the requirement is that it is not sent twice. */
  force: z.boolean().default(false),
});
export type SendEmailInput = z.infer<typeof SendEmailInput>;

export interface SendResult {
  sent: string[];
  skipped: Array<{ requestId: string; reason: string }>;
  failed: Array<{ requestId: string; error: string }>;
}

export interface EmailLogRow {
  id: string;
  templateKey: string;
  toEmail: string;
  subject: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  sentAt: string;
  sentBy: string;
}

export interface CommsRow {
  id: string;
  reference: string;
  requestType: string;
  stallName: string;
  requesterName: string;
  email: string;
  status: RequestStatus;
  stage: RequestStage;
  allocatedStalls: string[];
  lastSent: Record<string, string>;
}

export interface TemplatePreview {
  subject: string;
  body: string;
  missing: string[];
}

// ── Staff: onboarding & payment ────────────────────────────────────────────

export interface OnboardingRow {
  id: string;
  reference: string;
  requestType: string;
  stallName: string;
  requesterName: string;
  email: string;
  contactNumber: string;
  stage: RequestStage;
  allocatedStalls: string[];
  bankSubmittedAt: string | null;
  payment: {
    totalPayablePaise: number;
    emailSentAt: string | null;
    confirmedAt: string | null;
  } | null;
  fssai: { uploadedAt: string; verifiedAt: string | null } | null;
  coupon: { code: string; maxStaff: number; registeredCount: number } | null;
  lastSent: Record<string, string>;
}

export interface PaymentView extends Bill {
  quotedAt: string;
  quotedBy: string;
  emailSentAt: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  creditDate: string | null;
  referenceNo: string | null;
  ecollectCode: string | null;
  remitterName: string | null;
  mode: string | null;
  amountReceivedPaise: number | null;
  notes: string | null;
}

export const ConfirmPaymentInput = z.object({
  creditDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  referenceNo: z.string().trim().min(1).max(100),
  ecollectCode: z.string().trim().max(100).optional(),
  remitterName: z.string().trim().max(200).optional(),
  mode: z.enum(['NEFT', 'RTGS', 'IMPS', 'UPI', 'CASH', 'CHEQUE', 'OTHER']),
  amountReceivedPaise: z.number().int().min(0).max(1_000_000_000),
  notes: z.string().trim().max(1000).optional(),
});
export type ConfirmPaymentInput = z.infer<typeof ConfirmPaymentInput>;

export interface FinanceRow {
  id: string;
  reference: string;
  stallName: string;
  requesterName: string;
  invoiceName: string | null;
  gstNumber: string | null;
  totalPayablePaise: number;
  emailSentAt: string | null;
  confirmedAt: string | null;
  amountReceivedPaise: number | null;
  differencePaise: number | null;
}

export const LinksInput = z.object({
  staffRegistrationUrl: z.url().nullable().optional(),
  fssaiProcessUrl: z.url().nullable().optional(),
  termsUrl: z.url().nullable().optional(),
  financeEmail: z.email().nullable().optional(),
  bankInstructions: z.string().max(4000).nullable().optional(),
});
export type LinksInput = z.infer<typeof LinksInput>;

// ── Staff: event ops ───────────────────────────────────────────────────────

export const IssueCouponInput = z.object({
  maxStaff: z.number().int().min(0).max(200).optional(),
});

export const RegisteredCountInput = z.object({
  registeredCount: z.number().int().min(0).max(500),
});

export const FssaiReviewInput = z.object({
  verdict: z.enum(['VERIFY', 'REJECT']),
  reason: z.string().trim().max(500).optional(),
});

export interface ElectricalRow {
  stallNumber: string;
  zoneCode: string;
  cluster: string | null;
  category: string;
  reference: string | null;
  stallName: string | null;
  requestType: string | null;
  plugs5a: number;
  plugs15a: number;
  gasStoves: number;
  appliances: Array<{ name: string; watts: number }>;
  totalWatts: number;
}

export const ClusterInput = z.object({ cluster: z.string().trim().max(40).nullable() });

export const CheckInInput = z.object({
  staffPresent: z.number().int().min(0).max(500),
  passes2wIssued: z.number().int().min(0).max(100),
  passes4wIssued: z.number().int().min(0).max(100),
  passesStaffIssued: z.number().int().min(0).max(500),
  notes: z.string().trim().max(1000).optional(),
});
export type CheckInInput = z.infer<typeof CheckInInput>;

export interface CheckInRow {
  id: string;
  reference: string;
  stallName: string;
  requesterName: string;
  contactNumber: string;
  requestType: string;
  stage: RequestStage;
  allocatedStalls: string[];
  passes2w: number;
  passes4w: number;
  passesStaff: number;
  coupon: { registeredCount: number; maxStaff: number } | null;
  pending: string[];
  checkedInAt: string | null;
}

export const FurnitureIssueInput = z.object({
  chairsIssued: z.number().int().min(0).max(500),
  tablesIssued: z.number().int().min(0).max(200),
  extraChairs: z.number().int().min(0).max(500),
  extraTables: z.number().int().min(0).max(200),
  cashCollectedPaise: z.number().int().min(0).max(100_000_000),
  notes: z.string().trim().max(1000).optional(),
});
export type FurnitureIssueInput = z.infer<typeof FurnitureIssueInput>;

export const FurnitureReturnInput = z.object({
  chairsReturned: z.number().int().min(0).max(1000),
  tablesReturned: z.number().int().min(0).max(500),
  chairsDamaged: z.number().int().min(0).max(1000),
  tablesDamaged: z.number().int().min(0).max(500),
  flagged: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional(),
});
export type FurnitureReturnInput = z.infer<typeof FurnitureReturnInput>;

export interface FurnitureRow {
  id: string;
  reference: string;
  stallName: string;
  requestType: string;
  contactNumber: string;
  allocatedStalls: string[];
  chairsOrdered: number;
  tablesOrdered: number;
  ledger: {
    chairsIssued: number;
    tablesIssued: number;
    extraChairs: number;
    extraTables: number;
    extraChargePaise: number;
    cashCollectedPaise: number;
    issuedAt: string | null;
    chairsReturned: number | null;
    tablesReturned: number | null;
    chairsMissing: number;
    tablesMissing: number;
    chairsDamaged: number;
    tablesDamaged: number;
    returnedAt: string | null;
    flagged: boolean;
    notes: string | null;
  } | null;
}

export const FineInput = z.object({
  fineTypeId: z.uuid().optional(),
  reason: z.string().trim().min(1).max(200),
  amountPaise: z.number().int().min(0).max(100_000_000),
});

export interface RefundRow {
  id: string;
  reference: string;
  stallName: string;
  requestType: string;
  invoiceName: string | null;
  accountHolder: string | null;
  bankName: string | null;
  accountNumberMasked: string | null;
  ifsc: string | null;
  depositTotalPaise: number;
  furnitureDeductionPaise: number;
  finesPaise: number;
  refundablePaise: number;
  shortfallPaise: number;
  fines: Array<{ id: string; reason: string; amountPaise: number; waivedAt: string | null }>;
  ledgerFlagged: boolean;
  preparedAt: string | null;
  sentToFinanceAt: string | null;
  paidAt: string | null;
  referenceNo: string | null;
}

export const RefundPaidInput = z.object({
  referenceNo: z.string().trim().min(1).max(100),
});
