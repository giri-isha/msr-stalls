// SHELL — goes with `app/` at migration, along with what it covers.
//
// The chrome had no test at all while it was a sidebar and a header. It is now
// a rail that collapses, a drawer that traps Escape, a topbar with an account
// menu and a breadcrumb that reads the route — four pieces of state whose only
// other reader is a browser. These are the assertions worth having: that it
// mounts, that the gate does what it says, and that the nav honours the
// caller's actions.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { stallsPublicRoutes, stallsBackofficeRoutes } from '@/modules/stalls';
import { installFetch, ME_LEAD } from '@/modules/stalls/test-utils';
import { PublicLayout } from './PublicLayout';
import { BackofficeLayout } from './BackofficeLayout';

const ME = ['GET', /\/m\/stalls\/me$/, () => ME_LEAD] as const;
/** The landing's payload. ⚠️ `/home`, not `/dashboard` — the Dashboard stopped
 *  being where a member lands when Home took the job, and its counts are on
 *  Reports & Dashboards now. */
const HOME = [
  'GET',
  /\/m\/stalls\/home$/,
  () => ({
    editionLabel: 'Mahashivarathri 2026',
    widgets: [
      {
        key: 'requests_summary',
        label: 'Request Pipeline',
        glyph: 'clipboard-list',
        span: 'full',
        to: '/m/stalls/requests',
        data: { total: 3, submitted: 3, shortlisted: 0, selected: 0, backup: 0, rejected: 0 },
      },
    ],
  }),
] as const;

const SESSION = {
  accountId: 'a-1',
  displayName: 'Priya Venkat',
  email: 'priya@greenleaf.example',
  phone: '9840012345',
};

function renderPublic(path = '/stalls/apply') {
  const router = createMemoryRouter(
    [{ path: '/stalls', element: <PublicLayout />, children: stallsPublicRoutes }],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

function renderBackoffice(path = '/m/stalls') {
  const router = createMemoryRouter(
    [{ path: '/m/stalls', element: <BackofficeLayout />, children: stallsBackofficeRoutes }],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  // The rail preference is per browser and survives a render, so a test that
  // toggles it would otherwise leak into the next one.
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('the backoffice shell', () => {
  test('shows the dev sign-in when there is no session, and the app once there is', async () => {
    installFetch([
      ['GET', /\/m\/stalls\/me$/, () => [401, { error: 'no session' }]],
      HOME,
      ['GET', /\/dev\/people$/, () => []],
    ]);
    renderBackoffice();

    expect(await screen.findByText('Sign in — development')).toBeInTheDocument();
    // The chrome must NOT be behind the gate — a signed-out visitor should not
    // be able to Tab into a nav they cannot use.
    expect(screen.queryByRole('navigation', { name: 'Main Navigation' })).not.toBeInTheDocument();
  });

  test('mounts the nav, the breadcrumb and the dashboard behind it', async () => {
    installFetch([ME, HOME]);
    renderBackoffice();

    const nav = await screen.findByRole('navigation', { name: 'Main Navigation' });
    expect(within(nav).getByTitle('Home')).toBeInTheDocument();
    expect(within(nav).getByTitle('Reports & Dashboards')).toBeInTheDocument();
    expect(within(nav).getByTitle('All Requests')).toBeInTheDocument();
    // The crumb names the heading this caller's sidebar files the screen under,
    // and the title names the screen.
    expect(await screen.findByText('Overview')).toBeInTheDocument();
    expect(await screen.findByText('Mahashivarathri 2026')).toBeInTheDocument();
  });

  test('hides the nav items the caller has no action for', async () => {
    // ⚠️ THREE actions stripped to hide ONE item, and that is the point: the
    // filter reads the privileges list rather than hard-coding which labels a
    // role sees. Planning & Zones is reached by `planning.read` OR `config.read`
    // — the bays, the columns and the rate card are tabs on it now — and a write
    // implies its read, so a lead who kept `planning.write` is still entitled.
    const noPlanning = {
      ...ME_LEAD,
      privileges: ME_LEAD.privileges.filter(
        (a) => a !== 'planning.read' && a !== 'planning.write' && a !== 'config.read',
      ),
    };
    installFetch([['GET', /\/m\/stalls\/me$/, () => noPlanning], HOME]);
    renderBackoffice();

    const nav = await screen.findByRole('navigation', { name: 'Main Navigation' });
    expect(within(nav).queryByTitle('Planning & Zones')).not.toBeInTheDocument();
    expect(within(nav).getByTitle('All Requests')).toBeInTheDocument();
  });

  test('an item gated on either action shows for someone holding just one', async () => {
    // An admin who never plans a stall still sets the bays, the planning columns
    // and the rate card — and those are tabs on Planning & Zones rather than on
    // Admin. One entry, gated on either action, is what that screen now is.
    const configOnly = { ...ME_LEAD, privileges: ['requests.read', 'config.read'] };
    installFetch([['GET', /\/m\/stalls\/me$/, () => configOnly], HOME]);
    renderBackoffice();

    const nav = await screen.findByRole('navigation', { name: 'Main Navigation' });
    expect(within(nav).getByTitle('Planning & Zones')).toBeInTheDocument();
  });

  /** 🔴 The sidebar is SERVED now, not computed in the browser. When `/me`
   *  carries an arrangement the shell draws that and nothing else — which is
   *  what Configs › Sidebar Layout is for. */
  test('draws the sidebar the server resolved, headings and order and all', async () => {
    const arranged = {
      ...ME_LEAD,
      nav: [
        {
          title: 'Every Day',
          items: [
            {
              key: 'checkin',
              to: '/m/stalls/checkin',
              label: 'Check-In',
              glyph: 'circle-check',
              meta: 'Arrivals',
            },
            {
              key: 'home',
              to: '/m/stalls',
              label: 'Home',
              glyph: 'home',
              meta: 'Your cards',
              end: true,
            },
          ],
        },
      ],
    };
    installFetch([['GET', /\/m\/stalls\/me$/, () => arranged], HOME]);
    renderBackoffice();

    const nav = await screen.findByRole('navigation', { name: 'Main Navigation' });
    expect(within(nav).getByText('Every Day')).toBeInTheDocument();
    // In the order the server sent, not the order the registry ships.
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('title')),
    ).toEqual(['Check-In', 'Home']);
    // And nothing the arrangement left out, even though this caller holds it.
    expect(within(nav).queryByTitle('All Requests')).not.toBeInTheDocument();
  });

  test('the rail control collapses the sidebar and remembers the choice', async () => {
    installFetch([ME, HOME]);
    const { unmount } = renderBackoffice();

    const collapse = await screen.findByRole('button', { name: 'Collapse sidebar' });
    await userEvent.setup().click(collapse);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    );

    unmount();
    installFetch([ME, HOME]);
    renderBackoffice();
    // Read once at mount, from storage — the sidebar comes back collapsed.
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  test('the account menu carries the identity and the way out', async () => {
    installFetch([ME, HOME]);
    renderBackoffice();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Account Menu' }));
    expect(screen.getByText(ME_LEAD.displayName)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
  });

  /** 🔴 The refresh re-runs the SCREEN's loads — it is not `location.reload()`.
   *  The two assertions that say so: the home payload is asked for a second
   *  time, and the shell is still standing while it is. */
  test('the refresh re-asks for the screen and for /me, without blanking the shell', async () => {
    const fetches = installFetch([ME, HOME]);
    renderBackoffice();

    await screen.findByText('Mahashivarathri 2026');
    const before = fetches.calls.filter((c) => c.url.endsWith('/home')).length;
    expect(before).toBe(1);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(fetches.calls.filter((c) => c.url.endsWith('/home')).length).toBe(2),
    );
    // `/me` too — a role granted or a sidebar rearranged mid-session lands with
    // the rest rather than waiting for a hard reload.
    expect(fetches.calls.filter((c) => c.url.endsWith('/me')).length).toBe(2);

    // ⚠️ The nav never went away. `MeProvider.reload()` puts the provider back
    // into `loading`, and the gate used to answer that with a full-page spinner
    // — pressing Refresh would have thrown the whole backoffice away and drawn
    // it again, which is the reload this button exists to avoid.
    expect(screen.getByRole('navigation', { name: 'Main Navigation' })).toBeInTheDocument();
    expect(screen.getByText('Mahashivarathri 2026')).toBeInTheDocument();
  });

  test('the theme control sits in the bar, not behind the account menu', async () => {
    installFetch([ME, HOME]);
    renderBackoffice();

    const user = userEvent.setup();
    // Reached without opening anything — that is the point of the move, and
    // asserting it from a closed shell is what would fail if it went back.
    await user.click(await screen.findByRole('button', { name: 'Dark theme' }));

    // ⚠️ The theme is a class on <html>, not component state, so this asserts
    // the document — which is the whole contract the module's tokens rely on.
    expect(document.documentElement).toHaveClass('dark');

    // And back, so the control reads as a toggle rather than a one-way switch.
    await user.click(screen.getByRole('button', { name: 'Light theme' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });
});

describe('the public shell', () => {
  test('wraps the forms and carries nothing but the theme control', async () => {
    // Signed out — the gate is on the page, and the header stays bare.
    installFetch([['GET', /\/public\/session$/, () => [404, { error: 'no session' }]]]);
    renderPublic();

    expect(await screen.findByText('Request a Stall')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument();
    // No sidebar, no account chip: a vendor with a link from an email meets the
    // form and nothing else.
    expect(screen.queryByRole('navigation', { name: 'Main Navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account Menu' })).not.toBeInTheDocument();
  });

  test('signed in, the way to a new request is a button in the header, not a tab', async () => {
    installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      ['GET', /\/public\/requests$/, () => ({ displayName: 'Priya Venkat', requests: [] })],
    ]);
    renderPublic('/stalls/requests');

    const header = await screen.findByRole('banner');
    expect(within(header).getByRole('link', { name: 'New Request' })).toHaveAttribute(
      'href',
      '/stalls/apply',
    );
    expect(within(header).getByText('Priya Venkat')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Log Out' })).toBeInTheDocument();
    // ⚠️ No tab strip. The requests page IS the portal; there is nothing left
    // to tab between, and an action drawn as a tab reads as a place.
    expect(within(header).queryByRole('navigation')).not.toBeInTheDocument();
  });

  test('signed out, the header carries neither the button nor a name', async () => {
    installFetch([['GET', /\/public\/session$/, () => [404, { error: 'no session' }]]]);
    renderPublic('/stalls/login');

    const header = await screen.findByRole('banner');
    expect(within(header).queryByRole('link', { name: 'New Request' })).not.toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: 'Log Out' })).not.toBeInTheDocument();
  });

  /** 🔴 The button is an OFFER, and an offer the post would refuse costs a
   *  requester a whole form to find out. `canFileMore` reads the same count the
   *  submit path enforces on. */
  test('the button goes once the account has spent the edition’s cap', async () => {
    installFetch([
      [
        'GET',
        /\/public\/session$/,
        () => ({ ...SESSION, allowance: { used: 2, max: 2, countedAs: 'still open' } }),
      ],
      ['GET', /\/public\/requests$/, () => ({ displayName: 'Priya Venkat', requests: [] })],
    ]);
    renderPublic('/stalls/requests');

    const header = await screen.findByRole('banner');
    // The name is still there — it is the button that goes, not the session.
    expect(within(header).getByText('Priya Venkat')).toBeInTheDocument();
    expect(within(header).queryByRole('link', { name: 'New Request' })).not.toBeInTheDocument();
  });

  // ⚠️ Four public screens call `useToast()`, and that hook THROWS outside a
  // provider. The shell is the only place that can mount one, so this asserts
  // the wiring from the real route tree rather than from a harness — the
  // module's own tests wrap every render in `ToastProvider`, which is exactly
  // why the public tree could ship without one and no test go red.
  test('mounts the toast host the forms report their failures through', async () => {
    installFetch([
      ['GET', /\/public\/session$/, () => SESSION],
      [
        'GET',
        /\/public\/requests$/,
        () => ({
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
              // A self-serve step, so the card draws the button whose failure
              // path is the one that needs somewhere to report.
              pending: [{ step: 'BANK_FORM', label: 'Bank details pending' }],
            },
          ],
        }),
      ],
      ['POST', /\/public\/requests\/continue$/, () => [500, { error: 'link could not be minted' }]],
    ]);
    renderPublic('/stalls/requests');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open the Form' }));

    // The toast, not a crash: the screen stays up and says what went wrong.
    expect(await screen.findByText('link could not be minted')).toBeInTheDocument();
    expect(screen.getByText('Green Leaf Organics')).toBeInTheDocument();
  });
});
