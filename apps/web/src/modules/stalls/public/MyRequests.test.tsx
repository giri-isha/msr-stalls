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
const withPending = (pending: Array<{ step: string; label: string }>) => ({
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
    },
  ],
});

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
    expect(screen.getAllByRole('button', { name: /Open the form/ })).toHaveLength(1);
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

    await userEvent.click(await screen.findByRole('button', { name: /Open the form/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://web.test/stalls/fssai/tok'));
    expect(fx.last().body).toEqual({ reference: 'VEN-2026-0001', step: 'FSSAI' });
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
