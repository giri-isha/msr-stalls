import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, installFetch, renderAt } from '../test-utils';
import { Onboarding } from './Onboarding';

const routes = [{ path: '/m/stalls/onboarding', element: <Onboarding /> }];
const render = () => renderAt('/m/stalls/onboarding', routes, { me: true });

const ID = '77777777-7777-4777-8777-777777777777';

function row(over: Record<string, unknown> = {}) {
  return {
    requestId: ID,
    reference: 'VEN-2026-0001',
    stallName: 'Green Leaf Organics',
    requesterName: 'Priya Venkat',
    requestType: 'VENDOR',
    stallNumbers: ['C1-4'],
    bankDetails: 'PENDING',
    gst: 'PENDING',
    payment: 'PENDING',
    fssai: 'PENDING',
    staffRegistered: 1,
    staffExpected: 3,
    couponCode: null,
    couponCapacity: null,
    stage: 'BANK_FORM_SENT',
    pending: [
      { step: 'BANK_FORM', label: 'Bank details pending' },
      { step: 'FSSAI', label: 'FSSAI certificate pending' },
    ],
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    ...row(),
    bank: null,
    staff: [],
    fssaiFiles: [],
    quote: null,
    ...over,
  };
}

beforeEach(() => vi.unstubAllGlobals());

describe('the onboarding table', () => {
  test('distinguishes "not applicable" from "pending"', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/onboarding$/,
        () => [
          row(),
          row({
            requestId: 'other',
            stallName: 'Annadanam',
            requestType: 'ASHRAM',
            bankDetails: 'NOT_APPLICABLE',
            gst: 'NOT_APPLICABLE',
            payment: 'NOT_APPLICABLE',
            fssai: 'NOT_APPLICABLE',
          }),
        ],
      ],
    ]);
    render();

    await screen.findByText('Annadanam');
    // Four N/A cells on the ashram row; the vendor row is all Pending.
    expect(screen.getAllByText('N/A')).toHaveLength(4);
    expect(screen.getAllByText('Pending')).toHaveLength(4);
  });

  test('shows the staff count against what was asked for', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row()]],
    ]);
    render();
    expect(await screen.findByText('1 of 3')).toBeInTheDocument();
  });

  test('searching narrows by stall number as well as by name', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/onboarding$/,
        () => [
          row(),
          row({ requestId: 'other', stallName: 'Coastal Spice', stallNumbers: ['B4-2'] }),
        ],
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Coastal Spice');
    await user.type(screen.getByLabelText('Search'), 'B4-2');

    await waitFor(() => expect(screen.queryByText('Green Leaf Organics')).not.toBeInTheDocument());
    expect(screen.getByText('Coastal Spice')).toBeInTheDocument();
  });
});

describe('the vendor detail', () => {
  test('reads the bank details back with short-lived links to the files', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row({ bankDetails: 'RECEIVED', gst: 'RECEIVED' })]],
      [
        'GET',
        /\/onboarding\/.+$/,
        () =>
          detail({
            bankDetails: 'RECEIVED',
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
              submittedAt: '2026-01-10T10:00:00.000Z',
              files: [
                {
                  label: 'Cancelled cheque / passbook',
                  name: 'Cancelled cheque / passbook',
                  url: 'https://store.test/view/x.jpg',
                },
              ],
            },
          }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('HDFC0001234')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Cancelled cheque/ })).toHaveAttribute(
      'href',
      'https://store.test/view/x.jpg',
    );
  });

  test('verifying the FSSAI certificate posts the change', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row({ fssai: 'UPLOADED' })]],
      [
        'GET',
        /\/onboarding\/.+$/,
        () =>
          detail({
            fssai: 'UPLOADED',
            fssaiFiles: [{ name: 'cert.pdf', uploadedAt: '2026-01-20T10:00:00.000Z', url: null }],
          }),
      ],
      ['POST', /\/fssai\/verify$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Mark verified' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.url.includes('/fssai/verify'));
      expect(post?.body).toEqual({ verified: true });
    });
  });

  test('a coupon can be issued by hand when no letter has gone out', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row()]],
      ['GET', /\/onboarding\/.+$/, () => detail()],
      ['POST', /\/coupon$/, () => ({ code: 'GRE-2026-K7Q4M2X9' })],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Issue coupon/ }));

    await waitFor(() =>
      expect(fetch.calls.some((c) => c.method === 'POST' && c.url.endsWith('/coupon'))).toBe(true),
    );
  });

  test('an existing coupon is shown rather than a second one offered', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row({ couponCode: 'GRE-2026-K7Q4M2X9' })]],
      ['GET', /\/onboarding\/.+$/, () => detail({ couponCode: 'GRE-2026-K7Q4M2X9' })],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('GRE-2026-K7Q4M2X9')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Issue coupon/ })).not.toBeInTheDocument();
  });

  // 🔴 "If they want more staff members, in the back end we raise that capacity
  // to 10, 12." The raise lands on the coupon the vendor already holds, so
  // nobody has to be sent a new code.
  test('the back office raises what the coupon admits, on the code already out', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row({ couponCode: 'GRE-2026-K7Q4M2X9' })]],
      [
        'GET',
        /\/onboarding\/.+$/,
        () => detail({ couponCode: 'GRE-2026-K7Q4M2X9', couponCapacity: 8 }),
      ],
      ['PUT', /\/coupon\/capacity$/, () => ({ code: 'GRE-2026-K7Q4M2X9', capacity: 12 })],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const record = within(await screen.findByRole('dialog', { name: 'Green Leaf Organics' }));
    // The record STATES the cap; the pencil is what changes it.
    expect(record.getByText('8')).toBeInTheDocument();
    await user.click(record.getByLabelText('Edit coupon capacity'));

    // ⚠️ A box over a box: the record is a dialog too, so the query names the
    // one it means rather than taking whichever comes first.
    const box = within(await screen.findByRole('dialog', { name: 'Coupon capacity' }));
    const field = box.getByLabelText('Admits (people)');
    expect(field).toHaveValue(8);

    await user.clear(field);
    await user.type(field, '12');
    await user.click(box.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PUT');
      expect(call?.body).toEqual({ capacity: 12 });
    });
  });

  // Lowering below what is already registered would leave the stall over its
  // own cap with no way to read the number as a limit again.
  test('refuses to lower the cap below the people already registered', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row({ couponCode: 'GRE-2026-K7Q4M2X9' })]],
      [
        'GET',
        /\/onboarding\/.+$/,
        () => detail({ couponCode: 'GRE-2026-K7Q4M2X9', couponCapacity: 8, staffRegistered: 5 }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const record = within(await screen.findByRole('dialog', { name: 'Green Leaf Organics' }));
    await user.click(record.getByLabelText('Edit coupon capacity'));

    const box = within(await screen.findByRole('dialog', { name: 'Coupon capacity' }));
    const field = box.getByLabelText('Admits (people)');
    await user.clear(field);
    await user.type(field, '2');

    expect(box.getByText(/5 already registered/)).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('backoffice numbers are shown in full to the team, unlike the vendor’s own page', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row()]],
      [
        'GET',
        /\/onboarding\/.+$/,
        () =>
          detail({
            staff: [
              {
                id: 's1',
                name: 'Ravi Kumar',
                mobile: '9840055555',
                idType: 'AADHAAR',
                idNumber: '9012',
                role: null,
                registeredAt: '2026-02-01T10:00:00.000Z',
              },
            ],
          }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('9840055555')).toBeInTheDocument();
    expect(within(dialog).getByText(/aadhaar ···9012/)).toBeInTheDocument();
  });
});
