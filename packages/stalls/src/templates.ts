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
  appliesTo: ReadonlyArray<'ASHRAM' | 'ASHRAM_FOOD' | 'LOCAL_WELFARE' | 'VENDOR'>;
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
  { key: 'editionName', description: 'e.g. Maha Shivratri 2026' },
  { key: 'feeTotal', description: 'Fee including GST, formatted' },
  { key: 'depositTotal', description: 'Refundable deposit, formatted' },
  { key: 'grandTotal', description: 'Fee plus deposit, formatted' },
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
    appliesTo: ['ASHRAM', 'ASHRAM_FOOD'],
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
    body: [
      'Dear {{requesterName}},',
      '',
      'Thank you for sending your bank details. The amount due for {{stallName}}',
      '(area {{zoneCode}}) is set out below.',
      '',
      'Fee, including GST      : {{feeTotal}}',
      'Refundable deposit      : {{depositTotal}}',
      'Total to transfer       : {{grandTotal}}',
      '',
      'Please transfer by NEFT to the accounts below. They are issued to you',
      'alone, which is how we identify your payment — please do not pay into any',
      'other account, and please keep the reference number.',
      '',
      'Fee, to account         : {{virtualAccountRent}}',
      'Deposit, to account     : {{virtualAccountDeposit}}',
      '',
      'The deposit is returned to the bank account you gave us, after the event,',
      'less any deductions for unreturned or damaged chairs and tables or for an',
      'unclean stall.',
      '',
      'Isha Stall Team',
    ].join('\n'),
  },
  {
    key: 'ONBOARDING_FSSAI_STAFF',
    name: 'FSSAI and staff registration',
    description:
      'Sent once payment is confirmed. Carries the FSSAI upload link and the staff coupon.',
    appliesTo: ['VENDOR', 'LOCAL_WELFARE', 'ASHRAM_FOOD'],
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
