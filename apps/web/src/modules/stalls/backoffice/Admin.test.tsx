import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  BACKOFFICE_CONFIG,
  EDITIONS,
  ME_ADMIN,
  PAST_CONFIG,
  installFetch,
  renderAt,
} from '../test-utils';
import { Admin } from './Admin';

beforeEach(() => vi.unstubAllGlobals());

const routes = [{ path: '/m/stalls/admin', element: <Admin /> }];
const render = () => renderAt('/m/stalls/admin', routes, { me: true });

const base = (extra: ReadonlyArray<readonly [string, RegExp, unknown]> = []) =>
  installFetch([
    ['GET', /\/me$/, () => ME_ADMIN],
    [
      'GET',
      /\/config$/,
      (url: URL) => (url.searchParams.get('editionId') === 'e0' ? PAST_CONFIG : BACKOFFICE_CONFIG),
    ],
    ['GET', /\/editions$/, () => EDITIONS],
    ...(extra as ReadonlyArray<readonly [string, RegExp, () => unknown]>),
  ]);

describe('edition settings', () => {
  /** ⚠️ Nothing is editable until a row's pencil is pressed. The settings used
   *  to be five inputs open on the tab; they belong to an edition, so they are
   *  reached through the edition. */
  const openEdition = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(await screen.findByRole('tab', { name: /editions/i }));
    await user.click(await screen.findByLabelText(`Edit ${name}`));
  };

  test('sends the account prefixes Finance issues, and empty means not issued', async () => {
    const fetch = base([['PATCH', /\/editions\/e1\/settings$/, () => ({})]]);
    render();
    const user = userEvent.setup();

    await openEdition(user, 'MSR 2026');
    await user.type(screen.getByLabelText('Virtual Account Prefix — Rent'), 'MSRRENT');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PATCH');
      expect(call?.body).toMatchObject({
        name: 'MSR 2026',
        virtualAccountRentPrefix: 'MSRRENT',
        // Never issued, and sent as null rather than an empty string — the API
        // reads null as "Finance has not issued one for this edition".
        virtualAccountDepositPrefix: null,
        maxStallsPerRequest: 3,
      });
    });
  });

  /** 🔴 The one write on this screen that does not go to the active edition.
   *  Every other panel writes to whatever is active regardless of the selector,
   *  which is why they go read-only on a past year and this row does not. */
  test('edits a past edition on its own row, not the active one', async () => {
    const fetch = base([['PATCH', /\/editions\/e0\/settings$/, () => ({})]]);
    render();
    const user = userEvent.setup();

    await openEdition(user, 'MSR 2025');
    await user.type(screen.getByLabelText('Virtual Account Prefix — Rent'), 'OLD');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PATCH');
      expect(call?.url).toContain('/editions/e0/settings');
    });
  });
});
