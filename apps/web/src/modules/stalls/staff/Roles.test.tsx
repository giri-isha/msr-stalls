import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, installFetch, renderAt } from '../test-utils';
import { Roles } from './Roles';

beforeEach(() => vi.unstubAllGlobals());

const ROLE_ROWS = [
  ['stalls_admin', 'Admin', null, 0, true, true],
  ['stalls_lead', 'Lead (Stall Coordinator)', 'stalls_admin', 1, true, true],
  ['stalls_volunteer', 'Volunteer', 'stalls_lead', 2, true, true],
] as const;

const list = {
  roles: ROLE_ROWS.map(([roleKey, name, parentKey, depth, isSystem, assignable]) => ({
    roleKey,
    name,
    description: `${name} does things`,
    parentKey,
    depth,
    isSystem,
    assignable,
  })),
};

const detail = {
  ...list.roles[2],
  privileges: ['requests.read', 'checkin.write'],
  allPrivileges: false,
  canAssignSameLevel: false,
  requestTypeScope: [],
  grantCount: 0,
};

const routes = [{ path: '/m/stalls/admin', element: <Roles writable /> }];

const render = (
  me: unknown = ME_ADMIN,
  extra: ReadonlyArray<readonly [string, RegExp, unknown]> = [],
) => {
  const fetch = installFetch([
    ['GET', /\/me$/, () => me],
    ['GET', /\/roles$/, () => list],
    ['GET', /\/roles\/[a-z_]+$/, () => detail],
    ...(extra as ReadonlyArray<readonly [string, RegExp, () => unknown]>),
  ]);
  return { ...renderAt('/m/stalls/admin', routes, { me: true }), fetch };
};

describe('the roles screen', () => {
  test('lists the roles the server sent, not a copy shipped in the bundle', async () => {
    render();
    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Volunteer')).toBeInTheDocument();
  });

  // The seed would put a shipped role straight back, and grants refer to its key.
  test('marks the roles that ship with the module', async () => {
    render();
    expect((await screen.findAllByText('Ships with the module')).length).toBe(3);
  });

  test('a role above the caller cannot be opened', async () => {
    const above = {
      roles: list.roles.map((r) =>
        r.roleKey === 'stalls_admin' ? { ...r, assignable: false } : r,
      ),
    };
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/roles$/, () => above],
    ]);
    renderAt('/m/stalls/admin', routes, { me: true });

    expect(await screen.findByText('Above you')).toBeInTheDocument();
    const rows = screen.getAllByRole('button', { name: 'Edit' });
    expect(rows[0]).toBeDisabled();
  });

  test('opening one shows what it currently carries', async () => {
    render();
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[2]);
    await waitFor(() => expect(screen.getByLabelText(/View requests/)).toBeChecked());
    expect(screen.getByLabelText(/Plan and allot stalls/)).not.toBeChecked();
  });

  // 🔴 A role may not carry a privilege its author does not hold — whoever
  // composes a role can hand it to themselves. The box is shown greyed rather
  // than hidden, so the vocabulary stays legible.
  test('a privilege the author does not hold cannot be ticked', async () => {
    const limited = { ...ME_ADMIN, privileges: ['roles.write', 'requests.read'] };
    render(limited);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[2]);
    await waitFor(() => expect(screen.getByLabelText(/View requests/)).toBeEnabled());
    expect(screen.getByLabelText(/Change configuration/)).toBeDisabled();
  });

  test('saving sends the ticked set, so a cleared privilege actually leaves', async () => {
    const { fetch } = render(ME_ADMIN, [['PUT', /\/roles\/[a-z_]+$/, () => detail]]);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole('button', { name: 'Edit' }))[2]);
    await waitFor(() => expect(screen.getByLabelText(/View requests/)).toBeChecked());
    await user.click(screen.getByLabelText(/View requests/));
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PUT');
      const sent = call?.body as { privileges: string[] } | undefined;
      expect(sent?.privileges).toEqual(['checkin.write']);
    });
  });
});
