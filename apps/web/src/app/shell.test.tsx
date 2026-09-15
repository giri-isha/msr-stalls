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
import { stallsPublicRoutes, stallsStaffRoutes } from '@/modules/stalls';
import { installFetch, ME_LEAD } from '@/modules/stalls/test-utils';
import { PublicLayout } from './PublicLayout';
import { StaffLayout } from './StaffLayout';

const ME = ['GET', /\/m\/stalls\/me$/, () => ME_LEAD] as const;
const DASH = [
  'GET',
  /\/m\/stalls\/dashboard$/,
  () => ({
    total: 3,
    byType: { VENDOR: 2, LOCAL_WELFARE: 1, ASHRAM: 0, ASHRAM_FOOD: 0 },
    byStatus: { SUBMITTED: 3 },
    stallsPlanned: 10,
    stallsAllocated: 1,
    flagged: 0,
  }),
] as const;

function renderStaff(path = '/m/stalls') {
  const router = createMemoryRouter(
    [{ path: '/m/stalls', element: <StaffLayout />, children: stallsStaffRoutes }],
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

describe('the staff shell', () => {
  test('shows the dev sign-in when there is no session, and the app once there is', async () => {
    installFetch([
      ['GET', /\/m\/stalls\/me$/, () => [401, { error: 'no session' }]],
      DASH,
      ['GET', /\/dev\/people$/, () => []],
    ]);
    renderStaff();

    expect(await screen.findByText('Sign in — development')).toBeInTheDocument();
    // The chrome must NOT be behind the gate — a signed-out visitor should not
    // be able to Tab into a nav they cannot use.
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });

  test('mounts the nav, the breadcrumb and the dashboard behind it', async () => {
    installFetch([ME, DASH]);
    renderStaff();

    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByTitle('Dashboard')).toBeInTheDocument();
    expect(within(nav).getByTitle('Stall Requests')).toBeInTheDocument();
    // The crumb names the group and the title the route.
    expect(await screen.findByText('Maha Shivratri · MSR Stalls Program')).toBeInTheDocument();
  });

  test('hides the nav items the caller has no action for', async () => {
    // `ME_LEAD` holds both `planning.read` and `config.read`, so one is stripped
    // here — the point is that the filter reads the PRIVILEGES list rather than
    // hard-coding which labels a role sees.
    const noPlanning = {
      ...ME_LEAD,
      privileges: ME_LEAD.privileges.filter((a) => a !== 'planning.read'),
    };
    installFetch([['GET', /\/m\/stalls\/me$/, () => noPlanning], DASH]);
    renderStaff();

    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).queryByTitle('Planning & Zones')).not.toBeInTheDocument();
    expect(within(nav).getByTitle('Admin')).toBeInTheDocument();
  });

  test('the rail control collapses the sidebar and remembers the choice', async () => {
    installFetch([ME, DASH]);
    const { unmount } = renderStaff();

    const collapse = await screen.findByRole('button', { name: 'Collapse sidebar' });
    await userEvent.setup().click(collapse);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
        'aria-expanded',
        'false',
      ),
    );

    unmount();
    installFetch([ME, DASH]);
    renderStaff();
    // Read once at mount, from storage — the sidebar comes back collapsed.
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  test('the account menu carries the identity and the way out', async () => {
    installFetch([ME, DASH]);
    renderStaff();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.getByText(ME_LEAD.displayName)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  test('the theme control sits in the bar, not behind the account menu', async () => {
    installFetch([ME, DASH]);
    renderStaff();

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
    const router = createMemoryRouter(
      [{ path: '/stalls', element: <PublicLayout />, children: stallsPublicRoutes }],
      { initialEntries: ['/stalls/apply'] },
    );
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Request a stall')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /theme/i })).toBeInTheDocument();
    // No sidebar, no account chip: a vendor with a link from an email meets the
    // form and nothing else.
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
  });
});
