import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, ME_LEAD, installFetch, renderAt } from '../../test-utils';
import { Users } from './Users';

beforeEach(() => vi.unstubAllGlobals());

function backoffice(over: Record<string, unknown> = {}) {
  return {
    id: 'p-admin',
    kind: 'BACKOFFICE',
    displayName: 'Vikram Sethu',
    email: 'vikram.s@ishafoundation.org',
    phone: null,
    grants: [{ roleKey: 'stalls_admin', editionScope: [], zoneScope: [] }],
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
    grants: [],
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
  { label: 'Backoffice', count: 1 },
  { label: 'Requesters', count: 1 },
  { label: 'Cannot sign in', count: 0 },
  { label: 'Locked out', count: 0 },
];

function page(users: unknown[], counts = COUNTS) {
  return { users, counts, total: users.length, page: 0, pageSize: 50 };
}

const routes = [{ path: '/m/stalls/access/users', element: <Users /> }];
/** ⚠️ `me: true` now. The screen is its own route rather than a tab Admin
 *  handed a `writable` prop to, so it reads the caller's privileges itself —
 *  the same way every other backoffice screen does. */
const render = () => renderAt('/m/stalls/access/users', routes, { me: true });

/**
 * The roles, as the server now sends them.
 *
 * ⚠️ Served, not imported. The screen used to render its pickers from the
 * `ROLES` constant; roles are data now, so the list is fetched and each row
 * carries whether THIS caller may hand it out. Every role here is assignable
 * because these tests act as an admin — the role hierarchy itself is exercised
 * against the tree in `rbac.test.ts` and against the API in `directory.test.ts`.
 */
const ROLE_ROWS = [
  ['stalls_admin', 'Admin', 'Full access, including module configuration', null, 0],
  ['stalls_lead', 'Lead (Stall Coordinator)', 'Planning, selection and finance', 'stalls_admin', 1],
  ['stalls_volunteer', 'Volunteer', 'Check-in, chairs and tables', 'stalls_lead', 2],
  ['stalls_finance', 'Finance', 'Payment confirmation and refunds', 'stalls_lead', 2],
  ['stalls_electrical', 'Electrical & Venue Prep', 'The electrical sheet', 'stalls_lead', 2],
  ['stalls_local_welfare', 'Local Welfare', 'Local welfare stalls only', 'stalls_lead', 2],
] as const;

const ROLES_BODY = {
  roles: ROLE_ROWS.map(([roleKey, name, description, parentKey, level]) => ({
    roleKey,
    name,
    description,
    parentKey,
    level,
    isSystem: true,
    assignable: true,
    privilegeCount: 4,
    grantCount: 1,
    allPrivileges: false,
    requestTypeScope: [],
  })),
};

/** The two axes a grant can be narrowed to. Loaded best-effort by the dialog —
 *  somebody holding `users.write` and neither read simply grants unscoped. */
const ZONES = [
  { id: 'z-a1', code: 'A1', name: 'Bay A1' },
  { id: 'z-b2', code: 'B2', name: 'Bay B2' },
];
const EDITIONS = [
  { id: 'e-2026', year: 2026, name: 'MSR 2026', isActive: true },
  { id: 'e-2025', year: 2025, name: 'MSR 2025', isActive: false },
];

/** ⚠️ Extras FIRST. `installFetch` takes the first route that matches, so a
 *  stub appended after the defaults would never be reached — and a test that
 *  thought it had overridden one would quietly assert against the default. */
const base = (
  body: unknown,
  extra: ReadonlyArray<readonly [string, RegExp, unknown]> = [],
  /** Who is looking. A lead holds no `users.write`, which is how the read-only
   *  cases are expressed now that the screen reads its own gate. */
  me: unknown = ME_ADMIN,
) =>
  installFetch([
    ...(extra as ReadonlyArray<readonly [string, RegExp, () => unknown]>),
    ['GET', /\/me$/, () => me],
    ['GET', /\/users$/, () => body],
    ['GET', /\/roles$/, () => ROLES_BODY],
    ['GET', /\/zones$/, () => ZONES],
    ['GET', /\/editions$/, () => EDITIONS],
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
  test('shows backoffice and requesters in one table, told apart by type', async () => {
    base(page([backoffice(), requester()]));
    render();

    expect(within(await rowFor('Vikram Sethu')).getByText('Backoffice')).toBeInTheDocument();
    expect(within(await rowFor('Priya Venkat')).getByText('Requester')).toBeInTheDocument();
  });

  test('a requester has no role, and a backoffice member has no request count', async () => {
    base(page([backoffice(), requester()]));
    render();

    // The em-dash is the point: the column exists for the other population and
    // says so rather than being blank.
    expect(within(await rowFor('Priya Venkat')).getByText('—')).toBeInTheDocument();
    expect(within(await rowFor('Vikram Sethu')).getByText('Admin')).toBeInTheDocument();
    expect(within(await rowFor('Priya Venkat')).getByText('2')).toBeInTheDocument();
  });

  /** ⚠️ The reason `LINK_ONLY` exists. A vendor who never registered a password
   *  is the ordinary case, and must not be drawn as a problem. */
  test('a requester who never registered reads as "Link Only", not as a fault', async () => {
    base(page([requester()]));
    render();

    expect(within(await rowFor('Priya Venkat')).getByText('Link Only')).toBeInTheDocument();
  });
});

describe('the tiles', () => {
  test('are the view filter: picking one asks the server for that view', async () => {
    const fetch = base(page([backoffice(), requester()]));
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
    const fetch = base(page([backoffice(), requester()]));
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
    const fetch = base(page([backoffice(), requester()]));
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    await user.type(screen.getByLabelText('Search Users'), 'priya');

    await waitFor(() => expect(fetch.calls.some((c) => c.url.includes('q=priya'))).toBe(true));
    // Five keystrokes, not five requests.
    expect(fetch.calls.filter((c) => c.url.includes('q=')).length).toBe(1);
  });

  test('a role filter narrows the request', async () => {
    const fetch = base(page([backoffice()]));
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
    base(page([backoffice(), requester()]));
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
    base(page([requester({ signInState: 'LOCKED' })]), [], ME_LEAD);
    render();

    await screen.findByText('Priya Venkat');
    expect(screen.queryByLabelText('Unlock Priya Venkat')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Send Priya Venkat their access link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add User/ })).not.toBeInTheDocument();
  });
});

/**
 * 🔴 TEMPORARY, with the requester password login — see the screen's own note.
 */
describe("setting a requester's password", () => {
  /** An admin minus the one privilege, which is the only honest way to show
   *  that it is `passwords.write` and not `users.write` opening this. */
  const ME_NO_PASSWORDS = {
    ...ME_ADMIN,
    privileges: ME_ADMIN.privileges.filter((p) => p !== 'passwords.write'),
  };

  test('sends the typed password, and only once it is long enough', async () => {
    const fetch = base(page([requester()]), [
      ['POST', /\/users\/a-priya\/password$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Set a password for Priya Venkat'));

    const set = screen.getByRole('button', { name: 'Set Password' });
    await user.type(screen.getByLabelText('New Password'), 'short');
    expect(set).toBeDisabled();

    await user.type(screen.getByLabelText('New Password'), '-monsoon');
    await user.click(set);

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.url.endsWith('/users/a-priya/password'));
      expect(call?.body).toEqual({ password: 'short-monsoon' });
    });
  });

  /** ⚠️ Not masked, deliberately: the desk is reading it down a phone line. */
  test('the password is legible while it is typed', async () => {
    base(page([requester()]));
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Set a password for Priya Venkat'));
    expect(screen.getByLabelText('New Password')).toHaveAttribute('type', 'text');
  });

  /** A backoffice member signs in through the Foundation. There is no password
   *  here for anyone to set, so the row must not offer one. */
  test('is never offered on a backoffice row', async () => {
    base(page([backoffice(), requester()]));
    render();

    await screen.findByText('Vikram Sethu');
    expect(screen.queryByLabelText('Set a password for Vikram Sethu')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Set a password for Priya Venkat')).toBeInTheDocument();
  });

  test('users.write without passwords.write offers every other action and not this one', async () => {
    base(page([requester({ signInState: 'LOCKED' })]), [], ME_NO_PASSWORDS);
    render();

    await screen.findByText('Priya Venkat');
    expect(screen.getByLabelText('Unlock Priya Venkat')).toBeInTheDocument();
    expect(screen.queryByLabelText('Set a password for Priya Venkat')).not.toBeInTheDocument();
  });

  test('a refusal is shown in the dialog, where the field still is', async () => {
    base(page([requester()]), [
      [
        'POST',
        /\/users\/a-priya\/password$/,
        () => [409, { error: 'another account already signs in with priya@greenleaf.example' }],
      ],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Set a password for Priya Venkat'));
    await user.type(screen.getByLabelText('New Password'), 'monsoon-fig-84');
    await user.click(screen.getByRole('button', { name: 'Set Password' }));

    expect(await screen.findByText(/another account already signs in/)).toBeInTheDocument();
    expect(screen.getByLabelText('New Password')).toBeInTheDocument();
  });
});

describe('granting a role', () => {
  // Position 0 of the assignable list is the caller's MOST privileged role, so
  // any positional default would make Admin the thing granted by an admin who
  // never touched the dropdown. There is no honest default left, so there is
  // none.
  test('will not grant until a role is actually chosen', async () => {
    base(page([backoffice()]), [
      [
        'GET',
        /\/backoffice\/search$/,
        () => [
          { personId: 'p-new', displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org' },
        ],
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    await user.click(screen.getByRole('button', { name: /Add User/ }));
    await user.type(screen.getByLabelText('Search People'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));

    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
    await user.click(await screen.findByLabelText('Kavya Nair'));
    await user.selectOptions(screen.getByLabelText('Role'), 'stalls_volunteer');
    expect(screen.getByRole('button', { name: 'Assign' })).toBeEnabled();
  });

  test('searches the directory and grants, then reloads the list', async () => {
    const fetch = base(page([backoffice()]), [
      [
        'GET',
        /\/backoffice\/search$/,
        () => [
          { personId: 'p-new', displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org' },
        ],
      ],
      ['POST', /\/backoffice$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    await user.click(screen.getByRole('button', { name: /Add User/ }));
    await user.type(screen.getByLabelText('Search People'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));

    // No default role: the picker opens on a placeholder, because position 0 of
    // the assignable list is the caller's MOST privileged role and defaulting
    // to it would grant Admin to anyone who never touched the dropdown.
    await user.click(await screen.findByLabelText('Kavya Nair'));
    await user.selectOptions(screen.getByLabelText('Role'), 'stalls_lead');
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/backoffice'));
      expect(call?.body).toMatchObject({ personRef: 'p-new', roleKey: 'stalls_lead' });
    });
  });
});

describe("editing a backoffice member's roles", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, name = 'Vikram Sethu') => {
    await user.click(await screen.findByLabelText(`Edit ${name}`));
  };

  test('opens with the roles they already hold ticked', async () => {
    base(page([backoffice()]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByRole('radio', { name: 'Admin' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Volunteer' })).not.toBeChecked();
  });

  /**
   * 🔴 ONE role at a time. Choosing another does not add to what somebody
   * holds — it replaces it, because a person in this module holds exactly one
   * role and the screen would otherwise quietly build up a union nobody asked
   * for. Every role they held that is not the chosen one is revoked.
   *
   * ⚠️ Grant BEFORE revoke. The calls are not atomic, so the order decides what
   * a refusal leaves behind: this way a failure leaves them holding both, which
   * an admin can see and fix, rather than holding nothing.
   */
  test('choosing another role replaces the one they hold', async () => {
    const fetch = base(
      page([
        backoffice({
          grants: [
            { roleKey: 'stalls_admin', editionScope: [], zoneScope: [] },
            { roleKey: 'stalls_finance', editionScope: [], zoneScope: [] },
          ],
        }),
      ]),
      [
        ['POST', /\/backoffice$/, () => [204, null]],
        ['DELETE', /\/backoffice\/p-admin\/[a-z_]+$/, () => [204, null]],
      ],
    );
    render();
    const user = userEvent.setup();

    await open(user);
    await user.click(await screen.findByRole('radio', { name: 'Volunteer' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const granted = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/backoffice'));
      expect(granted?.body).toMatchObject({ personRef: 'p-admin', roleKey: 'stalls_volunteer' });
    });
    // Both of the old ones go, and exactly one grant is asked for.
    const revoked = fetch.calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(revoked).toContain('/api/m/stalls/backoffice/p-admin/stalls_admin');
    expect(revoked).toContain('/api/m/stalls/backoffice/p-admin/stalls_finance');
    expect(
      fetch.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/backoffice')),
    ).toHaveLength(1);
  });

  // ⚠️ Says so in words. "Pick one" is a rule a reader should not have to infer
  // from the shape of the controls.
  test('says that a role replaces the one they hold rather than adding to it', async () => {
    base(page([backoffice()]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByText(/one role at a time/i)).toBeInTheDocument();
  });

  test('a Save that changed nothing asks the server for nothing', async () => {
    const fetch = base(page([backoffice()]));
    render();
    const user = userEvent.setup();

    await open(user);
    await user.click(await screen.findByRole('button', { name: /^Save$/ }));

    expect(fetch.calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  /** ⚠️ The dialog claims no rollback, so it must not claim the opposite
   *  either: after a refusal part-way through, what already stuck is gone, and
   *  a second Save must not ask for it again — every grant writes to the trail,
   *  and a repeated one writes that a role was given twice. */
  test('a refusal part-way leaves the dialog describing what actually stuck', async () => {
    const fetch = base(
      page([
        backoffice({
          grants: [
            { roleKey: 'stalls_admin', editionScope: [], zoneScope: [] },
            { roleKey: 'stalls_finance', editionScope: [], zoneScope: [] },
          ],
        }),
      ]),
      [
        ['POST', /\/backoffice$/, () => [204, null]],
        ['DELETE', /\/backoffice\/p-admin\/stalls_finance$/, () => [204, null]],
        [
          'DELETE',
          /\/backoffice\/p-admin\/stalls_admin$/,
          () => [409, { error: 'cannot remove the last stalls admin' }],
        ],
      ],
    );
    render();
    const user = userEvent.setup();

    await open(user);
    await user.click(await screen.findByRole('radio', { name: 'Volunteer' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await screen.findByText(/last stalls admin/);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    // The grant stuck on the first attempt; the second Save must not repeat it.
    await waitFor(() =>
      expect(
        fetch.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/backoffice')),
      ).toHaveLength(1),
    );
  });

  /** ⚠️ Revoking used to be one click on an × in a dense row. It is a dialog
   *  now, and the × must be gone rather than merely duplicated. */
  test('a role can no longer be revoked by a single click in the table', async () => {
    base(page([backoffice()]));
    render();

    await screen.findByText('Vikram Sethu');
    expect(
      screen.queryByLabelText('Revoke stalls_admin from Vikram Sethu'),
    ).not.toBeInTheDocument();
  });
});

/**
 * 🔴 Scope, on the dialog that grants.
 *
 * The two dialogs this replaced disagreed: the one that ADDED a backoffice member
 * offered editions and bays, and the one that edited an existing person's roles
 * did not — it called `grantRole` with no scope at all. Empty means EVERY
 * edition and EVERY bay, so the most-used of the two silently handed out the
 * widest grant the module can express, with nothing on screen saying so.
 */
describe('what a grant reaches', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, name = 'Vikram Sethu') => {
    await user.click(await screen.findByLabelText(`Edit ${name}`));
  };

  test('a role granted to somebody already in the list carries the bays chosen for it', async () => {
    const fetch = base(page([backoffice()]), [['POST', /\/backoffice$/, () => [204, null]]]);
    render();
    const user = userEvent.setup();

    await open(user);
    await user.click(await screen.findByRole('radio', { name: 'Volunteer' }));
    await user.click(screen.getByRole('combobox', { name: 'Bays for Volunteer' }));
    await user.click(await screen.findByRole('option', { name: 'A1 — Bay A1' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/backoffice'));
      expect(call?.body).toMatchObject({
        personRef: 'p-admin',
        roleKey: 'stalls_volunteer',
        zoneScope: ['A1'],
      });
    });
  });

  test('the scope a grant already has is shown, not silently reset', async () => {
    base(
      page([
        backoffice({
          grants: [{ roleKey: 'stalls_admin', editionScope: ['e-2026'], zoneScope: ['B2'] }],
        }),
      ]),
    );
    render();
    const user = userEvent.setup();

    await open(user);

    // The chosen bay reads off the closed control, so what a grant reaches is
    // legible without opening anything.
    expect(await screen.findByRole('combobox', { name: 'Bays for Admin' })).toHaveTextContent(
      'B2 — Bay B2',
    );
    expect(screen.getByRole('combobox', { name: 'Editions for Admin' })).toHaveTextContent('2026');
  });

  // ⚠️ A re-grant RESETS scope on the server, so narrowing one has to travel as
  // a whole grant — and a role nobody touched must not travel at all.
  test('narrowing the role somebody already holds re-sends that one grant', async () => {
    const fetch = base(page([backoffice()]), [['POST', /\/backoffice$/, () => [204, null]]]);
    render();
    const user = userEvent.setup();

    await open(user);
    await user.click(await screen.findByRole('combobox', { name: 'Bays for Admin' }));
    await user.click(await screen.findByRole('option', { name: 'A1 — Bay A1' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const sent = fetch.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/backoffice'));
      expect(sent).toHaveLength(1);
      expect(sent[0]?.body).toMatchObject({ roleKey: 'stalls_admin', zoneScope: ['A1'] });
    });
    // Nothing was revoked: the role did not change, only how far it reaches.
    expect(fetch.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  // ⚠️ Empty is EVERYTHING on both axes, which is the opposite of how a picker
  // usually reads — so the control SAYS it while empty rather than sitting
  // blank and leaving the reader to guess which way round it is.
  test('an empty scope says it means every edition and every bay', async () => {
    base(page([backoffice()]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByRole('combobox', { name: 'Bays for Admin' })).toHaveTextContent(
      'Every bay',
    );
    expect(screen.getByRole('combobox', { name: 'Editions for Admin' })).toHaveTextContent(
      'Every edition, including ones created later',
    );
  });

  // The dialog that adds somebody is the same dialog, so it narrows the same
  // way — this is the half that used to be the only one that could.
  test('a grant made from the add dialog carries its scope too', async () => {
    const fetch = base(page([backoffice()]), [
      [
        'GET',
        /\/backoffice\/search$/,
        () => [
          { personId: 'p-new', displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org' },
        ],
      ],
      ['POST', /\/backoffice$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Vikram Sethu');
    await user.click(screen.getByRole('button', { name: /Add User/ }));
    await user.type(screen.getByLabelText('Search People'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    await user.click(await screen.findByLabelText('Kavya Nair'));
    await user.selectOptions(screen.getByLabelText('Role'), 'stalls_volunteer');
    await user.click(screen.getByRole('combobox', { name: 'Bays' }));
    await user.click(await screen.findByRole('option', { name: 'B2 — Bay B2' }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/backoffice'));
      expect(call?.body).toMatchObject({ roleKey: 'stalls_volunteer', zoneScope: ['B2'] });
    });
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
   *  moves, the password login does not. Backoffice who do not know that will
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
    base(page([backoffice(), requester()]), [], ME_LEAD);
    render();

    await screen.findByText('Priya Venkat');
    expect(screen.queryByLabelText('Edit Priya Venkat')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit Vikram Sethu')).not.toBeInTheDocument();
  });
});

/**
 * Adding somebody the Foundation directory does not have yet.
 *
 * 🔴 **Search first, stage second.** The order is the guard, not the layout: a
 * well-formed but wrong address stages a role for whoever really owns it, so
 * "add them" has to be the answer to a search that found nothing rather than
 * the first thing the dialog offers.
 */
describe('adding somebody who is not in the directory', () => {
  const found = (rows: unknown[]) =>
    ['GET', /\/backoffice\/search$/, () => rows] as readonly [string, RegExp, unknown];

  const openAdd = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText('Vikram Sethu');
    await user.click(screen.getByRole('button', { name: /Add User/ }));
  };

  test('offers to add them only once a search has actually run', async () => {
    base(page([backoffice()]), [found([])]);
    render();
    const user = userEvent.setup();

    await openAdd(user);
    expect(screen.queryByRole('button', { name: 'Add Them' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Search People'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));

    expect(await screen.findByRole('button', { name: 'Add Them' })).toBeInTheDocument();
  });

  test('stages the person and the role in one call', async () => {
    const fetch = base(page([backoffice()]), [
      found([]),
      ['POST', /\/backoffice$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await openAdd(user);
    await user.type(screen.getByLabelText('Search People'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    await user.click(await screen.findByRole('button', { name: 'Add Them' }));

    await user.type(screen.getByLabelText('Name'), 'Kavya Nair');
    await user.type(screen.getByLabelText('Email'), 'kavya.n@ishafoundation.org');
    await user.selectOptions(screen.getByLabelText('Role'), 'stalls_volunteer');
    await user.click(screen.getByRole('button', { name: /Add and assign/ }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/backoffice'));
      expect(call?.body).toMatchObject({
        newPerson: { displayName: 'Kavya Nair', email: 'kavya.n@ishafoundation.org', phone: '' },
        roleKey: 'stalls_volunteer',
      });
    });
    // The one arm or the other — never a body carrying both, which the server
    // refuses outright.
    const call = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/backoffice'));
    expect(call?.body).not.toHaveProperty('personRef');
  });

  test('will not stage until there is a name and an address to stage', async () => {
    base(page([backoffice()]), [found([])]);
    render();
    const user = userEvent.setup();

    await openAdd(user);
    await user.type(screen.getByLabelText('Search People'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    await user.click(await screen.findByRole('button', { name: 'Add Them' }));
    await user.selectOptions(screen.getByLabelText('Role'), 'stalls_volunteer');

    expect(screen.getByRole('button', { name: /Add and assign/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), 'Kavya Nair');
    expect(screen.getByRole('button', { name: /Add and assign/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Email'), 'kavya.n@ishafoundation.org');
    expect(screen.getByRole('button', { name: /Add and assign/ })).toBeEnabled();
  });

  test('the way back to the search is on the staging form', async () => {
    base(page([backoffice()]), [found([])]);
    render();
    const user = userEvent.setup();

    await openAdd(user);
    await user.type(screen.getByLabelText('Search People'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    await user.click(await screen.findByRole('button', { name: 'Add Them' }));
    await user.click(screen.getByRole('button', { name: /Search the Directory Instead/ }));

    expect(screen.getByLabelText('Search People')).toBeInTheDocument();
  });

  /** Marked, not hidden. A row still waiting on its first sign-in is exactly
   *  the one to reuse, and a search that looks like a miss is what produces a
   *  second person on the same address. */
  test('a person somebody already staged is shown, marked as not yet arrived', async () => {
    base(page([backoffice()]), [
      found([
        {
          personId: 'p-new',
          displayName: 'Kavya Nair',
          email: 'kavya.n@ishafoundation.org',
          phone: null,
          staged: true,
        },
      ]),
    ]);
    render();
    const user = userEvent.setup();

    await openAdd(user);
    await user.type(screen.getByLabelText('Search People'), 'kavya');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));

    expect(await screen.findByLabelText('Kavya Nair')).toBeInTheDocument();
    expect(screen.getByText('Not Signed in Yet')).toBeInTheDocument();
  });
});

/** The other half: a backoffice member's own details, which this dialog used
 *  not to offer at all. */
describe("editing a backoffice member's details", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>, name = 'Vikram Sethu') => {
    await user.click(await screen.findByLabelText(`Edit ${name}`));
  };

  test('opens on their name, address and number', async () => {
    base(page([backoffice({ phone: '9840011111' })]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByLabelText('Name')).toHaveValue('Vikram Sethu');
    expect(screen.getByLabelText('Email')).toHaveValue('vikram.s@ishafoundation.org');
    expect(screen.getByLabelText('Phone')).toHaveValue('9840011111');
  });

  test('saves them to the directory, and asks nothing about roles', async () => {
    const fetch = base(page([backoffice()]), [
      ['PATCH', /\/backoffice\/p-admin$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await open(user);
    await user.clear(await screen.findByLabelText('Phone'));
    await user.type(screen.getByLabelText('Phone'), '9840011111');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PATCH');
      expect(call?.url).toBe('/api/m/stalls/backoffice/p-admin');
      expect(call?.body).toMatchObject({
        displayName: 'Vikram Sethu',
        email: 'vikram.s@ishafoundation.org',
        phone: '9840011111',
      });
    });
    expect(fetch.calls.some((c) => c.method === 'POST' || c.method === 'DELETE')).toBe(false);
  });

  /** ⚠️ Details BEFORE roles. The refusal that actually happens is an address
   *  another person holds, and it should land while the role picture is still
   *  as the admin found it. */
  test('a refused detail change leaves the roles untouched', async () => {
    const fetch = base(page([backoffice()]), [
      [
        'PATCH',
        /\/backoffice\/p-admin$/,
        () => [409, { error: 'Arun Kumar is already in the directory with this email' }],
      ],
      ['POST', /\/backoffice$/, () => [204, null]],
      ['DELETE', /\/backoffice\/p-admin\/[a-z_]+$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await open(user);
    await user.clear(await screen.findByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'arun.k@ishafoundation.org');
    await user.click(await screen.findByRole('radio', { name: 'Volunteer' }));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    expect(await screen.findByText(/already in the directory/)).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.method === 'POST' || c.method === 'DELETE')).toBe(false);
  });

  /** A person who really signs in through the Foundation keeps their identity
   *  there; one who has not arrived yet is matched by the address in this box.
   *  Two different facts, so two different sentences. */
  test('says what the address means for somebody who has not signed in yet', async () => {
    base(page([backoffice({ signInState: 'INVITED' })]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByText(/have not signed in yet/i)).toBeInTheDocument();
  });

  test('says the Foundation refreshes it for somebody who has', async () => {
    base(page([backoffice()]));
    render();
    const user = userEvent.setup();

    await open(user);

    expect(await screen.findByText(/next sign-in refreshes it/i)).toBeInTheDocument();
  });
});
