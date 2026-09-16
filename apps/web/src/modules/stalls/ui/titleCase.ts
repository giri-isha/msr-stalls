/**
 * Title Case, for the words the screens actually show.
 *
 * Every visible label in this module — headings, buttons, tabs, field labels,
 * pills, stat tiles, menu items — is written in Title Case. Hard-coded strings
 * are simply spelled that way at source, so what a reader sees in the file is
 * what the screen says. This helper is for the ones that CANNOT be spelled at
 * source: values that arrive as enum keys (`ASHRAM_FOOD`) or role keys
 * (`stalls_admin`) and used to reach the screen lower-cased.
 *
 * ⚠️ Labels only. Sentences — a page's sub-heading, an empty state, help text,
 * a toast — stay in sentence case; running prose in Title Case reads as a
 * ransom note. Nothing here is applied to those.
 */

/**
 * Words a title leaves lowercase in the middle of a phrase.
 *
 * Deliberately short. The rule people actually recognise is "little joining
 * words stay small"; a long list starts swallowing words like `Up` and `Off`
 * that carry meaning in a label such as `Follow Up`.
 */
const MINOR = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'but',
  'by',
  'for',
  'from',
  'in',
  'nor',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'via',
  'vs',
  'with',
]);

/**
 * Words this product spells in capitals, keyed by their lowercase form.
 *
 * ⚠️ Needed because the enum values arrive SHOUTING — `FSSAI_PENDING` has to
 * be lower-cased before it can be title-cased, which would otherwise turn a
 * licence number's name into `Fssai`.
 */
const ACRONYMS: Record<string, string> = {
  api: 'API',
  csv: 'CSV',
  fssai: 'FSSAI',
  gst: 'GST',
  id: 'ID',
  ifsc: 'IFSC',
  imps: 'IMPS',
  inr: 'INR',
  kyc: 'KYC',
  msr: 'MSR',
  neft: 'NEFT',
  otp: 'OTP',
  pan: 'PAN',
  pdf: 'PDF',
  qr: 'QR',
  rtgs: 'RTGS',
  sms: 'SMS',
  upi: 'UPI',
  url: 'URL',
  utr: 'UTR',
};

/** One word — or one hyphenated half of one — capitalised. */
const capitalise = (w: string): string => ACRONYMS[w] ?? w.charAt(0).toUpperCase() + w.slice(1);

/**
 * `ASHRAM_FOOD` → `Ashram Food`, `stalls_bank_ops` → `Stalls Bank Ops`,
 * `bank form sent` → `Bank Form Sent`.
 *
 * Underscores are spaces, hyphens are kept and both halves capitalised
 * (`check-in` → `Check-In`), and the first and last words are always
 * capitalised however small they are — `Ready to Go`, but `The Lot Of`.
 */
export function titleCase(raw: string): string {
  const words = raw.replace(/_/g, ' ').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((word, i) => {
      const minor = MINOR.has(word) && i !== 0 && i !== words.length - 1;
      if (minor) return word;
      return word.split('-').map(capitalise).join('-');
    })
    .join(' ');
}
