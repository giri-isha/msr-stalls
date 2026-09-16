import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installFetch, renderAt } from '../test-utils';
import { AccessLink } from './AccessLink';
import { StatusPage } from './StatusPage';

afterEach(() => vi.unstubAllGlobals());

const routes = [{ path: '/stalls/status/:token', element: <StatusPage /> }];

describe('StatusPage', () => {
  test("shows the vendor's requests, and the stall number only once selected", async () => {
    installFetch([
      [
        'GET',
        /\/public\/status\//,
        () => ({
          displayName: 'Priya Venkat',
          requests: [
            {
              reference: 'VEN-2026-0002',
              requestType: 'VENDOR',
              stallName: 'Second Stall',
              status: 'SHORTLISTED',
              submittedAt: '2026-09-02T10:00:00.000Z',
              allocatedStalls: [],
              pending: [],
            },
            {
              reference: 'VEN-2026-0001',
              requestType: 'VENDOR',
              stallName: 'Green Leaf Organics',
              status: 'SELECTED',
              submittedAt: '2026-09-01T10:00:00.000Z',
              allocatedStalls: ['A4-5'],
              pending: [],
            },
          ],
        }),
      ],
    ]);
    renderAt(`/stalls/status/${'t'.repeat(43)}`, routes);
    expect(await screen.findByText('Priya Venkat')).toBeInTheDocument();
    expect(screen.getByText('Green Leaf Organics')).toBeInTheDocument();
    expect(screen.getByText('Second Stall')).toBeInTheDocument();
    expect(screen.getByText('A4-5')).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(screen.getByText('Shortlisted')).toBeInTheDocument();
  });

  test('a 404 renders a plain "not valid" page with no detail', async () => {
    installFetch([['GET', /\/public\/status\//, () => [404, { error: 'this link is not valid' }]]]);
    renderAt('/stalls/status/wrong-token-wrong-token', routes);
    expect(await screen.findByText('This link is not valid')).toBeInTheDocument();
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
  });

  test('sends the token from the URL, encoded', async () => {
    const fx = installFetch([
      ['GET', /\/public\/status\//, () => ({ displayName: 'x', requests: [] })],
    ]);
    renderAt('/stalls/status/abc-DEF_123', routes);
    await screen.findByText('x');
    expect(fx.last().url).toBe('/api/m/stalls/public/status/abc-DEF_123');
  });
});

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
      allocatedStalls: ['C1-4'],
      pending,
    },
  ],
});

describe('the portal half of the status page', () => {
  test('shows what is outstanding, and offers a way in only where there is one', async () => {
    installFetch([
      [
        'GET',
        /\/public\/status\//,
        () =>
          withPending([
            { step: 'BANK_FORM', label: 'Bank details pending' },
            { step: 'PAYMENT', label: 'Payment pending' },
          ]),
      ],
    ]);
    renderAt(`/stalls/status/${'t'.repeat(43)}`, routes);

    expect(await screen.findByText('Bank details pending')).toBeInTheDocument();
    // Payment is shown — the vendor should know the team is waiting on it —
    // but there is no button, because Finance moves it, not the vendor.
    expect(screen.getByText('Payment pending')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open the form/ })).toHaveLength(1);
  });

  test('a request still under consideration is given no list of future chores', async () => {
    installFetch([
      [
        'GET',
        /\/public\/status\//,
        () => ({
          displayName: 'Priya Venkat',
          requests: [
            {
              reference: 'VEN-2026-0002',
              requestType: 'VENDOR',
              stallName: 'Second Stall',
              status: 'SHORTLISTED',
              submittedAt: '2026-09-02T10:00:00.000Z',
              allocatedStalls: [],
              pending: [],
            },
          ],
        }),
      ],
    ]);
    renderAt(`/stalls/status/${'t'.repeat(43)}`, routes);

    await screen.findByText('Second Stall');
    expect(screen.queryByText('Still to do')).not.toBeInTheDocument();
  });

  test('opening a step mints the link on the click, naming its own request', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const fx = installFetch([
      [
        'GET',
        /\/public\/status\//,
        () => withPending([{ step: 'FSSAI', label: 'FSSAI certificate pending' }]),
      ],
      [
        'POST',
        /\/public\/status\/.+\/continue/,
        () => ({ url: 'http://web.test/stalls/fssai/tok' }),
      ],
    ]);
    renderAt(`/stalls/status/${'t'.repeat(43)}`, routes);

    await userEvent.click(await screen.findByRole('button', { name: /Open the form/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://web.test/stalls/fssai/tok'));
    expect(fx.last().body).toEqual({ reference: 'VEN-2026-0001', step: 'FSSAI' });
  });

  test('the "not valid" page offers the one way forward there is', async () => {
    installFetch([['GET', /\/public\/status\//, () => [404, { error: 'this link is not valid' }]]]);
    renderAt('/stalls/status/wrong-token-wrong-token', routes);
    expect(await screen.findByText('This link is not valid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Email Me a New Link/ })).toHaveAttribute(
      'href',
      '/stalls/status',
    );
  });
});

describe('AccessLink — the vendor asking for their link back', () => {
  const render = () =>
    renderAt('/stalls/status', [{ path: '/stalls/status', element: <AccessLink /> }]);

  test('sends the contact as typed and confirms without confirming anything', async () => {
    const fx = installFetch([['POST', /\/public\/access-link/, () => [202, { ok: true }]]]);
    render();

    await userEvent.type(screen.getByLabelText(/Email address or mobile/), '98400 12345');
    await userEvent.click(screen.getByRole('button', { name: /Email me my link/ }));

    await screen.findByText('Check your email');
    expect(fx.last().body).toEqual({ contact: '98400 12345' });
    // ⚠️ The copy must hold for a contact that has never applied. Anything
    // that reads as "found you" turns this page into a way of asking whether
    // somebody applied.
    expect(screen.getByText(/If we have a stall request under that/)).toBeInTheDocument();
  });

  test('says the same thing when the API refuses — including at the rate limit', async () => {
    installFetch([['POST', /\/public\/access-link/, () => [429, { error: 'too many requests' }]]]);
    render();

    await userEvent.type(screen.getByLabelText(/Email address or mobile/), 'nobody@example.org');
    await userEvent.click(screen.getByRole('button', { name: /Email me my link/ }));

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
  });
});
