import { z } from 'zod';
import { STALL_CATEGORIES, ZONE_CODES } from './zones';

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
export const ZoneGroupValue = z.enum(['AB', 'C', 'CLOSED']);
export const AshramUsage = z.enum([
  'DEPT_DISPLAY',
  'DEPT_SALES',
  'VENDOR_SALES',
  'SPONSOR',
  'OTHER',
]);
export const ZoneCodeValue = z.enum(ZONE_CODES);
export const CategoryValue = z.enum(STALL_CATEGORIES);

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
  isClosedToVendors: boolean;
  /** Paise, or null where no rent is quoted (closed to vendors). */
  rentFoodPaise: number | null;
  rentNonFoodPaise: number | null;
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
  zones: PublicZone[];
  charges: {
    vendorDepositPaise: number;
    localWelfareDepositPaise: number;
    gstPercent: number;
  };
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
  allocatedStalls: string[];
}

export interface PublicStatusResponse {
  displayName: string;
  requests: PublicRequestStatus[];
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

// ── Staff: selection ────────────────────────────────────────────────────────

export const SelectRequestInput = z.object({
  stallNumbers: z
    .array(z.string().regex(/^[A-Z][0-9]-[1-9]\d*$/, 'expected a stall number like A4-17'))
    .min(1)
    .max(10),
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

const CountsShape = Object.fromEntries(
  STALL_CATEGORIES.map((c) => [c, z.number().int().min(0).max(500)]),
) as Record<(typeof STALL_CATEGORIES)[number], z.ZodNumber>;

export const ZonePlanInput = z.object({
  crowdPerStall: z.number().int().min(1).max(100_000).optional(),
  rows: z.array(
    z.object({
      zoneCode: ZoneCodeValue,
      expectedCrowd: z.number().int().min(0).max(10_000_000).optional(),
      counts: z.object(CountsShape),
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

export const CreateEditionInput = z.object({
  year: z.number().int().min(2020).max(2100),
  name: z.string().trim().min(1).max(100),
  activate: z.boolean().default(true),
});

export const ZoneInput = z.object({
  name: z.string().trim().min(1).max(100),
  expectedCrowd: z.number().int().min(0).max(10_000_000),
  isClosedToVendors: z.boolean(),
});

export const RateCardInput = z.object({
  entries: z
    .array(z.object({ zoneGroup: ZoneGroupValue, isFood: z.boolean(), amountPaise: Paise }))
    .max(20),
});

export const ChargesInput = z.object({
  chairRatePaise: Paise,
  tableRatePaise: Paise,
  lwChairRatePaise: Paise,
  lwTableRatePaise: Paise,
  vendorDepositPaise: Paise,
  localWelfareDepositPaise: Paise,
  plug5aRatePaise: Paise,
  plug15aRatePaise: Paise,
  gstPercent: z.number().int().min(0).max(100),
  crowdPerStall: z.number().int().min(1).max(100_000),
});
export type ChargesInput = z.infer<typeof ChargesInput>;

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

export interface MeResponse {
  personId: string;
  displayName: string;
  roleKeys: string[];
  actions: string[];
}
