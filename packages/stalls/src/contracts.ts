import { z } from 'zod';
import type { Declaration } from './declarations';
import type { BuilderForm, BuiltForm } from './form-builder';
import { AUTHORABLE_FIELD_TYPES } from './form-builder';
import { SELF_SERVE_STEPS } from './access';
import type { PendingStep } from './onboarding';
import { CATEGORY_KEY_PATTERN, ZONE_CODE_PATTERN } from './zones';
import { RATE_SCOPES } from './rates';
import { MAX_STAFF_COUPON_CAPACITY } from './coupons';
import { VIRTUAL_ACCOUNT_PREFIX_PATTERN } from './virtual-account';
import { SIGNATURE_STATUSES } from './signing';

/** The shapes that cross the network, shared by api and web so a rename breaks
 *  the build rather than production. Host convention: `@msr/shared` publishes
 *  wire contracts; `@msr/volunteering` does the same for one module. This is
 *  that, for stalls. */

// ── Enums as wire values ────────────────────────────────────────────────────

export const RequestType = z.enum(['ASHRAM', 'LOCAL_WELFARE', 'VENDOR']);
export const StallTypeValue = z.enum(['FOOD', 'NON_FOOD']);
export const RequestStatus = z.enum([
  'SUBMITTED',
  'SHORTLISTED',
  'SELECTED',
  'BACKUP',
  'REJECTED',
  'CANCELLED',
]);
export const RequestStage = z.enum([
  'NEW',
  'BANK_FORM_SENT',
  'BANK_FORM_FILLED',
  'PAYMENT_SENT',
  'PAYMENT_CONFIRMED',
  'FSSAI_PENDING',
  'READY',
  'CHECKED_IN',
]);
export const FormType = z.enum(['ASHRAM', 'LOCAL_WELFARE', 'VENDOR', 'BANK', 'FSSAI', 'STAFF']);
export const RateScopeValue = z.enum(RATE_SCOPES);
export const AshramUsage = z.enum([
  'DEPT_DISPLAY',
  'DEPT_SALES',
  'VENDOR_SALES',
  'SPONSOR',
  'OTHER',
]);
/** ⚠️ A PATTERN, not an enum of the seven codes 2025 used. Zones are per-edition
 *  data an admin adds to and removes from; a closed list here would 400 every
 *  request naming a bay added after this file shipped, while the database held
 *  it quite happily. Whether the code names a zone that exists is a lookup, and
 *  the routes do it. */
export const ZoneCodeValue = z
  .string()
  .trim()
  .toUpperCase()
  .refine((s) => ZONE_CODE_PATTERN.test(s), 'expected a zone code like A4 or C1');

/** Same reasoning as `ZoneCodeValue`: the planning grid's columns are an
 *  edition's own configuration. */
export const CategoryValue = z
  .string()
  .trim()
  .toUpperCase()
  .refine((s) => CATEGORY_KEY_PATTERN.test(s), 'expected a category key like VENDOR_FOOD');

export type RequestStatus = z.infer<typeof RequestStatus>;
export type RequestStage = z.infer<typeof RequestStage>;

// ── Public: submit ──────────────────────────────────────────────────────────

/** Indian mobile numbers: 10 digits starting 6–9, optionally carrying a +91 and
 *  any amount of human spacing. Stored normalised to the bare 10 digits. */
export const IndianMobile = z
  .string()
  .trim()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, ''))
  .refine((s) => /^[6-9]\d{9}$/.test(s), 'expected a 10-digit Indian mobile number');

const Count = (max: number) => z.number().int().min(0).max(max);

export const ApplianceInput = z.object({
  name: z.string().trim().min(1).max(200),
  watts: z.number().int().min(0).max(50_000),
});

export const AshramBlock = z.object({
  departmentHead: z.string().trim().min(1).max(200),
  departmentHeadContact: IndianMobile,
  department: z.string().trim().min(1).max(200),
  requestedBy: z.string().trim().min(1).max(200),
  requesterContact: IndianMobile,
  creditCardNeeded: z.boolean(),
  usage: AshramUsage,
  usageOther: z.string().trim().max(500).optional(),
  wantsThembu: z.boolean(),
  fssaiExpected: z.boolean().optional(),
});

/** The exact declaration VERSIONS the page displayed.
 *
 *  🔴 Posted back, and checked against what is live — see `submitRequest`.
 *  Not because the client is trusted with them (it is not; a posted id is
 *  never what gets logged) but because a MISMATCH is the only way to notice
 *  that the wording changed while the form sat open. Without it, a page
 *  opened this morning submits against wording published this afternoon and
 *  the consent log records agreement to a paragraph nobody ever saw.
 *
 *  ⚠️ `optional`, NOT `.default([])`, and the difference is the whole
 *  design. Defaulted, "I displayed no declarations" and "I have never heard
 *  of declarations" arrive as the same value, so the check cannot tell a
 *  form that showed nothing from a caller that does not participate — and
 *  it would have to refuse both or neither. Absent means the second: log
 *  what is live, which is what every caller did before this existed. An
 *  ARRAY is a claim about what was on screen, and a claim is checked.
 *
 *  Omitting it is not a way around the check. The check detects staleness;
 *  it does not authorise anything, and skipping it logs the live wording —
 *  the same thing the server would have recorded anyway.
 *
 *  ⚠️ `uuid`, not any non-empty string. These ids are compared by set equality
 *  against the live rows, whose ids are uuids — so a value that cannot be one
 *  is a value that can only ever fail the comparison. Refusing it at the edge
 *  names the problem; accepting it turns a malformed post into a mysterious
 *  "the wording changed, please re-read it". */
const DeclarationIds = z.array(z.uuid()).max(20).optional();

/** `.strict()` is deliberately NOT used — unknown keys are stripped silently so
 *  a stale client does not 400, but nothing outside this schema is ever read.
 *  There is no key here that maps to status, stage, a stall number, or money. */
export const SubmitRequestInput = z
  .object({
    requestType: RequestType,
    stallName: z.string().trim().min(1).max(200),
    requesterName: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    contactNumber: IndianMobile,
    address: z.string().trim().max(1000).optional(),
    stallType: StallTypeValue,
    preferredZoneCode: ZoneCodeValue,
    itemsSelling: z.string().trim().min(1).max(2000),
    numStallsRequested: z.number().int().min(1).max(10),
    remarks: z.string().trim().max(2000).optional(),
    agreed: z.literal(true),
    declarationIds: DeclarationIds,
    depositAcknowledged: z.boolean().optional(),
    plugs5a: Count(50).optional(),
    plugs15a: Count(50).optional(),
    gasStoves: Count(10).optional(),
    appliances: z.array(ApplianceInput).max(20).optional(),
    tablesNeeded: Count(50).optional(),
    chairsNeeded: Count(200).optional(),
    passes2w: Count(50).optional(),
    passes4w: Count(50).optional(),
    passesStaff: Count(200).optional(),
    ashram: AshramBlock.optional(),
    customFields: z.record(z.string(), z.string().max(2000)).default({}),
  })
  .superRefine((v, ctx) => {
    if (v.requestType === 'LOCAL_WELFARE' && v.depositAcknowledged !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['depositAcknowledged'],
        message: 'the refundable caution deposit must be acknowledged',
      });
    }
    if (v.requestType === 'ASHRAM' && !v.ashram) {
      ctx.addIssue({
        code: 'custom',
        path: ['ashram'],
        message: 'department details are required for an ashram request',
      });
    }
  });
export type SubmitRequestInput = z.infer<typeof SubmitRequestInput>;

// ── Public: responses ───────────────────────────────────────────────────────

export interface PublicZone {
  code: string;
  name: string;
  /** The seating description the printed form carried for this bay, where
   *  there is one. A bay added since falls back to `name`. */
  blurb: string | null;
  isClosedToVendors: boolean;
  /** Paise, or null where this bay carries no rate at the scope the form is
   *  being filled at. A local welfare form asking after A3 gets a figure; a
   *  vendor form asking after the same bay gets null, because it is closed to
   *  trade — one bay, two answers, which is why the rent is resolved against
   *  the form's own scope rather than being a property of the zone. */
  rentFoodPaise: number | null;
  rentNonFoodPaise: number | null;
  /** The refundable advance for this bay, at the same scope. */
  depositPaise: number | null;
}

export interface PublicCustomField {
  id: string;
  formType: string;
  label: string;
  labelTa: string | null;
  fieldType: string;
  isRequired: boolean;
  sortOrder: number;
}

export interface PublicConfig {
  edition: { year: number; name: string };
  /** Priced at the scope of the form being rendered — see `PublicZone`. */
  zones: PublicZone[];
  charges: {
    gstPercent: number;
  };
  /** The cap on how many stalls one request may ask for in a single bay.
   *  Wanting ground in a second bay is a second request, so the team can accept
   *  one and decline the other. */
  maxStallsPerRequest: number;
  customFields: PublicCustomField[];
  /** The four request forms, as the edition defines them.
   *
   *  ⚠️ Empty on an edition seeded before forms became data, and the page then
   *  falls back to `FORM_DEFINITIONS` — a form that renders nothing is worse
   *  than one rendering last year's constant. `seedFormDefinitions` fills the
   *  rows in on the next boot, so the fallback is a window, not a mode. */
  forms: BuiltForm[];
  /** Every LIVE declaration on the edition, for every form.
   *
   *  ⚠️ Not pre-filtered to the form being rendered. The page picks its own
   *  with `declarationsFor`, and the API validates a submission with the same
   *  function — filtering here would put the variant-beats-default rule in two
   *  places, and the one that matters legally is the one that decides what was
   *  agreed to. */
  declarations: Declaration[];
}

export interface SubmitRequestResponse {
  reference: string;
  statusToken: string;
}

export interface PublicRequestStatus {
  reference: string;
  requestType: string;
  stallName: string;
  status: RequestStatus;
  submittedAt: string;
  /** The bay, once the team has settled it. This one IS told early: the rent
   *  depends on it, so a vendor cannot be asked to pay without knowing it. */
  allocatedZone: string | null;
  /** 🔴 The stall NUMBER within that bay, and empty until the stall has
   *  actually checked in.
   *
   *  Telling a vendor their number in advance is what the team asked not to
   *  happen, and the reason is operational rather than squeamish: "some of them
   *  come in advance, they look at where the stall is, they'll come and fight
   *  with you — I don't want this location". The number is handed over at the
   *  counter with the wristbands, which is also the moment somebody is standing
   *  there to have that conversation. */
  allocatedStalls: string[];
  /** What is still outstanding on a SELECTED request, from the same
   *  `pendingSteps` the Onboarding table and the check-in counter read. Empty
   *  for a request that has not been selected: a vendor waiting on a decision
   *  has nothing to do, and a list of future chores would read as one. */
  pending: PendingStep[];
  /** What is owed and where to send it — the `PAYMENT_DETAILS` letter, as data.
   *
   *  🔴 Present as soon as the request is SELECTED and its zone has a rate —
   *  NOT only once the payment letter has frozen a plan. The letter is one way
   *  to learn this figure; it is no longer the only one.
   *
   *  Null for a request that was never selected, null for an EXEMPT stall (an
   *  ashram department is billed internally), and null where the zone is
   *  UNPRICED. Zero is not the answer to the last two: on a vendor's own page a
   *  zero reads as "free".
   *
   *  ⚠️ ONE fee, and it is what is OWED — `payableFeePaise`, so a concession is
   *  what the requester is asked for. The quoted rate is not here beside it.
   *  The gap between the two is the concession and that is the team's to see;
   *  showing a trader the figure they were talked down from serves nobody. */
  payment: PublicPaymentDue | null;
  /** What this requester has told us they transferred, newest first.
   *
   *  🔴 Includes REJECTED claims with their reason. That reason is the only
   *  thing that tells them what to correct, and a rejection they never see
   *  returns them to the mailbox this step replaced. */
  paymentClaims: PaymentClaimView[];
  /** The staff coupon and how far the vendor's own team has got.
   *
   *  ⚠️ An EMPTY `coupons` means none has been ISSUED, which is not the same as
   *  having none to issue — the requester can ask for one, and that is the
   *  difference it carries. `pendingSteps` stays silent until a
   *  coupon exists (nobody can register against one that does not), so this
   *  block is how the portal offers a step the pending list cannot yet name.
   *
   *  Null for a request that was never selected. */
  staff: PublicStaffCoupon | null;
}

export interface PublicPaymentDue {
  /** Fee including GST, after any concession. See the warning above. */
  feePaise: number;
  /** ⚠️ Never discounted. The deposit comes back in full, so a concession on it
   *  would mean refunding money that was never taken. */
  depositPaise: number;
  totalPaise: number;
  /** Null when the edition has no virtual-account prefix configured, or the
   *  contact number is not a mobile `virtualAccountFor` will build one from.
   *  The page then says where to ask rather than naming an account it guessed. */
  virtualAccountRent: string | null;
  virtualAccountDeposit: string | null;
}

export interface PublicStaffCoupon {
  /** 🔴 Every live coupon the stall holds, oldest first. Empty when none has
   *  been issued, which is not a dead end — the requester can ask for one. */
  coupons: CouponSummary[];
  /** Everyone on the stall's roster, however many codes they came in on. This
   *  is the number the check-in counter reads. */
  registered: number;
  /** Every coupon's capacity added up. A CEILING, never a quota: a vendor who
   *  needs three people registers three and is done. */
  capacity: number;
}

export interface PublicStatusResponse {
  displayName: string;
  requests: PublicRequestStatus[];
}

// ── Public: return access ───────────────────────────────────────────────────

/** "I applied but I cannot find the email." Email or mobile — whichever the
 *  vendor remembers using. See `access.ts` for why this is the whole of
 *  "login" in this module. */
export const RequestAccessLinkInput = z.object({
  contact: z.string().trim().min(1).max(254),
});
export type RequestAccessLinkInput = z.infer<typeof RequestAccessLinkInput>;

/** Always the same body, whether or not an account was found. A response that
 *  differed would turn this route into a way of asking "did this person apply",
 *  which is exactly what the signed-link design refuses to answer. */
export interface RequestAccessLinkResponse {
  ok: true;
}

export const SelfServeStepValue = z.enum(SELF_SERVE_STEPS);
export type SelfServeStepValue = z.infer<typeof SelfServeStepValue>;

/** Opens one outstanding step from the vendor's own portal.
 *
 *  ⚠️ `reference` is not an id and is not a credential — the status link is.
 *  The lookup is scoped to the account that link belongs to, so a reference
 *  belonging to anyone else reads as "not valid", exactly as an unknown one
 *  does. That keeps the rule the rest of this surface follows: holding one
 *  link can never reach another vendor's record. */
export const ContinueStepInput = z.object({
  reference: z.string().trim().min(3).max(40),
  step: SelfServeStepValue,
});
export type ContinueStepInput = z.infer<typeof ContinueStepInput>;

export interface ContinueStepResponse {
  /** A freshly minted single-purpose link. Short-lived, like the one the
   *  selection email carried. */
  url: string;
}

/** Asks for the staff coupon on one of the caller's own requests.
 *
 *  ⚠️ Same rule as `ContinueStepInput`: the CREDENTIAL is the status link or
 *  the session, and `reference` only picks which of that account's requests is
 *  meant. A reference belonging to anyone else reads as "not valid", exactly as
 *  an unknown one does.
 *
 *  Issuing is idempotent — `ensureCoupon` returns the existing code — so this
 *  is safe to press twice, and a vendor who lost the letter gets the SAME
 *  coupon their staff may already be registering against. */
export const RequestCouponInput = z.object({
  reference: z.string().trim().min(3).max(40),
});
export type RequestCouponInput = z.infer<typeof RequestCouponInput>;

export interface RequestCouponResponse {
  code: string;
}

// ── Backoffice: requests ─────────────────────────────────────────────────────────

export const ListRequestsQuery = z.object({
  requestType: RequestType.optional(),
  status: RequestStatus.optional(),
  stage: RequestStage.optional(),
  zoneCode: ZoneCodeValue.optional(),
  flagged: z.coerce.boolean().optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRequestsQuery = z.infer<typeof ListRequestsQuery>;

export interface RequestSummary {
  id: string;
  reference: string;
  requestType: string;
  stallType: string;
  stallName: string;
  requesterName: string;
  email: string;
  contactNumber: string;
  preferredZoneCode: string;
  /** The bay the team and the requester settled on, which is not always the one
   *  that was asked for: "we may have to talk to them saying that side is
   *  already filled up, why don't you look at this side — and if they accept,
   *  we allocate the stall to them there".
   *
   *  ⚠️ This, not `preferredZoneCode`, is what the stall is PRICED at once it is
   *  set, and it is settled before the payment letter goes out while the stall
   *  number is still open. Null until the team has had that conversation. */
  agreedZoneCode: string | null;
  numStallsRequested: number;
  status: RequestStatus;
  stage: RequestStage;
  submittedAt: string;
  flagged: boolean;
  allocatedStalls: string[];
}

export interface RequestAllocation {
  id: string;
  stallNumber: string;
  zoneCode: string;
  category: string;
  allocatedAt: string;
}

export interface RequestDetail extends RequestSummary {
  address: string | null;
  itemsSelling: string;
  remarks: string | null;
  plugs5a: number;
  plugs15a: number;
  gasStoves: number;
  tablesNeeded: number;
  chairsNeeded: number;
  passes2w: number;
  passes4w: number;
  passesStaff: number;
  agreedAt: string;
  depositAcknowledgedAt: string | null;
  flagReason: string | null;
  rejectReason: string | null;
  ashram: {
    departmentHead: string;
    departmentHeadContact: string;
    department: string;
    requestedBy: string;
    requesterContact: string;
    creditCardNeeded: boolean;
    usage: string;
    usageOther: string | null;
    wantsThembu: boolean;
    fssaiExpected: boolean | null;
  } | null;
  appliances: Array<{ name: string; watts: number }>;
  customValues: Array<{ fieldId: string; label: string; value: string }>;
  allocations: RequestAllocation[];
}

export interface RequestPage {
  items: RequestSummary[];
  nextCursor: string | null;
}

export interface DashboardCounts {
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  flagged: number;
  stallsPlanned: number;
  stallsAllocated: number;
}

export const FlagRequestInput = z.object({ reason: z.string().trim().min(1).max(500) });
export const RejectRequestInput = z.object({ reason: z.string().trim().min(1).max(500) });

/** Backoffice correcting a request after it was filed.
 *
 *  🔴 Almost everything about a request gets renegotiated by phone — "in case
 *  there are any other changes, we anyway speak to them and make that change" —
 *  and until there was a way to write those changes down, the only record of
 *  them was the caller's memory. A wrong mobile number could not be fixed, a
 *  bay moved by agreement could not be recorded, and a vendor who asked for two
 *  more chairs on the phone was quoted for the number on the form.
 *
 *  ⚠️ Every field here is one the requester could themselves have typed. Status,
 *  stage, stall numbers, money and the agreement timestamps are deliberately
 *  ABSENT: those are decisions the system makes through their own routes, each
 *  with its own guard and its own trail entry, and a general-purpose patch that
 *  could reach them would be a way around every one of those guards. */
export const PatchRequestInput = z
  .object({
    stallName: z.string().trim().min(1).max(200),
    requesterName: z.string().trim().min(1).max(200),
    email: z.email().max(320),
    contactNumber: IndianMobile,
    address: z.string().trim().max(1000).nullable(),
    stallType: StallTypeValue,
    preferredZoneCode: ZoneCodeValue,
    /** Set when the bay is agreed; cleared back to null if that falls through. */
    agreedZoneCode: ZoneCodeValue.nullable(),
    itemsSelling: z.string().trim().min(1).max(2000),
    numStallsRequested: z.number().int().min(1).max(20),
    remarks: z.string().trim().max(2000).nullable(),
    plugs5a: Count(50),
    plugs15a: Count(50),
    gasStoves: Count(10),
    appliances: z.array(ApplianceInput).max(20),
    tablesNeeded: Count(50),
    chairsNeeded: Count(200),
    passes2w: Count(50),
    passes4w: Count(50),
    passesStaff: Count(200),
  })
  .partial();
export type PatchRequestInput = z.infer<typeof PatchRequestInput>;

// ── Backoffice: selection ────────────────────────────────────────────────────────

export const SelectRequestInput = z.object({
  /** ⚠️ MAY BE EMPTY, and routinely is.
   *
   *  The team's sequence is: agree the bay, send the payment letter, allocate a
   *  number later — "the side will be decided, but the stall number may not be
   *  still put at the time of the payment". Requiring a number here would force
   *  the two decisions into one moment and pin a vendor to a pitch nobody has
   *  walked yet. `agreedZoneCode` carries the half that has been decided. */
  stallNumbers: z
    .array(z.string().regex(/^[A-Z]{1,2}\d{0,2}-[1-9]\d*$/, 'expected a stall number like A4-17'))
    .max(10)
    .default([]),
  /** The bay being agreed, when it is being agreed at the same time. */
  agreedZoneCode: ZoneCodeValue.optional(),
});
export type SelectRequestInput = z.infer<typeof SelectRequestInput>;

export interface AvailableStall {
  id: string;
  number: string;
  zoneCode: string;
  category: string;
  status: string;
}

// ── Backoffice: planning ─────────────────────────────────────────────────────────

/** Keyed by category key rather than by a fixed set of columns: which columns
 *  the grid carries is the edition's own configuration. A key the edition does
 *  not define is rejected by the route, which knows what they are. */
const CountsShape = z.record(CategoryValue, z.number().int().min(0).max(500));

export const ZonePlanInput = z.object({
  crowdPerStall: z.number().int().min(1).max(100_000).optional(),
  rows: z.array(
    z.object({
      zoneCode: ZoneCodeValue,
      expectedCrowd: z.number().int().min(0).max(10_000_000).optional(),
      counts: CountsShape,
    }),
  ),
});
export type ZonePlanInput = z.infer<typeof ZonePlanInput>;

export interface ZonePlanRowView {
  zoneCode: string;
  zoneName: string;
  isClosedToVendors: boolean;
  expectedCrowd: number;
  suggested: number;
  counts: Record<string, number>;
  total: number;
  stallsExisting: number;
  stallsAllocated: number;
}

export interface ZonePlanView {
  crowdPerStall: number;
  /** The grid's columns, in the order they are drawn. Sent with the data
   *  because they are the edition's own configuration — a screen that assumed a
   *  fixed set would drop a column an admin added. */
  categories: Array<{ key: string; name: string; isFood: boolean }>;
  rows: ZonePlanRowView[];
  totals: { byCategory: Record<string, number>; grandTotal: number };
}

export interface ApplyPlanResult {
  created: string[];
  removed: string[];
  /** Stalls the plan wanted gone but that hold a live allocation. Never removed. */
  kept: string[];
}

// ── Backoffice: admin ────────────────────────────────────────────────────────────

const Paise = z.number().int().min(0).max(1_000_000_000);

const VirtualAccountPrefix = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => VIRTUAL_ACCOUNT_PREFIX_PATTERN.test(v), 'expected 2–12 letters or digits')
  .nullable();

export const CreateEditionInput = z.object({
  year: z.number().int().min(2020).max(2100),
  name: z.string().trim().min(1).max(100),
  activate: z.boolean().default(true),
});

/** The edition's settings that are neither a rate nor a zone.
 *
 *  The two virtual-account prefixes are here because Finance issues them per
 *  edition and they are the only link between a bank credit and a request — see
 *  `virtual-account.ts`. */
export const EditionSettingsInput = z.object({
  name: z.string().trim().min(1).max(100),
  virtualAccountRentPrefix: VirtualAccountPrefix,
  virtualAccountDepositPrefix: VirtualAccountPrefix,
  maxStallsPerRequest: z.number().int().min(1).max(20),
  /** Where this edition's terms and conditions can be read, linked beside the
   *  tick-box on the bank form that records having accepted them.
   *
   *  ⚠️ `http(s)` only, and an empty string clears it. A `javascript:` or
   *  `data:` href would be rendered on a public page reached by a signed link,
   *  which is the one page in this module a stranger can be sent to. */
  termsUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((s) => s === '' || /^https?:\/\//i.test(s), 'expected an http:// or https:// link')
    .nullable()
    .default(null),
});
export type EditionSettingsInput = z.infer<typeof EditionSettingsInput>;

export interface EditionSettingsView {
  year: number;
  name: string;
  virtualAccountRentPrefix: string | null;
  virtualAccountDepositPrefix: string | null;
  maxStallsPerRequest: number;
  termsUrl: string | null;
}

/* ── Copying a section from another edition ──────────────────────────────── */

/** The seven things the Admin screen owns, and the only things a copy moves.
 *
 *  🔴 Configuration only. Requests, allocations, accounts, payments, consents
 *  and stalls are an edition's RECORD, and a record that could be copied into
 *  another year is not a record. */
export const COPY_SECTIONS = [
  'zones',
  'planCategories',
  'rates',
  'charges',
  'fineTypes',
  'forms',
  'declarations',
] as const;
export type CopySection = (typeof COPY_SECTIONS)[number];
export const CopySectionValue = z.enum(COPY_SECTIONS);

/** What the section is called on screen. Here rather than in the panel so the
 *  preview, the confirm button and the activity trail all say the same word. */
export const COPY_SECTION_LABELS: Record<CopySection, string> = {
  zones: 'Bays',
  planCategories: 'Planning Columns',
  rates: 'Rates',
  charges: 'Charges',
  fineTypes: 'Fines',
  forms: 'Forms',
  declarations: 'Declarations',
};

export const CopyEditionInput = z.object({
  /** Where the values come from. The target is always the ACTIVE edition and is
   *  never sent — see the route, which resolves it through `activeEditionFor`. */
  fromEditionId: z.uuid(),
  section: CopySectionValue,
});
export type CopyEditionInput = z.infer<typeof CopyEditionInput>;

/** One field that would change.
 *
 *  ⚠️ `before` and `after` are already RENDERED — rupees, not paise; `Yes`, not
 *  `true`. The preview and the row that gets written come from one plan, and a
 *  dialog that reformatted the plan's values could show a figure the write does
 *  not make. */
export interface CopyChange {
  field: string;
  before: string | null;
  after: string;
}

export interface CopyRow {
  /** The natural key, which is also what a second copy matches on. */
  key: string;
  /** What the dialog calls the row: `D1 · Adiyogi`, `Vendor form · Stall name`. */
  label: string;
  changes: CopyChange[];
}

/** Something the source has that this edition cannot take, and why. A rate for
 *  a bay this edition does not have is the case that exists today. */
export interface CopySkip {
  key: string;
  label: string;
  reason: string;
}

/** The whole answer to "what would copying do?", and the whole instruction for
 *  doing it. Preview returns it; apply recomputes it and writes it. */
export interface CopyPlan {
  section: CopySection;
  fromEditionId: string;
  fromEditionName: string;
  intoEditionName: string;
  create: CopyRow[];
  overwrite: CopyRow[];
  skip: CopySkip[];
  unchanged: number;
}

export interface CopyResult {
  created: number;
  overwritten: number;
  skipped: number;
}

export const ZoneInput = z.object({
  name: z.string().trim().min(1).max(100),
  expectedCrowd: z.number().int().min(0).max(10_000_000),
  isClosedToVendors: z.boolean(),
});

/** Adding a bay. The venue is redrawn every year, so this is ordinary
 *  configuration rather than a migration. */
export const CreateZoneInput = z.object({
  code: ZoneCodeValue,
  name: z.string().trim().min(1).max(100),
  expectedCrowd: z.number().int().min(0).max(10_000_000).default(0),
  isClosedToVendors: z.boolean().default(false),
});
export type CreateZoneInput = z.infer<typeof CreateZoneInput>;

export interface ZoneView {
  code: string;
  name: string;
  expectedCrowd: number;
  isClosedToVendors: boolean;
  sortOrder: number;
  /** Stalls standing in it. A bay holding stalls cannot be deleted, and the
   *  screen needs to say why before the button is pressed. */
  stallCount: number;
}

/** One row per bay × food/non-food × scope. Rent and its advance travel
 *  together so a bay cannot be repriced without its deposit being looked at. */
export const RateCardInput = z.object({
  entries: z
    .array(
      z.object({
        zoneCode: ZoneCodeValue,
        isFood: z.boolean(),
        scope: RateScopeValue,
        amountPaise: Paise,
        depositPaise: Paise,
      }),
    )
    .max(200),
});

export const ChargesInput = z.object({
  chairRatePaise: Paise,
  tableRatePaise: Paise,
  lwChairRatePaise: Paise,
  lwTableRatePaise: Paise,
  plug5aRatePaise: Paise,
  plug15aRatePaise: Paise,
  gstPercent: z.number().int().min(0).max(100),
  crowdPerStall: z.number().int().min(1).max(100_000),
  vendorChairRatePaise: Paise,
  vendorTableRatePaise: Paise,
  /** Flat, charged once when any furniture is taken — the 2025 sheet carries
   *  one figure per vendor, not a per-chair amount. */
  chairTableDepositPaise: Paise,
  /** How many days the chairs and tables are held. The forms quote per-day
   *  rates; this is what they are multiplied by. */
  equipmentDays: z.number().int().min(1).max(30),
  chairReplacementPaise: Paise,
  tableReplacementPaise: Paise,
  damagePenaltyPaise: Paise,
});
export type ChargesInput = z.infer<typeof ChargesInput>;

/** The planning grid's columns, as data. */
export const PlanCategoryInput = z.object({
  categories: z
    .array(
      z.object({
        key: CategoryValue,
        name: z.string().trim().min(1).max(60),
        isFood: z.boolean(),
        sortOrder: z.number().int().min(0).max(200),
      }),
    )
    .max(40),
});
export type PlanCategoryInput = z.infer<typeof PlanCategoryInput>;

export interface PlanCategoryView {
  key: string;
  name: string;
  isFood: boolean;
  sortOrder: number;
  /** Planned or allocated against it. A column in use cannot be deleted. */
  inUse: boolean;
}

export const FlowInput = z.object({
  bankStepEnabled: z.boolean(),
  paymentStepEnabled: z.boolean(),
  fssaiStepEnabled: z.boolean(),
});

export const FineTypeInput = z.object({
  reason: z.string().trim().min(1).max(200),
  defaultAmountPaise: Paise,
  isActive: z.boolean().default(true),
});

/* ── The form builder ──────────────────────────────────────────────────────*/

export const FieldOptionInput = z.object({
  value: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(200),
  labelTa: z.string().trim().max(200).nullable().default(null),
});

/** ⚠️ No `name` and no `isBuiltIn`. Both are the API's to decide: an appended
 *  field is never built in, and it has no name because its answer is keyed by
 *  id. A body that could set either would be a body that could claim a column. */
/** A media-store key as it crosses the wire.
 *
 *  ⚠️ The SHAPE only. What makes a key acceptable is `isOurKey`, which checks
 *  the folder the purpose writes to — a key this passes is still refused if it
 *  was not minted for a display block. */
export const MediaKeyValue = z.string().trim().min(1).max(400);

/**
 * The days a `date` question accepts, on the wire.
 *
 * ⚠️ A discriminated union, so a body cannot send `minDate` beside `minDays`
 * and leave the API to guess which one it meant. There is no `edition` mode —
 * `StallEdition` has no dates to follow; see the note in `field-rules.ts`.
 */
export const DateWindowInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('fixed'),
    min: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    max: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  z.object({
    mode: z.literal('rolling'),
    minDays: z.number().int().min(-3650).max(3650).optional(),
    maxDays: z.number().int().min(-3650).max(3650).optional(),
  }),
]);

/**
 * What a question accepts, as the builder sends it.
 *
 * 🔴 Shape only, exactly as everywhere else in this file. Whether a maximum
 * sits below its minimum, or a pattern is an expression that compiles, is
 * `checkRuleShape` in `@msr/stalls` — one function, read by the screen before
 * it saves and by the API before it writes. A Zod refinement here would be a
 * second opinion the two sides could drift apart on.
 */
const RuleFields = {
  /** Read three ways, decided by `fieldType`: the VALUE for a number, the DIGIT
   *  count for a telephone number, HOW MANY for a file list. */
  min: z.number().int().min(-1_000_000).max(1_000_000).nullable().default(null),
  max: z.number().int().min(-1_000_000).max(1_000_000).nullable().default(null),
  minLen: z.number().int().min(0).max(10_000).nullable().default(null),
  maxLen: z.number().int().min(1).max(10_000).nullable().default(null),
  decimals: z.number().int().min(0).max(6).nullable().default(null),
  pattern: z.string().trim().max(400).nullable().default(null),
  patternHint: z.string().trim().max(200).nullable().default(null),
  window: DateWindowInput.nullable().default(null),
};

export const AddFormFieldInput = z.object({
  label: z.string().trim().min(1).max(200),
  labelTa: z.string().trim().max(200).nullable().default(null),
  help: z.string().trim().max(600).nullable().default(null),
  /** ⚠️ Read from `AUTHORABLE_FIELD_TYPES` rather than spelled again. The list
   *  was retyped here and had already drifted: the picker offered `file` and
   *  `files`, and this enum refused them, so adding a file question failed at
   *  the API with a message about the shape of the body. */
  fieldType: z.enum(AUTHORABLE_FIELD_TYPES),
  isRequired: z.boolean().default(false),
  sectionId: z.uuid().nullable().default(null),
  options: z.array(FieldOptionInput).max(60).nullable().default(null),
  ...RuleFields,
  /** The picture a `display` block draws. Refused on every other type — see
   *  `canCarryMedia`. */
  mediaKey: MediaKeyValue.nullable().default(null),
});
export type AddFormFieldInput = z.infer<typeof AddFormFieldInput>;

/** ⚠️ `fieldType` is accepted and then checked against the field's VALUE SHAPE
 *  on a built-in, rather than left out of the shape. A built-in may be retyped
 *  to anything that posts the same thing its column holds — see
 *  `canRetypeBuiltInTo` — and leaving the key out would make a legal edit look
 *  like a field the client forgot to send. */
export const FormFieldPatch = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  labelTa: z.string().trim().max(200).nullable().optional(),
  help: z.string().trim().max(600).nullable().optional(),
  helpTa: z.string().trim().max(600).nullable().optional(),
  fieldType: z.string().optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sectionId: z.uuid().nullable().optional(),
  options: z.array(FieldOptionInput).max(60).nullable().optional(),
  min: RuleFields.min.unwrap().optional(),
  max: RuleFields.max.unwrap().optional(),
  minLen: RuleFields.minLen.unwrap().optional(),
  maxLen: RuleFields.maxLen.unwrap().optional(),
  decimals: RuleFields.decimals.unwrap().optional(),
  pattern: RuleFields.pattern.unwrap().optional(),
  patternHint: RuleFields.patternHint.unwrap().optional(),
  window: RuleFields.window.unwrap().optional(),
  /** `null` clears the picture and leaves the wording. */
  mediaKey: MediaKeyValue.nullable().optional(),
});
export type FormFieldPatch = z.infer<typeof FormFieldPatch>;

/** The order of a form, sent WHOLE. Dragging one field changes every position
 *  between where it was and where it went, and sending those one at a time
 *  leaves a reader loading mid-drag an order that is neither. */
export const ReorderFieldsInput = z.object({
  fields: z
    .array(z.object({ id: z.uuid(), sectionId: z.uuid().nullable().default(null) }))
    .max(200),
});
export type ReorderFieldsInput = z.infer<typeof ReorderFieldsInput>;

export const FormDefinitionPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  titleTa: z.string().trim().max(200).nullable().optional(),
});
export type FormDefinitionPatch = z.infer<typeof FormDefinitionPatch>;

export const AddSectionInput = z.object({
  heading: z.string().trim().min(1).max(200),
  headingTa: z.string().trim().max(200).nullable().default(null),
  help: z.string().trim().max(600).nullable().default(null),
});
export type AddSectionInput = z.infer<typeof AddSectionInput>;

export interface ListFormsResponse {
  forms: BuilderForm[];
}

/* ── Declarations ──────────────────────────────────────────────────────────*/

/** ⚠️ The key is validated against the same pattern `isDeclarationKey` uses,
 *  not a looser one. Two spellings of "what a key may be" is how a key gets in
 *  through the API that the screen would have refused. */
export const DeclarationKeyValue = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{2,63}$/, 'lower case letters, digits and underscores');

export const DeclarationInput = z.object({
  key: DeclarationKeyValue,
  /** `null` is the default, shown by any form with no variant of its own. */
  formType: FormType.nullable().default(null),
  title: z.string().trim().min(1).max(200),
  /** 🔴 Generous, and deliberately so: this is a legal paragraph somebody
   *  pastes in, not a label. It is stored as written — see
   *  `declarations.ts` for why the markers are parsed rather than the text
   *  being sanitised. */
  body: z.string().trim().min(1).max(8000),
  bodyTa: z.string().trim().max(8000).nullable().default(null),
  isActive: z.boolean().default(true),
});
export type DeclarationInput = z.infer<typeof DeclarationInput>;

/** ⚠️ No `key` and no `formType`. Both are the row's IDENTITY — the key is
 *  what consents are filed under and the variant is which form it belongs to —
 *  and changing either would silently move a consent somebody already gave to a
 *  different question. A wording that belongs to another form is a new row. */
export const DeclarationPatch = DeclarationInput.omit({ key: true, formType: true });
export type DeclarationPatch = z.infer<typeof DeclarationPatch>;

/** One version, as the backoffice screen lists it. */
export interface DeclarationRow {
  id: string;
  key: string;
  formType: string | null;
  version: number;
  title: string;
  body: string;
  bodyTa: string | null;
  isActive: boolean;
  isCurrent: boolean;
  createdAt: string;
  archivedAt: string | null;
}

export interface ListDeclarationsResponse {
  declarations: DeclarationRow[];
}

/** What one requester agreed to, with the wording as it stood when they did. */
export interface ConsentRecord {
  key: string;
  version: number;
  title: string;
  body: string;
  bodyTa: string | null;
  agreedAt: string;
}

/** Somebody an admin is putting into the directory themselves.
 *
 *  🔴 **The one thing this module writes into the Foundation's `Person`**, and
 *  the answer to a search that found nobody. Before it, adding a backoffice
 *  member meant asking somebody else to create the human first and coming back
 *  — so a desk that needed a new coordinator on Tuesday waited on a directory
 *  they could not reach.
 *
 *  ⚠️ The address is the CLAIM KEY, not a contact detail. The row is created
 *  with `staged` set, and their first sign-in finds it by email and takes it
 *  over — roles and all. A well-formed but wrong address therefore stages a
 *  role for whoever really owns it, which is why the dialog makes staging the
 *  answer to a search rather than the first thing it offers. */
export const StagedPersonInput = z.object({
  displayName: z.string().trim().min(1).max(200),
  /** Trimmed before it is judged, as `UpdateAccountInput` explains. */
  email: z.string().trim().pipe(z.email().max(320)),
  /** Optional in the same breath as `Person.phone`: the directory holds no
   *  number for most people, and refusing to stage somebody over one would put
   *  an admin back where this field was added to get them out of. */
  phone: z.union([IndianMobile, z.literal('')]).default(''),
});
export type StagedPersonInput = z.infer<typeof StagedPersonInput>;

/** A role handed to somebody — either a person already in the directory, or one
 *  this call is putting there.
 *
 *  ⚠️ **One arm or the other, never both and never neither.** Staging and
 *  granting are one request precisely so they are one transaction: a staged
 *  person whose grant was then refused would be a human in the directory with
 *  nothing to do there and nobody to explain them. */
export const GrantRoleInput = z
  .object({
    personRef: z.uuid().optional(),
    newPerson: StagedPersonInput.optional(),
    roleKey: z.string().min(1).max(64),
    /** Which editions this grant reaches. Empty — and absent — is every one,
     *  including editions created after the grant was made. */
    editionScope: z.array(z.uuid()).max(50).default([]),
    /** Which bays this grant reaches, by zone code. Empty is every bay. */
    zoneScope: z.array(ZoneCodeValue).max(100).default([]),
  })
  .refine((b) => Boolean(b.personRef) !== Boolean(b.newPerson), {
    error: 'name the person by id, or give the details to add them — not both',
    path: ['personRef'],
  });
export type GrantRoleInput = z.infer<typeof GrantRoleInput>;

/** A backoffice member's own details, corrected.
 *
 *  ⚠️ **This writes the Foundation's directory**, which every other read in
 *  this module treats as another team's table. It is here because the module
 *  can now put somebody INTO that directory: having staged a person from a
 *  typed address, refusing to let the same desk fix a typo in it would strand
 *  the row — nobody could ever claim it, and nothing else in the product would
 *  offer to mend it.
 *
 *  ⚠️ For somebody who really signs in through the Foundation, name and address
 *  are the identity provider's and come back on their next sign-in. The dialog
 *  says so; this schema cannot. */
export const UpdatePersonInput = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.string().trim().pipe(z.email().max(320)),
  phone: z.union([IndianMobile, z.literal('')]),
});
export type UpdatePersonInput = z.infer<typeof UpdatePersonInput>;

/** One row of the directory search behind the Add user dialog. */
export interface PersonMatch {
  personId: string;
  email: string;
  displayName: string;
  phone: string | null;
  /** Added here by an admin and not yet claimed by a sign-in. Marked rather
   *  than hidden: a staged person is precisely the one being onboarded, and
   *  granting a role to somebody who may never arrive is worth seeing. */
  staged: boolean;
}

/** A requester's own details, corrected by a desk.
 *
 *  ⚠️ `phone` accepts the empty string because the column already holds it:
 *  an account registered on an email alone never had a number, and an edit
 *  screen that refused to save one of those would be unable to fix the name on
 *  half the directory. `IndianMobile` normalises everything else to bare ten
 *  digits, which is what every other intake stores and what the directory
 *  search matches against.
 *
 *  ⚠️ Nothing here touches a backoffice row, whose details live in the
 *  Foundation directory and travel as `UpdatePersonInput`. Two schemas because
 *  they are two tables, not because they ask for different things. */
export const UpdateAccountInput = z.object({
  displayName: z.string().trim().min(1).max(200),
  /** Trimmed before it is judged: an address pasted out of a mail client
   *  arrives with whitespace around it, and rejecting that would send a desk
   *  hunting for a typo that is not there. `normalizeEmail` lowercases it. */
  email: z.string().trim().pipe(z.email().max(320)),
  phone: z.union([IndianMobile, z.literal('')]),
});
export type UpdateAccountInput = z.infer<typeof UpdateAccountInput>;

export interface BackofficeMember {
  personId: string;
  email: string;
  displayName: string;
  roleKeys: string[];
}

// ── Backoffice: the users directory ──────────────────────────────────────────────

/** Which population a directory row came from.
 *
 *  Backoffice hold this module's roles and live in the Foundation's `Person`;
 *  requesters are `StallAccount`s a public form created. The two stay in
 *  separate tables for the reason `ROLES` gives — that separation is what stops
 *  a vendor ever being granted `config:write` — and are brought together only
 *  here, for one screen, and only as a read. */
export type DirectoryKind = 'BACKOFFICE' | 'REQUESTER';

/**
 * Whether this person can get in, and if not, why.
 *
 * ⚠️ `LINK_ONLY` IS NOT A FAULT. A requester who applied and never set a
 * password is the ordinary case — the emailed status link is the whole of
 * their login, and most vendors never register at all. It must never be
 * counted under "Cannot sign in", or that tile reads as an outage every year.
 *
 * ⚠️ `INVITED` IS NOT A FAULT EITHER, and it is the backoffice half of the same
 * point. An admin added this person to the directory and nobody has signed in
 * as them yet — the ordinary state of somebody onboarded this morning. It must
 * never be counted under "Cannot sign in": they can, they simply have not.
 *
 * ⚠️ TEMPORARY, in the same breath as `credentials.ts`: every state but `OK`,
 * `INVITED` and `DISABLED` describes the requester password login that the
 * host's Isha OIDC replaces. When that goes, this narrows to the three that are
 * about a Foundation account, and the tiles that read the rest go with them.
 */
export type SignInState = 'OK' | 'INVITED' | 'LINK_ONLY' | 'LOCKED' | 'DISABLED';

/** One role somebody holds, and how far it reaches.
 *
 *  ⚠️ An empty list on either axis means EVERYTHING — every edition, every bay —
 *  which is the opposite of how a filter reads. The screens that show these say
 *  so in words rather than leaving a blank row to be guessed at. */
export interface DirectoryGrant {
  roleKey: string;
  /** Edition ids. Empty is every edition, including ones created later. */
  editionScope: string[];
  /** Zone CODES, not ids — a bay marshal who runs A1 runs A1 every edition. */
  zoneScope: string[];
}

export interface DirectoryUser {
  /** `personId` for backoffice, the account id for requesters. Both are UUIDs from
   *  different tables, so `kind` — not the id — is what an action keys on. */
  id: string;
  kind: DirectoryKind;
  displayName: string;
  email: string;
  /** Null where nobody has given one. It used to be null for EVERY backoffice
   *  row, because the directory stub had no column to hold a number — it has
   *  one now, and the Phone column means the same thing for both populations. */
  phone: string | null;
  /**
   * The roles this person holds, each with what it reaches. Empty for a
   * requester, who holds no role by construction.
   *
   * ⚠️ The whole grant rather than the key alone. The dialog that edits
   * somebody's roles sends the whole grant back, because a re-grant RESETS
   * scope — so without the scope on the row, adding one role would silently
   * widen every role the person already held to every edition and every bay.
   */
  grants: DirectoryGrant[];
  /** Requesters only — their requests in the ACTIVE edition, which is the
   *  edition every other backoffice screen is showing at the same moment. */
  requestCount: number | null;
  signInState: SignInState;
  /** Set only when `signInState` is `LOCKED`, so the row can say until when. */
  lockedUntil: string | null;
}

/**
 * The tiles, which are also the views.
 *
 * ⚠️ These strings are the filter values the tile sends back — `StatTiles`
 * passes the raw label to `onPick` precisely so the two cannot drift. Renaming
 * one here renames the view on the wire.
 */
export const DIRECTORY_VIEWS = [
  'All',
  'Backoffice',
  'Requesters',
  'Cannot sign in',
  'Locked out',
] as const;
export const DirectoryView = z.enum(DIRECTORY_VIEWS);
export type DirectoryView = z.infer<typeof DirectoryView>;

/** The finer sign-in states, for the Filter popover. The tiles flatten
 *  `LINK_ONLY` and `DISABLED` into one coarse reading; this is how a caller
 *  asks for one of them on its own. */
export const SignInStateValue = z.enum(['OK', 'INVITED', 'LINK_ONLY', 'LOCKED', 'DISABLED']);

export const ListUsersQuery = z.object({
  view: DirectoryView.default('All'),
  q: z.string().trim().max(200).optional(),
  /** Backoffice only, and it narrows to backoffice on its own — a requester holds no
   *  role, so asking for one and for requesters is an empty question. */
  roleKey: z.string().max(64).optional(),
  signInState: SignInStateValue.optional(),
  /** Zero-based, as every list endpoint in the module counts pages. */
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuery>;

export interface ListUsersResponse {
  users: DirectoryUser[];
  /**
   * The tiles above the table.
   *
   * ⚠️ Narrowed by the search and the Filter popover, NEVER by the active
   * view. A tile row that reacted to its own selection would zero the
   * Requesters tile the moment you picked Backoffice — the numbers would then
   * describe the slice you are already looking at rather than the ones you
   * might move to, which is the opposite of what a view switcher is for.
   */
  counts: { label: DirectoryView; count: number }[];
  /** Rows matching the view, the search and the filters — what the pager counts. */
  total: number;
  page: number;
  pageSize: number;
}

export interface MeResponse {
  personId: string;
  displayName: string;
  roleKeys: string[];
  /** The union of every privilege the caller's roles grant, resolved from the
   *  tables. The web gates on these and never on `roleKeys` — once a role is
   *  authored rather than shipped, a client-side role→screen map is not merely
   *  stale, it is unknowable, because the client cannot learn a new role's
   *  privileges (msr ADR 0065). */
  privileges: string[];
}

/**
 * One privilege, as the catalogue lists it.
 *
 * ⚠️ Read-only, and served from the TABLE rather than read off
 * `PRIVILEGE_CATEGORIES` in the bundle. The difference is `isActive`: a
 * privilege is retired by clearing that flag — never by deleting a row roles
 * still bundle — and the compiled-in list cannot know it happened.
 *
 * ⚠️ There is no write. The vocabulary is code: a privilege means nothing
 * unless a route enforces it, so one invented from a screen would be a code
 * that grants nothing. What is authored is the COMPOSITION — see `RoleDetail`.
 */
export interface PrivilegeCatalogEntry {
  code: string;
  label: string;
  category: string;
  /** view / action / config / sensitive / export. Presentation only — nothing
   *  branches on it at runtime. */
  kind: string;
  description: string;
  isActive: boolean;
}

export interface ListPrivilegesResponse {
  privileges: PrivilegeCatalogEntry[];
}

/** A role as the Users screen lists it.
 *
 *  ⚠️ Served rather than imported. The screen used to render its picker from
 *  the `ROLES` constant, which stopped being the truth the moment roles became
 *  data: a role an admin creates is on no list the bundle ships. */
export interface RoleSummary {
  roleKey: string;
  name: string;
  description: string;
  parentKey: string | null;
  /**
   * The rank an admin typed, 0 being the top.
   *
   * ⚠️ STORED, not derived from the parent chain — the reference module does
   * the same. It is a LABEL: assignability comes from `parentKey` and nothing
   * else, so a level that disagrees with the tree reads oddly and changes
   * nobody's reach.
   */
  level: number;
  isSystem: boolean;
  /** Whether the CALLER may hand this role out. The picker offers only these,
   *  so it cannot present a choice the server is about to refuse. */
  assignable: boolean;
  /** How many privileges it bundles.
   *
   *  ⚠️ For a role carrying `allPrivileges` this is the count of ACTIVE
   *  privileges, not the count of its join rows — which is zero, because the
   *  flag resolves against the live table instead. Counting rows would draw
   *  "0 privileges" on the most powerful card in the grid. */
  privilegeCount: number;
  /** How many people hold it. A role with holders cannot be deleted, and the
   *  card says so before the button is pressed rather than after. */
  grantCount: number;
  /** Carries every ACTIVE privilege, including ones added in a later release. */
  allPrivileges: boolean;
  /** Which requester types it reaches. Empty is EVERY type — see
   *  `unionRequestTypeScope`, which unions across the roles a person holds so a
   *  narrow role can never take access away from a broad one. */
  requestTypeScope: string[];
}

export interface ListRolesResponse {
  roles: RoleSummary[];
}

/** One role, opened for editing. */
export interface RoleDetail extends RoleSummary {
  /** The privilege codes it bundles. Empty when `allPrivileges` is set — the
   *  flag resolves against the live table instead, so there is nothing to list. */
  privileges: string[];
  /** May hand out its own role as well as the ones under it. Never a sibling. */
  canAssignSameLevel: boolean;
}

/** A role key is typed once and then referred to forever — by grants, and by
 *  the host's participation rows after migration — so it is restricted to the
 *  shape those can carry and never re-keyed afterwards. */
export const RoleKey = z
  .string()
  .trim()
  .min(3)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscores, starting with a letter');

export const SaveRoleInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300),
  /** `null` puts the role at the root of the tree. */
  parentKey: z.string().nullable(),
  /** 0 is the top. A label, not a rule — see `RoleSummary.level`. */
  level: z.number().int().min(0).max(9),
  privileges: z.array(z.string()).max(200),
  allPrivileges: z.boolean(),
  canAssignSameLevel: z.boolean(),
  requestTypeScope: z.array(z.string()).max(20),
});
export type SaveRoleInput = z.infer<typeof SaveRoleInput>;

export const CreateRoleInput = SaveRoleInput.extend({ roleKey: RoleKey });
export type CreateRoleInput = z.infer<typeof CreateRoleInput>;

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Onboarding & money
// ════════════════════════════════════════════════════════════════════════════

// ── Communication ───────────────────────────────────────────────────────────

export const TemplateKeyValue = z.enum([
  'SELECTION_VENDOR',
  'SELECTION_ASHRAM',
  'PAYMENT_DETAILS',
  'ONBOARDING_FSSAI_STAFF',
]);
export type TemplateKeyValue = z.infer<typeof TemplateKeyValue>;

/** How a letter reaches a requester.
 *
 *  🔴 Both, and the team named both: "we would like to send them a WhatsApp
 *  message as well as an email". WhatsApp is the one a village trader actually
 *  reads — many have no working email address at all, and the local welfare
 *  team routinely files them under a placeholder one — so an email-only send is
 *  a letter that never arrives for exactly the requesters least able to chase
 *  it. Email stays because it is the only channel that can carry the zone map
 *  the selection letter attaches. */
export const MessageChannel = z.enum(['EMAIL', 'WHATSAPP']);
export type MessageChannel = z.infer<typeof MessageChannel>;

export interface EmailTemplateView {
  key: TemplateKeyValue;
  name: string;
  description: string;
  subject: string;
  body: string;
  /** The short version, for WhatsApp. Same placeholders, no attachment, and
   *  written to be read on a phone — a letter pasted into WhatsApp whole is a
   *  wall of text nobody scrolls. Empty means this template is email-only. */
  whatsappBody: string;
  appliesTo: string[];
  /** Null while the seeded text has never been edited. */
  updatedAt: string | null;
  /** An attachment an admin has put on this template — the zone map that goes
   *  out with the selection letter. */
  attachment: { name: string; key: string; bytes: number } | null;
}

export const UpdateTemplateInput = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
  whatsappBody: z.string().trim().max(4000).default(''),
});

export const SendEmailInput = z.object({
  templateKey: TemplateKeyValue,
  requestIds: z.array(z.uuid()).min(1).max(500),
  /** Which channels to send on. Both by default — the team's own answer when
   *  asked to choose. */
  channels: z.array(MessageChannel).min(1).max(2).default(['EMAIL', 'WHATSAPP']),
});
export type SendEmailInput = z.infer<typeof SendEmailInput>;

export interface SendEmailResult {
  sent: string[];
  /** What actually went out, per channel. A WhatsApp message that could not be
   *  sent does not hold back the email, and the team has to be able to see
   *  which of the two a requester got. */
  byChannel: Record<string, number>;
  /** A request the send skipped, and why — already sent, wrong requester type,
   *  not selected. Reported rather than thrown: a bulk send of two hundred must
   *  not fail entirely because one row was already done. */
  skipped: Array<{ requestId: string; reason: string }>;
}

export interface CommRecipient {
  id: string;
  reference: string;
  stallName: string;
  requesterName: string;
  email: string;
  requestType: string;
  stallNumbers: string[];
  /** Which template this row should get, by requester type. */
  suggestedTemplate: TemplateKeyValue;
  sentAt: string | null;
  /** Every template already sent to this request, so the screen can say what
   *  has gone out without a second call. */
  sentTemplates: Array<{ key: string; sentAt: string }>;
}

export const ReminderKind = z.enum(['BANK', 'PAYMENT']);
export type ReminderKind = z.infer<typeof ReminderKind>;

export const LogReminderInput = z.object({
  kind: ReminderKind,
  note: z.string().trim().max(500).optional(),
});

export interface ReminderRow {
  requestId: string;
  reference: string;
  stallName: string;
  requesterName: string;
  contactNumber: string;
  email: string;
  kind: ReminderKind;
  callCount: number;
  lastCalledAt: string | null;
}

// ── Bank details (public, vendors only) ─────────────────────────────────────

/** Indian formats, checked in the shape the bank prints them. Wrong here means
 *  a failed NEFT and a vendor chased by phone, so the patterns are strict and
 *  the messages name the expected shape. */
export const Ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'expected an 11-character IFSC like HDFC0001234');

export const Pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'expected a 10-character PAN like ABCDE1234F');

/** 15 characters: 2 state digits, a 10-character PAN, an entity digit, Z, a
 *  checksum character. `NONE` is accepted because the 2025 form says so in as
 *  many words — "enter 'None' if not applicable". */
export const Gstin = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (v) => v === 'NONE' || /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][A-Z0-9]$/.test(v),
    "expected a 15-character GSTIN, or 'None'",
  );

const UploadKey = z.string().trim().min(1).max(400);

export const SubmitBankDetailsInput = z.object({
  email: z.email().max(320),
  invoiceName: z.string().trim().min(1).max(200),
  accountHolder: z.string().trim().min(1).max(200),
  mobile: IndianMobile,
  address: z.string().trim().min(1).max(1000),
  pincode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'expected a 6-digit pincode'),
  bankName: z.string().trim().min(1).max(200),
  branch: z.string().trim().min(1).max(200),
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, 'expected 6 to 20 digits'),
  ifsc: Ifsc,
  micr: z
    .string()
    .trim()
    .regex(/^\d{9}$/, 'expected a 9-digit MICR code')
    .optional()
    .or(z.literal('')),
  panNumber: Pan,
  gstNumber: Gstin,
  chequeKey: UploadKey,
  panKey: UploadKey,
  gstKey: UploadKey.optional().or(z.literal('')),
  declarationIds: DeclarationIds,
  /** Answers to questions an ADMIN appended, keyed by field id. The built-ins
   *  above land in typed columns; these have no column and are filed by id, the
   *  same split `SubmitRequestInput` already uses. */
  customFields: z.record(z.uuid(), z.string().trim().max(2000)).optional(),
  // The form is also where the vendor FINALISES what they need — the 2025 form
  // asks again, because a request made in November is stale by February.
  plugs5a: z.number().int().min(0).max(50),
  plugs15a: z.number().int().min(0).max(50),
  gasStoves: z.number().int().min(0).max(10),
  appliances: z.array(ApplianceInput).max(20).default([]),
  tablesNeeded: z.number().int().min(0).max(50),
  chairsNeeded: z.number().int().min(0).max(200),
  passes2w: z.number().int().min(0).max(50),
  passes4w: z.number().int().min(0).max(50),
  passesStaff: z.number().int().min(0).max(200),
  remarks: z.string().trim().max(2000).optional(),
});
export type SubmitBankDetailsInput = z.infer<typeof SubmitBankDetailsInput>;

export interface BankFormView {
  reference: string;
  stallName: string;
  requesterName: string;
  email: string;
  stallNumbers: string[];
  zoneCode: string | null;
  editionName: string;
  /** Where this edition's terms and conditions can be read. Null when the legal
   *  team has not issued a document — the consent is then shown without a link
   *  rather than with one that goes nowhere. */
  termsUrl: string | null;
  /** What was asked for at request time, to prefill the requirements block. */
  current: {
    plugs5a: number;
    plugs15a: number;
    gasStoves: number;
    tablesNeeded: number;
    chairsNeeded: number;
    passes2w: number;
    passes4w: number;
    passesStaff: number;
    appliances: Array<{ name: string; watts: number }>;
  };
  /** Non-null once submitted: the form becomes a read-back rather than a
   *  second chance to change bank details after Finance has acted on them. */
  submittedAt: string | null;
  /** 🔴 The edition's own definition of this form. What it asks, in what order,
   *  with what wording — including any question an admin appended. The page
   *  draws from this rather than from a constant, which is the whole point of
   *  the bank form becoming rows. */
  form: BuiltForm | null;
  declarations: Declaration[];
}

// ── Payment and finance ─────────────────────────────────────────────────────

export interface QuoteView {
  stallFeePaise: number;
  plugFeePaise: number;
  equipmentFeePaise: number;
  netPaise: number;
  gstPaise: number;
  feeTotalPaise: number;
  stallDepositPaise: number;
  equipmentDepositPaise: number;
  depositTotalPaise: number;
  grandTotalPaise: number;
  exempt: boolean;
  /** True when this bay carries no rate at this requester's scope. The row is
   *  shown, unpriced, rather than hidden. */
  unpriced: boolean;
  /** What was actually agreed, where the team agreed something other than the
   *  quote — see `payableFeePaise`. Null means the quote stands. */
  discretionaryFeePaise: number | null;
  discretionaryReason: string | null;
  /** `discretionaryFeePaise ?? feeTotalPaise`, resolved once here so that no
   *  screen has to remember the precedence. This is what "paid in full" is
   *  measured against. */
  payableFeePaise: number;
}

/** Recording the concession the local welfare team agreed on one stall.
 *
 *  ⚠️ The reason is required. A figure below the card rate with nothing beside
 *  it is indistinguishable from a typo six months later, when the person who
 *  agreed it has moved on and Finance is reconciling the edition. */
export const SetDiscretionaryFeeInput = z.object({
  /** Null clears it and puts the quoted figure back in force. */
  discretionaryFeePaise: z.number().int().min(0).max(1_000_000_000).nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
});
export type SetDiscretionaryFeeInput = z.infer<typeof SetDiscretionaryFeeInput>;

/** The two accounts a requester pays into, resolved for this request. Null
 *  where Finance has not issued that prefix for the edition yet. */
export interface VirtualAccountView {
  rent: string | null;
  deposit: string | null;
}

export const PaymentPurpose = z.enum(['RENT', 'DEPOSIT']);
export type PaymentPurpose = z.infer<typeof PaymentPurpose>;

export const ConfirmPaymentInput = z.object({
  purpose: PaymentPurpose,
  referenceNo: z.string().trim().min(1).max(100),
  eCollectCode: z.string().trim().max(100).optional(),
  amountPaise: z.number().int().min(1).max(1_000_000_000),
  receivedOn: z.iso.date(),
  remitterName: z.string().trim().max(200).optional(),
  mode: z.enum(['NEFT', 'CASH', 'CHEQUE', 'UPI', 'OTHER']).default('NEFT'),
  note: z.string().trim().max(500).optional(),
});
export type ConfirmPaymentInput = z.infer<typeof ConfirmPaymentInput>;

// ── Payment claims (public: a vendor says what they transferred) ────────────

export const PaymentClaimStatus = z.enum(['PENDING', 'VERIFIED', 'REJECTED']);
export type PaymentClaimStatus = z.infer<typeof PaymentClaimStatus>;

/**
 * What a requester submits after they have paid.
 *
 * 🔴 A CLAIM, not a receipt. `StallPaymentRecord` is finance-entered and every
 * row in it is money the Foundation has seen on its statement; this is what
 * somebody says they sent. The 2025 letter filled the gap with "please send
 * transfer details on E-mail IDs finance.support@… once you make the payment" —
 * a mailbox, matched by hand.
 *
 * ⚠️ The receipt upload is OPTIONAL. A vendor who transferred at a branch
 * counter may have only a stamped slip they cannot photograph well, and
 * refusing the claim over that sends them back to email — which is the thing
 * this replaces. The reference number is what finance actually matches.
 */
export const SubmitPaymentClaimInput = z.object({
  /** Which of the account's requests this is about. ⚠️ The SESSION is the
   *  credential; this only picks which request, so a reference belonging to
   *  somebody else 404s exactly as one that never existed does. */
  reference: z.string().trim().min(1).max(40),
  /** Rent and deposit are paid SEPARATELY, into different virtual accounts, so
   *  a claim is always about one of them. */
  purpose: PaymentPurpose,
  referenceNo: z.string().trim().min(4).max(80),
  amountPaise: z.number().int().positive().max(100_000_000),
  /** A banking date — the day it shows on the statement. */
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date as YYYY-MM-DD'),
  remitterName: z.string().trim().max(200).optional(),
  receiptKey: z.string().trim().max(400).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type SubmitPaymentClaimInput = z.infer<typeof SubmitPaymentClaimInput>;

/** Finance settling one. */
export const ReviewPaymentClaimInput = z.object({
  verdict: z.enum(['VERIFY', 'REJECT']),
  /** ⚠️ Required on REJECT and shown to the requester. A rejection with no
   *  reason is one they cannot act on. The database enforces it too. */
  rejectReason: z.string().trim().max(500).optional(),
  /** The virtual-account code the credit landed on, where finance can see one.
   *  Carried onto the payment record. */
  eCollectCode: z.string().trim().max(60).optional(),
  /** Overrides what the requester typed, where finance reads a different figure
   *  off the statement — the claim keeps what was claimed. */
  amountPaise: z.number().int().positive().max(100_000_000).optional(),
});
export type ReviewPaymentClaimInput = z.infer<typeof ReviewPaymentClaimInput>;

export interface PaymentClaimView {
  id: string;
  purpose: PaymentPurpose;
  status: PaymentClaimStatus;
  referenceNo: string;
  amountPaise: number;
  paidOn: string;
  remitterName: string | null;
  note: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  /** ⚠️ Shown to the REQUESTER on a rejected claim: it is the only thing that
   *  tells them what to correct. */
  rejectReason: string | null;
  hasReceipt: boolean;
}

/** One row on the finance queue, with enough of the request to act on. */
export interface PaymentClaimRow extends PaymentClaimView {
  requestId: string;
  reference: string;
  stallName: string;
  requesterName: string;
  /** What the plan says is owed for this purpose, so finance can see at a
   *  glance whether the claimed figure matches. */
  expectedPaise: number | null;
}

export interface PaymentClaimsResponse {
  claims: PaymentClaimRow[];
}

export interface PaymentRecordView {
  id: string;
  purpose: PaymentPurpose;
  referenceNo: string;
  eCollectCode: string | null;
  amountPaise: number;
  receivedOn: string;
  remitterName: string | null;
  mode: string;
  note: string | null;
  confirmedAt: string;
}

export interface PaymentRow {
  requestId: string;
  reference: string;
  stallName: string;
  requesterName: string;
  email: string;
  requestType: string;
  stallNumbers: string[];
  quote: QuoteView;
  bankDetailsReceivedAt: string | null;
  paymentEmailSentAt: string | null;
  records: PaymentRecordView[];
  /** Sum of confirmed receipts, per purpose. */
  receivedRentPaise: number;
  receivedDepositPaise: number;
  fullySettled: boolean;
}

// ── Refunds ─────────────────────────────────────────────────────────────────

export const SubmitRefundInput = z.object({
  equipmentDeductionPaise: z.number().int().min(0).max(1_000_000_000),
  fineTypeIds: z.array(z.uuid()).max(20).default([]),
  /** A one-off fine with no configured type. */
  extraFinePaise: z.number().int().min(0).max(1_000_000_000).default(0),
  extraFineReason: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional(),
});
export type SubmitRefundInput = z.infer<typeof SubmitRefundInput>;

export interface RefundRow {
  requestId: string;
  reference: string;
  stallName: string;
  requesterName: string;
  /** The two deposits, summed. */
  depositHeldPaise: number;
  /** 🔴 Held apart, because each deduction is charged to its own: fines come
   *  off the stall deposit, furniture losses off the chairs-and-tables one. */
  stallDepositPaise: number;
  equipmentDepositPaise: number;
  /** What Chairs & Tables says is missing or damaged, priced. An editable
   *  suggestion, not the answer — the counter's note and the vendor's account
   *  sometimes differ and a person settles it. */
  suggestedEquipmentDeductionPaise: number;
  equipmentDeductionPaise: number;
  fineDeductionPaise: number;
  fines: Array<{ reason: string; amountPaise: number }>;
  /** What comes back out of each deposit, and their sum. */
  stallRefundPaise: number;
  equipmentRefundPaise: number;
  refundDuePaise: number;
  /** Deductions beyond the deposit they are charged against, per bucket and
   *  summed. An over-run on furniture is a debt to recover, not a reason to
   *  keep the stall deposit. */
  stallShortfallPaise: number;
  equipmentShortfallPaise: number;
  shortfallPaise: number;
  submittedAt: string | null;
  voucherRef: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Event operations
// ════════════════════════════════════════════════════════════════════════════

// ── Staff registration (public, coupon-gated) ───────────────────────────────

export const CouponCode = z.string().trim().min(6).max(40);

export const RegisterStaffInput = z.object({
  couponCode: CouponCode,
  /** ⚠️ Filed against the STAFF MEMBER, not the stall — eight people share one
   *  request, so a request-keyed answer would collapse seven of them. See the
   *  partial indexes on `stall_custom_field_value`. */
  customFields: z.record(z.uuid(), z.string().trim().max(2000)).optional(),
  name: z.string().trim().min(1).max(200),
  mobile: IndianMobile,
  idType: z.enum(['AADHAAR', 'VOTER_ID', 'DRIVING_LICENCE', 'PASSPORT', 'OTHER']),
  /** Only the last four digits of an Aadhaar are kept — enough to match a card
   *  at the gate, not enough to be a copy of it. Longer ids are stored whole. */
  idNumber: z.string().trim().min(4).max(40),
  role: z.string().trim().max(100).optional(),
  declarationIds: DeclarationIds,
});
export type RegisterStaffInput = z.infer<typeof RegisterStaffInput>;

export interface CouponView {
  stallName: string;
  reference: string;
  /** The edition's own definition of the staff form, and the consents it asks
   *  for. Empty declarations means the team has authored none yet. */
  form: BuiltForm | null;
  declarations: Declaration[];
  /** ⚠️ Empty until the stall checks in — the same rule the vendor's own status
   *  page follows, and for the same reason. The coupon page is read by the
   *  vendor's whole team, which is the last place a number should leak early. */
  stallNumbers: string[];
  registered: number;
  /** The coupon's capacity: eight by default, raised case by case by the stall
   *  team. Always a real cap — never zero-meaning-unlimited. */
  maxStaff: number;
  staff: Array<{ name: string | null; mobile: string; registeredAt: string }>;
}

/** Raising (or lowering) what one coupon may register. */
export const SetCouponCapacityInput = z.object({
  capacity: z.number().int().min(1).max(MAX_STAFF_COUPON_CAPACITY),
});
export type SetCouponCapacityInput = z.infer<typeof SetCouponCapacityInput>;

export interface VendorStaffView {
  id: string;
  name: string | null;
  /** ⚠️ Never null. It is half of the unique index behind "one person, one
   *  registration per stall", so this is the one question on these forms that
   *  cannot be switched off. */
  mobile: string;
  idType: string | null;
  idNumber: string | null;
  role: string | null;
  registeredAt: string;
}

// ── FSSAI (public, link-gated) ──────────────────────────────────────────────

export const SubmitFssaiInput = z.object({
  stallName: z.string().trim().min(1).max(200),
  customFields: z.record(z.uuid(), z.string().trim().max(2000)).optional(),
  ownerName: z.string().trim().max(200).optional(),
  mobile: IndianMobile.optional(),
  files: z
    .array(z.object({ key: z.string().trim().min(1).max(400), name: z.string().trim().max(300) }))
    .min(1)
    .max(5),
  declarationIds: DeclarationIds,
});
export type SubmitFssaiInput = z.infer<typeof SubmitFssaiInput>;

export interface FssaiFormView {
  reference: string;
  stallName: string;
  requesterName: string;
  uploadedAt: string | null;
  verifiedAt: string | null;
  files: Array<{ name: string; uploadedAt: string }>;
  /** The edition's own definition of this form, and the consents it asks for.
   *  Both may be empty: this form seeds no declaration, so it gates on nothing
   *  until the team authors one. */
  form: BuiltForm | null;
  declarations: Declaration[];
}

// ── Contract signature ──────────────────────────────────────────────────────

export const SignatureStatusValue = z.enum(SIGNATURE_STATUSES);
export type SignatureStatusValue = z.infer<typeof SignatureStatusValue>;

export interface SignatureView {
  status: SignatureStatusValue;
  label: string;
  /** The provider's own id for the document, so a dispute can be traced back
   *  into their audit trail without going through this application. */
  documentId: string | null;
  sentAt: string | null;
  signedAt: string | null;
  /** Where the requester goes to sign. Reissued rather than stored long: these
   *  expire, and a stale one is worse than none. */
  signUrl: string | null;
  /** Why the provider refused, when it did. */
  error: string | null;
}

/** Sending the agreement out. No body: what goes out is the edition's
 *  configured agreement and the requester already on the request. */
export interface SendSignatureResult {
  status: SignatureStatusValue;
  signUrl: string | null;
}

// ── Uploads ─────────────────────────────────────────────────────────────────

export const PresignUploadInput = z.object({
  /** ⚠️ `FORM_FIELD` is the only purpose that needs a `fieldId`, and it is the
   *  purpose for a question an ADMIN added. The other five back typed columns
   *  and keep their own folders, so every key already in the store stays
   *  valid. */
  purpose: z.enum([
    'BANK_CHEQUE',
    'BANK_PAN',
    'BANK_GST',
    'FSSAI',
    'TEMPLATE_ATTACHMENT',
    'FORM_FIELD',
    // 🔴 The ADMIN's own picture, not a reader's answer — the venue layout
    // drawn inside a display block. It needs no `fieldId`: the folder holds
    // nothing but form-note images, every one of them authored in the builder,
    // so the folder alone is what `/public/form-image` will serve.
    'FORM_NOTE',
  ]),
  /** Which question this upload answers. Required for `FORM_FIELD` and ignored
   *  otherwise — it becomes part of the key's PATH, which is what makes a key
   *  valid for exactly one question. */
  fieldId: z.uuid().optional(),
  fileName: z.string().trim().min(1).max(300),
  contentType: z.string().trim().min(1).max(200),
  bytes: z.number().int().min(1).max(20_000_000),
});
export type PresignUploadInput = z.infer<typeof PresignUploadInput>;

export interface PresignUploadResponse {
  key: string;
  url: string;
  headers: Record<string, string>;
}

// ── Onboarding ──────────────────────────────────────────────────────────────

export interface CouponSummary {
  id: string;
  code: string;
  /** What this ONE coupon admits. */
  capacity: number;
  /** How many came in on THIS coupon, not on the stall as a whole. */
  registered: number;
}

export interface OnboardingRow {
  requestId: string;
  reference: string;
  stallName: string;
  requesterName: string;
  requestType: string;
  stallNumbers: string[];
  bankDetails: 'RECEIVED' | 'PENDING' | 'NOT_APPLICABLE';
  gst: 'RECEIVED' | 'PENDING' | 'NOT_APPLICABLE';
  payment: 'CONFIRMED' | 'PENDING' | 'NOT_APPLICABLE';
  fssai: 'VERIFIED' | 'UPLOADED' | 'PENDING' | 'NOT_APPLICABLE';
  staffRegistered: number;
  /** Every live coupon's capacity added up — what the stall may register in
   *  total, not what it owes. See `pendingSteps`. */
  staffExpected: number;
  /** 🔴 A LIST. A stall may hold more than one live coupon: the team issues a
   *  caterer their own code rather than a share of the vendor's, and the two are
   *  counted apart so the gate can say who somebody came in with. Empty until
   *  the first one is issued. Oldest first — the first is the one the letters
   *  name. */
  coupons: CouponSummary[];
  stage: string;
  pending: Array<{ step: string; label: string }>;
}

export interface OnboardingDetail extends OnboardingRow {
  /** ⚠️ Every answer is nullable. A question the edition stopped asking has no
   *  answer on records submitted after it was switched off, and a screen that
   *  assumed otherwise would print "undefined" beside a label. Which questions
   *  are actually asked is `is_required` on the form's field rows. */
  bank: {
    invoiceName: string | null;
    accountHolder: string | null;
    bankName: string | null;
    branch: string | null;
    accountNumber: string | null;
    ifsc: string | null;
    micr: string | null;
    panNumber: string | null;
    gstNumber: string | null;
    address: string | null;
    pincode: string | null;
    mobile: string | null;
    submittedAt: string;
    files: Array<{ label: string; name: string; url: string | null }>;
  } | null;
  staff: VendorStaffView[];
  fssaiFiles: Array<{ name: string; uploadedAt: string; url: string | null }>;
  quote: QuoteView | null;
}

// ── Electrical & venue prep ─────────────────────────────────────────────────

export interface ElectricalRow {
  stallNumber: string;
  zoneCode: string;
  stallName: string;
  category: string;
  requestType: string;
  /** As the printed sheet says it: including the one free plug. */
  plugs5aTotal: number;
  plugs15a: number;
  gasStoves: number;
  appliances: Array<{ name: string; watts: number }>;
  totalWatts: number;
}

export interface ElectricalSheet {
  editionName: string;
  zoneCode: string | null;
  rows: ElectricalRow[];
  totals: { stalls: number; plugs5a: number; plugs15a: number; watts: number };
}

// ── Check-in ────────────────────────────────────────────────────────────────

export const CheckInInput = z.object({ note: z.string().trim().max(500).optional() });

export interface CheckInRow {
  requestId: string;
  reference: string;
  stallName: string;
  requesterName: string;
  contactNumber: string;
  requestType: string;
  stallNumbers: string[];
  staffRegistered: number;
  staffExpected: number;
  passes2w: number;
  passes4w: number;
  passesStaff: number;
  pending: Array<{ step: string; label: string }>;
  checkedInAt: string | null;
  checkedInBy: string | null;
  note: string | null;
}

// ── Chairs and tables ───────────────────────────────────────────────────────

export const EquipmentPatch = z.object({
  extraChairs: z.number().int().min(0).max(500).optional(),
  extraTables: z.number().int().min(0).max(500).optional(),
  missingChairs: z.number().int().min(0).max(500).optional(),
  missingTables: z.number().int().min(0).max(500).optional(),
  damaged: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
  flagged: z.boolean().optional(),
});
export type EquipmentPatch = z.infer<typeof EquipmentPatch>;

export const EquipmentAction = z.enum([
  'DISTRIBUTE',
  'UNDISTRIBUTE',
  'COLLECT_EXTRA_PAYMENT',
  'COLLECT',
  'UNCOLLECT',
]);
export type EquipmentAction = z.infer<typeof EquipmentAction>;

export interface EquipmentRow {
  requestId: string;
  reference: string;
  stallName: string;
  requesterName: string;
  contactNumber: string;
  requestType: string;
  category: string;
  stallNumbers: string[];
  chairsRequested: number;
  tablesRequested: number;
  extraChairs: number;
  extraTables: number;
  /** What the extras cost at this requester type's rate — collected in cash at
   *  the counter, which is why it is shown as a figure and not just a count. */
  extraChargePaise: number;
  extraCollectedAt: string | null;
  distributedAt: string | null;
  collectedAt: string | null;
  missingChairs: number;
  missingTables: number;
  damaged: boolean;
  /** Priced from the admin's replacement rates; feeds the refund screen. */
  deductionPaise: number;
  note: string | null;
  flagged: boolean;
}

/** Everything the two-part paper challan prints. Assembled by the API so the
 *  printed slip and the screen cannot disagree. */
export interface ChallanView {
  stallNumber: string;
  stallName: string;
  ownerName: string;
  contactNumber: string;
  category: string;
  chairsOnline: number;
  tablesOnline: number;
  extraChairs: number;
  extraTables: number;
  extraChargePaise: number;
  editionName: string;
  printedAt: string;
}
