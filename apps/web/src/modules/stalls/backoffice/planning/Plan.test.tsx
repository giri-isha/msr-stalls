import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ME_LEAD, installFetch, renderAt } from '../../test-utils';
import { Plan } from './Plan';

afterEach(() => vi.unstubAllGlobals());

const zero = {
  VENDOR_FOOD: 0,
  ASHRAM_FOOD: 0,
  LW_FOOD: 0,
  VENDOR_NON_FOOD: 0,
  ASHRAM_NON_FOOD: 0,
  HELP_DESK: 0,
  BACKUP: 0,
};

/** The grid's columns travel WITH the data — they are the edition's own
 *  configuration, not a constant the screen holds. A fixture that omitted them
 *  would be testing a screen that cannot exist. */
const categories = [
  { key: 'VENDOR_FOOD', name: 'Vendor food', isFood: true },
  { key: 'ASHRAM_FOOD', name: 'Ashram food', isFood: true },
  { key: 'LW_FOOD', name: 'Local welfare food', isFood: true },
  { key: 'VENDOR_NON_FOOD', name: 'Vendor non-food', isFood: false },
  { key: 'ASHRAM_NON_FOOD', name: 'Ashram non-food', isFood: false },
  { key: 'HELP_DESK', name: 'Help desk', isFood: false },
  { key: 'BACKUP', name: 'Backup', isFood: false },
];

const plan = {
  crowdPerStall: 1000,
  categories,
  rows: [
    {
      zoneCode: 'A3',
      zoneName: 'A3',
      isClosedToVendors: true,
      expectedCrowd: 4200,
      suggested: 5,
      counts: { ...zero, ASHRAM_NON_FOOD: 6 },
      total: 6,
      stallsExisting: 6,
      stallsAllocated: 0,
    },
    {
      zoneCode: 'A4',
      zoneName: 'A4',
      isClosedToVendors: false,
      expectedCrowd: 25000,
      suggested: 25,
      counts: { ...zero, VENDOR_FOOD: 5, ASHRAM_FOOD: 6 },
      total: 11,
      stallsExisting: 11,
      stallsAllocated: 2,
    },
  ],
  totals: {
    byCategory: { ...zero, ASHRAM_NON_FOOD: 6, VENDOR_FOOD: 5, ASHRAM_FOOD: 6 },
    grandTotal: 17,
  },
};

/** ⚠️ The GRID, not the screen. Planning & Zones is a tab strip now — the plan
 *  beside the bays, the columns and the money — and the strip itself, its gates
 *  and its edition selector are `index.test.tsx`. These tests are about what the
 *  grid does with a crowd figure, which is unchanged by where it is mounted. */
const routes = [{ path: '/m/stalls/planning', element: <Plan /> }];

describe('Plan', () => {
  test('shows a row per zone with the crowd-based suggestion and the grand total', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_LEAD],
      ['GET', /\/planning$/, () => plan],
    ]);
    renderAt('/m/stalls/planning', routes, { me: true });
    // `closest` matches attributes, not implicit ARIA roles, and a native <tr>
    // carries its row role without spelling it out. Selecting the element is
    // the right way to reach it; a redundant role= on every row would not be.
    const a4row = (await screen.findByLabelText('Edit A4')).closest('tr') as HTMLElement;
    expect(a4row).toHaveTextContent('25,000');
    expect(screen.getByTestId('grand-total')).toHaveTextContent('17');
  });

  // The counts are typed in the box the pencil opens; the suggestion moves with
  // them there, and the grid's totals catch up when it closes.
  test('the dialog re-suggests as the crowd is typed, and the grid totals follow Done', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_LEAD],
      ['GET', /\/planning$/, () => plan],
    ]);
    renderAt('/m/stalls/planning', routes, { me: true });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Edit A4'));

    const box = within(screen.getByRole('dialog'));
    const crowd = box.getByLabelText('Expected Crowd');
    await user.clear(crowd);
    await user.type(crowd, '50000');
    // 50,000 ÷ 1,000 people per stall.
    expect(box.getByText('Suggested from the Crowd').parentElement).toHaveTextContent('50');

    const vf = box.getByLabelText('Vendor food');
    await user.clear(vf);
    await user.type(vf, '8');
    await user.click(box.getByRole('button', { name: 'Done' }));

    expect(screen.getByTestId('grand-total')).toHaveTextContent('20');
  });

  test('Save sends the full counts grid and the divisor', async () => {
    const fx = installFetch([
      ['GET', /\/me$/, () => ME_LEAD],
      ['GET', /\/planning$/, () => plan],
      ['PUT', /\/planning$/, () => plan],
    ]);
    renderAt('/m/stalls/planning', routes, { me: true });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Edit A4'));
    const box = within(screen.getByRole('dialog'));
    await user.clear(box.getByLabelText('Vendor food'));
    await user.type(box.getByLabelText('Vendor food'), '8');
    await user.click(box.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fx.calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = fx.calls.find((c) => c.method === 'PUT')?.body as {
      crowdPerStall: number;
      rows: Array<{ zoneCode: string; counts: Record<string, number> }>;
    };
    expect(put.crowdPerStall).toBe(1000);
    expect(put.rows.find((r) => r.zoneCode === 'A4')?.counts.VENDOR_FOOD).toBe(8);
    expect(Object.keys(put.rows[0].counts)).toHaveLength(7);
  });

  test('Apply warns when a zone now plans fewer stalls than exist', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_LEAD],
      ['GET', /\/planning$/, () => plan],
    ]);
    renderAt('/m/stalls/planning', routes, { me: true });
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Edit A4'));
    const box = within(screen.getByRole('dialog'));
    await user.clear(box.getByLabelText('Vendor food'));
    await user.type(box.getByLabelText('Vendor food'), '1');
    await user.click(box.getByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Apply Plan' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(/fewer stalls than exist/);
  });

  test('a volunteer sees the grid read-only', async () => {
    installFetch([
      [
        'GET',
        /\/me$/,
        () => ({
          ...ME_LEAD,
          roleKeys: ['stalls_volunteer'],
          privileges: ['requests.read', 'planning.read'],
        }),
      ],
      ['GET', /\/planning$/, () => plan],
    ]);
    renderAt('/m/stalls/planning', routes, { me: true });
    // The grid reads the same to everybody; what a volunteer does not get is
    // the way in to change it.
    expect(await screen.findByLabelText('Edit A4')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Apply Plan' })).toBeDisabled();
  });
});
