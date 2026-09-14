import type {
  ApplyPlanResult,
  AvailableStall,
  BankFormView,
  ChallanView,
  ContinueStepInput,
  ContinueStepResponse,
  ChargesInput,
  CheckInRow,
  CommRecipient,
  ConfirmPaymentInput,
  CouponView,
  DashboardCounts,
  ElectricalSheet,
  EmailTemplateView,
  EquipmentAction,
  EquipmentPatch,
  EquipmentRow,
  FssaiFormView,
  ListRequestsQuery,
  MeResponse,
  OnboardingDetail,
  OnboardingRow,
  PaymentRow,
  PresignUploadInput,
  PresignUploadResponse,
  PublicConfig,
  PublicStatusResponse,
  RateCardEntry,
  RateScope,
  RequestAccessLinkResponse,
  RefundRow,
  RegisterStaffInput,
  ReminderKind,
  ReminderRow,
  RequestDetail,
  RequestPage,
  SendEmailResult,
  StaffMember,
  StallRole,
  SubmitBankDetailsInput,
  SubmitFssaiInput,
  SubmitRefundInput,
  SubmitRequestInput,
  SubmitRequestResponse,
  TemplateKeyValue,
  VendorStaffView,
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

// ── Public ──────────────────────────────────────────────────────────────────

/** ⚠️ The scope is the form's, not a default. The same bay is priced
 *  differently for trade and for local welfare, and the two bays closed to
 *  trade are the ones a local welfare requester is most likely to want. */
export const getPublicConfig = (scope: RateScope = 'VENDOR') =>
  apiFetch<PublicConfig>(`${BASE}/public/config${qs({ scope })}`);

export const submitRequest = (body: SubmitRequestInput) =>
  apiFetch<SubmitRequestResponse>(`${BASE}/public/requests`, { method: 'POST', json: body });

export const getStatus = (token: string) =>
  apiFetch<PublicStatusResponse>(`${BASE}/public/status/${encodeURIComponent(token)}`);

/** Asks for the vendor's own link to be re-sent. Resolves the same way whether
 *  or not the contact matched an account — the caller is never told. */
export const requestAccessLink = (contact: string) =>
  apiFetch<RequestAccessLinkResponse>(`${BASE}/public/access-link`, {
    method: 'POST',
    json: { contact },
  });

/** Mints a fresh link to one outstanding step and returns where to send the
 *  vendor. */
export const continueStep = (token: string, body: ContinueStepInput) =>
  apiFetch<ContinueStepResponse>(`${BASE}/public/status/${encodeURIComponent(token)}/continue`, {
    method: 'POST',
    json: body,
  });

// ── Staff: me, dashboard ────────────────────────────────────────────────────

export const getMe = () => apiFetch<MeResponse>(`${BASE}/me`);
export const listRoles = () => apiFetch<StallRole[]>(`${BASE}/roles`);
export const getDashboard = () => apiFetch<DashboardCounts>(`${BASE}/dashboard`);

// ── Staff: requests ─────────────────────────────────────────────────────────

export const listRequests = (q: Partial<ListRequestsQuery> = {}) =>
  apiFetch<RequestPage>(
    `${BASE}/requests${qs(q as Record<string, string | number | boolean | undefined>)}`,
  );

export const getRequest = (id: string) => apiFetch<RequestDetail>(`${BASE}/requests/${id}`);

export const flagRequest = (id: string, reason: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/flag`, { method: 'POST', json: { reason } });
export const unflagRequest = (id: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/flag`, { method: 'DELETE' });

// ── Staff: selection ────────────────────────────────────────────────────────

const post = (id: string, action: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/${action}`, { method: 'POST' });
export const shortlist = (id: string) => post(id, 'shortlist');
export const unshortlist = (id: string) => post(id, 'unshortlist');
export const backup = (id: string) => post(id, 'backup');
export const cancel = (id: string) => post(id, 'cancel');
export const reject = (id: string, reason: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/reject`, { method: 'POST', json: { reason } });
export const select = (id: string, stallNumbers: string[]) =>
  apiFetch<{ allocated: string[] }>(`${BASE}/requests/${id}/select`, {
    method: 'POST',
    json: { stallNumbers },
  });
export const releaseAllocation = (allocationId: string) =>
  apiFetch<void>(`${BASE}/allocations/${allocationId}`, { method: 'DELETE' });
export const availableStalls = (zoneCode?: string) =>
  apiFetch<AvailableStall[]>(`${BASE}/stalls/available${qs({ zoneCode })}`);

// ── Staff: planning ─────────────────────────────────────────────────────────

export const getPlan = () => apiFetch<ZonePlanView>(`${BASE}/planning`);
export const putPlan = (input: ZonePlanInput) =>
  apiFetch<ZonePlanView>(`${BASE}/planning`, { method: 'PUT', json: input });
export const applyPlan = () =>
  apiFetch<ApplyPlanResult>(`${BASE}/planning/apply`, { method: 'POST' });

// ── Staff: config ───────────────────────────────────────────────────────────

export interface StaffConfig {
  edition: { id: string; year: number; name: string; isActive: boolean };
  zones: Array<{
    id: string;
    code: string;
    name: string;
    expectedCrowd: number;
    isClosedToVendors: boolean;
    sortOrder: number;
  }>;
  /** One row per bay x food/non-food x scope, each carrying its own refundable
   *  advance. Not a band: the rent genuinely differs bay by bay, and banding
   *  them meant two bays that happened to share a letter could never be priced
   *  apart. */
  rateCard: RateCardEntry[];
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
export const listEditions = () =>
  apiFetch<Array<{ id: string; year: number; name: string; isActive: boolean }>>(
    `${BASE}/editions`,
  );
export const createEdition = (input: { year: number; name: string; activate: boolean }) =>
  apiFetch<{ id: string }>(`${BASE}/editions`, { method: 'POST', json: input });
export const activateEdition = (id: string) =>
  apiFetch<void>(`${BASE}/editions/${id}/activate`, { method: 'POST' });
export const updateZone = (
  code: string,
  input: { name: string; expectedCrowd: number; isClosedToVendors: boolean },
) => apiFetch<unknown>(`${BASE}/config/zones/${code}`, { method: 'PUT', json: input });
export const putRateCard = (entries: RateCardEntry[]) =>
  apiFetch<unknown>(`${BASE}/config/rate-card`, { method: 'PUT', json: { entries } });
export const putCharges = (input: ChargesInput) =>
  apiFetch<unknown>(`${BASE}/config/charges`, { method: 'PUT', json: input });
export const putFlow = (input: StaffConfig['flow']) =>
  apiFetch<unknown>(`${BASE}/config/flow`, { method: 'PUT', json: input });
export const putFineType = (input: {
  reason: string;
  defaultAmountPaise: number;
  isActive: boolean;
}) => apiFetch<unknown>(`${BASE}/config/fine-types`, { method: 'PUT', json: input });
export const createCustomField = (input: {
  formType: string;
  label: string;
  labelTa?: string | null;
  fieldType: string;
  isRequired: boolean;
  sortOrder: number;
}) => apiFetch<{ id: string }>(`${BASE}/config/custom-fields`, { method: 'POST', json: input });
export const patchCustomField = (id: string, patch: Record<string, unknown>) =>
  apiFetch<unknown>(`${BASE}/config/custom-fields/${id}`, { method: 'PATCH', json: patch });
export const deleteCustomField = (id: string) =>
  apiFetch<void>(`${BASE}/config/custom-fields/${id}`, { method: 'DELETE' });

// ── Staff: users ────────────────────────────────────────────────────────────

export const listStaff = () => apiFetch<StaffMember[]>(`${BASE}/staff`);
export const searchPeople = (q: string) =>
  apiFetch<Array<{ personId: string; email: string; displayName: string }>>(
    `${BASE}/staff/search${qs({ q })}`,
  );
export const grantRole = (personRef: string, roleKey: string) =>
  apiFetch<void>(`${BASE}/staff`, { method: 'POST', json: { personRef, roleKey } });
export const revokeRole = (personRef: string, roleKey: string) =>
  apiFetch<void>(`${BASE}/staff/${personRef}/${roleKey}`, { method: 'DELETE' });

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Onboarding & money
// ════════════════════════════════════════════════════════════════════════════

// ── Public: the pages a vendor reaches from a link ──────────────────────────

const P = `${BASE}/public`;

export const getBankForm = (token: string) =>
  apiFetch<BankFormView>(`${P}/bank/${encodeURIComponent(token)}`);

export const submitBankDetails = (token: string, body: SubmitBankDetailsInput) =>
  apiFetch<void>(`${P}/bank/${encodeURIComponent(token)}`, { method: 'POST', json: body });

export const getFssaiForm = (token: string) =>
  apiFetch<FssaiFormView>(`${P}/fssai/${encodeURIComponent(token)}`);

export const submitFssai = (token: string, body: SubmitFssaiInput) =>
  apiFetch<void>(`${P}/fssai/${encodeURIComponent(token)}`, { method: 'POST', json: body });

export const getCoupon = (code: string) =>
  apiFetch<CouponView>(`${P}/staff-registration/${encodeURIComponent(code)}`);

export const registerStaff = (body: RegisterStaffInput) =>
  apiFetch<CouponView>(`${P}/staff-registration`, { method: 'POST', json: body });

/** Presign, then PUT the bytes straight at the store.
 *
 *  The file never passes through the API: a 15 MB certificate uploaded through
 *  a JSON body would be base64 in a request log and a memory spike in the
 *  process. The presigned headers are part of the signature, so they are sent
 *  exactly as given — changing one makes the store reject the PUT, which is
 *  what makes the size and type limits real rather than advisory. */
export async function uploadFile(
  presign: (input: PresignUploadInput) => Promise<PresignUploadResponse>,
  file: File,
  purpose: PresignUploadInput['purpose'],
): Promise<{ key: string; name: string }> {
  const { key, url, headers } = await presign({
    purpose,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    bytes: file.size,
  });
  const res = await fetch(url, { method: 'PUT', headers, body: file });
  if (!res.ok) throw new Error(`Could not upload ${file.name} (${res.status})`);
  return { key, name: file.name };
}

export const presignPublicUpload = (token: string) => (input: PresignUploadInput) =>
  apiFetch<PresignUploadResponse>(`${P}/uploads/${encodeURIComponent(token)}`, {
    method: 'POST',
    json: input,
  });

export const presignStaffUpload = (input: PresignUploadInput) =>
  apiFetch<PresignUploadResponse>(`${BASE}/uploads`, { method: 'POST', json: input });

// ── Staff: communication ────────────────────────────────────────────────────

export interface TemplatesResponse {
  templates: EmailTemplateView[];
  placeholders: Array<{ key: string; description: string }>;
}

export const getTemplates = () => apiFetch<TemplatesResponse>(`${BASE}/comms/templates`);

export const putTemplate = (key: TemplateKeyValue, body: { subject: string; body: string }) =>
  apiFetch<void>(`${BASE}/comms/templates/${key}`, { method: 'PUT', json: body });

export const putTemplateAttachment = (
  key: TemplateKeyValue,
  file: { key: string; name: string; bytes: number } | null,
) => apiFetch<void>(`${BASE}/comms/templates/${key}/attachment`, { method: 'PUT', json: file });

export const listRecipients = () => apiFetch<CommRecipient[]>(`${BASE}/comms/recipients`);

export const sendEmails = (templateKey: TemplateKeyValue, requestIds: string[]) =>
  apiFetch<SendEmailResult>(`${BASE}/comms/send`, {
    method: 'POST',
    json: { templateKey, requestIds },
  });

export const clearSent = (requestId: string, key: TemplateKeyValue) =>
  apiFetch<void>(`${BASE}/comms/sent/${requestId}/${key}`, { method: 'DELETE' });

export const listReminders = (kind: ReminderKind) =>
  apiFetch<ReminderRow[]>(`${BASE}/comms/reminders${qs({ kind })}`);

export const logReminder = (requestId: string, kind: ReminderKind, note?: string) =>
  apiFetch<void>(`${BASE}/requests/${requestId}/reminders`, {
    method: 'POST',
    json: { kind, note },
  });

// ── Staff: onboarding ───────────────────────────────────────────────────────

export const listOnboarding = () => apiFetch<OnboardingRow[]>(`${BASE}/onboarding`);
export const getOnboarding = (id: string) => apiFetch<OnboardingDetail>(`${BASE}/onboarding/${id}`);
export const issueCoupon = (id: string) =>
  apiFetch<{ code: string }>(`${BASE}/onboarding/${id}/coupon`, { method: 'POST' });
export const verifyFssai = (id: string, verified: boolean) =>
  apiFetch<void>(`${BASE}/onboarding/${id}/fssai/verify`, {
    method: 'POST',
    json: { verified },
  });
export const listVendorStaff = (id: string) =>
  apiFetch<VendorStaffView[]>(`${BASE}/onboarding/${id}/staff`);
export const removeVendorStaff = (id: string) =>
  apiFetch<void>(`${BASE}/staff-registrations/${id}`, { method: 'DELETE' });

// ── Staff: finance ──────────────────────────────────────────────────────────

export const listPayments = () => apiFetch<PaymentRow[]>(`${BASE}/finance/payments`);
export const confirmPayment = (requestId: string, body: ConfirmPaymentInput) =>
  apiFetch<void>(`${BASE}/finance/payments/${requestId}`, { method: 'POST', json: body });
export const deletePaymentRecord = (recordId: string) =>
  apiFetch<void>(`${BASE}/finance/payments/${recordId}`, { method: 'DELETE' });

export const listRefunds = () => apiFetch<RefundRow[]>(`${BASE}/finance/refunds`);
export const submitRefund = (requestId: string, body: SubmitRefundInput) =>
  apiFetch<RefundRow>(`${BASE}/finance/refunds/${requestId}`, { method: 'POST', json: body });
export const setVoucherRef = (requestId: string, voucherRef: string) =>
  apiFetch<void>(`${BASE}/finance/refunds/${requestId}/voucher`, {
    method: 'PUT',
    json: { voucherRef },
  });

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3 — Event operations
// ════════════════════════════════════════════════════════════════════════════

export const getElectrical = (zoneCode?: string) =>
  apiFetch<ElectricalSheet>(`${BASE}/electrical${qs({ zoneCode })}`);

export const listCheckIns = (q?: string) => apiFetch<CheckInRow[]>(`${BASE}/checkin${qs({ q })}`);
export const checkIn = (id: string, note?: string) =>
  apiFetch<CheckInRow>(`${BASE}/checkin/${id}`, { method: 'POST', json: { note } });
export const undoCheckIn = (id: string) =>
  apiFetch<CheckInRow>(`${BASE}/checkin/${id}`, { method: 'DELETE' });

export const listEquipment = () => apiFetch<EquipmentRow[]>(`${BASE}/equipment`);
export const patchEquipment = (id: string, patch: EquipmentPatch) =>
  apiFetch<EquipmentRow>(`${BASE}/equipment/${id}`, { method: 'PATCH', json: patch });
export const equipmentAction = (id: string, action: EquipmentAction) =>
  apiFetch<EquipmentRow>(`${BASE}/equipment/${id}/action`, { method: 'POST', json: { action } });
export const getChallan = (id: string) => apiFetch<ChallanView>(`${BASE}/equipment/${id}/challan`);
