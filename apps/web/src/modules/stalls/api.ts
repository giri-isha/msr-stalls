import type {
  OnboardingStep,
  StallRequestType,
  ApplyPlanResult,
  AuditEventView,
  FileBankInput,
  FileClaimInput,
  FileFssaiInput,
  FileRequestInput,
  FileRequestResponse,
  FileStaffInput,
  RequesterLookupResponse,
  AuditPage,
  ListAuditQuery,
  AvailableStall,
  AddFormFieldInput,
  AddSectionInput,
  BankFormView,
  DeclarationInput,
  FormDefinitionPatch,
  FormFieldPatch,
  ListFormsResponse,
  DeclarationPatch,
  DeclarationRow,
  ListDeclarationsResponse,
  ChallanView,
  ContinueStepInput,
  ContinueStepResponse,
  ChargesInput,
  CopyEditionInput,
  CopyPlan,
  CopyResult,
  CheckInRow,
  CommRecipient,
  ConfirmPaymentInput,
  CouponSummary,
  CouponView,
  DashboardCounts,
  ElectricalSheet,
  EmailTemplateView,
  EquipmentAction,
  EquipmentPatch,
  EquipmentRow,
  FssaiFormView,
  ListRequestsQuery,
  ListUsersQuery,
  ListUsersResponse,
  LoginInput,
  MeResponse,
  OnboardingDetail,
  OnboardingRow,
  PatchRequestInput,
  PaymentRow,
  PresignUploadInput,
  PresignUploadResponse,
  PublicConfig,
  PublicStatusResponse,
  ZoneView,
  PlanCategoryView,
  RateCardEntry,
  RateScope,
  SignatureView,
  RequestAccessLinkResponse,
  RequestCouponInput,
  RequestCouponResponse,
  RefundRow,
  RegisterInput,
  RegisterStaffInput,
  ReminderKind,
  ReminderRow,
  RequestDetail,
  RequestPage,
  RequesterSession,
  SendEmailResult,
  SetDiscretionaryFeeInput,
  BackofficeMember,
  CreateRoleInput,
  ListPrivilegesResponse,
  ListRolesResponse,
  RoleDetail,
  SaveRoleInput,
  SubmitBankDetailsInput,
  SubmitFssaiInput,
  SubmitRefundInput,
  SubmitRequestInput,
  SubmitRequestResponse,
  TemplateKeyValue,
  UpdateAccountInput,
  UpdatePersonInput,
  PersonMatch,
  StagedPersonInput,
  VendorStaffView,
  ZonePlanInput,
  ZonePlanView,
  PaymentClaimView,
  PaymentClaimsResponse,
  ReviewPaymentClaimInput,
  SubmitPaymentClaimInput,
  VoidPaymentInput,
} from '@stalls/core';
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

/** Issues the staff coupon, or returns the one already issued. Idempotent — see
 *  `couponFor` on the API side for why that matters. */
export const requestCoupon = (token: string, body: RequestCouponInput) =>
  apiFetch<RequestCouponResponse>(`${BASE}/public/status/${encodeURIComponent(token)}/coupon`, {
    method: 'POST',
    json: body,
  });

/** The same two calls, for a requester who is logged in rather than following a
 *  link. No token in either URL — the session cookie is the credential, and the
 *  API reads the account off it.
 *
 *  ⚠️ These survive the swap to the host's Isha OIDC. The six password calls
 *  below do not. */
export const getMyRequests = () => apiFetch<PublicStatusResponse>(`${BASE}/public/requests`);

export const continueMyStep = (body: ContinueStepInput) =>
  apiFetch<ContinueStepResponse>(`${BASE}/public/requests/continue`, {
    method: 'POST',
    json: body,
  });

export const requestMyCoupon = (body: RequestCouponInput) =>
  apiFetch<RequestCouponResponse>(`${BASE}/public/requests/coupon`, {
    method: 'POST',
    json: body,
  });

// ── Backoffice: me, dashboard ────────────────────────────────────────────────────

export const getMe = () => apiFetch<MeResponse>(`${BASE}/me`);
/** The live roles, each marked with whether THIS caller may hand it out.
 *  Served rather than imported: a role an admin creates is on no list the
 *  bundle ships. */
export const listRoles = () => apiFetch<ListRolesResponse>(`${BASE}/roles`);

// ── Backoffice: authoring roles ──────────────────────────────────────────────────
//
// Composition, not vocabulary. The privileges themselves are code and arrive
// with the bundle (`PRIVILEGE_CATEGORIES`); which of them a role bundles is
// data, and these are how it is edited.

export const getRole = (roleKey: string) => apiFetch<RoleDetail>(`${BASE}/roles/${roleKey}`);

/** The privilege catalogue — the vocabulary, with what each code means.
 *
 *  ⚠️ Fetched rather than read off `PRIVILEGE_CATEGORIES`, which ships in this
 *  bundle. The bundle is the right source for what a privilege MEANS and the
 *  wrong one for which are live: a privilege is retired by clearing `isActive`
 *  on the row, and a compiled-in list cannot know it happened. There is no
 *  sibling that writes — see `privileges.ts` on the API. */
export const listPrivileges = () => apiFetch<ListPrivilegesResponse>(`${BASE}/privileges`);

export const createRole = (body: CreateRoleInput) =>
  apiFetch<RoleDetail>(`${BASE}/roles`, { method: 'POST', json: body });

export const saveRole = (roleKey: string, body: SaveRoleInput) =>
  apiFetch<RoleDetail>(`${BASE}/roles/${roleKey}`, { method: 'PUT', json: body });

export const deleteRole = (roleKey: string) =>
  apiFetch<void>(`${BASE}/roles/${roleKey}`, { method: 'DELETE' });
export const getDashboard = () => apiFetch<DashboardCounts>(`${BASE}/dashboard`);

// ── Backoffice: requests ─────────────────────────────────────────────────────────

export const listRequests = (q: Partial<ListRequestsQuery> = {}) =>
  apiFetch<RequestPage>(
    `${BASE}/requests${qs(q as Record<string, string | number | boolean | undefined>)}`,
  );

export const getRequest = (id: string) => apiFetch<RequestDetail>(`${BASE}/requests/${id}`);

/** Correcting an application — what the requester told the team over the phone,
 *  and the bay they settled on. Status, money and stall numbers are not here:
 *  each has its own route and its own guard. */
export const patchRequest = (id: string, input: PatchRequestInput) =>
  apiFetch<RequestDetail>(`${BASE}/requests/${id}`, { method: 'PATCH', json: input });

export const flagRequest = (id: string, reason: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/flag`, { method: 'POST', json: { reason } });
export const unflagRequest = (id: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/flag`, { method: 'DELETE' });

// ── Backoffice: selection ────────────────────────────────────────────────────────

const post = (id: string, action: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/${action}`, { method: 'POST' });
export const shortlist = (id: string) => post(id, 'shortlist');
export const unshortlist = (id: string) => post(id, 'unshortlist');
export const backup = (id: string) => post(id, 'backup');
export const cancel = (id: string) => post(id, 'cancel');
export const reject = (id: string, reason: string) =>
  apiFetch<void>(`${BASE}/requests/${id}/reject`, { method: 'POST', json: { reason } });
/** ⚠️ `agreedZoneCode` is not optional decoration. The bay is settled at
 *  selection and the stall number days later, and the bay is what the rent is
 *  read from — a selection that moves a vendor without it quotes the bay they
 *  asked for. */
export const select = (id: string, stallNumbers: string[], agreedZoneCode?: string) =>
  apiFetch<{ allocated: string[] }>(`${BASE}/requests/${id}/select`, {
    method: 'POST',
    json: { stallNumbers, ...(agreedZoneCode ? { agreedZoneCode } : {}) },
  });
export const releaseAllocation = (allocationId: string) =>
  apiFetch<void>(`${BASE}/allocations/${allocationId}`, { method: 'DELETE' });
/** Correct a stall number already given out. One call rather than a release
 *  and a fresh select, so nobody can take the stall in between. */
export const moveAllocation = (allocationId: string, stallNumber: string) =>
  apiFetch<{ stallNumber: string }>(`${BASE}/allocations/${allocationId}`, {
    method: 'PATCH',
    json: { stallNumber },
  });
export const availableStalls = (zoneCode?: string) =>
  apiFetch<AvailableStall[]>(`${BASE}/stalls/available${qs({ zoneCode })}`);

// ── Backoffice: planning ─────────────────────────────────────────────────────────

export const getPlan = () => apiFetch<ZonePlanView>(`${BASE}/planning`);
export const putPlan = (input: ZonePlanInput) =>
  apiFetch<ZonePlanView>(`${BASE}/planning`, { method: 'PUT', json: input });
export const applyPlan = () =>
  apiFetch<ApplyPlanResult>(`${BASE}/planning/apply`, { method: 'POST' });

// ── Backoffice: config ───────────────────────────────────────────────────────────

export interface BackofficeConfig {
  edition: {
    id: string;
    year: number;
    name: string;
    isActive: boolean;
    /** Finance issues these per edition; null until they have. A request with no
     *  prefix quotes no account to pay into. */
    virtualAccountRentPrefix: string | null;
    virtualAccountDepositPrefix: string | null;
    maxStallsPerRequest: number;
    termsUrl: string | null;
  };
  zones: Array<ZoneView & { id: string }>;
  /** The planning grid's columns, each saying whether anything already stands
   *  on it — a column in use cannot be dropped. */
  planCategories: PlanCategoryView[];
  /** One row per bay x food/non-food x scope, each carrying its own refundable
   *  advance. Not a band: the rent genuinely differs bay by bay, and banding
   *  them meant two bays that happened to share a letter could never be priced
   *  apart. */
  rateCard: RateCardEntry[];
  charges: ChargesInput & { id: string; editionId: string };
  /** `asked` says WHETHER each step happens, per requester type; `stages` says
   *  WHEN. The lowest stage still outstanding is the one the requester may act
   *  on. Everything asked and all four at 1 — the default — switches nothing
   *  off and locks nothing.
   *
   *  ⚠️ The three booleans are DERIVED ("asked of any type") and are what this
   *  panel used to read. They are still sent so a page served ahead of the API
   *  renders, and are still accepted on a PUT that carries no `asked`. Nothing
   *  here reads them. */
  flow: {
    asked?: Record<StallRequestType, Record<OnboardingStep, boolean>>;
    bankStepEnabled: boolean;
    paymentStepEnabled: boolean;
    fssaiStepEnabled: boolean;
    stages: Record<StallRequestType, Record<OnboardingStep, number>>;
  };
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

/** ⚠️ `editionId` is a READ of another edition — the Admin selector, so a past
 *  year can be compared against this one. Every write below still goes to the
 *  active edition and takes no edition at all. */
export const getConfig = (editionId?: string) =>
  apiFetch<BackofficeConfig>(`${BASE}/config${editionQuery(editionId)}`);

const editionQuery = (editionId?: string) =>
  editionId ? `?editionId=${encodeURIComponent(editionId)}` : '';

/** The edition's bays alone. Behind `requests:read`, so every screen that
 *  filters by bay can read the edition's own list rather than carrying a copy
 *  that goes stale the year the venue is redrawn. */
export const listZones = () => apiFetch<Array<ZoneView & { id: string }>>(`${BASE}/zones`);
/** Every edition with its own settings, newest year first.
 *
 *  ⚠️ Carries the settings and not just the name, because the Editions table
 *  edits a row in place through a dialog. Reading them back per row would be a
 *  request per pencil for figures the list already had. */
export const listEditions = () =>
  apiFetch<Array<{ id: string; year: number; name: string; isActive: boolean } & EditionSettings>>(
    `${BASE}/editions`,
  );
export const createEdition = (input: { year: number; name: string; activate: boolean }) =>
  apiFetch<{ id: string }>(`${BASE}/editions`, { method: 'POST', json: input });
/** What copying this section from that edition would do. Writes nothing. */
export const previewCopy = (input: CopyEditionInput) =>
  apiFetch<CopyPlan>(`${BASE}/config/copy/preview`, { method: 'POST', json: input });
/** Does it, into the ACTIVE edition — which is why no target is sent. */
export const copyFromEdition = (input: CopyEditionInput) =>
  apiFetch<CopyResult>(`${BASE}/config/copy`, { method: 'POST', json: input });
export const activateEdition = (id: string) =>
  apiFetch<void>(`${BASE}/editions/${id}/activate`, { method: 'POST' });
export const updateZone = (
  code: string,
  input: { name: string; expectedCrowd: number; isClosedToVendors: boolean },
) => apiFetch<unknown>(`${BASE}/config/zones/${code}`, { method: 'PUT', json: input });
/** The venue is redrawn every year, so adding a bay is configuration rather
 *  than a migration. */
export const createZone = (input: {
  code: string;
  name: string;
  expectedCrowd: number;
  isClosedToVendors: boolean;
}) => apiFetch<unknown>(`${BASE}/config/zones`, { method: 'POST', json: input });
/** 409 while the bay holds stalls — the caller shows that, it does not force. */
export const deleteZone = (code: string) =>
  apiFetch<void>(`${BASE}/config/zones/${code}`, { method: 'DELETE' });
/** The planning grid's columns, sent whole. A column left out is dropped, and
 *  one that is planned or allocated against refuses with a 409. */
export const putPlanCategories = (
  categories: Array<{ key: string; name: string; isFood: boolean; sortOrder: number }>,
) => apiFetch<unknown>(`${BASE}/config/plan-categories`, { method: 'PUT', json: { categories } });
export type EditionSettings = {
  name: string;
  virtualAccountRentPrefix: string | null;
  virtualAccountDepositPrefix: string | null;
  maxStallsPerRequest: number;
  /** Where this edition's terms can be read, linked beside the acceptance
   *  tick-box on the bank form. Null until the legal team issues one. */
  termsUrl: string | null;
  /** Who the money goes to. Rendered by the payment letter AND by the vendor's
   *  own payment page, which is why it is configuration and not prose in the
   *  template — two copies of a bank identity is one bank change away from a
   *  letter and a page naming different beneficiaries. Null until Finance has
   *  confirmed the edition's account. */
  beneficiaryName: string | null;
  beneficiaryAddress: string | null;
  bankAccountType: string | null;
  bankName: string | null;
  bankIfsc: string | null;
  bankBranch: string | null;
};
export const updateEditionSettings = (id: string, input: EditionSettings) =>
  apiFetch<unknown>(`${BASE}/editions/${id}/settings`, { method: 'PATCH', json: input });
export const putRateCard = (entries: RateCardEntry[]) =>
  apiFetch<unknown>(`${BASE}/config/rate-card`, { method: 'PUT', json: { entries } });
export const putCharges = (input: ChargesInput) =>
  apiFetch<unknown>(`${BASE}/config/charges`, { method: 'PUT', json: input });
export const putFlow = (input: BackofficeConfig['flow']) =>
  apiFetch<unknown>(`${BASE}/config/flow`, { method: 'PUT', json: input });
export const putFineType = (input: {
  reason: string;
  defaultAmountPaise: number;
  isActive: boolean;
}) => apiFetch<unknown>(`${BASE}/config/fine-types`, { method: 'PUT', json: input });

// ── Backoffice: the form builder ────────────────────────────────────────────

export const listForms = (editionId?: string) =>
  apiFetch<ListFormsResponse>(`${BASE}/config/forms${editionQuery(editionId)}`);
export const patchForm = (formType: string, patch: FormDefinitionPatch) =>
  apiFetch<void>(`${BASE}/config/forms/${formType}`, { method: 'PATCH', json: patch });
export const addFormField = (definitionId: string, input: AddFormFieldInput) =>
  apiFetch<{ id: string }>(`${BASE}/config/forms/${definitionId}/fields`, {
    method: 'POST',
    json: input,
  });
export const patchFormField = (id: string, patch: FormFieldPatch) =>
  apiFetch<void>(`${BASE}/config/form-fields/${id}`, { method: 'PATCH', json: patch });
/** ⚠️ 409 once the question has been answered, and 409 on a built-in whatever
 *  it has been answered. The caller shows that; it does not force. */
export const deleteFormField = (id: string) =>
  apiFetch<void>(`${BASE}/config/form-fields/${id}`, { method: 'DELETE' });
/** ⚠️ The whole order, not one moved field — see `reorderFormFields`. */
export const reorderFormFields = (
  definitionId: string,
  fields: Array<{ id: string; sectionId: string | null }>,
) =>
  apiFetch<void>(`${BASE}/config/forms/${definitionId}/order`, {
    method: 'PUT',
    json: { fields },
  });
export const addFormSection = (definitionId: string, input: AddSectionInput) =>
  apiFetch<{ id: string }>(`${BASE}/config/forms/${definitionId}/sections`, {
    method: 'POST',
    json: input,
  });
export const deleteFormSection = (id: string) =>
  apiFetch<void>(`${BASE}/config/sections/${id}`, { method: 'DELETE' });

// ── Backoffice: declarations ────────────────────────────────────────────────

export const listDeclarations = (editionId?: string) =>
  apiFetch<ListDeclarationsResponse>(`${BASE}/config/declarations${editionQuery(editionId)}`);
export const createDeclaration = (input: DeclarationInput) =>
  apiFetch<DeclarationRow>(`${BASE}/config/declarations`, { method: 'POST', json: input });
/** ⚠️ Returns whichever version is CURRENT after the save, which is a new row
 *  when the wording changed. The caller reloads rather than patching the one it
 *  sent — see `updateDeclaration` on the API side. */
export const patchDeclaration = (id: string, patch: DeclarationPatch) =>
  apiFetch<DeclarationRow>(`${BASE}/config/declarations/${id}`, { method: 'PATCH', json: patch });

// ── Backoffice: users ────────────────────────────────────────────────────────────

export const listBackoffice = () => apiFetch<BackofficeMember[]>(`${BASE}/backoffice`);
export const searchPeople = (q: string) =>
  apiFetch<PersonMatch[]>(`${BASE}/backoffice/search${qs({ q })}`);

/** A role handed to somebody already in the directory, or to somebody this call
 *  adds to it.
 *
 *  ⚠️ **One call, not two.** Staging and granting travel together because the
 *  server does them in one transaction — a person added for a grant that was
 *  then refused would be a human in the directory with nothing to do there. */
export const grantRole = (
  who: { personRef: string } | { newPerson: StagedPersonInput },
  roleKey: string,
  scope: { editionScope?: string[]; zoneScope?: string[] } = {},
) => apiFetch<void>(`${BASE}/backoffice`, { method: 'POST', json: { ...who, roleKey, ...scope } });
export const revokeRole = (personRef: string, roleKey: string) =>
  apiFetch<void>(`${BASE}/backoffice/${personRef}/${roleKey}`, { method: 'DELETE' });

/** A backoffice member's own details, corrected in the Foundation directory.
 *
 *  ⚠️ The sibling of `updateAccount` and deliberately a different route: that
 *  one edits a `StallAccount` and this one a `Person`. Which to call is decided
 *  by the row's `kind`, never by trying one and falling back to the other. */
export const updatePerson = (personRef: string, body: UpdatePersonInput) =>
  apiFetch<void>(`${BASE}/backoffice/${personRef}`, { method: 'PATCH', json: body });

/** A requester's own details, corrected from the directory. Requesters only —
 *  a backoffice member's name and address belong to the Foundation. */
export const updateAccount = (id: string, body: UpdateAccountInput) =>
  apiFetch<void>(`${BASE}/users/${id}`, { method: 'PATCH', json: body });

/** The directory: backoffice and requesters in one list, with the tile counts. */
export const listUsers = (q: Partial<ListUsersQuery> = {}) =>
  apiFetch<ListUsersResponse>(`${BASE}/users${qs(q)}`);

/** The two support actions. Each answers 204 and acts on the contact the
 *  account already holds — neither returns a link to the caller. The third,
 *  below, is the one that does not follow that rule. */
export const unlockAccount = (accountId: string) =>
  apiFetch<void>(`${BASE}/users/${accountId}/unlock`, { method: 'POST' });
export const sendAccessLinkTo = (accountId: string) =>
  apiFetch<void>(`${BASE}/users/${accountId}/access-link`, { method: 'POST' });

/** A password chosen for a requester at a desk and read out to them.
 *
 *  🔴 The one account action that hands over a way in rather than causing one
 *  to be sent, which is why it holds `passwords.write` and not `users.write`.
 *
 *  ⚠️ TEMPORARY, with the whole requester password login — it goes when the
 *  host signs requesters in through Isha SSO. */
export const setRequesterPassword = (accountId: string, password: string) =>
  apiFetch<void>(`${BASE}/users/${accountId}/password`, { method: 'POST', json: { password } });

// ── Backoffice: the audit log ───────────────────────────────────────────────
//
// Every filter is applied by the SERVER. The log is the one list in the module
// expected to run to tens of thousands of rows, so nothing here narrows a list
// already held.

/** The edition's log, filtered and paged. `audit.read`. */
export const listAudit = (q: Partial<ListAuditQuery> = {}) =>
  apiFetch<AuditPage>(
    `${BASE}/audit${qs(q as Record<string, string | number | boolean | undefined>)}`,
  );

/** One request's timeline, newest first. `audit.read`, plus the request's scope. */
export const getRequestAudit = (id: string) =>
  apiFetch<AuditEventView[]>(`${BASE}/requests/${id}/audit`);

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — Onboarding & money
// ════════════════════════════════════════════════════════════════════════════

// ── Public: the pages a vendor reaches from a link ──────────────────────────

const P = `${BASE}/public`;

/* ── The requester login ────────────────────────────────────────────────────
 *
 * ⚠️ TEMPORARY, until the host's Isha OIDC. `getRequesterSession` is the only
 * one of these the rest of the web module touches; when SSO lands the other
 * five go and that one stays.
 */

export const registerRequester = (body: RegisterInput) =>
  apiFetch<{ ok: true }>(`${P}/register`, { method: 'POST', json: body });

export const loginRequester = (body: LoginInput) =>
  apiFetch<{ ok: true }>(`${P}/login`, { method: 'POST', json: body });

export const logoutRequester = () =>
  apiFetch<{ ok: true }>(`${P}/logout`, { method: 'POST', json: {} });

/** ⚠️ Rejects with a 404 `ApiError` when nobody is logged in — that is the
 *  normal case on a public page, not a fault. `RequesterProvider` treats it as
 *  "signed out" and renders. */
export const getRequesterSession = () => apiFetch<RequesterSession>(`${P}/session`);

export const requestPasswordReset = (contact: string) =>
  apiFetch<{ ok: true }>(`${P}/password-reset`, { method: 'POST', json: { contact } });

export const completePasswordReset = (token: string, password: string) =>
  apiFetch<{ ok: true }>(`${P}/password-reset/confirm`, {
    method: 'POST',
    json: { token, password },
  });

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
  /** ⚠️ Required for `FORM_FIELD`, which is the purpose every admin-added file
   *  question uses. It becomes part of the key's path, so a key minted here is
   *  only ever valid as the answer to THIS question. */
  fieldId?: string,
): Promise<{ key: string; name: string }> {
  const { key, url, headers } = await presign({
    purpose,
    fieldId,
    fileName: file.name,
    contentType: file.type || 'application/octet-stream',
    bytes: file.size,
  });
  const res = await fetch(url, { method: 'PUT', headers, body: file });
  if (!res.ok) throw new Error(`Could not upload ${file.name} (${res.status})`);
  return { key, name: file.name };
}

/** What a requester says they transferred. The SESSION is the credential; the
 *  reference in the body only picks which of their requests it is about. */
export const submitPaymentClaim = (input: SubmitPaymentClaimInput) =>
  apiFetch<PaymentClaimView>(`${P}/requests/payment-claim`, { method: 'POST', json: input });

// ── Backoffice: payment claims ──────────────────────────────────────────────

export const getPaymentClaims = () => apiFetch<PaymentClaimsResponse>(`${BASE}/finance/claims`);

export const reviewPaymentClaim = (id: string, input: ReviewPaymentClaimInput) =>
  apiFetch<void>(`${BASE}/finance/claims/${id}`, { method: 'POST', json: input });

export const presignPublicUpload = (token: string) => (input: PresignUploadInput) =>
  apiFetch<PresignUploadResponse>(`${P}/uploads/${encodeURIComponent(token)}`, {
    method: 'POST',
    json: input,
  });

export const presignBackofficeUpload = (input: PresignUploadInput) =>
  apiFetch<PresignUploadResponse>(`${BASE}/uploads`, { method: 'POST', json: input });

/** Where a display block's picture is drawn from.
 *
 *  ⚠️ A URL, not a fetch. The browser asks for it as an `<img src>` and the API
 *  redirects to a short-lived signed URL — pulling the bytes through `apiFetch`
 *  would put a phone-sized photograph in memory on every form render, and the
 *  key is not secret: the route serves the display-block folder and nothing
 *  else. */
export const formImageUrl = (mediaKey: string) =>
  `${P}/form-image?key=${encodeURIComponent(mediaKey)}`;

// ── Backoffice: communication ────────────────────────────────────────────────────

export interface TemplatesResponse {
  templates: EmailTemplateView[];
  placeholders: Array<{ key: string; description: string }>;
}

export const getTemplates = () => apiFetch<TemplatesResponse>(`${BASE}/comms/templates`);

export const putTemplate = (
  key: TemplateKeyValue,
  body: { subject: string; body: string; whatsappBody: string },
) => apiFetch<void>(`${BASE}/comms/templates/${key}`, { method: 'PUT', json: body });

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

// ── Backoffice: onboarding ───────────────────────────────────────────────────────

export const listOnboarding = () => apiFetch<OnboardingRow[]>(`${BASE}/onboarding`);
export const getOnboarding = (id: string) => apiFetch<OnboardingDetail>(`${BASE}/onboarding/${id}`);
/** Issues a staff coupon — the first, or ANOTHER one beside it. Always mints:
 *  a stall may hold several live codes so a caterer can be handed their own,
 *  counted apart from the vendor's own team. */
export const issueCoupon = (id: string) =>
  apiFetch<CouponSummary>(`${BASE}/onboarding/${id}/coupon`, { method: 'POST' });
/** Eight by default, raised case by case. Takes effect on the coupon the vendor
 *  already holds, so nobody has to be sent a new code. */
export const setCouponCapacity = (id: string, couponId: string, capacity: number) =>
  apiFetch<CouponSummary>(`${BASE}/onboarding/${id}/coupons/${couponId}/capacity`, {
    method: 'PUT',
    json: { capacity },
  });
export const verifyFssai = (id: string, verified: boolean) =>
  apiFetch<void>(`${BASE}/onboarding/${id}/fssai/verify`, {
    method: 'POST',
    json: { verified },
  });
export const listVendorStaff = (id: string) =>
  apiFetch<VendorStaffView[]>(`${BASE}/onboarding/${id}/backoffice`);
export const removeVendorStaff = (id: string) =>
  apiFetch<void>(`${BASE}/staff-registrations/${id}`, { method: 'DELETE' });

// ── Backoffice: the contract signature ───────────────────────────────────────────

export const getSignature = (id: string) =>
  apiFetch<SignatureView>(`${BASE}/requests/${id}/signature`);
/** Idempotent: re-sending returns the agreement already open rather than
 *  opening a second one against the same stall. */
export const sendForSignature = (id: string) =>
  apiFetch<SignatureView>(`${BASE}/requests/${id}/signature`, { method: 'POST' });
/** Signing happens later and elsewhere, so the state has to be pulled. */
export const refreshSignature = (id: string) =>
  apiFetch<SignatureView>(`${BASE}/requests/${id}/signature/refresh`, { method: 'POST' });

// ── Backoffice: finance ──────────────────────────────────────────────────────────

export const listPayments = () => apiFetch<PaymentRow[]>(`${BASE}/finance/payments`);
export const confirmPayment = (requestId: string, body: ConfirmPaymentInput) =>
  apiFetch<void>(`${BASE}/finance/payments/${requestId}`, { method: 'POST', json: body });
/** Withdraw a credit entered in error.
 *
 *  🔴 There is no delete. The row is kept and marked so the trail survives —
 *  "recorded on the 14th, withdrawn on the 16th" is the answer to the vendor
 *  asking why their payment vanished. The reason is required. */
export const voidPaymentRecord = (recordId: string, body: VoidPaymentInput) =>
  apiFetch<void>(`${BASE}/finance/payments/${recordId}/void`, { method: 'POST', json: body });

/** The concession the local welfare team agreed on one stall. Recorded beside
 *  the quote, never on top of it — what the requester was told and what they
 *  owe are two figures. `null` clears it. */
export const setDiscretionaryFee = (requestId: string, body: SetDiscretionaryFeeInput) =>
  apiFetch<void>(`${BASE}/finance/payments/${requestId}/discretionary-fee`, {
    method: 'PUT',
    json: body,
  });

export const listRefunds = () => apiFetch<RefundRow[]>(`${BASE}/finance/refunds`);
export const submitRefund = (requestId: string, body: SubmitRefundInput) =>
  apiFetch<RefundRow>(`${BASE}/finance/refunds/${requestId}`, { method: 'POST', json: body });
export const setVoucherRef = (requestId: string, voucherRef: string) =>
  apiFetch<void>(`${BASE}/finance/refunds/${requestId}/voucher`, {
    method: 'PUT',
    json: { voucherRef },
  });

// ── Backoffice: filing on behalf of a requester ─────────────────────────────
//
// The same five writes the requester has, from the backoffice. Each answers
// with what the requester's own call answers, minus anything that is a way in:
// `fileRequest` returns a reference and never a token.

/** Resolves a contact to an account, for the requester step. `filing.request`. */
export const lookupRequester = (contact: string) =>
  apiFetch<RequesterLookupResponse>(`${BASE}/requests/file/lookup${qs({ contact })}`);

export const fileRequest = (body: FileRequestInput) =>
  apiFetch<FileRequestResponse>(`${BASE}/requests/file`, { method: 'POST', json: body });

export const getBankFormFor = (id: string) =>
  apiFetch<BankFormView>(`${BASE}/requests/${id}/bank-form`);
export const fileBank = (id: string, body: FileBankInput) =>
  apiFetch<void>(`${BASE}/requests/${id}/bank`, { method: 'POST', json: body });

export const getFssaiFormFor = (id: string) =>
  apiFetch<FssaiFormView>(`${BASE}/requests/${id}/fssai-form`);
export const fileFssai = (id: string, body: FileFssaiInput) =>
  apiFetch<void>(`${BASE}/requests/${id}/fssai`, { method: 'POST', json: body });

/** The stall's own coupon, found or issued, with the staff form beside it. */
export const getStaffFormFor = (id: string) =>
  apiFetch<CouponView & { couponCode: string }>(`${BASE}/requests/${id}/staff-form`);
export const fileStaff = (id: string, body: FileStaffInput) =>
  apiFetch<CouponView>(`${BASE}/requests/${id}/staff`, { method: 'POST', json: body });

export const fileClaim = (id: string, body: FileClaimInput) =>
  apiFetch<PaymentClaimView>(`${BASE}/requests/${id}/payment-claim`, {
    method: 'POST',
    json: body,
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
