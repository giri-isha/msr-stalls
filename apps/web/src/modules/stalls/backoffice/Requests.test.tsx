import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ME_LEAD, detail, installFetch, onboarding, renderAt, summary } from '../test-utils';
import { RequestDetail } from './RequestDetail';
import { Requests } from './Requests';

afterEach(() => vi.unstubAllGlobals());

// The record's route is mounted alongside the list, because opening one is a
// navigation — a test that only mounted the list would assert against a router
// that has nowhere to go.
const routes = [
  { path: '/m/stalls/requests', element: <Requests /> },
  { path: '/m/stalls/requests/:id', element: <RequestDetail /> },
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
  summary({
    id: '44444444-4444-4444-8444-444444444444',
    reference: 'VEN-2026-0002',
    stallName: 'Kodiveli Idli Kadai',
    status: 'SELECTED',
    stage: 'BANK_FORM_SENT',
    preferredZoneCode: 'B4',
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
        const stage = url.searchParams.get('stage');
        const q = url.searchParams.get('q');
        let list = items;
        if (status) list = list.filter((i) => i.status === status);
        if (stage) list = list.filter((i) => i.stage === stage);
        if (q) list = list.filter((i) => i.stallName.toLowerCase().includes(q.toLowerCase()));
        return { items: list, nextCursor: null };
      },
    ],
    ['GET', /\/requests\/[^/]+$/, () => detail()],
    ['GET', /\/onboarding\/[^/]+$/, () => onboarding()],
  ] as Array<[string, RegExp, (url: URL) => unknown]>;

describe('Requests', () => {
  test('lists requests with reference, type and status', async () => {
    installFetch(base());
    renderAt('/m/stalls/requests', routes, { me: true });
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
    const { router } = renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    await userEvent.setup().selectOptions(screen.getByLabelText('Status'), 'SHORTLISTED');
    await waitFor(() => expect(screen.queryByText('VEN-2026-0001')).not.toBeInTheDocument());
    expect(screen.getByText('LWS-2026-0001')).toBeInTheDocument();
    expect(router.state.location.search).toContain('status=SHORTLISTED');
    expect(fx.calls.some((c) => c.url.includes('status=SHORTLISTED'))).toBe(true);
  });

  test('search is sent as q', async () => {
    const fx = installFetch(base());
    renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    await userEvent.setup().type(screen.getByLabelText('Search'), 'seva');
    await waitFor(() => expect(fx.calls.some((c) => c.url.includes('q=seva'))).toBe(true));
    await waitFor(() => expect(screen.queryByText('VEN-2026-0001')).not.toBeInTheDocument());
  });

  // jsdom is 1024px wide, which `test-setup.ts` answers as `desktop` — so this
  // is the laptop default. The phone default is `useListView.test.ts`, which
  // can set a width before the breakpoint store reads one.
  test('opens as a table on a laptop, and toggles to cards', async () => {
    installFetch(base());
    renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    expect(screen.getByRole('table')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Card View' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Card View' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  // ⚠️ The phone default is a GUESS, and the point of this one is that being
  // told otherwise beats it. The table is the shape that answers "find me this
  // reference", and a narrow screen does not stop somebody needing that.
  test('a chosen shape survives the width and the next visit', async () => {
    installFetch(base());
    renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Card View' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    cleanup();
    installFetch(base());
    renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  describe('the column picker', () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByText('VEN-2026-0001');
      await user.click(screen.getByRole('button', { name: /Columns/ }));
      return within(await screen.findByRole('listbox', { name: 'Columns' }));
    };

    test('hides a column from the table, and remembers it', async () => {
      installFetch(base());
      renderAt('/m/stalls/requests', routes, { me: true });
      const user = userEvent.setup();

      expect(await screen.findByRole('columnheader', { name: 'Stage' })).toBeInTheDocument();
      await user.click((await open(user)).getByRole('option', { name: /Stage$/ }));
      expect(screen.queryByRole('columnheader', { name: 'Stage' })).not.toBeInTheDocument();
      // Every row lost the cell too, not just the header.
      expect(screen.queryByText('Bank Form')).not.toBeInTheDocument();

      cleanup();
      installFetch(base());
      renderAt('/m/stalls/requests', routes, { me: true });
      await screen.findByText('VEN-2026-0001');
      expect(screen.queryByRole('columnheader', { name: 'Stage' })).not.toBeInTheDocument();
    });

    /** ⚠️ Without these two a reader can reach a pipeline of statuses belonging
     *  to nobody, and the way back is the picker they would have to find. */
    test('offers no way to hide the two columns that say which row this is', async () => {
      installFetch(base());
      renderAt('/m/stalls/requests', routes, { me: true });
      const box = await open(userEvent.setup());

      expect(box.queryByRole('option', { name: /Reference$/ })).not.toBeInTheDocument();
      expect(box.queryByRole('option', { name: /Stall$/ })).not.toBeInTheDocument();
      expect(box.getByRole('option', { name: /Status$/ })).toBeInTheDocument();
    });

    test('the button counts what is hidden, and reset puts it back', async () => {
      installFetch(base());
      renderAt('/m/stalls/requests', routes, { me: true });
      const user = userEvent.setup();

      await user.click((await open(user)).getByRole('option', { name: /Zone$/ }));
      expect(screen.getByRole('button', { name: /Columns/ })).toHaveTextContent('1');

      await user.click(screen.getByRole('button', { name: 'Reset' }));
      expect(await screen.findByRole('columnheader', { name: 'Zone' })).toBeInTheDocument();
    });

    /** The cards read a fixed set of fields, so a picker there would be a
     *  control that changes nothing on the screen it is sitting on. */
    test('is not offered with the cards', async () => {
      installFetch(base());
      renderAt('/m/stalls/requests', routes, { me: true });
      const user = userEvent.setup();
      await screen.findByText('VEN-2026-0001');

      await user.click(screen.getByRole('button', { name: 'Card View' }));
      expect(screen.queryByRole('button', { name: /Columns/ })).not.toBeInTheDocument();
    });
  });

  test('clicking a row navigates to the record page', async () => {
    const fx = installFetch(base());
    const { router } = renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    await userEvent.setup().click(screen.getByText('Green Leaf Organics'));
    const page = await screen.findByRole('region', { name: 'Request Detail' });
    expect(
      await within(page).findByText('Organic spices, cold-pressed oils, honey'),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      '/m/stalls/requests/22222222-2222-4222-8222-222222222222',
    );
    expect(
      fx.calls.some((c) => c.url.endsWith('/requests/22222222-2222-4222-8222-222222222222')),
    ).toBe(true);
  });

  test('the record page carries the list filters home on its back link', async () => {
    installFetch(base());
    const { router } = renderAt('/m/stalls/requests?status=SHORTLISTED', routes, { me: true });
    await screen.findByText('LWS-2026-0001');
    const user = userEvent.setup();
    await user.click(screen.getByText('Seva Health Camp'));
    const page = await screen.findByRole('region', { name: 'Request Detail' });
    expect(router.state.location.search).toContain('status=SHORTLISTED');
    await user.click(within(page).getByRole('link', { name: 'All Requests' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/m/stalls/requests'));
    expect(router.state.location.search).toContain('status=SHORTLISTED');
  });

  test('a lead sees the selection actions; shortlisting calls the API and refreshes', async () => {
    const fx = installFetch([...base(), ['POST', /\/shortlist$/, () => [204, null]]]);
    renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    const user = userEvent.setup();
    await user.click(screen.getByText('Green Leaf Organics'));
    const page = await screen.findByRole('region', { name: 'Request Detail' });
    await user.click(await within(page).findByRole('button', { name: 'Shortlist' }));
    await waitFor(() =>
      expect(fx.calls.some((c) => c.method === 'POST' && c.url.endsWith('/shortlist'))).toBe(true),
    );
  });

  test('the stage column reads the onboarding stage, and only where there is one', async () => {
    installFetch(base());
    renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0002');
    const rows = screen.getAllByRole('row');
    const selected = rows.find((r) => within(r).queryByText('Kodiveli Idli Kadai'));
    const submitted = rows.find((r) => within(r).queryByText('Green Leaf Organics'));
    expect(within(selected as HTMLElement).getByText('Bank Form Sent')).toBeInTheDocument();
    // Not selected yet, so there is no onboarding to be at a stage of.
    expect(within(submitted as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  test('the record page tabs the forms the requester has since filled', async () => {
    installFetch(base());
    renderAt('/m/stalls/requests/22222222-2222-4222-8222-222222222222', routes, { me: true });
    const page = await screen.findByRole('region', { name: 'Request Detail' });
    const user = userEvent.setup();
    // The application is what opens; the forms are tabs beside it.
    expect(await within(page).findByText('Organic spices, cold-pressed oils, honey')).toBeVisible();
    await user.click(await within(page).findByRole('tab', { name: 'Bank Form' }));
    expect(await within(page).findByText('HDFC0001234')).toBeInTheDocument();
    // And "All details" is every form at once, without the tabbing.
    await user.click(within(page).getByRole('tab', { name: 'All Details' }));
    expect(within(page).getByText('HDFC0001234')).toBeInTheDocument();
    expect(within(page).getByText('Organic spices, cold-pressed oils, honey')).toBeInTheDocument();
  });

  test('a form nobody asked this requester for gets no tab at all', async () => {
    installFetch([
      ...base().filter(([, re]) => !re.source.includes('onboarding')),
      // An ashram department is never asked for bank details, and this stall
      // is not food. Absent, not empty — an empty tab would say "asked, not
      // answered", which is a vendor somebody has to chase.
      [
        'GET',
        /\/onboarding\/[^/]+$/,
        () => onboarding({ bankDetails: 'NOT_APPLICABLE', fssai: 'NOT_APPLICABLE' }),
      ],
    ] as Array<[string, RegExp, (url: URL) => unknown]>);
    renderAt('/m/stalls/requests/22222222-2222-4222-8222-222222222222', routes, { me: true });
    const page = await screen.findByRole('region', { name: 'Request Detail' });
    await within(page).findByRole('tab', { name: 'Application' });
    expect(within(page).queryByRole('tab', { name: 'Bank Form' })).not.toBeInTheDocument();
    expect(within(page).queryByRole('tab', { name: 'FSSAI' })).not.toBeInTheDocument();
  });

  test('the stage filter narrows the list through the API and the URL', async () => {
    const fx = installFetch(base());
    const { router } = renderAt('/m/stalls/requests', routes, { me: true });
    await screen.findByText('VEN-2026-0001');
    await userEvent.setup().selectOptions(screen.getByLabelText('Stage'), 'BANK_FORM_SENT');
    await waitFor(() => expect(screen.queryByText('VEN-2026-0001')).not.toBeInTheDocument());
    expect(screen.getByText('VEN-2026-0002')).toBeInTheDocument();
    expect(router.state.location.search).toContain('stage=BANK_FORM_SENT');
    expect(fx.calls.some((c) => c.url.includes('stage=BANK_FORM_SENT'))).toBe(true);
  });
});
