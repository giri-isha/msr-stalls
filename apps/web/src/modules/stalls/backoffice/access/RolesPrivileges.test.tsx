import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, installFetch, renderAt } from '../../test-utils';
import { RolesPrivileges } from './RolesPrivileges';

beforeEach(() => vi.unstubAllGlobals());

/**
 * The roles, as the list route now sends them.
 *
 * ⚠️ Every number the grid draws is on the ROW. A card that fetched its own
 * counts would be a request per role, and the grid draws them all at once.
 */
const ROLES = {
  roles: [
    {
      roleKey: 'stalls_admin',
      name: 'Admin',
      description: 'Full access, including module configuration',
      parentKey: null,
      level: 0,
      isSystem: true,
      assignable: true,
      privilegeCount: 16,
      grantCount: 1,
      allPrivileges: true,
      requestTypeScope: [],
    },
    {
      roleKey: 'stalls_lead',
      name: 'Lead (Stall Coordinator)',
      description: 'Planning, selection and finance',
      parentKey: 'stalls_admin',
      level: 1,
      isSystem: true,
      assignable: true,
      privilegeCount: 9,
      grantCount: 2,
      allPrivileges: false,
      requestTypeScope: [],
    },
    {
      roleKey: 'stalls_local_welfare',
      name: 'Local Welfare',
      description: 'Local welfare stalls only',
      parentKey: 'stalls_lead',
      level: 2,
      isSystem: false,
      assignable: true,
      privilegeCount: 4,
      grantCount: 0,
      allPrivileges: false,
      requestTypeScope: ['LOCAL_WELFARE'],
    },
  ],
};

/** The catalogue, from the table rather than from the bundle — `isActive` is
 *  the field the bundle cannot know. */
const PRIVILEGES = {
  privileges: [
    {
      code: 'requests.read',
      label: 'View requests',
      category: 'requests',
      kind: 'view',
      description: 'Every request in the edition.',
      isActive: true,
    },
    {
      code: 'requests.write',
      label: 'Edit requests',
      category: 'requests',
      kind: 'action',
      description: 'Correct a request after it was filed.',
      isActive: true,
    },
    {
      code: 'finance.write',
      label: 'Confirm payments',
      category: 'finance',
      kind: 'action',
      description: 'Match a credit to a request and confirm it.',
      isActive: true,
    },
    {
      code: 'config.write',
      label: 'Change configuration',
      category: 'config',
      kind: 'config',
      description: 'Set the rates, charges and forms an edition runs on.',
      isActive: true,
    },
    {
      code: 'finance.legacy_export',
      label: 'Old finance export',
      category: 'finance',
      kind: 'export',
      description: 'Withdrawn in 2025.',
      isActive: false,
    },
  ],
};

const detail = {
  ...ROLES.roles[1],
  privileges: ['requests.read', 'finance.write'],
  canAssignSameLevel: false,
};

const routes = [{ path: '/m/stalls/access/roles', element: <RolesPrivileges /> }];

const render = (
  me: unknown = ME_ADMIN,
  extra: ReadonlyArray<readonly [string, RegExp, unknown]> = [],
  roles: unknown = ROLES,
) => {
  // ⚠️ Extras FIRST. `installFetch` takes the first route that matches, so a
  // stub appended after the defaults would never be reached — and a test that
  // thought it had overridden the role detail would quietly assert against the
  // default one.
  const fetch = installFetch([
    ...(extra as ReadonlyArray<readonly [string, RegExp, () => unknown]>),
    ['GET', /\/me$/, () => me],
    ['GET', /\/roles$/, () => roles],
    ['GET', /\/privileges$/, () => PRIVILEGES],
    ['GET', /\/roles\/[a-z_]+$/, () => detail],
  ]);
  return { ...renderAt('/m/stalls/access/roles', routes, { me: true }), fetch };
};

/** One card, by the role it is about — never by index, so a re-sort cannot
 *  silently re-point a test. */
const card = async (name: string) => await screen.findByRole('article', { name });

describe('the roles grid', () => {
  test('draws a card per role, saying what it bundles and who holds it', async () => {
    render();
    const admin = await card('Admin');

    expect(within(admin).getByText('16 privileges')).toBeInTheDocument();
    expect(within(admin).getByText('1 user')).toBeInTheDocument();
    expect(within(await card('Lead (Stall Coordinator)')).getByText('2 users')).toBeInTheDocument();
  });

  // The flag resolves against the live table, so the role holds no join rows at
  // all — a card that counted them would call the most powerful role empty.
  test('a role that carries everything says so', async () => {
    render();
    expect(within(await card('Admin')).getByText('Carries every privilege')).toBeInTheDocument();
  });

  test('a card names the role it sits under, and how deep it sits', async () => {
    render();
    const lead = await card('Lead (Stall Coordinator)');
    expect(within(lead).getByText('Admin')).toBeInTheDocument();
    expect(within(lead).getByText('Level 1')).toBeInTheDocument();
  });

  // ⚠️ Empty is EVERY type, which is the opposite of how a filter reads — so the
  // card says it in words rather than leaving the badge blank.
  test('the badge says how far a role reaches across requester types', async () => {
    render();
    expect(within(await card('Admin')).getByText('All requester types')).toBeInTheDocument();
    expect(within(await card('Local Welfare')).getByText('Local welfare')).toBeInTheDocument();
  });

  test('a role that ships with the module cannot be deleted', async () => {
    render();
    const admin = await card('Admin');
    expect(within(admin).getByText('Ships with the module')).toBeInTheDocument();
    expect(within(admin).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  test('a role above the caller cannot be opened', async () => {
    const above = {
      roles: ROLES.roles.map((r) =>
        r.roleKey === 'stalls_admin' ? { ...r, assignable: false } : r,
      ),
    };
    render(ME_ADMIN, [], above);

    const admin = await card('Admin');
    expect(within(admin).getByText('Above you')).toBeInTheDocument();
    expect(within(admin).getByRole('button', { name: /edit/i })).toBeDisabled();
  });

  test('searching narrows the grid to the roles that match', async () => {
    render();
    const user = userEvent.setup();
    await card('Admin');

    await user.type(screen.getByLabelText(/search roles/i), 'welfare');

    expect(await card('Local Welfare')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Admin' })).not.toBeInTheDocument();
  });

  test('the hierarchy view shows the same roles as a tree', async () => {
    render();
    const user = userEvent.setup();
    await card('Admin');

    await user.click(screen.getByRole('button', { name: /hierarchy/i }));

    const tree = await screen.findByRole('list', { name: /role hierarchy/i });
    expect(within(tree).getByText('Local Welfare')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Admin' })).not.toBeInTheDocument();
  });
});

describe('the privilege catalogue', () => {
  const open = async () => {
    const user = userEvent.setup();
    await screen.findByRole('article', { name: 'Admin' });
    await user.click(screen.getByRole('tab', { name: /privileges/i }));
    return user;
  };

  test('lists the vocabulary with the code a route actually enforces', async () => {
    render();
    await open();

    const row = (await screen.findByText('Confirm payments')).closest('tr') as HTMLElement;
    expect(within(row).getByText('finance.write')).toBeInTheDocument();
    expect(within(row).getByText('Finance')).toBeInTheDocument();
    expect(within(row).getByText('action')).toBeInTheDocument();
  });

  // Retired, not deleted — a role that still bundles it keeps resolving, and the
  // compiled-in list is exactly what cannot know this happened.
  test('a retired privilege is shown as retired rather than dropped', async () => {
    render();
    await open();

    const row = (await screen.findByText('Old finance export')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Retired')).toBeInTheDocument();
  });

  // 🔴 The vocabulary is CODE. A privilege authored here would be a code no
  // route enforces — a rule that grants nothing while reading as one that does.
  test('offers no way to invent a privilege', async () => {
    render();
    await open();
    await screen.findByText('Confirm payments');

    expect(screen.queryByRole('button', { name: /add privilege/i })).not.toBeInTheDocument();
  });

  test('searching narrows it, and the category filter narrows it further', async () => {
    render();
    const user = await open();
    await screen.findByText('Confirm payments');

    await user.selectOptions(screen.getByLabelText(/category/i), 'requests');

    expect(screen.getByText('View requests')).toBeInTheDocument();
    expect(screen.queryByText('Confirm payments')).not.toBeInTheDocument();
  });
});

describe('editing a role', () => {
  const open = async (name = 'Lead (Stall Coordinator)') => {
    const user = userEvent.setup();
    const target = await screen.findByRole('article', { name });
    await user.click(within(target).getByRole('button', { name: /edit/i }));
    await screen.findByRole('dialog');
    return user;
  };

  /**
   * The level is TYPED, beside the parent rather than derived from it.
   *
   * ⚠️ The two can disagree, and that is the trade the reference module makes
   * too: the number is a label on the card and the picker, while who may hand
   * out which role is decided by `parentKey` alone. A level that reads oddly
   * therefore changes nobody's reach — `roles-admin.test.ts` pins that.
   */
  test('the level is set here, beside the parent it is independent of', async () => {
    render();
    await open();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/level/i)).toHaveValue(1);
    expect(within(dialog).getByLabelText(/sits under/i)).toHaveValue('stalls_admin');
  });

  test('a retyped level is what saving sends', async () => {
    const { fetch } = render(ME_ADMIN, [['PUT', /\/roles\/[a-z_]+$/, () => detail]]);
    const user = await open();

    const level = within(screen.getByRole('dialog')).getByLabelText(/level/i);
    await user.clear(level);
    await user.type(level, '4');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const sent = fetch.calls.find((c) => c.method === 'PUT')?.body as
        | { level: number }
        | undefined;
      expect(sent?.level).toBe(4);
    });
  });

  test('says how much of the vocabulary the role carries', async () => {
    render();
    await open();

    expect(await screen.findByText('2 of 4 selected')).toBeInTheDocument();
  });

  test('a category is collapsed until opened, and says how much of it is ticked', async () => {
    render();
    const user = await open();

    const finance = (await screen.findByText('Finance')).closest('button') as HTMLElement;
    expect(within(finance).getByText('1/1')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Confirm payments/)).not.toBeInTheDocument();

    await user.click(finance);
    expect(screen.getByLabelText(/Confirm payments/)).toBeChecked();
  });

  test('ticking a category ticks everything in it', async () => {
    render();
    const user = await open();

    await user.click((await screen.findByText('Requests')).closest('button') as HTMLElement);
    // Half ticked to begin with: the role carries `requests.read` and not
    // `requests.write`, which is the state the category box has to resolve.
    expect(screen.getByLabelText(/Edit requests/)).not.toBeChecked();

    await user.click(screen.getByLabelText('Every privilege under Requests'));

    expect(screen.getByLabelText(/View requests/)).toBeChecked();
    expect(screen.getByLabelText(/Edit requests/)).toBeChecked();
  });

  test('searching finds a privilege without knowing its category', async () => {
    render();
    const user = await open();

    await user.type(await screen.findByLabelText(/search privileges/i), 'configuration');

    expect(await screen.findByLabelText(/Change configuration/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Confirm payments/)).not.toBeInTheDocument();
  });

  // 🔴 A role may not carry a privilege its author does not hold — whoever
  // composes a role can hand it to themselves. Shown greyed rather than hidden,
  // so the vocabulary stays legible and the rule is visible before Save.
  test('a privilege the author does not hold cannot be ticked', async () => {
    render({ ...ME_ADMIN, privileges: ['roles.write', 'requests.read', 'finance.write'] });
    const user = await open();

    await user.click((await screen.findByText('Configuration')).closest('button') as HTMLElement);
    expect(screen.getByLabelText(/Change configuration/)).toBeDisabled();
  });

  test('saving sends the ticked set, so a cleared privilege actually leaves', async () => {
    const { fetch } = render(ME_ADMIN, [['PUT', /\/roles\/[a-z_]+$/, () => detail]]);
    const user = await open();

    await user.click((await screen.findByText('Finance')).closest('button') as HTMLElement);
    await user.click(screen.getByLabelText(/Confirm payments/));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const sent = fetch.calls.find((c) => c.method === 'PUT')?.body as
        | { privileges: string[] }
        | undefined;
      expect(sent?.privileges).toEqual(['requests.read']);
    });
  });

  /**
   * 🔴 A retired privilege the role still bundles must survive a save it was
   * not part of. The tree lists the ACTIVE vocabulary, so a bundled-but-retired
   * code is invisible to it — and `setPrivileges` writes the set it is sent, so
   * anything the dialog forgets to mention is silently revoked.
   */
  test('a retired privilege the role still holds is not dropped by saving', async () => {
    const withRetired = { ...detail, privileges: ['requests.read', 'finance.legacy_export'] };
    const { fetch } = render(ME_ADMIN, [
      ['GET', /\/roles\/[a-z_]+$/, () => withRetired],
      ['PUT', /\/roles\/[a-z_]+$/, () => withRetired],
    ]);
    const user = await open();

    await user.click(await screen.findByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const sent = fetch.calls.find((c) => c.method === 'PUT')?.body as
        | { privileges: string[] }
        | undefined;
      expect(sent?.privileges.sort()).toEqual(['finance.legacy_export', 'requests.read']);
    });
  });
});
