import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { type RouteObject, RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { MeProvider } from './me';
import { ToastProvider } from './ui/components/Toast';

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

/** Render `routes` inside a memory router positioned at `path`. */
export function renderAt(path: string, routes: RouteObject[], opts: { me?: boolean } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  // Every screen may raise a toast, so the provider is always there — as it
  // is in production, where the shell mounts it above the router.
  const tree: ReactElement = (
    <ToastProvider>
      {opts.me ? (
        <MeProvider>
          <RouterProvider router={router} />
        </MeProvider>
      ) : (
        <RouterProvider router={router} />
      )}
    </ToastProvider>
  );
  return { ...render(tree), router };
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
      isClosedToVendors: true,
      rentFoodPaise: null,
      rentNonFoodPaise: null,
    },
    {
      code: 'A4',
      name: 'A4',
      isClosedToVendors: false,
      rentFoodPaise: 1_800_000,
      rentNonFoodPaise: 1_500_000,
    },
    {
      code: 'B2',
      name: 'B2',
      isClosedToVendors: true,
      rentFoodPaise: null,
      rentNonFoodPaise: null,
    },
    {
      code: 'B3',
      name: 'B3',
      isClosedToVendors: false,
      rentFoodPaise: 1_800_000,
      rentNonFoodPaise: 1_500_000,
    },
    {
      code: 'B4',
      name: 'B4',
      isClosedToVendors: false,
      rentFoodPaise: 1_800_000,
      rentNonFoodPaise: 1_500_000,
    },
    {
      code: 'C1',
      name: 'C1',
      isClosedToVendors: false,
      rentFoodPaise: 1_500_000,
      rentNonFoodPaise: 1_200_000,
    },
    {
      code: 'C2',
      name: 'C2',
      isClosedToVendors: false,
      rentFoodPaise: 1_500_000,
      rentNonFoodPaise: 1_200_000,
    },
  ],
  charges: { vendorDepositPaise: 400_000, localWelfareDepositPaise: 400_000, gstPercent: 18 },
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
