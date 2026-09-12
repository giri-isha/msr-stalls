import type {
  ApplyPlanResult,
  AvailableStall,
  ChargesInput,
  DashboardCounts,
  ListRequestsQuery,
  MeResponse,
  PublicConfig,
  PublicStatusResponse,
  RequestDetail,
  RequestPage,
  StaffMember,
  StallRole,
  SubmitRequestInput,
  SubmitRequestResponse,
  ZonePlanInput,
  ZonePlanView,
} from '@msr/stalls';
import { apiFetch } from '../../lib/api-client';

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

export const getPublicConfig = () => apiFetch<PublicConfig>(`${BASE}/public/config`);

export const submitRequest = (body: SubmitRequestInput) =>
  apiFetch<SubmitRequestResponse>(`${BASE}/public/requests`, { method: 'POST', json: body });

export const getStatus = (token: string) =>
  apiFetch<PublicStatusResponse>(`${BASE}/public/status/${encodeURIComponent(token)}`);

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
export const putRateCard = (
  entries: Array<{ zoneGroup: 'AB' | 'C' | 'CLOSED'; isFood: boolean; amountPaise: number }>,
) => apiFetch<unknown>(`${BASE}/config/rate-card`, { method: 'PUT', json: { entries } });
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
