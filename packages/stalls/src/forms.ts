import type { StallRequestType } from './reference';
import { ZONE_BLURB_2025 } from './zones';
import type { PublicZone } from './contracts';

/** The four 2025 request forms, transcribed from the PDFs in `stalls_forms/`.
 *
 *  ── On the Tamil ───────────────────────────────────────────────────────────
 *  Every `labelTa` below was copied character-for-character from the printed
 *  2025 Google Form. None of it is machine-translated, and none of it is
 *  guessed. Where the source form had no Tamil — the two ashram forms, which
 *  ashram departments fill in English — `labelTa` is `null`.
 *
 *  Two plug-point pricing notes did not render legibly in the request-form
 *  PDFs; they were taken from the 2025 bank-details form, where the same text
 *  renders cleanly. Nothing here is an approximation.
 *
 *  ── 🔴 THIS FILE IS THE SEED, NOT THE FORM ─────────────────────────────────
 *  It WAS both: one component rendered all four forms from this table and the
 *  API validated against it. Forms are rows now — `StallFormDefinition` and the
 *  fields under it — and `seedFormDefinitions` writes these constants into an
 *  edition the first time it is created.
 *
 *  ⚠️ So an edit here reaches NO existing edition. Changing a label in this
 *  file changes what a NEW edition starts with and nothing else; the 2026 form
 *  is whatever the 2026 rows say, and the Admin screen is where it is changed.
 *  What this file is still for is the transcription below — which is why it is
 *  read by the seed rather than copied into a migration.
 *
 *  The two ashram forms' `FORM_DEFINITIONS` entries also remain the fallback
 *  the public page renders while an edition has no rows yet, which is the
 *  window between deploying this and the API next starting.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'appliances'
  /** The preferred-location radio list. Its choices are the edition's zones,
   *  resolved at render time rather than stored here. */
  | 'zone';

export interface FieldOption {
  value: string;
  label: string;
  labelTa: string | null;
}

export interface FormField {
  name: string;
  label: string;
  /** The Tamil printed beside the English on the 2025 form. `null` where the
   *  source form had none. Never machine-translated. */
  labelTa: string | null;
  help?: string;
  helpTa?: string | null;
  type: FieldType;
  required: boolean;
  options?: FieldOption[];
  min?: number;
  max?: number;
}

export interface FormDefinition {
  type: StallRequestType;
  title: string;
  titleTa: string | null;
  /** The allocation disclaimer, shown above the form and acknowledged by the
   *  `agreed` field. Legally the most important string on the page. */
  disclaimer: string;
  disclaimerTa: string | null;
  fields: FormField[];
}

// ── Shared pieces ───────────────────────────────────────────────────────────

/** The disclaimer printed on both public forms, verbatim, in both languages. */
const PUBLIC_DISCLAIMER =
  'Submission of stall request form does not guarantee stall allocation to you ' +
  'for the Event. Allocation is at sole discretion of Isha Stall Team. Only the ' +
  'selected stall will be informed in the registered email id.';

const PUBLIC_DISCLAIMER_TA =
  'ஸ்டால் கோரிக்கைப் படிவத்தைச் சமர்ப்பித்தால், நிகழ்விற்கான ஸ்டால் ஒதுக்கீடு ' +
  'உங்களுக்கு உத்தரவாதம் அளிக்காது. ஒதுக்கீடு ஈஷா ஸ்டால் குழுவின் சொந்த ' +
  'விருப்பத்திற்கு உட்பட்டது. தேர்ந்தெடுக்கப்பட்ட ஸ்டாலுக்கு மட்டும் பதிவு ' +
  'செய்யப்பட்ட மின்னஞ்சல் ஐடியில் தெரிவிக்கப்படும்.';

const ASHRAM_DISCLAIMER =
  'PLEASE NOTE THAT REQUISITION IS NOT A CONFIRMATION OF ALLOCATION OF A STALL. ' +
  'Stalls will be allocated based on availability. Please note that stalls are ' +
  'not near the seating area. Please refer to Map and choose based on need.';

/** The preferred-location choices, built from the edition's OWN zones.
 *
 *  ⚠️ Not a constant. The venue is redrawn each year — a bay is added, another
 *  dropped — and a baked-in list would mean a form that silently cannot offer
 *  a bay the team had already configured and priced. The 2025 seating blurbs
 *  are kept in `ZONE_BLURB_2025` and used where the code still matches;
 *  anything added since shows its own configured name, which is what an admin
 *  typed for exactly this purpose.
 *
 *  `forVendor` drops the bays closed to trade. A3 and B2 are the standing case:
 *  closed on the vendor form, offered on the local welfare one, because that is
 *  who actually stands in them. */
export function zoneOptions(zones: PublicZone[], forVendor: boolean): FieldOption[] {
  return zones
    .filter((z) => !(forVendor && z.isClosedToVendors))
    .map((z) => ({
      value: z.code,
      label: z.blurb ?? ZONE_BLURB_2025[z.code] ?? z.name,
      labelTa: null,
    }));
}

const YES_NO: FieldOption[] = [
  { value: 'YES', label: 'Yes', labelTa: null },
  { value: 'NO', label: 'No', labelTa: null },
];

const agreedField = (labelTa: string | null): FormField => ({
  name: 'agreed',
  label: 'I Agree',
  labelTa,
  type: 'checkbox',
  required: true,
});

/** The electrical block, identical on the local welfare and ashram forms. The
 *  prices in the help text are the 2025 printed ones; the Admin screen's charge
 *  configuration is what actually bills. */
const electricalFields = (tamil: boolean): FormField[] => [
  {
    name: 'plugs5a',
    label: 'Number of 5 AMP Plug Points',
    labelTa: null,
    help: 'One 5 AMP plug point will be provided. Additional points are Rs.500/point',
    // Transcribed from the 2025 bank-details form, where this note renders
    // legibly (the request-form PDF garbled it).
    helpTa:
      'ஒரு 5 ஆம்ப் மின் பெட்டி மண்டபத்துடன் சேர்ந்து வழங்கப்படும். அதற்கு அதிகமாக ' +
      'ஒவ்வொரு கூடுதல் மின் பெட்டிக்கும் ரூ.500 கட்டணமாகும். எனவே, உண்மையாகவே ' +
      'தேவையான அளவிற்கு மட்டுமே கோரவும்.',
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'plugs15a',
    label: 'Number of 15 AMP Plug Points',
    labelTa: null,
    help:
      'Rs. 1000 for each 15 AMP plug point (upto 1000 watts, additional Rs.500 ' +
      'for every additional 500 watts)',
    helpTa:
      'ஒவ்வொரு 15 ஆம்ப் இணைப்பிற்கும் ரூ.1000 கட்டணமாகும். எனவே, உண்மையாகவே தேவையான ' +
      'அளவிற்கு மட்டுமே கோரவும்.',
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'gasStoves',
    label: 'How many Gas stoves you will be bringing?',
    labelTa: tamil ? 'நீங்கள் எத்தனை எரிவாயு அடுப்புகளை கொண்டு வருவீர்கள்?' : null,
    type: 'number',
    required: true,
    min: 0,
    max: 10,
  },
  {
    name: 'appliances',
    label: 'Electrical Appliances and their Wattage',
    labelTa: null,
    help: 'List each appliance you will bring and its wattage',
    type: 'appliances',
    required: false,
    max: 20,
  },
];

// ── Vendor ──────────────────────────────────────────────────────────────────

const VENDOR_FIELDS: FormField[] = [
  { name: 'email', label: 'Email', labelTa: null, type: 'email', required: true },
  agreedField('நான் ஒப்புக்கொள்கிறேன்'),
  { name: 'stallName', label: 'Stall Name', labelTa: 'ஸ்டால் பெயர்', type: 'text', required: true },
  { name: 'requesterName', label: 'Vendor Name', labelTa: null, type: 'text', required: true },
  { name: 'address', label: 'Address', labelTa: 'முகவரி', type: 'textarea', required: true },
  {
    name: 'contactNumber',
    label: 'Contact Number',
    labelTa: 'தொடர்பு எண்',
    type: 'tel',
    required: true,
  },
  {
    name: 'stallType',
    label: 'Type of stall',
    labelTa: 'ஸ்டால் வகை',
    type: 'select',
    required: true,
    options: [
      { value: 'FOOD', label: 'Food', labelTa: null },
      { value: 'NON_FOOD', label: 'Non Food', labelTa: null },
    ],
  },
  {
    name: 'preferredZoneCode',
    label: 'Preferred Location',
    labelTa: null,
    // Options come from the edition's zones at render time — see `zoneOptions`.
    type: 'zone',
    required: true,
  },
  {
    name: 'itemsSelling',
    label: 'What items are you selling? (Cannot change the items listed here)',
    labelTa: 'நீங்கள் என்ன பொருட்களை விற்கிறீர்கள்? (இங்கே பட்டியலிடப்பட்ட உருப்படிகளை மாற்ற முடியாது)',
    type: 'textarea',
    required: true,
  },
  {
    name: 'numStallsRequested',
    label: 'Number of stalls required (Stall size is 10x20 Feet)',
    labelTa: 'தேவையான ஸ்டால்களின் எண்ணிக்கை (ஸ்டால் அளவு 10x20 அடி)',
    type: 'number',
    required: true,
    min: 1,
    max: 10,
  },
  {
    name: 'remarks',
    label: 'Any additional remarks',
    labelTa: 'ஏதேனும் கூடுதல் கருத்துகள்',
    type: 'textarea',
    required: false,
  },
];

// ── Local welfare ───────────────────────────────────────────────────────────

const LOCAL_WELFARE_FIELDS: FormField[] = [
  { name: 'email', label: 'Email', labelTa: null, type: 'email', required: true },
  agreedField('நான் ஒப்புக்கொள்கிறேன்'),
  { name: 'stallName', label: 'Stall Name', labelTa: 'ஸ்டால் பெயர்', type: 'text', required: true },
  { name: 'requesterName', label: 'Vendor Name', labelTa: null, type: 'text', required: true },
  { name: 'address', label: 'Address', labelTa: 'முகவரி', type: 'textarea', required: true },
  {
    name: 'contactNumber',
    label: 'Contact Number',
    labelTa: 'தொடர்பு எண்',
    type: 'tel',
    required: true,
  },
  {
    name: 'stallType',
    label: 'Type of stall',
    labelTa: 'ஸ்டால் வகை',
    type: 'select',
    required: true,
    options: [
      { value: 'FOOD', label: 'Food', labelTa: null },
      { value: 'NON_FOOD', label: 'Non Food', labelTa: null },
    ],
  },
  {
    name: 'preferredZoneCode',
    label: 'Preferred Location',
    labelTa: null,
    type: 'zone',
    required: true,
  },
  {
    name: 'itemsSelling',
    label: 'What items are you selling? (Cannot change the items listed here)',
    labelTa: 'நீங்கள் என்ன பொருட்களை விற்கிறீர்கள்? (இங்கே பட்டியலிடப்பட்ட உருப்படிகளை மாற்ற முடியாது)',
    type: 'textarea',
    required: true,
  },
  {
    name: 'numStallsRequested',
    label: 'Number of stalls required (Stall size is 10x20 Feet)',
    labelTa: 'தேவையான ஸ்டால்களின் எண்ணிக்கை (ஸ்டால் அளவு 10x20 அடி)',
    type: 'number',
    required: true,
    min: 1,
    max: 10,
  },
  ...electricalFields(true),
  {
    name: 'tablesNeeded',
    // ⚠️ The 2025 local welfare form quotes Rs.300/day per table and Rs.100/day
    // per chair. The 2025 ASHRAM form quotes Rs.50/day per chair. The rates
    // genuinely differ by requester type — do not "fix" one to match the other.
    // Both are seeded into StallChargeConfig and editable from Admin.
    label: 'Do you need Tables? (Each Table Rs.300/day & Chair Rs 100/day)',
    labelTa: 'உங்களுக்கு மேசைகள் தேவையா?',
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'chairsNeeded',
    label: 'Do you need Chairs? (Each Chair Rs 100/day)',
    labelTa: 'உங்களுக்கு நாற்காலிகள் தேவையா?',
    type: 'number',
    required: true,
    min: 0,
    max: 200,
  },
  {
    name: 'passes2w',
    label: 'Number of Vehicle Pass - 2 Wheeler',
    labelTa: null,
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'passes4w',
    label: 'Number of Vehicle Pass - 4 Wheeler',
    labelTa: null,
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'depositAcknowledged',
    label: 'Refundable Caution Deposit',
    labelTa: 'திரும்பப்பெறக்கூடிய எச்சரிக்கை வைப்பு',
    help: 'Money will be deducted for any damage, loss or cleaning charges. The amount depends on the area you choose and is shown with it above.',
    // TO-VERIFY: the 2025 Tamil named the flat Rs.4000 figure, which is now
    // area-wise. Ask the stalls team for the revised string rather than
    // editing a printed one — it is the sentence that says money is withheld.
    helpTa: null,
    type: 'checkbox',
    required: true,
  },
  {
    name: 'remarks',
    label: 'Any additional remarks',
    labelTa: 'ஏதேனும் கூடுதல் கருத்துகள்',
    type: 'textarea',
    required: false,
  },
];

// ── Ashram (English only — ashram departments work in English) ───────────────

const ashramFields = (food: boolean): FormField[] => [
  { name: 'email', label: 'Email', labelTa: null, type: 'email', required: true },
  agreedField(null),
  { name: 'departmentHead', label: 'Department Head', labelTa: null, type: 'text', required: true },
  {
    name: 'departmentHeadContact',
    label: 'Department Head Contact Number',
    labelTa: null,
    type: 'tel',
    required: true,
  },
  { name: 'department', label: 'Department', labelTa: null, type: 'text', required: true },
  { name: 'requestedBy', label: 'Requested By', labelTa: null, type: 'text', required: true },
  {
    name: 'requesterContact',
    label: 'Requester Contact Number',
    labelTa: null,
    type: 'tel',
    required: true,
  },
  {
    name: 'stallName',
    label: 'Stall Name',
    labelTa: null,
    type: 'text',
    required: true,
  },
  {
    name: 'creditCardNeeded',
    label: 'Credit card Facility needed?',
    labelTa: null,
    type: 'select',
    required: true,
    options: YES_NO,
  },
  {
    name: 'usage',
    label: 'How is the stall Used?',
    labelTa: null,
    type: 'radio',
    required: true,
    options: [
      { value: 'DEPT_DISPLAY', label: 'Used by Department for Display', labelTa: null },
      { value: 'DEPT_SALES', label: 'Used by Department for Sales', labelTa: null },
      { value: 'VENDOR_SALES', label: 'Giving to Vendor for sales', labelTa: null },
      { value: 'SPONSOR', label: 'Giving to Sponsor', labelTa: null },
      { value: 'OTHER', label: 'Others - Please specify in remarks', labelTa: null },
    ],
  },
  {
    name: 'itemsSelling',
    label: 'What are you displaying/Selling?',
    labelTa: null,
    help: 'Please list the items',
    type: 'textarea',
    required: true,
  },
  {
    name: 'preferredZoneCode',
    label: 'Preferred Location',
    labelTa: null,
    help: 'If you need stalls in multiple areas, please create a separate entry for each area',
    type: 'zone',
    required: true,
  },
  {
    name: 'numStallsRequested',
    label: 'Number of stalls required',
    labelTa: null,
    type: 'number',
    required: true,
    min: 1,
    max: 10,
  },
  {
    name: 'wantsThembu',
    label: 'Do you want a stall during 11 Days of Tamil Thembu?',
    labelTa: null,
    type: 'select',
    required: true,
    options: YES_NO,
  },
  ...electricalFields(false),
  {
    name: 'tablesNeeded',
    label: 'Do you need tables?',
    labelTa: null,
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'chairsNeeded',
    // The ashram form's own rate — see the warning on the local welfare table field.
    label: 'Do you need chairs? (Each Chair : Rs.50/day. So order only if needed)',
    labelTa: null,
    type: 'number',
    required: true,
    min: 0,
    max: 200,
  },
  {
    name: 'passes2w',
    label: 'Number of 2 wheeler passes needed',
    labelTa: null,
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'passes4w',
    label: 'Number of 4 wheeler passes needed',
    labelTa: null,
    type: 'number',
    required: true,
    min: 0,
    max: 50,
  },
  {
    name: 'passesStaff',
    label: 'Number of Staff passes needed',
    labelTa: null,
    type: 'number',
    required: true,
    min: 0,
    max: 200,
  },
  {
    name: 'remarks',
    label: 'Any additional remarks',
    labelTa: null,
    type: 'textarea',
    required: false,
  },
  ...(food
    ? [
        {
          name: 'fssaiExpected',
          label: 'Will you hold an FSSAI certificate for this stall?',
          labelTa: null,
          help: 'Food stalls must upload an FSSAI certificate before the event',
          type: 'select' as const,
          required: true,
          options: YES_NO,
        },
      ]
    : []),
];

export const FORM_DEFINITIONS: Record<StallRequestType, FormDefinition> = {
  VENDOR: {
    type: 'VENDOR',
    title: 'Vendor Stall Request Form',
    titleTa: null,
    disclaimer: PUBLIC_DISCLAIMER,
    disclaimerTa: PUBLIC_DISCLAIMER_TA,
    fields: VENDOR_FIELDS,
  },
  LOCAL_WELFARE: {
    type: 'LOCAL_WELFARE',
    title: 'Local Welfare Stall Request Form',
    titleTa: null,
    disclaimer: PUBLIC_DISCLAIMER,
    disclaimerTa: PUBLIC_DISCLAIMER_TA,
    fields: LOCAL_WELFARE_FIELDS,
  },
  ASHRAM: {
    type: 'ASHRAM',
    title: 'Ashram Stall Request Form',
    titleTa: null,
    disclaimer: ASHRAM_DISCLAIMER,
    disclaimerTa: null,
    fields: ashramFields(false),
  },
  ASHRAM_FOOD: {
    type: 'ASHRAM_FOOD',
    title: 'Ashram Food Stall Request Form',
    titleTa: null,
    disclaimer: ASHRAM_DISCLAIMER,
    disclaimerTa: null,
    fields: ashramFields(true),
  },
};

export function fieldsFor(type: StallRequestType): FormField[] {
  return FORM_DEFINITIONS[type].fields;
}

export function formDefinition(type: StallRequestType): FormDefinition {
  return FORM_DEFINITIONS[type];
}
