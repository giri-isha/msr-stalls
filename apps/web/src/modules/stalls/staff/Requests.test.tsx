import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ME_LEAD, detail, installFetch, renderAt, summary } from '../test-utils';
import { Requests } from './Requests';

afterEach(() => vi.unstubAllGlobals());

const routes = [
  { path: '/m/stalls/requests', element: <Requests mode='triage' /> },
  { path: '/m/stalls/all', element: <Requests mode='all' /> },
];

const items = [
  summary(),
  summary({
    id: '33333333-3333-4333-8333-333333333333',
    reference: 'LWS-2026-0001',
    requestType: 'LOCAL_WELFARE',
    stallName: 'Seva Health Camp',
    requesterName: 'Gopal Krishnan',
    status: 'SHORTLISTED',
    preferredZoneCode: 'A3',
  }),
];

const base = () =>
  [
    ['GET', /\/me$/, () => ME_LEAD],
    [
      'GET',
      /\/requests$/,
      (url: URL) => {
        const status = url.searchParams.get('status');
        const q = url.searchParams.get('q');
        let list = items;
        if (status) list = list.filter((i) => i.status === status);
        if (q) list = list.filter((i) => i.stallName.toLowerCase().includes(q.toLowerCase()));
        return { items: list, nextCursor: null };
      },
    ],
    ['GET', /\/requests\/[^/]+$/, () => detail()],
  ] as Array<[string, RegExp, (url: URL) => unknown]>;

describe('Requests', () => {
  test('lists requests with reference, type and status', async () => {
    installFetch(base());
    renderAt('/m/stalls/all', routes, { me: true });
    expect(await screen.findByText('VEN-2026-0001')).toBeInTheDocument();
    // Scoped to the table: the type and status filters also list these words
    // as <option>s.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Seva Health Camp')).toBeInTheDocument();
    expect(table.getByText('Local Welfare')).toBeInTheDocument();
    expect(table.getByText('Shortlisted')).toBeInTheDocument();
  });

  test('the status filter narrows the list through the API and the URL', async () => {
    const fx = installFetch(base());
    const { router } = renderAt('/m/stalls/all', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    await userEvent.setup().selectOptions(screen.getByLabelText('Status'), 'SHORTLISTED');
    await waitFor(() => expect(screen.queryByText('VEN-2026-0001')).not.toBeInTheDocument());
    expect(screen.getByText('LWS-2026-0001')).toBeInTheDocument();
    expect(router.state.location.search).toContain('status=SHORTLISTED');
    expect(fx.calls.some((c) => c.url.includes('status=SHORTLISTED'))).toBe(true);
  });

  test('search is sent as q', async () => {
    const fx = installFetch(base());
    renderAt('/m/stalls/all', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    await userEvent.setup().type(screen.getByLabelText('Search'), 'seva');
    await waitFor(() => expect(fx.calls.some((c) => c.url.includes('q=seva'))).toBe(true));
    await waitFor(() => expect(screen.queryByText('VEN-2026-0001')).not.toBeInTheDocument());
  });

  test('toggles between table and cards', async () => {
    installFetch(base());
    renderAt('/m/stalls/all', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    expect(screen.getByRole('table')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Card view' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Card view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('triage mode opens in cards and clicking one opens the detail panel', async () => {
    const fx = installFetch(base());
    renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Green Leaf Organics'));
    const panel = await screen.findByRole('complementary', { name: 'Request detail' });
    expect(
      await within(panel).findByText('Organic spices, cold-pressed oils, honey'),
    ).toBeInTheDocument();
    expect(
      fx.calls.some((c) => c.url.endsWith('/requests/22222222-2222-4222-8222-222222222222')),
    ).toBe(true);
  });

  test('a lead sees the selection actions; shortlisting calls the API and refreshes', async () => {
    const fx = installFetch([...base(), ['POST', /\/shortlist$/, () => [204, null]]]);
    renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    const user = userEvent.setup();
    await user.click(screen.getByText('Green Leaf Organics'));
    const panel = await screen.findByRole('complementary', { name: 'Request detail' });
    await user.click(await within(panel).findByRole('button', { name: 'Shortlist' }));
    await waitFor(() =>
      expect(fx.calls.some((c) => c.method === 'POST' && c.url.endsWith('/shortlist'))).toBe(true),
    );
  });
});
