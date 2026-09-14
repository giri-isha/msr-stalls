import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ME_ADMIN,
  checkInRow,
  equipmentRow,
  installFetch,
  renderAt,
} from '../test-utils';
import { CheckIn } from './CheckIn';
import { Electrical } from './Electrical';
import { Equipment } from './Equipment';

beforeEach(() => vi.unstubAllGlobals());

// ── Electrical ──────────────────────────────────────────────────────────────

const SHEET = {
  editionName: 'MSR 2026',
  zoneCode: null,
  rows: [
    {
      stallNumber: 'C1-4',
      zoneCode: 'C1',
      stallName: 'Green Leaf Organics',
      category: 'VENDOR_FOOD',
      requestType: 'VENDOR',
      plugs5aTotal: 5,
      plugs15a: 5,
      gasStoves: 1,
      appliances: [{ name: 'Deep fryer', watts: 2500 }],
      totalWatts: 2500,
    },
  ],
  totals: { stalls: 1, plugs5a: 5, plugs15a: 5, watts: 2500 },
};

describe('the electrical sheet', () => {
  // The bay tabs are the edition's own zones, loaded rather than baked in — the
  // venue layout is redrawn every year. The screen asks /config for them.
  const CONFIG = {
    edition: { id: 'e1', year: 2026, name: 'MSR 2026', isActive: true },
    zones: ['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2'].map((code, i) => ({
      id: `z-${code}`,
      code,
      name: code,
      expectedCrowd: 1000,
      isClosedToVendors: code === 'A3' || code === 'B2',
      sortOrder: i,
    })),
    rateCard: [],
    charges: {},
    flow: { bankStepEnabled: true, paymentStepEnabled: true, fssaiStepEnabled: true },
    fineTypes: [],
    customFields: [],
  };

  const render = () =>
    renderAt('/m/stalls/electrical', [{ path: '/m/stalls/electrical', element: <Electrical /> }], {
      me: true,
    });

  test('prints the 5A total including the free plug, as the column says', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/config$/, () => CONFIG],
      ['GET', /\/electrical/, () => SHEET],
    ]);
    render();

    expect(await screen.findByText('C1-4')).toBeInTheDocument();
    expect(screen.getByText('5A (incl. 1 default)')).toBeInTheDocument();
    expect(screen.getByText('Deep fryer 2500W')).toBeInTheDocument();
  });

  test('a cluster tab narrows the request, not just the table', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/config$/, () => CONFIG],
      ['GET', /\/electrical/, () => SHEET],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('C1-4');
    await user.click(screen.getByRole('button', { name: 'B4' }));

    await waitFor(() =>
      expect(fetch.calls.some((c) => c.url.includes('zoneCode=B4'))).toBe(true),
    );
  });

  test('totals the load across the sheet', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/config$/, () => CONFIG],
      ['GET', /\/electrical/, () => SHEET],
    ]);
    render();
    expect(await screen.findByText('2,500 W total load')).toBeInTheDocument();
  });
});

// ── Check-in ────────────────────────────────────────────────────────────────

describe('check-in', () => {
  const render = () =>
    renderAt('/m/stalls/checkin', [{ path: '/m/stalls/checkin', element: <CheckIn /> }], {
      me: true,
    });

  test('shows the counter the staff count, the passes and what is outstanding', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => [checkInRow()]],
    ]);
    render();

    expect(await screen.findByText('Green Leaf Organics')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByText('FSSAI certificate pending')).toBeInTheDocument();
  });

  test('lets a stall in despite an outstanding item, carrying the note', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => [checkInRow()]],
      [
        'POST',
        /\/checkin\//,
        (_u, _i, body) =>
          checkInRow({
            checkedInAt: '2026-02-14T06:00:00.000Z',
            note: (body as { note?: string }).note ?? null,
          }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Green Leaf Organics');
    await user.type(
      screen.getByPlaceholderText(/Note \(optional\)/),
      'FSSAI shown on paper',
    );
    await user.click(screen.getByRole('button', { name: 'Check in' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toEqual({ note: 'FSSAI shown on paper' });
    });
    expect(await screen.findByRole('button', { name: 'Undo check-in' })).toBeInTheDocument();
  });

  test('says "All clear" when nothing is outstanding', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => [checkInRow({ pending: [] })]],
    ]);
    render();
    expect(await screen.findByText('All clear')).toBeInTheDocument();
  });

  test('a volunteer without the action sees the state but no button', async () => {
    installFetch([
      ['GET', /\/me$/, () => ({ ...ME_ADMIN, actions: ['requests:read'] })],
      ['GET', /\/checkin/, () => [checkInRow()]],
    ]);
    render();

    await screen.findByText('Green Leaf Organics');
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
  });
});

// ── Chairs and tables ───────────────────────────────────────────────────────

describe('chairs and tables', () => {
  const render = () =>
    renderAt('/m/stalls/equipment', [{ path: '/m/stalls/equipment', element: <Equipment /> }], {
      me: true,
    });

  test('shows what was ordered and walks the counter through distribute', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/equipment$/, () => [equipmentRow()]],
      [
        'POST',
        /\/equipment\/.+\/action$/,
        () => equipmentRow({ distributedAt: '2026-02-13T09:00:00.000Z' }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    expect(await screen.findByText('6 ch / 2 tb')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Distribute' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.url.includes('/action'));
      expect(post?.body).toEqual({ action: 'DISTRIBUTE' });
    });
    expect(await screen.findByText('Out')).toBeInTheDocument();
  });

  test('extra chairs are committed on blur, not on every keystroke', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/equipment$/, () => [equipmentRow()]],
      [
        'PATCH',
        /\/equipment\//,
        () => equipmentRow({ extraChairs: 12, extraChargePaise: 60_000 }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('6 ch / 2 tb');
    const inputs = screen.getAllByLabelText('Count');
    await user.clear(inputs[0]);
    await user.type(inputs[0], '12');
    // Still nothing sent — a "1" in flight would be a real charge at a counter.
    expect(fetch.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    await user.tab();
    await waitFor(() => {
      const patch = fetch.calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toEqual({ extraChairs: 12 });
    });
  });

  test('missing and damaged items show the deduction they will cause', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/equipment$/,
        () =>
          [
            equipmentRow({
              missingChairs: 2,
              damaged: true,
              deductionPaise: 105_000,
              flagged: true,
            }),
          ],
      ],
    ]);
    render();

    expect(await screen.findByText('Deduction ₹1,050')).toBeInTheDocument();
    expect(screen.getByText('Flagged')).toBeInTheDocument();
  });

  test('the challan prints both copies with what was ordered and what was added', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/equipment$/, () => [equipmentRow({ extraChairs: 2 })]],
      [
        'GET',
        /\/equipment\/.+\/challan$/,
        () => ({
          stallNumber: 'C1-4',
          stallName: 'Green Leaf Organics',
          ownerName: 'Priya Venkat',
          contactNumber: '9840012345',
          category: 'VENDOR_FOOD',
          chairsOnline: 6,
          tablesOnline: 2,
          extraChairs: 2,
          extraTables: 0,
          extraChargePaise: 10_000,
          editionName: 'MSR 2026',
          printedAt: '2026-02-13T09:00:00.000Z',
        }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('6 ch / 2 tb');
    await user.click(screen.getByRole('button', { name: 'Challan' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Vendor copy/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Office copy/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Ordered online:/)).toHaveLength(2);
  });
});
