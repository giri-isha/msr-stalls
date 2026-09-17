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

    await openEdition(user, 'Stalls 2026');
    await user.type(screen.getByLabelText('Virtual Account Prefix — Rent'), 'STALLRENT');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PATCH');
      expect(call?.body).toMatchObject({
        name: 'Stalls 2026',
        virtualAccountRentPrefix: 'STALLRENT',
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

    await openEdition(user, 'Stalls 2025');
    await user.type(screen.getByLabelText('Virtual Account Prefix — Rent'), 'OLD');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PATCH');
      expect(call?.url).toContain('/editions/e0/settings');
    });
  });
});

// ── When each step opens ────────────────────────────────────────────────────
//
// Three switches say WHETHER a step happens; the grid says WHEN. The lowest
// number still outstanding is what a requester can act on, so all 1s — the
// default — opens everything at once and locks nothing.

describe('the onboarding flow ordering', () => {
  const openFlow = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole('tab', { name: /^flow$/i }));
  };

  test('saves a stage per step per requester type', async () => {
    const fx = base([['PUT', /\/config\/flow$/, () => ({})]]);
    const user = userEvent.setup();
    render();
    await openFlow(user);

    const cell = await screen.findByLabelText(/payment details and confirmation stage for vendor/i);
    await user.clear(cell);
    await user.type(cell, '2');
    await user.click(screen.getByRole('button', { name: /save/i }));

    // ⚠️ The PUT, not the last call — saving reloads the config, so a GET lands
    // after it.
    const put = await waitFor(() => {
      const hit = fx.calls.find((c) => c.method === 'PUT');
      if (!hit) throw new Error('no PUT yet');
      return hit;
    });
    const body = put.body as { stages: Record<string, Record<string, number>> };
    expect(body.stages.VENDOR.PAYMENT).toBe(2);
    // ⚠️ The other types are untouched by a change to one column.
    expect(body.stages.LOCAL_WELFARE.PAYMENT).toBe(1);
  });

  test('One at a time fills a column, All at once puts it back', async () => {
    const fx = base([['PUT', /\/config\/flow$/, () => ({})]]);
    const user = userEvent.setup();
    render();
    await openFlow(user);

    const vendorCol = (await screen.findAllByRole('button', { name: /one at a time/i }))[0];
    await user.click(vendorCol);
    await user.click(screen.getByRole('button', { name: /save/i }));

    const put = await waitFor(() => {
      const hit = fx.calls.find((c) => c.method === 'PUT');
      if (!hit) throw new Error('no PUT yet');
      return hit;
    });
    expect((put.body as { stages: Record<string, Record<string, number>> }).stages.VENDOR).toEqual({
      BANK_FORM: 1,
      PAYMENT: 2,
      FSSAI: 3,
      STAFF_REGISTRATION: 4,
    });

    // And back: all 1s is "everything at once", which is what an edition nobody
    // has configured already does.
    await user.click((await screen.findAllByRole('button', { name: /all at once/i }))[0]);
    await user.click(screen.getByRole('button', { name: /save/i }));

    const puts = await waitFor(() => {
      const all = fx.calls.filter((c) => c.method === 'PUT');
      expect(all.length).toBe(2);
      return all;
    });
    expect(
      (puts[1].body as { stages: Record<string, Record<string, number>> }).stages.VENDOR,
    ).toEqual({ BANK_FORM: 1, PAYMENT: 1, FSSAI: 1, STAFF_REGISTRATION: 1 });
  });

  test('a step a requester type is never asked draws a dash, not an input', async () => {
    const user = userEvent.setup();
    base();
    render();
    await openFlow(user);

    // Local welfare stalls are not invoiced through the vendor flow, so they
    // are never asked for bank details — a gap in the grid would read as a
    // mistake, so the screen says so.
    await screen.findByLabelText(/bank, gst and contract details stage for vendor/i);
    expect(
      screen.queryByLabelText(/bank, gst and contract details stage for local welfare/i),
    ).toBeNull();
    // Ashram departments are billed internally: no payment step either.
    expect(
      screen.queryByLabelText(/payment details and confirmation stage for ashram/i),
    ).toBeNull();
  });
});
