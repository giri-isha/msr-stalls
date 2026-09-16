import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installFetch, renderAt } from '../test-utils';
import { MyRequests } from './MyRequests';

afterEach(() => vi.unstubAllGlobals());

const routes = [
  { path: '/stalls/requests', element: <MyRequests /> },
  { path: '/stalls/login', element: <div>the login page</div> },
  { path: '/stalls/apply', element: <div>the form picker</div> },
];

const render = () => renderAt('/stalls/requests', routes, { requester: true });

const SESSION = {
  accountId: 'a-1',
  displayName: 'Priya Venkat',
  email: 'priya@greenleaf.example',
  phone: '9840012345',
};

/** One selected request with whatever is outstanding on it. */
const withPending = (
  pending: Array<{ step: string; label: string }>,
  extra: Record<string, unknown> = {},
) => ({
  displayName: 'Priya Venkat',
  requests: [
    {
      reference: 'VEN-2026-0001',
      requestType: 'VENDOR',
      stallName: 'Green Leaf Organics',
      status: 'SELECTED',
      submittedAt: '2026-09-01T10:00:00.000Z',
      allocatedZone: 'C1',
      allocatedStalls: ['C1-4'],
      pending,
      payment: null,
      staff: null,
      ...extra,
    },
  ],
});

const PAYMENT = {
  feePaise: 11_800_000, // ₹1,18,000
  depositPaise: 2_000_000, // ₹20,000
  totalPaise: 13_800_000, // ₹1,38,000
  virtualAccountRent: 'MSRR9840012345',
  virtualAccountDeposit: 'MSRD9840012345',
};

const signedIn = (requests: unknown) =>
  installFetch([
    ['GET', /\/public\/session$/, () => SESSION],
    ['GET', /\/public\/requests$/, () => requests],
  ]);

describe('MyRequests', () => {
  test('shows the requests of whoever is logged in', async () => {
    signedIn({
      displayName: 'Priya Venkat',
      requests: [
        {
          reference: 'VEN-2026-0002',
          requestType: 'VENDOR',
          stallName: 'Second Stall',
          status: 'SUBMITTED',
          submittedAt: '2026-09-02T10:00:00.000Z',
          allocatedZone: null,
          allocatedStalls: [],
          pending: [],
        },
        {
          reference: 'VEN-2026-0001',
          requestType: 'VENDOR',
          stallName: 'Green Leaf Organics',
          status: 'SELECTED',
          submittedAt: '2026-09-01T10:00:00.000Z',
          allocatedZone: 'C1',
          allocatedStalls: ['C1-4'],
          pending: [],
        },
      ],
    });
    render();

    expect(await screen.findByText('Green Leaf Organics')).toBeInTheDocument();
    expect(screen.getByText('Second Stall')).toBeInTheDocument();
    expect(screen.getByText('VEN-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('C1-4')).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
    // The one sentence a requester who has only just applied comes back for.
    expect(screen.getByText(/Received. The stall team will review it./)).toBeInTheDocument();
  });

  test('carries no token in the URL it asks on — the cookie is the credential', async () => {
    const fx = signedIn({ displayName: 'Priya Venkat', requests: [] });
    render();

    await screen.findByText(/have not requested a stall/i);
    expect(fx.calls.map((c) => `${c.method} ${c.url}`)).toContain(
      'GET /api/m/stalls/public/requests',
    );
  });

  test('sends somebody who is not logged in to the login page', async () => {
    installFetch([['GET', /\/public\/session$/, () => [404, { error: 'no session' }]]]);
    const { router } = render();

    await waitFor(() => expect(router.state.location.pathname).toBe('/stalls/login'));
  });

  test('offers an empty account the way to the forms', async () => {
    signedIn({ displayName: 'Priya Venkat', requests: [] });
    render();

    expect(await screen.findByText(/have not requested a stall/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Request a Stall/ })).toHaveAttribute(
      'href',
      '/stalls/apply',
    );
  });

  test('offers a way in only for the steps a requester can fill themselves', async () => {
    signedIn(
      withPending([
        { step: 'BANK_FORM', label: 'Bank details pending' },
        { step: 'PAYMENT', label: 'Payment pending' },
      ]),
    );
    render();

    expect(await screen.findByText('Bank details pending')).toBeInTheDocument();
    // Payment shows — the requester should know the team is waiting on it —
    // but carries no button, because Finance moves it and this page cannot.
    expect(screen.getByText('Payment pending')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open the Form/ })).toHaveLength(1);
  });

  test('opens a step on the click, naming its own request', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fx = installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => withPending([{ step: 'FSSAI', label: 'FSSAI certificate pending' }]),
      ],
      [
        'POST',
        /\/public\/requests\/continue$/,
        () => ({ url: 'http://web.test/stalls/fssai/tok' }),
      ],
    ]);
    render();

    await userEvent.click(await screen.findByRole('button', { name: /Open the Form/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://web.test/stalls/fssai/tok'));
    expect(fx.last().body).toEqual({ reference: 'VEN-2026-0001', step: 'FSSAI' });
  });

  test('names the amount and the accounts under the payment chip', async () => {
    // 🔴 The whole point: these figures used to exist only in a letter, and a
    // vendor who never got it had a chip saying "payment pending" and no way on
    // this earth to find out what to pay or where.
    signedIn(withPending([{ step: 'PAYMENT', label: 'Payment pending' }], { payment: PAYMENT }));
    render();

    expect(await screen.findByText('Payment pending')).toBeInTheDocument();
    expect(screen.getByText('₹1,18,000')).toBeInTheDocument();
    expect(screen.getByText('₹20,000')).toBeInTheDocument();
    expect(screen.getByText('₹1,38,000')).toBeInTheDocument();
    expect(screen.getByText('MSRR9840012345')).toBeInTheDocument();
    expect(screen.getByText('MSRD9840012345')).toBeInTheDocument();
  });

  test('says where to ask rather than printing a blank account number', async () => {
    signedIn(
      withPending([{ step: 'PAYMENT', label: 'Payment pending' }], {
        payment: { ...PAYMENT, virtualAccountRent: null, virtualAccountDeposit: null },
      }),
    );
    render();

    // A vendor transferring to a half-remembered account is the expensive
    // failure here, so a missing number is said out loud.
    expect(await screen.findAllByText(/ask the stall team for the account/i)).toHaveLength(2);
  });

  test('shows the coupon and the way to register under the staff chip', async () => {
    signedIn(
      withPending([{ step: 'STAFF_REGISTRATION', label: 'Backoffice not registered' }], {
        staff: {
          coupons: [{ id: 'c-1', code: 'GLO-2026-K7Q4M2X9', capacity: 8, registered: 0 }],
          capacity: 8,
          registered: 0,
        },
      }),
    );
    render();

    expect(await screen.findByText('Backoffice not registered')).toBeInTheDocument();
    expect(screen.getByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    // ⚠️ Never "0 of 8": the cap is what the coupon admits, not what the stall
    // owes. Reading it as a quota is the misreading this wording exists to stop.
    expect(screen.getByText('up to 8 people')).toBeInTheDocument();
    expect(screen.queryByText('0 of 8')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Register Backoffice/ })).toHaveAttribute(
      'href',
      '/stalls/staff/GLO-2026-K7Q4M2X9',
    );
    // The chip above already carries the warning; the panel adds no second one.
    expect(screen.queryByText('Backoffice registration')).not.toBeInTheDocument();
  });

  test('offers a coupon to a vendor who has none, without inventing a chore', async () => {
    signedIn(withPending([], { staff: { coupons: [], capacity: 0, registered: 0 } }));
    render();

    expect(await screen.findByRole('button', { name: /Get Your Coupon/ })).toBeInTheDocument();
    // ⚠️ `pendingSteps` said nothing is outstanding — it cannot, with no coupon
    // to register against — so this page must not say otherwise.
    expect(screen.queryByText('Still to do')).not.toBeInTheDocument();
    expect(screen.getByText('Backoffice registration')).toBeInTheDocument();
  });

  test('asking for a coupon names its own request and reveals the code', async () => {
    const fx = installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => withPending([], { staff: { coupons: [], capacity: 0, registered: 0 } }),
      ],
      ['POST', /\/public\/requests\/coupon$/, () => ({ code: 'GLO-2026-K7Q4M2X9' })],
    ]);
    render();

    await userEvent.click(await screen.findByRole('button', { name: /Get Your Coupon/ }));

    expect(await screen.findByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    expect(fx.last().body).toEqual({ reference: 'VEN-2026-0001' });
    expect(screen.getByRole('link', { name: /Register Backoffice/ })).toHaveAttribute(
      'href',
      '/stalls/staff/GLO-2026-K7Q4M2X9',
    );
  });

  test('a stall holding two codes gets a way in for each of them', async () => {
    // 🔴 The vendor forwards one code to their kitchen team and the other to a
    // caterer. One button beside a list of codes would not say which is which.
    signedIn(
      withPending([{ step: 'STAFF_REGISTRATION', label: 'Backoffice not registered' }], {
        staff: {
          coupons: [
            { id: 'c-1', code: 'GLO-2026-K7Q4M2X9', capacity: 8, registered: 2 },
            { id: 'c-2', code: 'GLO-2026-B4K2M7PW', capacity: 4, registered: 0 },
          ],
          capacity: 12,
          registered: 2,
        },
      }),
    );
    render();

    expect(await screen.findByText('GLO-2026-K7Q4M2X9')).toBeInTheDocument();
    expect(screen.getByText('GLO-2026-B4K2M7PW')).toBeInTheDocument();

    const links = screen.getAllByRole('link', { name: /Register Backoffice/ });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/stalls/staff/GLO-2026-K7Q4M2X9',
      '/stalls/staff/GLO-2026-B4K2M7PW',
    ]);

    // Each code's own usage, and the stall's ceiling as the two added up.
    expect(screen.getByText('2 registered, up to 8')).toBeInTheDocument();
    expect(screen.getByText('0 registered, up to 4')).toBeInTheDocument();
    expect(screen.getByText('up to 12 people')).toBeInTheDocument();
  });

  test('a request still under consideration is given no list of future chores', async () => {
    signedIn({
      displayName: 'Priya Venkat',
      requests: [
        {
          reference: 'VEN-2026-0002',
          requestType: 'VENDOR',
          stallName: 'Second Stall',
          status: 'SHORTLISTED',
          submittedAt: '2026-09-02T10:00:00.000Z',
          allocatedZone: null,
          allocatedStalls: [],
          pending: [],
        },
      ],
    });
    render();

    await screen.findByText('Second Stall');
    expect(screen.queryByText('Still to do')).not.toBeInTheDocument();
  });
});
