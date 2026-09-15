import { z } from 'zod';
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

export const RequestType = z.enum(['ASHRAM', 'ASHRAM_FOOD', 'LOCAL_WELFARE', 'VENDOR']);
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
export const FormType = z.enum([
  'ASHRAM',
  'ASHRAM_FOOD',
  'LOCAL_WELFARE',
  'VENDOR',
  'BANK',
  'FSSAI',
]);
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
    if ((v.requestType === 'ASHRAM' || v.requestType === 'ASHRAM_FOOD') && !v.ashram) {
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

// ── Staff: requests ─────────────────────────────────────────────────────────

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

/** Staff correcting a request after it was filed.
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

// ── Staff: selection ────────────────────────────────────────────────────────

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

// ── Staff: planning ─────────────────────────────────────────────────────────

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

// ── Staff: admin ────────────────────────────────────────────────────────────

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

/** The season's settings that are neither a rate nor a zone.
 *
 *  The two virtual-account prefixes are here because Finance issues them per
 *  season and they are the only link between a bank credit and a request — see
 *  `virtual-account.ts`. */
export const EditionSettingsInput = z.object({
  name: z.string().trim().min(1).max(100),
  virtualAccountRentPrefix: VirtualAccountPrefix,
  virtualAccountDepositPrefix: VirtualAccountPrefix,
  maxStallsPerRequest: z.number().int().min(1).max(20),
  /** Where this season's terms and conditions can be read, linked beside the
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

export const CustomFieldInput = z.object({
  formType: FormType,
  label: z.string().trim().min(1).max(200),
  labelTa: z.string().trim().max(200).nullable().optional(),
  fieldType: z.enum(['text', 'textarea', 'number', 'checkbox']),
  isRequired: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

export const CustomFieldPatch = CustomFieldInput.partial().extend({
  isActive: z.boolean().optional(),
});

export const GrantRoleInput = z.object({
  personRef: z.uuid(),
  roleKey: z.string().min(1).max(64),
});

export interface StaffMember {
  personId: string;
  email: string;
  displayName: string;
  roleKeys: string[];
}

// ── Staff: the users directory ──────────────────────────────────────────────

/** Which population a directory row came from.
 *
 *  Staff hold this module's roles and live in the Foundation's `Person`;
 *  requesters are `StallAccount`s a public form created. The two stay in
 *  separate tables for the reason `ROLES` gives — that separation is what stops
 *  a vendor ever being granted `config:write` — and are brought together only
 *  here, for one screen, and only as a read. */
export type DirectoryKind = 'STAFF' | 'REQUESTER';

/**
 * Whether this person can get in, and if not, why.
 *
 * ⚠️ `LINK_ONLY` IS NOT A FAULT. A requester who applied and never set a
 * password is the ordinary case — the emailed status link is the whole of
 * their login, and most vendors never register at all. It must never be
 * counted under "Cannot sign in", or that tile reads as an outage every year.
 *
 * ⚠️ TEMPORARY, in the same breath as `credentials.ts`: every state but `OK`
 * and `DISABLED` describes the requester password login that the host's Isha
 * OIDC replaces. When that goes, this narrows to the two that are about a
 * Foundation account, and the two tiles that read the rest go with it.
 */
export type SignInState = 'OK' | 'LINK_ONLY' | 'UNCONFIRMED' | 'LOCKED' | 'DISABLED';

export interface DirectoryUser {
  /** `personId` for staff, the account id for requesters. Both are UUIDs from
   *  different tables, so `kind` — not the id — is what an action keys on. */
  id: string;
  kind: DirectoryKind;
  displayName: string;
  email: string;
  /** Requesters only. The Foundation directory holds no number for staff. */
  phone: string | null;
  /** Staff only; empty for a requester, who holds no role by construction. */
  roleKeys: string[];
  /** Requesters only — their requests in the ACTIVE edition, which is the
   *  edition every other staff screen is showing at the same moment. */
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
  'Staff',
  'Requesters',
  'Cannot sign in',
  'Locked out',
] as const;
export const DirectoryView = z.enum(DIRECTORY_VIEWS);
export type DirectoryView = z.infer<typeof DirectoryView>;

/** The finer sign-in states, for the Filter popover. The tiles flatten
 *  `LINK_ONLY`, `UNCONFIRMED` and `DISABLED` into one coarse reading; this is
 *  how a caller asks for one of them on its own. */
export const SignInStateValue = z.enum(['OK', 'LINK_ONLY', 'UNCONFIRMED', 'LOCKED', 'DISABLED']);

export const ListUsersQuery = z.object({
  view: DirectoryView.default('All'),
  q: z.string().trim().max(200).optional(),
  /** Staff only, and it narrows to staff on its own — a requester holds no
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
   * Requesters tile the moment you picked Staff — the numbers would then
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
  actions: string[];
}

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
  agreeNeft: z.literal(true),
  agreeTerms: z.literal(true),
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
  /** Where this season's terms and conditions can be read. Null when the legal
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
 *  agreed it has moved on and Finance is reconciling the season. */
export const SetDiscretionaryFeeInput = z.object({
  /** Null clears it and puts the quoted figure back in force. */
  discretionaryFeePaise: z.number().int().min(0).max(1_000_000_000).nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
});
export type SetDiscretionaryFeeInput = z.infer<typeof SetDiscretionaryFeeInput>;

/** The two accounts a requester pays into, resolved for this request. Null
 *  where Finance has not issued that prefix for the season yet. */
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
  name: z.string().trim().min(1).max(200),
  mobile: IndianMobile,
  idType: z.enum(['AADHAAR', 'VOTER_ID', 'DRIVING_LICENCE', 'PASSPORT', 'OTHER']),
  /** Only the last four digits of an Aadhaar are kept — enough to match a card
   *  at the gate, not enough to be a copy of it. Longer ids are stored whole. */
  idNumber: z.string().trim().min(4).max(40),
  role: z.string().trim().max(100).optional(),
});
export type RegisterStaffInput = z.infer<typeof RegisterStaffInput>;

export interface CouponView {
  stallName: string;
  reference: string;
  /** ⚠️ Empty until the stall checks in — the same rule the vendor's own status
   *  page follows, and for the same reason. The coupon page is read by the
   *  vendor's whole team, which is the last place a number should leak early. */
  stallNumbers: string[];
  registered: number;
  /** The coupon's capacity: eight by default, raised case by case by the stall
   *  team. Always a real cap — never zero-meaning-unlimited. */
  maxStaff: number;
  staff: Array<{ name: string; mobile: string; registeredAt: string }>;
}

/** Raising (or lowering) what one coupon may register. */
export const SetCouponCapacityInput = z.object({
  capacity: z.number().int().min(1).max(MAX_STAFF_COUPON_CAPACITY),
});
export type SetCouponCapacityInput = z.infer<typeof SetCouponCapacityInput>;

export interface VendorStaffView {
  id: string;
  name: string;
  mobile: string;
  idType: string;
  idNumber: string;
  role: string | null;
  registeredAt: string;
}

// ── FSSAI (public, link-gated) ──────────────────────────────────────────────

export const SubmitFssaiInput = z.object({
  stallName: z.string().trim().min(1).max(200),
  ownerName: z.string().trim().max(200).optional(),
  mobile: IndianMobile.optional(),
  files: z
    .array(z.object({ key: z.string().trim().min(1).max(400), name: z.string().trim().max(300) }))
    .min(1)
    .max(5),
});
export type SubmitFssaiInput = z.infer<typeof SubmitFssaiInput>;

export interface FssaiFormView {
  reference: string;
  stallName: string;
  requesterName: string;
  uploadedAt: string | null;
  verifiedAt: string | null;
  files: Array<{ name: string; uploadedAt: string }>;
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
  purpose: z.enum(['BANK_CHEQUE', 'BANK_PAN', 'BANK_GST', 'FSSAI', 'TEMPLATE_ATTACHMENT']),
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
  /** The coupon's capacity, not the vendor's own pass count. */
  staffExpected: number;
  couponCode: string | null;
  /** Null until a coupon has been issued. */
  couponCapacity: number | null;
  stage: string;
  pending: Array<{ step: string; label: string }>;
}

export interface OnboardingDetail extends OnboardingRow {
  bank: {
    invoiceName: string;
    accountHolder: string;
    bankName: string;
    branch: string;
    accountNumber: string;
    ifsc: string;
    micr: string | null;
    panNumber: string;
    gstNumber: string;
    address: string;
    pincode: string;
    mobile: string;
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
