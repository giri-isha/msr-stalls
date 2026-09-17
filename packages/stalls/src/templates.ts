/** Outbound mail, as editable data.
 *
 *  The requirement asks for "an email template to send an email communication
 *  along with attachment to selected vendors… different email templates for
 *  Ashram stall and vendor stalls". So the bodies below are seeds, not code:
 *  an admin edits them on the Communication screen and the module renders
 *  whatever is stored. Nothing here is hard-coded into a send path.
 *
 *  Placeholders are `{{name}}`. An unknown one renders as an empty string
 *  rather than leaving `{{oops}}` in a vendor's inbox — a missing figure is a
 *  gap a reader can query, a stray brace is a mistake they cannot act on.
 */

export const TEMPLATE_KEYS = [
  'SELECTION_VENDOR',
  'SELECTION_ASHRAM',
  'PAYMENT_DETAILS',
  'ONBOARDING_FSSAI_STAFF',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateSeed {
  key: TemplateKey;
  name: string;
  description: string;
  subject: string;
  body: string;
  /** The WhatsApp version. Short, no attachment, and written for a phone —
   *  empty where a letter only makes sense as email. */
  whatsappBody: string;
  /** Which requester types this template is offered for. The Communication
   *  screen uses it to pick a default, and the send path uses it to refuse a
   *  mismatch — an ashram department must never receive the vendor letter with
   *  its bank-form link. */
  appliesTo: ReadonlyArray<'ASHRAM' | 'LOCAL_WELFARE' | 'VENDOR'>;
}

/** Every placeholder the module knows how to fill, with what it means. Shown
 *  beside the editor so an admin writing a template can see what is available
 *  without reading this file. */
export const TEMPLATE_PLACEHOLDERS: Array<{ key: string; description: string }> = [
  { key: 'requesterName', description: 'Who applied' },
  { key: 'stallName', description: 'The stall’s name' },
  { key: 'reference', description: 'Request reference, e.g. VEN-2026-0042' },
  {
    key: 'stallNumbers',
    description:
      'Allocated stall numbers — EMPTY until the stall checks in, so a letter sent before then renders a blank',
  },
  { key: 'zoneCode', description: 'The agreed zone' },
  { key: 'virtualAccountRent', description: 'Virtual account for the rent' },
  { key: 'virtualAccountDeposit', description: 'Virtual account for the deposit' },
  { key: 'signatureUrl', description: 'Link to sign the stall agreement' },
  { key: 'editionName', description: 'e.g. Stalls 2026' },
  { key: 'feeTotal', description: 'Fee including GST, formatted' },
  { key: 'depositTotal', description: 'Refundable deposit, formatted' },
  { key: 'grandTotal', description: 'Fee plus deposit, formatted' },
  // 🔴 The 2025 letter shows the arithmetic — "15 Amp : 4 × 1000 : ₹4,000.00" —
  // because a vendor querying their bill asks about the multiplication, not the
  // total. `charges` is those lines, already aligned; the zero rows are dropped
  // so a stall that took no chairs is not billed a visible nothing.
  {
    key: 'charges',
    description: 'The itemised charges, one per line with counts and rates, GST and fee total',
  },
  { key: 'depositBreakdown', description: 'Caution deposit split into stall and furniture' },
  // 🔴 The beneficiary block was PROSE in the body below, which was fine while
  // the letter was the only place a vendor read it. Their payment page now
  // prints the same table, and two copies of a bank identity is one bank change
  // away from a page and a letter naming different beneficiaries. It is the
  // edition's configuration now, and these render it.
  { key: 'beneficiaryName', description: 'Account name the transfer is made to' },
  { key: 'beneficiaryAddress', description: 'The beneficiary’s address' },
  { key: 'accountType', description: 'Savings or current' },
  { key: 'bankName', description: 'The bank the accounts are held at' },
  { key: 'ifscCode', description: 'RTGS / NEFT / IFSC code' },
  { key: 'branchAddress', description: 'The branch the accounts are held at' },
  { key: 'stallDeposit', description: 'Caution deposit for the stall alone, formatted' },
  { key: 'equipmentDeposit', description: 'Caution deposit for chairs and tables, formatted' },
  { key: 'gstAmount', description: 'The GST alone, formatted' },
  { key: 'netAmount', description: 'Charges before GST, formatted' },
  { key: 'bankFormUrl', description: 'Private link to the bank-details form' },
  { key: 'fssaiUrl', description: 'Private link to the FSSAI upload form' },
  { key: 'staffRegistrationUrl', description: 'Staff registration link' },
  { key: 'staffCouponCode', description: 'The vendor’s staff-registration coupon' },
  { key: 'statusUrl', description: 'The vendor’s own status page' },
];

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  {
    key: 'SELECTION_VENDOR',
    name: 'Vendor selection confirmation',
    description:
      'Sent once a vendor or local welfare stall is selected. Carries the bank form link.',
    appliesTo: ['VENDOR', 'LOCAL_WELFARE'],
    subject: 'Your stall is confirmed — {{stallName}} ({{reference}})',
    whatsappBody: [
      'Namaskaram {{requesterName}},',
      '',
      'Your stall {{stallName}} ({{reference}}) is confirmed for {{editionName}} in area {{zoneCode}}.',
      '',
      'Please complete your bank details and requirements here: {{bankFormUrl}}',
      '',
      'Your stall number is given at the check-in counter.',
      '',
      'Isha Stall Team',
    ].join('\n'),
    body: [
      'Dear {{requesterName}},',
      '',
      'Your stall request for {{editionName}} has been confirmed.',
      '',
      'Stall name : {{stallName}}',
      'Reference  : {{reference}}',
      'Area       : {{zoneCode}}',
      '',
      'Your stall number within the area is given to you at the check-in counter',
      'when you collect your wristbands.',
      '',
      'Next step — please complete the bank details and requirements form:',
      '{{bankFormUrl}}',
      '',
      'You will also receive the stall agreement for digital signature:',
      '{{signatureUrl}}',
      '',
      'Once we receive it we will send you the payment details. Payment is made',
      'by NEFT to the Isha Foundation account named in that email; no payment is',
      'collected on the form itself.',
      '',
      'You can see the status of your request at any time here:',
      '{{statusUrl}}',
      '',
      'Isha Stall Team',
    ].join('\n'),
  },
  {
    key: 'SELECTION_ASHRAM',
    name: 'Ashram selection confirmation',
    description: 'Sent to an ashram department. No bank form, no payment.',
    appliesTo: ['ASHRAM'],
    subject: 'Your ashram stall is confirmed — {{stallName}} ({{reference}})',
    whatsappBody: [
      'Namaskaram {{requesterName}},',
      '',
      'Your ashram stall {{stallName}} ({{reference}}) is confirmed for {{editionName}} in area {{zoneCode}}.',
      '',
      'Staff registration coupon: {{staffCouponCode}}',
      '{{staffRegistrationUrl}}',
      '',
      'Isha Stall Team',
    ].join('\n'),
    body: [
      'Dear {{requesterName}},',
      '',
      'Your stall request for {{editionName}} has been confirmed.',
      '',
      'Stall name : {{stallName}}',
      'Reference  : {{reference}}',
      'Area       : {{zoneCode}}',
      '',
      'Your stall number within the area is given at the check-in counter.',
      '',
      'Please share the stall layout and electrical requirements with your team.',
      'Staff registration coupon: {{staffCouponCode}}',
      '{{staffRegistrationUrl}}',
      '',
      'You can see the status of your request at any time here:',
      '{{statusUrl}}',
      '',
      'Isha Stall Team',
    ].join('\n'),
  },
  {
    key: 'PAYMENT_DETAILS',
    name: 'Payment details',
    description: 'Sent after bank details are received. Carries the itemised amount due.',
    appliesTo: ['VENDOR', 'LOCAL_WELFARE'],
    subject: 'Payment details for your stall — {{reference}}',
    whatsappBody: [
      'Namaskaram {{requesterName}},',
      '',
      'Amount due for {{stallName}} ({{reference}}):',
      'Fee incl. GST: {{feeTotal}}',
      'Refundable deposit: {{depositTotal}}',
      'Total: {{grandTotal}}',
      '',
      'Please transfer by NEFT:',
      'Fee to {{virtualAccountRent}}',
      'Deposit to {{virtualAccountDeposit}}',
      '',
      'Keep the reference number — we need it to confirm your payment.',
      '',
      'Isha Stall Team',
    ].join('\n'),
    // 🔴 The two payments are SEPARATE, and the letter says so twice. Rent and
    // deposit land on different virtual accounts, and a vendor who transfers the
    // sum of both into one of them has paid an amount that reconciles against
    // neither — which is a refund request and a chase, not a payment.
    //
    // ⚠️ The bank identity below — account name, beneficiary address, bank,
    // IFSC, branch — used to be TEXT here, so the team could change banks
    // without a deploy. It is the EDITION'S SETTINGS now, and still changes
    // without one: the Admin screen writes them, this letter renders them, and
    // the vendor's own payment page renders the same rows. It had to move the
    // day that page started printing the block too — a vendor cannot make an
    // NEFT transfer from a page that knows the account number and not the
    // IFSC, and a second copy of the identity is one bank change away from a
    // letter and a page naming different beneficiaries.
    body: [
      'Namaskaram {{requesterName}},',
      '',
      'Congratulations!',
      '',
      'You, {{stallName}}, have been selected to set up a stall during',
      '{{editionName}} at Isha Foundation. Rent, caution deposit and additional',
      'charges are set out below.',
      '',
      'These details are for fund transfer through NEFT/RTGS only. Please do not',
      'make transfers using IMPS.',
      '',
      'PLEASE PAY PAYMENTS 1 AND 2 SEPARATELY.',
      '',
      '── Payment 1: For Rent ─────────────────────────────────────────────',
      '',
      '{{charges}}',
      '',
      'Please pay using the details below.',
      '',
      '  Account Name              {{beneficiaryName}}',
      '  Beneficiary Address       {{beneficiaryAddress}}',
      '  Account Type              {{accountType}}',
      '  Account Number for RENT   {{virtualAccountRent}}',
      '  Bank Name                 {{bankName}}',
      '  RTGS / NEFT / IFSC Code   {{ifscCode}}',
      '  Address                   {{branchAddress}}',
      '',
      'This account is issued to you alone; please do not share it.',
      '',
      '── Payment 2: For Security Deposit ─────────────────────────────────',
      '',
      'The caution deposit must be paid separately.',
      '',
      '{{depositBreakdown}}',
      '',
      'Please pay using the details below.',
      '',
      '  Account Name                {{beneficiaryName}}',
      '  Beneficiary Address         {{beneficiaryAddress}}',
      '  Account Type                {{accountType}}',
      '  Account Number for DEPOSIT  {{virtualAccountDeposit}}',
      '  Bank Name                   {{bankName}}',
      '  RTGS / NEFT / IFSC Code     {{ifscCode}}',
      '  Address                     {{branchAddress}}',
      '',
      'This account is issued to you alone; please do not share it.',
      '',
      '── Important ───────────────────────────────────────────────────────',
      '',
      '1. Direct cash, cheque or DD deposits are not allowed for these accounts.',
      '2. Please add the beneficiary using your bank’s desktop site — many apps',
      '   will not accept alphanumeric characters in the account number field.',
      '3. Please do not pay through Google Pay, PhonePe or Paytm: they do not',
      '   send the remitter details, so we cannot identify your payment.',
      '4. HDFC account holders can add the account number under',
      '   "Add Beneficiary — ECMS code".',
      '5. Please transfer from one account only, for easy reconciliation.',
      '6. Once you have paid, submit your transfer details here: {{statusUrl}}',
      '',
      '── Other inputs needed ─────────────────────────────────────────────',
      '',
      'Please confirm you have read the attached terms and conditions. Print',
      'them, sign each page, scan and send the scanned copy to us.',
      '',
      'You also need to give us the staff and vehicle details for shifting',
      'material to the stall. We will send a separate link for that. Every staff',
      'member must carry a valid government photo ID.',
      '',
      'Without all three steps, the stall will not be provided.',
      '',
      'The deposit is returned to the bank account you gave us after the event,',
      'less any deductions for unreturned or damaged chairs and tables or for an',
      'unclean stall.',
      '',
      'Pranam,',
      'Isha — Stall Management Team',
    ].join('\n'),
  },
  {
    key: 'ONBOARDING_FSSAI_STAFF',
    name: 'FSSAI and staff registration',
    description:
      'Sent once payment is confirmed. Carries the FSSAI upload link and the staff coupon.',
    // ⚠️ `ASHRAM`, where this was `ASHRAM_FOOD`. The ashram forms are one, so
    // this list can no longer say "ashram departments that sell food" — and it
    // does not need to: a non-food ashram stall has no FSSAI step outstanding,
    // so `pendingSteps` leaves it off the sending list on its own.
    appliesTo: ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM'],
    subject: 'Next steps for your stall — FSSAI and staff registration',
    whatsappBody: [
      'Namaskaram {{requesterName}},',
      '',
      'Payment for {{stallName}} ({{reference}}) is confirmed. Two things remain:',
      '',
      '1. FSSAI certificate: {{fssaiUrl}}',
      '2. Register your staff with coupon {{staffCouponCode}}: {{staffRegistrationUrl}}',
      '',
      'Please do not share the coupon outside your own team.',
      '',
      'Isha Stall Team',
    ].join('\n'),
    body: [
      'Dear {{requesterName}},',
      '',
      'Your payment for {{stallName}} ({{reference}}) is confirmed. Two things',
      'remain before the event.',
      '',
      '1. FSSAI certificate — every food stall must upload a valid certificate:',
      '   {{fssaiUrl}}',
      '',
      '2. Staff registration — everyone working on your stall must be registered',
      '   before they can be given a pass. Use your coupon:',
      '   Coupon: {{staffCouponCode}}',
      '   {{staffRegistrationUrl}}',
      '',
      'Please do not share the coupon outside your own team — registrations made',
      'with it are recorded against your stall.',
      '',
      'Isha Stall Team',
    ].join('\n'),
  },
];

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Substitutes `{{name}}` from `vars`. A name that is not supplied renders as
 *  an empty string — see the note at the top of the file. */
export function renderTemplate(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(PLACEHOLDER, (_, key: string) => vars[key] ?? '');
}

/** Placeholders used in a body that the module cannot fill. Shown as a warning
 *  in the editor while an admin types, so a typo is caught before it reaches a
 *  vendor rather than after. */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set(TEMPLATE_PLACEHOLDERS.map((p) => p.key));
  const found = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (!known.has(m[1])) found.add(m[1]);
  }
  return [...found];
}
