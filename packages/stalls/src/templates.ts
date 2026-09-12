/** Email templates: the keys, the placeholders each may use, a renderer, and
 *  the defaults a new edition starts with. Admins edit the text; the
 *  placeholders are the contract between the text and the module. */

export const TEMPLATE_KEYS = [
  'SELECTION_VENDOR',
  'SELECTION_ASHRAM',
  'SELECTION_LOCAL_WELFARE',
  'PAYMENT_DETAILS',
  'BANK_REMINDER',
  'PAYMENT_REMINDER',
  'POST_PAYMENT',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  SELECTION_VENDOR: 'Selection confirmation — Vendor',
  SELECTION_ASHRAM: 'Selection confirmation — Ashram',
  SELECTION_LOCAL_WELFARE: 'Selection confirmation — Local Welfare',
  PAYMENT_DETAILS: 'Payment details',
  BANK_REMINDER: 'Reminder — bank details pending',
  PAYMENT_REMINDER: 'Reminder — payment pending',
  POST_PAYMENT: 'After payment — FSSAI and staff registration',
};

const COMMON = ['requesterName', 'stallName', 'reference', 'stallNumbers', 'zone', 'editionName'];

/** What each template may mention. The editor lists these; the renderer
 *  reports any it could not fill so a typo shows up as a warning, not as
 *  `{{stalName}}` in a vendor's inbox. */
export const PLACEHOLDERS: Record<TemplateKey, string[]> = {
  SELECTION_VENDOR: [...COMMON, 'bankFormUrl', 'statusUrl', 'termsUrl'],
  SELECTION_ASHRAM: [...COMMON, 'statusUrl'],
  SELECTION_LOCAL_WELFARE: [...COMMON, 'bankFormUrl', 'statusUrl', 'termsUrl'],
  PAYMENT_DETAILS: [...COMMON, 'billLines', 'totalPayable', 'bankInstructions', 'statusUrl'],
  BANK_REMINDER: [...COMMON, 'bankFormUrl'],
  PAYMENT_REMINDER: [...COMMON, 'totalPayable', 'bankInstructions'],
  POST_PAYMENT: [
    ...COMMON,
    'fssaiUploadUrl',
    'fssaiProcessUrl',
    'staffRegistrationUrl',
    'couponCode',
    'maxStaff',
  ],
};

/** Placeholders that are links or texts an admin MAY leave unset. A blank one
 *  renders as nothing and does not block a send; the load-bearing ones (the
 *  vendor's own signed links, the coupon, the bill) do. */
export const OPTIONAL_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'termsUrl',
  'bankInstructions',
  'fssaiProcessUrl',
  'staffRegistrationUrl',
  'zone',
]);

/** `{{name}}` → value. Unknown or missing names render as empty and are
 *  returned in `missing`, so the caller can refuse to send a half-filled mail. */
export function renderTemplate(
  text: string,
  vars: Record<string, string | number | null | undefined>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined || v === null || v === '') {
      missing.add(name);
      return '';
    }
    return String(v);
  });
  return { text: out, missing: [...missing] };
}

/** Which placeholders a body mentions, for the editor's "used / unused" hint. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!))];
}

const SIGN = '\n\nWarm regards,\nIsha Stall Team';

export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string; body: string }> = {
  SELECTION_VENDOR: {
    subject: 'Your stall is confirmed — {{stallName}} ({{reference}})',
    body:
      'Namaskaram {{requesterName}},\n\n' +
      'We are happy to confirm a stall for {{stallName}} at {{editionName}}.\n\n' +
      'Stall: {{stallNumbers}} in zone {{zone}}\nReference: {{reference}}\n\n' +
      'Please fill in your bank, GST and contract details here within 3 days:\n{{bankFormUrl}}\n\n' +
      'Terms and conditions: {{termsUrl}}\n\n' +
      'You can check your status at any time: {{statusUrl}}' +
      SIGN,
  },
  SELECTION_ASHRAM: {
    subject: 'Stall allocated — {{stallName}} ({{reference}})',
    body:
      'Namaskaram {{requesterName}},\n\n' +
      'A stall has been allocated to {{stallName}} for {{editionName}}.\n\n' +
      'Stall: {{stallNumbers}} in zone {{zone}}\nReference: {{reference}}\n\n' +
      'Status page: {{statusUrl}}' +
      SIGN,
  },
  SELECTION_LOCAL_WELFARE: {
    subject: 'Your stall is confirmed — {{stallName}} ({{reference}})',
    body:
      'Namaskaram {{requesterName}},\n\n' +
      'We are happy to confirm a stall for {{stallName}} at {{editionName}}.\n\n' +
      'Stall: {{stallNumbers}} in zone {{zone}}\nReference: {{reference}}\n\n' +
      'Please fill in your bank details for the refundable caution deposit here:\n{{bankFormUrl}}\n\n' +
      'Terms and conditions: {{termsUrl}}\n\nStatus page: {{statusUrl}}' +
      SIGN,
  },
  PAYMENT_DETAILS: {
    subject: 'Payment details — {{stallName}} ({{reference}})',
    body:
      'Namaskaram {{requesterName}},\n\n' +
      'Thank you for your details. The amount payable for {{stallName}} is:\n\n{{billLines}}\n\n' +
      'Total payable: {{totalPayable}}\n\n' +
      'Please transfer by NEFT to:\n{{bankInstructions}}\n\n' +
      'Quote {{reference}} in the transfer remarks. Status page: {{statusUrl}}' +
      SIGN,
  },
  BANK_REMINDER: {
    subject: 'Reminder: bank details pending — {{stallName}}',
    body:
      'Namaskaram {{requesterName}},\n\n' +
      'We have not yet received your bank and GST details for {{stallName}} ({{reference}}). ' +
      'Please complete them here:\n{{bankFormUrl}}' +
      SIGN,
  },
  PAYMENT_REMINDER: {
    subject: 'Reminder: payment pending — {{stallName}}',
    body:
      'Namaskaram {{requesterName}},\n\n' +
      'The payment of {{totalPayable}} for {{stallName}} ({{reference}}) is still pending. ' +
      'NEFT details:\n{{bankInstructions}}' +
      SIGN,
  },
  POST_PAYMENT: {
    subject: 'Payment received — next steps for {{stallName}}',
    body:
      'Namaskaram {{requesterName}},\n\n' +
      'We have received your payment for {{stallName}} ({{reference}}). Two things remain:\n\n' +
      '1. FSSAI certificate (food stalls): upload here {{fssaiUploadUrl}}\n   About the process: {{fssaiProcessUrl}}\n\n' +
      '2. Staff registration: register up to {{maxStaff}} staff at {{staffRegistrationUrl}}\n   Your coupon code: {{couponCode}} — keep it private.' +
      SIGN,
  },
};
