import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installFetch, renderAt } from '../test-utils';
import { Users } from './Users';

beforeEach(() => vi.unstubAllGlobals());

function staff(over: Record<string, unknown> = {}) {
  return {
    id: 'p-admin',
    kind: 'STAFF',
    displayName: 'Vikram Sethu',
    email: 'vikram.s@ishafoundation.org',
    phone: null,
    roleKeys: ['stalls_admin'],
    requestCount: null,
    signInState: 'OK',
    lockedUntil: null,
    ...over,
  };
}

function requester(over: Record<string, unknown> = {}) {
  return {
    id: 'a-priya',
    kind: 'REQUESTER',
    displayName: 'Priya Venkat',
    email: 'priya@greenleaf.example',
    phone: '9840012345',
    roleKeys: [],
    requestCount: 2,
    signInState: 'LINK_ONLY',
    lockedUntil: null,
    ...over,
  };
}

/** The tile row the server sends. Its labels ARE the view filter values, so a
 *  test that invented its own would pass while the screen sent nonsense. */
const COUNTS = [
  { label: 'All', count: 2 },
  { label: 'Staff', count: 1 },
  { label: 'Requesters', count: 1 },
  { label: 'Cannot sign in', count: 0 },
  { label: 'Locked out', count: 0 },
];

function page(users: unknown[], counts = COUNTS) {
  return { users, counts, total: users.length, page: 0, pageSize: 50 };
}

const routes = [{ path: '/m/stalls/admin', element: <Users writable /> }];
const render = () => renderAt('/m/stalls/admin', routes, { me: false });

const base = (body: unknown, extra: ReadonlyArray<readonly [string, RegExp, unknown]> = []) =>
  installFetch([
    ['GET', /\/users$/, () => body],
    ...(extra as ReadonlyArray<readonly [string, RegExp, () => unknown]>),
  ]);

/** The one row whose name cell contains `name` — rows are found by who they
 *  are about, never by index, so a re-sort does not silently re-point a test. */
async function rowFor(name: string) {
  const cell = await screen.findByText(name);
  const row = cell.closest('tr');
  expect(row, `expected a row for ${name}`).not.toBeNull();
  return row as HTMLElement;
}

describe('the directory', () => {
  test('shows staff and requesters in one table, told apart by type', async () => {
    base(page([staff(), requester()]));
    render();

    expect(within(await rowFor('Vikram Sethu')).getByText('Staff')).toBeInTheDocument();
    expect(within(await rowFor('Priya Venkat')).getByText('Requester')).toBeInTheDocument();
  });

  test('a requester has no role, and a staff member has no request count', async () => {
    base(page([staff(), requester()]));
    render();

    // The em-dash is the point: the column exists for the other population and
    // says so rather than being blank.
    expect(within(await rowFor('Priya Venkat')).getByText('—')).toBeInTheDocument();
    expect(within(await rowFor('Vikram Sethu')).getByText('Admin')).toBeInTheDocument();
    expect(within(await rowFor('Priya Venkat')).getByText('2')).toBeInTheDocument();
  });

  /** ⚠️ The reason `LINK_ONLY` exists. A vendor who never registered a password
   *  is the ordinary case, and must not be drawn as a problem. */
  test('a requester who never registered reads as "Link only", not as a fault', async () => {
    base(page([requester()]));
    render();

    expect(within(await rowFor('Priya Venkat')).getByText('Link only')).toBeInTheDocument();
    expect(screen.queryByText('Unconfirmed')).not.toBeInTheDocument();
  });
});

describe('the tiles', () => {
  test('are the view filter: picking one asks the server for that view', async () => {
    const fetch = base(page([staff(), requester()]));
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    // The RAW label the server understands, not the retitled "Total Users".
    await user.click(screen.getByRole('button', { name: /Requesters/ }));

    await waitFor(() =>
      expect(
        fetch.calls.some((c) => c.url.includes('/users?') && c.url.includes('view=Requesters')),
      ).toBe(true),
    );
  });

  test('the All tile is titled from the noun, and keeps its raw value on the wire', async () => {
    const fetch = base(page([staff(), requester()]));
    render();
    const user = userEvent.setup();

    await screen.findByText('Total Users');
    await user.click(screen.getByRole('button', { name: /Requesters/ }));
    await user.click(screen.getByRole('button', { name: /Total Users/ }));

    await waitFor(() => expect(fetch.calls.some((c) => c.url.includes('view=All'))).toBe(true));
  });
});

describe('the toolbar', () => {
  test('search reaches the server, debounced into one request', async () => {
    const fetch = base(page([staff(), requester()]));
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    await user.type(screen.getByLabelText('Search users'), 'priya');

    await waitFor(() => expect(fetch.calls.some((c) => c.url.includes('q=priya'))).toBe(true));
    // Five keystrokes, not five requests.
    expect(fetch.calls.filter((c) => c.url.includes('q=')).length).toBe(1);
  });

  test('a role filter narrows the request', async () => {
    const fetch = base(page([staff()]));
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    await user.click(screen.getByRole('button', { name: /Filter/ }));
    // Scoped to the popover: the role names also appear in the Roles panel
    // above, which is the legend for the column rather than a control.
    const panel = screen.getByRole('button', { name: /Filter/ }).parentElement as HTMLElement;
    await user.click(within(panel).getByText('Lead (Stall Coordinator)'));

    await waitFor(() =>
      expect(fetch.calls.some((c) => c.url.includes('roleKey=stalls_lead'))).toBe(true),
    );
  });

  test('Columns hides a column, and Name is not on offer', async () => {
    base(page([staff(), requester()]));
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    expect(screen.getByRole('columnheader', { name: 'Email' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Columns/ }));
    const panel = screen.getByRole('button', { name: /Columns/ }).parentElement as HTMLElement;
    await user.click(within(panel).getByText('Email'));

    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: 'Email' })).not.toBeInTheDocument(),
    );
    // The identity column has no tick box — a directory that can hide who a
    // row is about is a list of email addresses.
    expect(within(panel).queryByText('Name')).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
  });
});

describe('support actions', () => {
  test('Unlock is offered only on a locked row, and asks before it fires', async () => {
    const fetch = base(
      page([requester({ signInState: 'LOCKED', lockedUntil: '2026-09-15T09:00:00.000Z' })]),
      [['POST', /\/users\/a-priya\/unlock$/, () => [204, null]]],
    );
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Unlock Priya Venkat'));
    // Nothing has been sent yet — the dialog is the gate.
    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() =>
      expect(
        fetch.calls.some((c) => c.method === 'POST' && c.url.endsWith('/users/a-priya/unlock')),
      ).toBe(true),
    );
  });

  test('a row that is not locked offers no Unlock', async () => {
    base(page([requester()]));
    render();

    await screen.findByText('Priya Venkat');
    expect(screen.queryByLabelText('Unlock Priya Venkat')).not.toBeInTheDocument();
  });

  test('Resend confirmation is offered only where there is one to confirm', async () => {
    base(page([requester({ signInState: 'UNCONFIRMED' }), staff()]));
    render();

    await screen.findByText('Priya Venkat');
    expect(screen.getByLabelText('Resend confirmation to Priya Venkat')).toBeInTheDocument();
    expect(screen.queryByLabelText('Resend confirmation to Vikram Sethu')).not.toBeInTheDocument();
  });

  /** ⚠️ The dialog names the contact the letter will REACH. An account
   *  registered on a number carries a placeholder address nothing delivers to,
   *  and naming that would promise a letter that never arrives. */
  test('the confirm dialog names the number for an account registered on one', async () => {
    base(
      page([
        requester({
          email: 'mobile+9840012345@stalls.invalid',
          phone: '9840012345',
        }),
      ]),
    );
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Send Priya Venkat their access link'));
    expect(screen.getByText('Goes to 9840012345')).toBeInTheDocument();
  });

  test('cancelling the dialog sends nothing', async () => {
    const fetch = base(page([requester()]));
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Send Priya Venkat their access link'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  test('a read-only caller gets no actions at all', async () => {
    base(page([requester({ signInState: 'LOCKED' })]));
    renderAt('/m/stalls/admin', [{ path: '/m/stalls/admin', element: <Users writable={false} /> }]);

    await screen.findByText('Priya Venkat');
    expect(screen.queryByLabelText('Unlock Priya Venkat')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Send Priya Venkat their access link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a staff member/ })).not.toBeInTheDocument();
  });
});

describe('granting a role', () => {
  test('searches the directory and grants, then reloads the list', async () => {
    const fetch = base(page([staff()]), [
      [
        'GET',
        /\/staff\/search$/,
        () => [
          { personId: 'p-new', displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org' },
        ],
      ],
      ['POST', /\/staff$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    await user.click(screen.getByRole('button', { name: /Add a staff member/ }));
    await user.type(screen.getByLabelText('Search people'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));

    await user.click(await screen.findByRole('button', { name: 'Grant' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/staff'));
      expect(call?.body).toMatchObject({ personRef: 'p-new', roleKey: 'stalls_lead' });
    });
  });

  test('a role is revoked from the chip beside it', async () => {
    const fetch = base(page([staff()]), [
      ['DELETE', /\/staff\/p-admin\/stalls_admin$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Revoke stalls_admin from Vikram Sethu'));

    await waitFor(() =>
      expect(
        fetch.calls.some(
          (c) => c.method === 'DELETE' && c.url.endsWith('/staff/p-admin/stalls_admin'),
        ),
      ).toBe(true),
    );
  });
});
