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
});

describe("editing a staff member's roles", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, name = 'Vikram Sethu') => {
    await user.click(await screen.findByLabelText(`Edit ${name}`));
  };

  test('opens with the roles they already hold ticked', async () => {
    base(page([staff()]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByRole('checkbox', { name: 'Admin' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Volunteer' })).not.toBeChecked();
  });

  /** ⚠️ The difference only. A Save that re-granted everything ticked would
   *  write an activity row per role on every visit, and the trail is the one
   *  place "who gave this person finance" gets answered. */
  test('saves only what changed — one grant, one revoke', async () => {
    const fetch = base(page([staff({ roleKeys: ['stalls_admin', 'stalls_finance'] })]), [
      ['POST', /\/staff$/, () => [204, null]],
      ['DELETE', /\/staff\/p-admin\/stalls_finance$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await open(user);
    await user.click(await screen.findByRole('checkbox', { name: 'Volunteer' }));
    await user.click(screen.getByRole('checkbox', { name: 'Finance' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const granted = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/staff'));
      expect(granted?.body).toMatchObject({ personRef: 'p-admin', roleKey: 'stalls_volunteer' });
    });
    expect(
      fetch.calls.some(
        (c) => c.method === 'DELETE' && c.url.endsWith('/staff/p-admin/stalls_finance'),
      ),
    ).toBe(true);
    expect(fetch.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/staff'))).toHaveLength(
      1,
    );
  });

  test('a Save that changed nothing asks the server for nothing', async () => {
    const fetch = base(page([staff()]));
    render();
    const user = userEvent.setup();

    await open(user);
    await user.click(await screen.findByRole('button', { name: /^Save$/ }));

    expect(fetch.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  /** ⚠️ The dialog claims no rollback, so it must not claim the opposite
   *  either: after a refusal part-way through, what already stuck is gone, and
   *  a second Save must not ask for it again — every revoke writes to the
   *  trail, and a repeated one writes that a role was taken away twice. */
  test('a refusal part-way leaves the dialog describing what actually stuck', async () => {
    const fetch = base(page([staff({ roleKeys: ['stalls_admin', 'stalls_finance'] })]), [
      ['DELETE', /\/staff\/p-admin\/stalls_admin$/, () => [204, null]],
      [
        'DELETE',
        /\/staff\/p-admin\/stalls_finance$/,
        () => [409, { error: 'cannot remove the last stalls admin' }],
      ],
    ]);
    render();
    const user = userEvent.setup();

    await open(user);
    await user.click(await screen.findByRole('checkbox', { name: 'Admin' }));
    await user.click(screen.getByRole('checkbox', { name: 'Finance' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await screen.findByText(/last stalls admin/);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() =>
      expect(
        fetch.calls.filter(
          (c) => c.method === 'DELETE' && c.url.endsWith('/staff/p-admin/stalls_admin'),
        ),
      ).toHaveLength(1),
    );
  });

  /** ⚠️ Revoking used to be one click on an × in a dense row. It is a dialog
   *  now, and the × must be gone rather than merely duplicated. */
  test('a role can no longer be revoked by a single click in the table', async () => {
    base(page([staff()]));
    render();

    await screen.findByText('Vikram Sethu');
    expect(
      screen.queryByLabelText('Revoke stalls_admin from Vikram Sethu'),
    ).not.toBeInTheDocument();
  });
});

describe('editing a requester', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByLabelText('Edit Priya Venkat'));
  };

  test('opens with the details the account carries', async () => {
    base(page([requester()]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByLabelText('Name')).toHaveValue('Priya Venkat');
    expect(screen.getByLabelText('Email')).toHaveValue('priya@greenleaf.example');
    expect(screen.getByLabelText('Phone')).toHaveValue('9840012345');
  });

  test('a corrected address is saved and the list reloaded', async () => {
    const fetch = base(page([requester()]), [['PATCH', /\/users\/a-priya$/, () => [204, null]]]);
    render();
    const user = userEvent.setup();

    await open(user);
    const email = await screen.findByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'priya@greenleaf.co.in');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PATCH');
      expect(call?.body).toMatchObject({
        displayName: 'Priya Venkat',
        email: 'priya@greenleaf.co.in',
        phone: '9840012345',
      });
    });
    await waitFor(() =>
      expect(
        fetch.calls.filter((c) => c.method === 'GET' && c.url.includes('/users')),
      ).toHaveLength(2),
    );
  });

  /** ⚠️ The one thing the screen must say out loud: the account's address
   *  moves, the password login does not. Staff who do not know that will
   *  correct an address and then wonder why the vendor still cannot sign in. */
  test('says plainly that an existing password sign-in keeps the old address', async () => {
    base(page([requester({ signInState: 'OK' })]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByText(/password/i)).toBeInTheDocument();
  });

  test('the address another account holds is reported, and the dialog stays open', async () => {
    base(page([requester()]), [
      ['PATCH', /\/users\/a-priya$/, () => [409, { error: 'Arun Kumar already uses this email' }]],
    ]);
    render();
    const user = userEvent.setup();

    await open(user);
    const email = await screen.findByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'arun@spicebox.example');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByText(/Arun Kumar/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  test('a reader who may not write is offered no Edit at all', async () => {
    base(page([staff(), requester()]));
    renderAt('/m/stalls/admin', [{ path: '/m/stalls/admin', element: <Users writable={false} /> }]);

    await screen.findByText('Priya Venkat');
    expect(screen.queryByLabelText('Edit Priya Venkat')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit Vikram Sethu')).not.toBeInTheDocument();
  });
});
