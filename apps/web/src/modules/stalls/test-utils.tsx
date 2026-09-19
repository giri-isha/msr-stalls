import { SEED_ROLES, STALL_PRIVILEGES } from '@stalls/core';
import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { type RouteObject, RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { MeProvider } from './me';
import { RequesterProvider } from './requester';
import { ToastProvider } from './ui';

/**
 * Choose `value` from one of the module's dropdowns.
 *
 * ⚠️ This replaces `userEvent.selectOptions`, which drives a native `<select>`
 * and nothing else. The module draws its own list — see `ui/components/Select.tsx`
 * for why — so choosing is what a person actually does: press the control, then
 * press the row. The row is found by the VALUE it carries rather than by its
 * label, so a test still says `'SHORTLISTED'` and not "Shortlisted".
 */
export async function choose(
  user: { click: (el: Element) => Promise<unknown> },
  control: HTMLElement,
  value: string,
) {
  // Tolerates a list a test opened for itself — to read the options it offers,
  // say — so asserting on the panel does not close it under the next line.
  if (control.getAttribute('aria-expanded') !== 'true') await user.click(control);
  const list = await screen.findByRole('listbox');
  const option = within(list)
    .getAllByRole('option')
    .find((o) => o.getAttribute('data-value') === value);
  if (!option) throw new Error(`no option with value ${JSON.stringify(value)} in this list`);
  await user.click(option);
}

export interface Call {
  method: string;
  url: string;
  body: unknown;
}

type Handler = (url: URL, init: RequestInit, body: unknown) => unknown | [number, unknown];

/** A tiny fetch stub: a list of [method, path regex, handler]. The handler
 *  returns a body (200) or a [status, body] tuple. Every call is recorded so a
 *  test can assert on what the screen sent, not just what it showed. */
export function installFetch(routes: ReadonlyArray<readonly [string, RegExp, Handler]>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'http://test');
      const method = (init.method ?? 'GET').toUpperCase();
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url: url.pathname + url.search, body });
      const hit = routes.find(([m, re]) => m === method && re.test(url.pathname));
      if (!hit)
        return new Response(JSON.stringify({ error: `no stub for ${method} ${url.pathname}` }), {
          status: 404,
        });
      const out = hit[2](url, init, body);
      const [status, payload] =
        Array.isArray(out) && typeof out[0] === 'number' ? (out as [number, unknown]) : [200, out];
      if (status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return { calls, last: () => calls[calls.length - 1] };
}

/**
 * Render `routes` inside a memory router positioned at `path`.
 *
 * ⚠️ `ToastProvider` wraps every render, `me` or not, because `useToast()`
 * THROWS outside it — that is the component's contract, and it is the right one:
 * a screen whose confirmations go nowhere should fail at mount rather than
 * swallow them. It is what `BackofficeLayout` mounts in the real shell, so this is
 * the harness matching the app rather than the harness being generous.
 *
 * ⚠️ It is OUTSIDE `MeProvider`, matching the shell for the same reason given
 * there: the gate swaps its whole subtree once the session lands, and a toast
 * host inside it would unmount on that transition and drop what it was holding.
 */
export function renderAt(
  path: string,
  routes: RouteObject[],
  opts: { me?: boolean; requester?: boolean } = {},
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  let inner: ReactElement = <RouterProvider router={router} />;
  // ⚠️ The requester provider is the PUBLIC session and `MeProvider` is the
  // backoffice one. A screen never needs both, and nesting them here would let a
  // test pass while reading the wrong one.
  if (opts.requester) inner = <RequesterProvider>{inner}</RequesterProvider>;
  if (opts.me) inner = <MeProvider>{inner}</MeProvider>;
  return { ...render(<ToastProvider>{inner}</ToastProvider>), router };
}

/** What a shipped role actually holds, so a fixture cannot drift from the seed.
 *
 *  ⚠️ Hand-listed before, and it HAD drifted — `ME_LEAD` was missing
 *  `refunds.write` and `electrical.read`, which the Lead role has granted since
 *  it was written. A fixture that lists privileges is a second opinion about
 *  what a role is, and this suite is the last place that should hold one.
 *
 *  The reads a write implies are deliberately absent: `can` resolves those, and
 *  the fixture stands for what `GET /me` returns, which is the raw union. */
const seeded = (roleKey: string): string[] => [
  ...(SEED_ROLES.find((r) => r.roleKey === roleKey)?.privileges ?? []),
];

export const ME_LEAD = {
  personId: 'p-lead',
  displayName: 'Deepa Ramanathan',
  roleKeys: ['stalls_lead'],
  privileges: seeded('stalls_lead'),
  // `/me` publishes this now — the File a Request page reads it.
  requestTypeScope: null,
  /** ⚠️ EMPTY, deliberately. `/me` also carries the caller's resolved sidebar,
   *  and an empty one is how `MeProvider` is told to fall back to the registry
   *  defaults — which is what the shell shows for a role nobody has arranged,
   *  and therefore what most of these tests want. A test about an ARRANGED
   *  sidebar stubs `/me` with its own groups. */
  nav: [] as never[],
};

export const PUBLIC_CONFIG = {
  edition: { year: 2026, name: 'Stalls 2026' },
  zones: [
    {
      code: 'A3',
      name: 'A3',
      blurb: null,
      isClosedToVendors: true,
      rentFoodPaise: null,
      rentNonFoodPaise: null,
      depositPaise: null,
    },
    {
      code: 'A4',
      name: 'A4',
      blurb: null,
      isClosedToVendors: false,
      rentFoodPaise: 1_800_000,
      rentNonFoodPaise: 1_500_000,
      depositPaise: 400_000,
    },
    {
      code: 'B2',
      name: 'B2',
      blurb: null,
      isClosedToVendors: true,
      rentFoodPaise: null,
      rentNonFoodPaise: null,
      depositPaise: null,
    },
    {
      code: 'B3',
      name: 'B3',
      blurb: null,
      isClosedToVendors: false,
      rentFoodPaise: 1_800_000,
      rentNonFoodPaise: 1_500_000,
      depositPaise: 400_000,
    },
    {
      code: 'B4',
      name: 'B4',
      blurb: null,
      isClosedToVendors: false,
      rentFoodPaise: 1_800_000,
      rentNonFoodPaise: 1_500_000,
      depositPaise: 400_000,
    },
    {
      code: 'C1',
      name: 'C1',
      blurb: null,
      isClosedToVendors: false,
      rentFoodPaise: 1_500_000,
      rentNonFoodPaise: 1_200_000,
      depositPaise: 400_000,
    },
    {
      code: 'C2',
      name: 'C2',
      blurb: null,
      isClosedToVendors: false,
      rentFoodPaise: 1_500_000,
      rentNonFoodPaise: 1_200_000,
      depositPaise: 400_000,
    },
  ],
  // The refundable advance is per bay now, on each zone above — not one figure
  // for the whole venue, which is what the form used to print in its header.
  charges: { gstPercent: 18 },
  maxStallsPerRequest: 3,
  maxOpenRequests: 2,
  requestCapScope: 'OPEN' as const,
  customFields: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      formType: 'VENDOR',
      label: 'Instagram handle',
      labelTa: null,
      fieldType: 'text',
      isRequired: false,
      sortOrder: 0,
    },
  ],
  /** ⚠️ `formType: null` — the DEFAULT wording, which every form shows unless
   *  it has a variant of its own. A fixture that scoped this to VENDOR would
   *  let a screen that ignores the fallback rule pass, and the fallback is what
   *  stops a form showing the same consent twice in different words. */
  declarations: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      key: 'request_submission',
      formType: null,
      version: 1,
      title: 'Stall request',
      body: 'Submission of this form does not guarantee stall allocation. Allocation is at the sole discretion of the Isha Stall Team.',
      bodyTa: null,
      isActive: true,
      isCurrent: true,
    },
  ],
};

/** The same edition, answered at the asking form's scope.
 *
 *  ⚠️ `PUBLIC_CONFIG` above is the VENDOR answer, and A3 and B2 are unpriced in
 *  it because they are closed to trade. At the local welfare scope those two
 *  bays are priced — they carry the VAP traders, who pay the most of any local
 *  welfare stall. A stub that returned one payload for both scopes would let a
 *  screen that ignores the scope pass. */
export function publicConfigFor(scope: string | null) {
  if (scope !== 'LOCAL_WELFARE') return PUBLIC_CONFIG;
  return {
    ...PUBLIC_CONFIG,
    zones: PUBLIC_CONFIG.zones.map((z) =>
      z.isClosedToVendors
        ? { ...z, rentFoodPaise: 1_200_000, rentNonFoodPaise: 1_000_000, depositPaise: 400_000 }
        : z,
    ),
  };
}

/** The edition's bays, as `GET /zones` returns them. Every backoffice screen that
 *  filters or assigns by bay reads this rather than a list of its own. */
export const ZONES = [
  {
    id: 'z-a3',
    code: 'A3',
    name: 'VIP Snake side',
    expectedCrowd: 5000,
    isClosedToVendors: true,
    sortOrder: 1,
    stallCount: 12,
  },
  {
    id: 'z-a4',
    code: 'A4',
    name: 'Snake side',
    expectedCrowd: 20000,
    isClosedToVendors: false,
    sortOrder: 2,
    stallCount: 30,
  },
  {
    id: 'z-c1',
    code: 'C1',
    name: 'Moon side',
    expectedCrowd: 15000,
    isClosedToVendors: false,
    sortOrder: 3,
    stallCount: 24,
  },
];

export function summary(over: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    reference: 'VEN-2026-0001',
    requestType: 'VENDOR',
    stallType: 'FOOD',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    email: 'priya@greenleaf.example',
    contactNumber: '9840012345',
    preferredZoneCode: 'C1',
    /** Null until the team and the requester have settled the bay — which is
     *  what the stall is priced at, and is not always the one asked for. */
    agreedZoneCode: null,
    numStallsRequested: 1,
    status: 'SUBMITTED',
    stage: 'NEW',
    submittedAt: '2026-09-01T10:00:00.000Z',
    flagged: false,
    allocatedStalls: [],
    ...over,
  };
}

export function detail(over: Record<string, unknown> = {}) {
  return {
    ...summary(),
    address: '12 Mettupalayam Road',
    itemsSelling: 'Organic spices, cold-pressed oils, honey',
    remarks: null,
    plugs5a: 0,
    plugs15a: 0,
    gasStoves: 0,
    tablesNeeded: 0,
    chairsNeeded: 0,
    passes2w: 0,
    passes4w: 0,
    passesStaff: 0,
    agreedAt: '2026-09-01T10:00:00.000Z',
    depositAcknowledgedAt: null,
    flagReason: null,
    rejectReason: null,
    ashram: null,
    appliances: [],
    customValues: [],
    allocations: [],
    ...over,
  };
}

/** A caller who holds everything — the Phase 2 and 3 screens each gate on a
 *  different action, and most tests are about the screen rather than the gate. */
export const ME_ADMIN = {
  personId: 'p-admin',
  displayName: 'Vikram Sethu',
  roleKeys: ['stalls_admin'],
  /** ⚠️ Every ACTIVE privilege, because that is what `allPrivileges` resolves
   *  to — including `passwords.write`, which an admin holds not as part of
   *  `users.write` but because the flag expands against the whole live list.
   *  A privilege added in a later release reaches this fixture with no edit,
   *  which is exactly how it reaches a real admin. */
  privileges: [...STALL_PRIVILEGES],
  nav: [] as never[],
  // An admin reaches every requester type, which is what `null` means.
  requestTypeScope: null,
};

/**
 * What the forms call returns for a request — the shape `GET /onboarding/:id`
 * serves and the record page's form tabs read.
 *
 * ⚠️ `bankDetails`/`fssai` are the API's own answer to "does this form apply
 * to this requester", already resolved against the edition's flow config. A
 * test overriding one to `NOT_APPLICABLE` is saying the vendor was never
 * asked, which is what makes the tab disappear rather than go empty.
 */
export function onboarding(over: Record<string, unknown> = {}) {
  return {
    requestId: '22222222-2222-4222-8222-222222222222',
    reference: 'VEN-2026-0001',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    requestType: 'VENDOR',
    stallNumbers: [],
    bankDetails: 'RECEIVED',
    gst: 'RECEIVED',
    payment: 'PENDING',
    fssai: 'PENDING',
    staffRegistered: 0,
    staffExpected: 8,
    coupons: [{ id: 'c-1', code: 'GRE-2026-ABCD', capacity: 8, registered: 0 }],
    stage: 'BANK_FORM_FILLED',
    pending: [],
    bank: {
      invoiceName: 'Green Leaf Organics Pvt Ltd',
      accountHolder: 'Green Leaf Organics Pvt Ltd',
      bankName: 'HDFC Bank',
      branch: 'RS Puram',
      accountNumber: '50100123456789',
      ifsc: 'HDFC0001234',
      micr: null,
      panNumber: 'ABCDE1234F',
      gstNumber: '33ABCDE1234F1Z5',
      address: '12 Mettupalayam Road',
      pincode: '641043',
      mobile: '9840012345',
      submittedAt: '2026-09-05T10:00:00.000Z',
      files: [],
    },
    staff: [],
    fssaiFiles: [],
    quote: null,
    ...over,
  };
}

export function recipient(over: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    reference: 'VEN-2026-0001',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    email: 'priya@greenleaf.example',
    requestType: 'VENDOR',
    stallNumbers: ['C1-4'],
    suggestedTemplate: 'SELECTION_VENDOR',
    sentAt: null,
    sentTemplates: [] as Array<{ key: string; sentAt: string }>,
    ...over,
  };
}

export function checkInRow(over: Record<string, unknown> = {}) {
  return {
    requestId: '44444444-4444-4444-8444-444444444444',
    reference: 'VEN-2026-0001',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    contactNumber: '9840012345',
    requestType: 'VENDOR',
    stallNumbers: ['C1-4'],
    staffRegistered: 1,
    staffExpected: 3,
    passes2w: 2,
    passes4w: 1,
    passesStaff: 3,
    pending: [
      { step: 'FSSAI', label: 'FSSAI certificate pending', stage: 1, open: true, blockedBy: [] },
    ],
    checkedInAt: null,
    checkedInBy: null,
    note: null,
    ...over,
  };
}

export function equipmentRow(over: Record<string, unknown> = {}) {
  return {
    requestId: '55555555-5555-4555-8555-555555555555',
    reference: 'VEN-2026-0001',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    contactNumber: '9840012345',
    requestType: 'VENDOR',
    category: 'VENDOR_FOOD',
    stallNumbers: ['C1-4'],
    chairsRequested: 6,
    tablesRequested: 2,
    extraChairs: 0,
    extraTables: 0,
    chairRatePaise: 10000,
    tableRatePaise: 40000,
    extraChargePaise: 0,
    extraCollectedAt: null,
    distributedAt: null,
    collectedAt: null,
    missingChairs: 0,
    missingTables: 0,
    damagedChairs: 0,
    damagedTables: 0,
    daysHeld: 1,
    items: [
      {
        itemId: 'ci1',
        name: 'Fan',
        perDay: true,
        ratePaise: 8000,
        missingPaise: 60000,
        damagedPaise: 30000,
        count: 0,
        missing: 0,
        damaged: 0,
      },
    ],
    deductionPaise: 0,
    deductionLines: [] as Array<{ label: string; amountPaise: number }>,
    note: null,
    flagged: false,
    ...over,
  };
}

export function quote(over: Record<string, unknown> = {}) {
  return {
    stallFeePaise: 1_500_000,
    plugFeePaise: 700_000,
    equipmentFeePaise: 0,
    netPaise: 2_200_000,
    gstPaise: 396_000,
    feeTotalPaise: 2_596_000,
    stallDepositPaise: 400_000,
    equipmentDepositPaise: 0,
    depositTotalPaise: 400_000,
    grandTotalPaise: 2_996_000,
    exempt: false,
    unpriced: false,
    /** No concession by default. `payableFeePaise` is what "paid in full" is
     *  measured against — it tracks the agreed figure where the team gave one,
     *  and the quoted figure otherwise. */
    discretionaryFeePaise: null,
    discretionaryReason: null,
    payableFeePaise: 2_596_000,
    ...over,
  };
}

export function paymentRow(over: Record<string, unknown> = {}) {
  return {
    requestId: '66666666-6666-4666-8666-666666666666',
    reference: 'VEN-2026-0001',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    email: 'priya@greenleaf.example',
    requestType: 'VENDOR',
    stallNumbers: ['C1-4'],
    quote: quote(),
    bankDetailsReceivedAt: '2026-01-10T10:00:00.000Z',
    paymentEmailSentAt: null,
    records: [] as unknown[],
    // Empty by default: most credit tests are about the form, and a reported
    // transfer sitting above it would put a second "Confirm" in every query.
    pendingClaims: [] as unknown[],
    receivedRentPaise: 0,
    receivedDepositPaise: 0,
    fullySettled: false,
    ...over,
  };
}

/* ── The backoffice configuration, as two screens see it ──────────────────
 *
 * ⚠️ Here rather than in one screen's test file. The bays, the planning
 * columns, the rate card, the charges and the fines moved from Admin to
 * Planning & Zones, and the edition settings stayed — so both suites stub
 * the same `GET /config`. Two copies of this payload would drift, and the
 * screen that kept the stale one would keep passing.
 */
/** What the backoffice config endpoint answers. Every list here is the edition's own
 *  configuration — bays and planning columns are rows, not constants — so the
 *  screen has to draw itself from this payload and nothing else. */
export const BACKOFFICE_CONFIG = {
  edition: {
    id: 'e1',
    year: 2026,
    name: 'Stalls 2026',
    isActive: true,
    virtualAccountRentPrefix: null,
    virtualAccountDepositPrefix: null,
    maxStallsPerRequest: 3,
    maxOpenRequests: 2,
    requestCapScope: 'OPEN' as const,
  },
  zones: [
    {
      id: 'z-c1',
      code: 'C1',
      name: 'C1 — Moon side',
      expectedCrowd: 25000,
      isClosedToVendors: false,
      sortOrder: 0,
      stallCount: 0,
    },
    {
      id: 'z-a3',
      code: 'A3',
      name: 'A3 — Behind Adiyogi',
      expectedCrowd: 4200,
      isClosedToVendors: true,
      sortOrder: 1,
      stallCount: 6,
    },
  ],
  planCategories: [
    { key: 'VENDOR_FOOD', name: 'Vendor food', isFood: true, sortOrder: 0, inUse: true },
    { key: 'BACKUP', name: 'Backup', isFood: false, sortOrder: 1, inUse: false },
  ],
  rateCard: [
    {
      zoneCode: 'C1',
      isFood: true,
      scope: 'VENDOR' as const,
      amountPaise: 1_500_000,
      depositPaise: 400_000,
    },
    {
      zoneCode: 'A3',
      isFood: true,
      scope: 'LOCAL_WELFARE' as const,
      amountPaise: 1_200_000,
      depositPaise: 400_000,
    },
  ],
  charges: {
    id: 'ch1',
    editionId: 'e1',
    chairRatePaise: 5000,
    tableRatePaise: 15000,
    lwChairRatePaise: 10000,
    lwTableRatePaise: 30000,
    vendorChairRatePaise: 10000,
    vendorTableRatePaise: 40000,
    plug5aRatePaise: 50000,
    plug15aRatePaise: 100000,
    gstRentPercent: 18,
    gstItemsPercent: 18,
    gstDepositPercent: 0,
    crowdPerStall: 1000,
    chairTableDepositPaise: 400000,
    equipmentDays: 1,
    chairPerDay: true,
    tablePerDay: true,
    chairReplacementPaise: 40000,
    tableReplacementPaise: 90000,
    chairDamagePaise: 25000,
    tableDamagePaise: 25000,
  },
  // A fan, so the Charges matrix and the counter dialogs are exercised against
  // a catalogue row and not only against the two fixed ones.
  chargeItems: [
    {
      id: 'ci1',
      key: 'FAN',
      name: 'Fan',
      ashramRatePaise: 0,
      lwRatePaise: 5000,
      vendorRatePaise: 8000,
      perDay: true,
      missingPaise: 60000,
      damagedPaise: 30000,
      isActive: true,
      sortOrder: 0,
      inUse: false,
    },
  ],
  flow: {
    bankStepEnabled: true,
    paymentStepEnabled: true,
    fssaiStepEnabled: true,
    // All at stage 1: nothing is ever locked, which is the default and what
    // every existing assertion on this fixture was written against.
    stages: {
      VENDOR: { BANK_FORM: 1, PAYMENT: 1, FSSAI: 1, STAFF_REGISTRATION: 1 },
      LOCAL_WELFARE: { BANK_FORM: 1, PAYMENT: 1, FSSAI: 1, STAFF_REGISTRATION: 1 },
      ASHRAM: { BANK_FORM: 1, PAYMENT: 1, FSSAI: 1, STAFF_REGISTRATION: 1 },
    },
  },
  fineTypes: [],
  customFields: [],
};

/** Two of them, so the edition selector has something to choose between — and
 *  so the tests below can point the screen at a year that is not the one every
 *  write goes to. */
const EDITION_SETTINGS = {
  virtualAccountRentPrefix: null,
  virtualAccountDepositPrefix: null,
  maxStallsPerRequest: 3,
  maxOpenRequests: 2,
  requestCapScope: 'OPEN' as const,
  termsUrl: null,
};
export const EDITIONS = [
  { id: 'e1', year: 2026, name: 'Stalls 2026', isActive: true, ...EDITION_SETTINGS },
  { id: 'e0', year: 2025, name: 'Stalls 2025', isActive: false, ...EDITION_SETTINGS },
];

/** Last year's configuration, which is what `/config?editionId=e0` answers. */
export const PAST_CONFIG = {
  ...BACKOFFICE_CONFIG,
  edition: {
    ...BACKOFFICE_CONFIG.edition,
    id: 'e0',
    year: 2025,
    name: 'Stalls 2025',
    isActive: false,
  },
  zones: BACKOFFICE_CONFIG.zones.map((z) =>
    z.code === 'C1' ? { ...z, name: 'C1 — Moon side (2025)' } : z,
  ),
};

/** One audit row, as `GET /audit` and `GET /requests/:id/audit` return it. */
export function auditEvent(over: Record<string, unknown> = {}) {
  return {
    id: 'a1111111-1111-4111-8111-111111111111',
    occurredAt: '2026-09-17T06:02:47.000Z',
    action: 'stall_request.amended',
    label: 'Request Amended',
    family: 'request',
    glyph: 'pencil',
    tone: 'neutral',
    actorKind: 'BACKOFFICE',
    actorRef: 'p-lead',
    actorName: 'Deepa Ramanathan',
    onBehalfOf: null,
    channel: 'BACKOFFICE',
    subjectType: 'request',
    subjectRef: '22222222-2222-4222-8222-222222222222',
    requestId: '22222222-2222-4222-8222-222222222222',
    reference: 'VEN-2026-0001',
    requestType: 'VENDOR',
    changes: [{ field: 'chairsNeeded', before: 2, after: 4 }],
    detail: { fields: ['chairsNeeded'] },
    outcome: 'OK',
    ...over,
  };
}
