import type {
  ApplyPlanResult,
  AvailableStall,
  BankDetailsInput,
  ChargesInput,
  CheckInInput,
  CheckInRow,
  CommsRow,
  ConfirmPaymentInput,
  DashboardCounts,
  ElectricalRow,
  EmailLogRow,
  FinanceRow,
  FssaiUploadInput,
  FurnitureIssueInput,
  FurnitureReturnInput,
  FurnitureRow,
  LinksInput,
  ListRequestsQuery,
  MeResponse,
  OnboardingRow,
  PaymentView,
  PresignUploadInput,
  PresignedUploadResponse,
  PublicBankView,
  PublicConfig,
  PublicFssaiView,
  PublicStaffView,
  RefundRow,
  RequestDetail,
  RequestPage,
  SendEmailInput,
  SendResult,
  StaffMember,
  StallRole,
  StatusStep,
  SubmitRequestInput,
  SubmitRequestResponse,
  TemplateInput,
  TemplatePreview,
  ZonePlanInput,
  ZonePlanView,
} from '@msr/stalls';
import { apiFetch } from './api-client';

/** Typed client for every stalls endpoint. One place for paths, so a route
 *  rename is one edit. Base is `/api/m/stalls`, the host's `/m/{key}` shape. */
const BASE = '/api/m/stalls';

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const enc = encodeURIComponent;

// ── Public ──────────────────────────────────────────────────────────────────

export interface PublicStatusFull {
  displayName: string;
  requests: Array<{
    reference: string;
    requestType: string;
    stallName: string;
    status: string;
    stage: string;
    submittedAt: string;
    allocatedStalls: string[];
    steps: StatusStep[];
    bankFormUrl: string | null;
    fssaiUploadUrl: string | null;
    staffUrl: string | null;
    paymentDuePaise: number | null;
    paymentDue: string | null;
  }>;
}

export const getPublicConfig = () => apiFetch<PublicConfig>(`${BASE}/public/config`);
export const submitRequest = (body: SubmitRequestInput) =>
  apiFetch<SubmitRequestResponse>(`${BASE}/public/requests`, { method: 'POST', json: body });
export const getStatus = (token: string) => apiFetch<PublicStatusFull>(`${BASE}/public/status/${enc(token)}`);

export const getBankView = (token: string) => apiFetch<PublicBankView>(`${BASE}/public/bank/${enc(token)}`);
export const submitBank = (token: string, body: BankDetailsInput) =>
  apiFetch<{ reference: string }>(`${BASE}/public/bank/${enc(token)}`, { method: 'POST', json: body });

export const presignUpload = (token: string, body: PresignUploadInput) =>
  apiFetch<PresignedUploadResponse>(`${BASE}/public/upload/${enc(token)}`, { method: 'POST', json: body });

/** Presign, then PUT the bytes where the store says. Returns the key the form
 *  stores. Works against the dev disk store and S3 alike — both answer a PUT. */
export async function uploadFile(token: string, purpose: PresignUploadInput['purpose'], file: File): Promise<string> {
  const contentType = file.type as PresignUploadInput['contentType'];
  const slot = await presignUpload(token, { purpose, fileName: file.name, contentType, bytes: file.size });
  const res = await fetch(slot.url, { method: 'PUT', headers: slot.headers, body: file });
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  return slot.key;
}

export const getFssaiView = (token: string) => apiFetch<PublicFssaiView>(`${BASE}/public/fssai/${enc(token)}`);
export const submitFssai = (token: string, body: FssaiUploadInput) =>
  apiFetch<unknown>(`${BASE}/public/fssai/${enc(token)}`, { method: 'POST', json: body });
export const getStaffView = (token: string) => apiFetch<PublicStaffView>(`${BASE}/public/staff/${enc(token)}`);

// ── Staff: me, dashboard ────────────────────────────────────────────────────

export const getMe = () => apiFetch<MeResponse>(`${BASE}/me`);
export const listRoles = () => apiFetch<StallRole[]>(`${BASE}/roles`);
export const getDashboard = () => apiFetch<DashboardCounts>(`${BASE}/dashboard`);

// ── Staff: requests ─────────────────────────────────────────────────────────

export const listRequests = (q: Partial<ListRequestsQuery> = {}) =>
  apiFetch<RequestPage>(`${BASE}/requests${qs(q as Record<string, string | number | boolean | undefined>)}`);
export const getRequest = (id: string) => apiFetch<RequestDetail>(`${BASE}/requests/${id}`);
export const flagRequest = (id: string, reason: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/flag`, { method: 'POST', json: { reason } });
export const unflagRequest = (id: string) => apiFetch<void>(`${BASE}/requests/${id}/flag`, { method: 'DELETE' });

// ── Staff: selection ────────────────────────────────────────────────────────

const post = (id: string, action: string) => apiFetch<void>(`${BASE}/requests/${id}/${action}`, { method: 'POST' });
export const shortlist = (id: string) => post(id, 'shortlist');
export const unshortlist = (id: string) => post(id, 'unshortlist');
export const backup = (id: string) => post(id, 'backup');
export const cancel = (id: string) => post(id, 'cancel');
export const reject = (id: string, reason: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/reject`, { method: 'POST', json: { reason } });
export const select = (id: string, stallNumbers: string[]) =>
  apiFetch<{ allocated: string[] }>(`${BASE}/requests/${id}/select`, { method: 'POST', json: { stallNumbers } });
export const releaseAllocation = (allocationId: string) =>
  apiFetch<void>(`${BASE}/allocations/${allocationId}`, { method: 'DELETE' });
export const availableStalls = (zoneCode?: string) =>
  apiFetch<AvailableStall[]>(`${BASE}/stalls/available${qs({ zoneCode })}`);

// ── Staff: planning ─────────────────────────────────────────────────────────

export const getPlan = () => apiFetch<ZonePlanView>(`${BASE}/planning`);
export const putPlan = (input: ZonePlanInput) => apiFetch<ZonePlanView>(`${BASE}/planning`, { method: 'PUT', json: input });
export const applyPlan = () => apiFetch<ApplyPlanResult>(`${BASE}/planning/apply`, { method: 'POST' });

// ── Staff: communication ────────────────────────────────────────────────────

export interface TemplateRow {
  key: string;
  subject: string;
  body: string;
  attachmentKey: string | null;
  updatedAt: string | null;
  placeholders: string[];
}
export const listTemplates = () => apiFetch<TemplateRow[]>(`${BASE}/comms/templates`);
export const putTemplate = (key: string, input: TemplateInput) =>
  apiFetch<unknown>(`${BASE}/comms/templates/${key}`, { method: 'PUT', json: input });
export const previewTemplate = (templateKey: string, requestId: string) =>
  apiFetch<TemplatePreview>(`${BASE}/comms/preview`, { method: 'POST', json: { templateKey, requestId } });
export const sendEmails = (input: SendEmailInput) =>
  apiFetch<SendResult>(`${BASE}/comms/send`, { method: 'POST', json: input });
export const commsRows = (requestType?: string) => apiFetch<CommsRow[]>(`${BASE}/comms/rows${qs({ requestType })}`);
export const emailLog = (id: string) => apiFetch<EmailLogRow[]>(`${BASE}/requests/${id}/emails`);

// ── Staff: onboarding, payment, finance ─────────────────────────────────────

export const onboardingRows = () => apiFetch<OnboardingRow[]>(`${BASE}/onboarding`);
export interface BankDetailsRow {
  requestId: string;
  invoiceName: string;
  accountHolder: string;
  mobile: string;
  address: string;
  pincode: string;
  bankName: string;
  branch: string;
  accountNumber: string;
  ifsc: string;
  micr: string | null;
  chequeMediaKey: string | null;
  panNumber: string;
  panMediaKey: string | null;
  gstNumber: string;
  gstMediaKey: string | null;
  submittedAt: string;
}
export const bankDetails = (id: string) => apiFetch<BankDetailsRow | null>(`${BASE}/requests/${id}/bank`);
export const payment = (id: string) => apiFetch<PaymentView>(`${BASE}/requests/${id}/payment`);
export const requote = (id: string) => apiFetch<PaymentView>(`${BASE}/requests/${id}/payment/requote`, { method: 'POST' });
export const sendPaymentEmail = (id: string) => apiFetch<void>(`${BASE}/requests/${id}/payment/send`, { method: 'POST' });
export const confirmPayment = (id: string, input: ConfirmPaymentInput) =>
  apiFetch<{ payment: unknown; postPaymentMail: SendResult }>(`${BASE}/requests/${id}/payment/confirm`, { method: 'POST', json: input });
export const financeRows = (pending: boolean) => apiFetch<FinanceRow[]>(`${BASE}/finance${qs({ pending: pending || undefined })}`);

export interface LinksRow {
  staffRegistrationUrl: string | null;
  fssaiProcessUrl: string | null;
  termsUrl: string | null;
  financeEmail: string | null;
  bankInstructions: string | null;
}
export const getLinks = () => apiFetch<LinksRow>(`${BASE}/config/links`);
export const putLinks = (input: LinksInput) => apiFetch<LinksRow>(`${BASE}/config/links`, { method: 'PUT', json: input });

// ── Staff: event ops ────────────────────────────────────────────────────────

export const issueCoupon = (id: string, maxStaff?: number) =>
  apiFetch<{ code: string; maxStaff: number; registeredCount: number }>(`${BASE}/requests/${id}/coupon`, { method: 'POST', json: { maxStaff } });
export const setRegisteredCount = (id: string, registeredCount: number) =>
  apiFetch<unknown>(`${BASE}/requests/${id}/coupon/registered`, { method: 'PUT', json: { registeredCount } });
export interface FssaiRow {
  requestId: string;
  mediaKey: string;
  fileName: string;
  licenseNumber: string | null;
  validTill: string | null;
  uploadedAt: string;
  verifiedAt: string | null;
  rejectedReason: string | null;
  viewUrl: string | null;
}
export const fssaiFor = (id: string) => apiFetch<FssaiRow | null>(`${BASE}/requests/${id}/fssai`);
export const reviewFssai = (id: string, verdict: 'VERIFY' | 'REJECT', reason?: string) =>
  apiFetch<unknown>(`${BASE}/requests/${id}/fssai/review`, { method: 'POST', json: { verdict, reason } });

export const electricalRows = (zoneCode?: string) => apiFetch<ElectricalRow[]>(`${BASE}/electrical${qs({ zoneCode })}`);
export const setCluster = (stallNumber: string, cluster: string | null) =>
  apiFetch<unknown>(`${BASE}/stalls/${enc(stallNumber)}/cluster`, { method: 'PUT', json: { cluster } });

export const checkInRows = (q?: string) => apiFetch<CheckInRow[]>(`${BASE}/checkin${qs({ q })}`);
export const checkIn = (id: string, input: CheckInInput) =>
  apiFetch<unknown>(`${BASE}/requests/${id}/checkin`, { method: 'POST', json: input });

export const furnitureRows = () => apiFetch<FurnitureRow[]>(`${BASE}/furniture`);
export const issueFurniture = (id: string, input: FurnitureIssueInput) =>
  apiFetch<{ extraChargePaise: number }>(`${BASE}/requests/${id}/furniture/issue`, { method: 'POST', json: input });
export const returnFurniture = (id: string, input: FurnitureReturnInput) =>
  apiFetch<{ chairsMissing: number; tablesMissing: number; flagged: boolean }>(`${BASE}/requests/${id}/furniture/return`, { method: 'POST', json: input });

export interface FineRow {
  id: string;
  reason: string;
  amountPaise: number;
  leviedAt: string;
  waivedAt: string | null;
}
export const listFines = (id: string) => apiFetch<FineRow[]>(`${BASE}/requests/${id}/fines`);
export const addFine = (id: string, input: { fineTypeId?: string; reason: string; amountPaise: number }) =>
  apiFetch<FineRow>(`${BASE}/requests/${id}/fines`, { method: 'POST', json: input });
export const waiveFine = (fineId: string) => apiFetch<unknown>(`${BASE}/fines/${fineId}/waive`, { method: 'POST' });

export const refundRows = () => apiFetch<RefundRow[]>(`${BASE}/refunds`);
export const prepareRefund = (id: string) => apiFetch<unknown>(`${BASE}/requests/${id}/refund/prepare`, { method: 'POST' });
export const sendRefunds = (requestIds: string[]) =>
  apiFetch<{ sent: number }>(`${BASE}/refunds/send`, { method: 'POST', json: { requestIds } });
export const markRefundPaid = (id: string, referenceNo: string) =>
  apiFetch<unknown>(`${BASE}/requests/${id}/refund/paid`, { method: 'POST', json: { referenceNo } });

// ── Staff: config ───────────────────────────────────────────────────────────

export interface StaffConfig {
  edition: { id: string; year: number; name: string; isActive: boolean };
  zones: Array<{ id: string; code: string; name: string; expectedCrowd: number; isClosedToVendors: boolean; sortOrder: number }>;
  rateCard: Array<{ zoneGroup: 'AB' | 'C' | 'CLOSED'; isFood: boolean; amountPaise: number }>;
  charges: ChargesInput & { id: string; editionId: string };
  flow: { bankStepEnabled: boolean; paymentStepEnabled: boolean; fssaiStepEnabled: boolean };
  fineTypes: Array<{ id: string; reason: string; defaultAmountPaise: number; isActive: boolean }>;
  customFields: Array<{
    id: string;
    formType: string;
    label: string;
    labelTa: string | null;
    fieldType: string;
    isRequired: boolean;
    sortOrder: number;
    isActive: boolean;
  }>;
}
export const getConfig = () => apiFetch<StaffConfig>(`${BASE}/config`);
export const listEditions = () => apiFetch<Array<{ id: string; year: number; name: string; isActive: boolean }>>(`${BASE}/editions`);
export const createEdition = (input: { year: number; name: string; activate: boolean }) =>
  apiFetch<{ id: string }>(`${BASE}/editions`, { method: 'POST', json: input });
export const activateEdition = (id: string) => apiFetch<void>(`${BASE}/editions/${id}/activate`, { method: 'POST' });
export const updateZone = (code: string, input: { name: string; expectedCrowd: number; isClosedToVendors: boolean }) =>
  apiFetch<unknown>(`${BASE}/config/zones/${code}`, { method: 'PUT', json: input });
export const putRateCard = (entries: Array<{ zoneGroup: 'AB' | 'C' | 'CLOSED'; isFood: boolean; amountPaise: number }>) =>
  apiFetch<unknown>(`${BASE}/config/rate-card`, { method: 'PUT', json: { entries } });
export const putCharges = (input: ChargesInput) => apiFetch<unknown>(`${BASE}/config/charges`, { method: 'PUT', json: input });
export const putFlow = (input: StaffConfig['flow']) => apiFetch<unknown>(`${BASE}/config/flow`, { method: 'PUT', json: input });
export const putFineType = (input: { reason: string; defaultAmountPaise: number; isActive: boolean }) =>
  apiFetch<unknown>(`${BASE}/config/fine-types`, { method: 'PUT', json: input });
export const createCustomField = (input: { formType: string; label: string; labelTa?: string | null; fieldType: string; isRequired: boolean; sortOrder: number }) =>
  apiFetch<{ id: string }>(`${BASE}/config/custom-fields`, { method: 'POST', json: input });
export const patchCustomField = (id: string, patch: Record<string, unknown>) =>
  apiFetch<unknown>(`${BASE}/config/custom-fields/${id}`, { method: 'PATCH', json: patch });
export const deleteCustomField = (id: string) => apiFetch<void>(`${BASE}/config/custom-fields/${id}`, { method: 'DELETE' });

// ── Staff: users ────────────────────────────────────────────────────────────

export const listStaff = () => apiFetch<StaffMember[]>(`${BASE}/staff`);
export const searchPeople = (q: string) =>
  apiFetch<Array<{ personId: string; email: string; displayName: string }>>(`${BASE}/staff/search${qs({ q })}`);
export const grantRole = (personRef: string, roleKey: string) =>
  apiFetch<void>(`${BASE}/staff`, { method: 'POST', json: { personRef, roleKey } });
export const revokeRole = (personRef: string, roleKey: string) =>
  apiFetch<void>(`${BASE}/staff/${personRef}/${roleKey}`, { method: 'DELETE' });
