import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { type RouteObject, RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { MeProvider } from './me';
import { ToastProvider } from './ui';

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
 * swallow them. It is what `StaffLayout` mounts in the real shell, so this is
 * the harness matching the app rather than the harness being generous.
 *
 * ⚠️ It is OUTSIDE `MeProvider`, matching the shell for the same reason given
 * there: the gate swaps its whole subtree once the session lands, and a toast
 * host inside it would unmount on that transition and drop what it was holding.
 */
export function renderAt(path: string, routes: RouteObject[], opts: { me?: boolean } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const inner: ReactElement = opts.me ? (
    <MeProvider>
      <RouterProvider router={router} />
    </MeProvider>
  ) : (
    <RouterProvider router={router} />
  );
  return { ...render(<ToastProvider>{inner}</ToastProvider>), router };
}

export const ME_LEAD = {
  personId: 'p-lead',
  displayName: 'Deepa Ramanathan',
  roleKeys: ['stalls_lead'],
  actions: [
    'requests:read',
    'requests:write',
    'planning:read',
    'planning:write',
    'selection:read',
    'selection:write',
    'comms:write',
    'finance:read',
    'config:read',
  ],
};

export const PUBLIC_CONFIG = {
  edition: { year: 2026, name: 'MSR 2026' },
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
  actions: [
    'requests:read',
    'requests:write',
    'planning:read',
    'planning:write',
    'selection:read',
    'selection:write',
    'comms:write',
    'finance:read',
    'finance:write',
    'checkin:write',
    'config:read',
    'config:write',
    'users:write',
  ],
};

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
    pending: [{ step: 'FSSAI', label: 'FSSAI certificate pending' }],
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
    extraChargePaise: 0,
    extraCollectedAt: null,
    distributedAt: null,
    collectedAt: null,
    missingChairs: 0,
    missingTables: 0,
    damaged: false,
    deductionPaise: 0,
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
    receivedRentPaise: 0,
    receivedDepositPaise: 0,
    fullySettled: false,
    ...over,
  };
}
