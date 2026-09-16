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
    coupons: [],
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

describe('the onboarding filters', () => {
  const two = () =>
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/onboarding$/,
        () => [
          row(),
          row({
            requestId: '88888888-8888-4888-8888-888888888888',
            reference: 'LWS-2026-0001',
            stallName: 'Seva Health Camp',
            requestType: 'LOCAL_WELFARE',
            pending: [{ step: 'PAYMENT', label: 'Payment pending' }],
          }),
        ],
      ],
    ]);

  test('narrows the list to the step being waited on', async () => {
    two();
    render();
    const user = userEvent.setup();
    await screen.findByText('Green Leaf Organics');

    await user.selectOptions(screen.getByLabelText('Outstanding'), 'PAYMENT');
    expect(screen.queryByText('Green Leaf Organics')).not.toBeInTheDocument();
    expect(screen.getByText('Seva Health Camp')).toBeInTheDocument();
  });

  /** 🔴 The filter reads `pending`, which the API computes. Deriving "is this
   *  outstanding" from the four status columns instead would have to re-answer
   *  what NOT_APPLICABLE means, and that rule already lives in one place. */
  test('uses the API’s own pending list, not the status columns', async () => {
    two();
    render();
    const user = userEvent.setup();
    await screen.findByText('Green Leaf Organics');

    // Both rows show `payment: 'PENDING'` in their column; only one of them is
    // actually WAITING on payment, and the filter follows the latter.
    await user.selectOptions(screen.getByLabelText('Outstanding'), 'BANK_FORM');
    expect(screen.getByText('Green Leaf Organics')).toBeInTheDocument();
    expect(screen.queryByText('Seva Health Camp')).not.toBeInTheDocument();
  });

  test('and by requester type', async () => {
    two();
    render();
    const user = userEvent.setup();
    await screen.findByText('Green Leaf Organics');

    await user.selectOptions(screen.getByLabelText('Type'), 'LOCAL_WELFARE');
    expect(screen.queryByText('Green Leaf Organics')).not.toBeInTheDocument();
    expect(screen.getByText('Seva Health Camp')).toBeInTheDocument();
  });

  /** ⚠️ GST has a COLUMN and is not a step — it arrives with the bank form. An
   *  "outstanding" list written by hand would have offered it and matched
   *  nothing ever, which reads as an empty queue rather than a broken filter. */
  test('offers no step the API never emits', async () => {
    two();
    render();
    await screen.findByText('Green Leaf Organics');

    const options = within(screen.getByLabelText('Outstanding')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Anything Outstanding',
      'Waiting on Bank Details',
      'Waiting on Payment',
      'Waiting on FSSAI',
      'Waiting on Staff Registration',
    ]);
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
    await user.click(within(dialog).getByRole('button', { name: /Issue Coupon/ }));

    await waitFor(() =>
      expect(fetch.calls.some((c) => c.method === 'POST' && c.url.endsWith('/coupon'))).toBe(true),
    );
  });

  // 🔴 A stall may hold more than one live code — a caterer's beside the
  // vendor's own — so an existing coupon does NOT close the door on another.
  test('an existing coupon is shown, and another can still be issued', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/onboarding$/,
        () => [
          row({ coupons: [{ id: 'c-1', code: 'GRE-2026-K7Q4M2X9', capacity: 8, registered: 0 }] }),
        ],
      ],
      [
        'GET',
        /\/onboarding\/.+$/,
        () =>
          detail({
            coupons: [{ id: 'c-1', code: 'GRE-2026-K7Q4M2X9', capacity: 8, registered: 0 }],
          }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('GRE-2026-K7Q4M2X9')).toBeInTheDocument();
    // The button reads New Coupon rather than Issue Coupon once one exists, so
    // nobody presses it expecting to be shown the code already out.
    expect(within(dialog).queryByRole('button', { name: /Issue Coupon/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /New Coupon/ })).toBeInTheDocument();
  });

  // 🔴 "If they want more staff members, in the back end we raise that capacity
  // to 10, 12." The raise lands on the coupon the vendor already holds, so
  // nobody has to be sent a new code.
  test('the back office raises what the coupon admits, on the code already out', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/onboarding$/,
        () => [
          row({ coupons: [{ id: 'c-1', code: 'GRE-2026-K7Q4M2X9', capacity: 8, registered: 0 }] }),
        ],
      ],
      [
        'GET',
        /\/onboarding\/.+$/,
        () =>
          detail({
            coupons: [{ id: 'c-1', code: 'GRE-2026-K7Q4M2X9', capacity: 8, registered: 0 }],
          }),
      ],
      [
        'PUT',
        /\/coupons\/.+\/capacity$/,
        () => ({ id: 'c-1', code: 'GRE-2026-K7Q4M2X9', capacity: 12 }),
      ],
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
    const box = within(await screen.findByRole('dialog', { name: 'Coupon Capacity' }));
    const field = box.getByLabelText('Admits (People)');
    expect(field).toHaveValue(8);

    await user.clear(field);
    await user.type(field, '12');
    await user.click(box.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PUT');
      expect(call?.body).toEqual({ capacity: 12 });
    });
  });

  // 🔴 The team's SECOND lever. Raising a capacity gives one code more room;
  // issuing another lets a caterer be handed their own, counted apart from the
  // vendor's own kitchen team — which is the thing a bigger number cannot say.
  test('a stall can hold two codes, each with its own cap and its own count', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/onboarding$/, () => [row({ coupons: [] })]],
      [
        'GET',
        /\/onboarding\/.+$/,
        () =>
          detail({
            coupons: [
              { id: 'c-1', code: 'GRE-2026-K7Q4M2X9', capacity: 8, registered: 2 },
              { id: 'c-2', code: 'GRE-2026-B4K2M7PW', capacity: 4, registered: 0 },
            ],
            staffRegistered: 2,
          }),
      ],
      [
        'POST',
        /\/coupon$/,
        () => ({ id: 'c-3', code: 'GRE-2026-ZZ11YY22', capacity: 8, registered: 0 }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const record = within(await screen.findByRole('dialog', { name: 'Green Leaf Organics' }));

    expect(record.getByText('GRE-2026-K7Q4M2X9')).toBeInTheDocument();
    expect(record.getByText('GRE-2026-B4K2M7PW')).toBeInTheDocument();
    expect(record.getByText('2 registered on this code')).toBeInTheDocument();
    expect(record.getByText('0 registered on this code')).toBeInTheDocument();
    // One pencil per code — a cap belongs to a coupon, not to the stall.
    expect(record.getAllByLabelText('Edit coupon capacity')).toHaveLength(2);

    await user.click(record.getByRole('button', { name: /New Coupon/ }));
    await waitFor(() =>
      expect(fetch.calls.some((c) => c.method === 'POST' && c.url.endsWith('/coupon'))).toBe(true),
    );
  });

  // Lowering below what is already registered would leave the stall over its
  // own cap with no way to read the number as a limit again.
  test('refuses to lower the cap below the people already registered', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/onboarding$/,
        () => [
          row({ coupons: [{ id: 'c-1', code: 'GRE-2026-K7Q4M2X9', capacity: 8, registered: 0 }] }),
        ],
      ],
      [
        'GET',
        /\/onboarding\/.+$/,
        () =>
          detail({
            coupons: [{ id: 'c-1', code: 'GRE-2026-K7Q4M2X9', capacity: 8, registered: 5 }],
            staffRegistered: 5,
          }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByText('Green Leaf Organics'));
    const record = within(await screen.findByRole('dialog', { name: 'Green Leaf Organics' }));
    await user.click(record.getByLabelText('Edit coupon capacity'));

    const box = within(await screen.findByRole('dialog', { name: 'Coupon Capacity' }));
    const field = box.getByLabelText('Admits (People)');
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
    expect(within(dialog).getByText(/Aadhaar ···9012/)).toBeInTheDocument();
  });
});
