import { fireEvent, screen, waitFor } from '@testing-library/react';
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
// ⚠️ `Configs`, not `Admin`. The five panels this file exercises are five tabs
// of Configs now, and the STRIP that switches between them moved there with
// them — so a test that mounted `AdminPanels` directly could no longer press a
// tab, which is how every case below reaches the panel it is about.
import { Configs } from './Configs';

beforeEach(() => vi.unstubAllGlobals());

const routes = [{ path: '/m/stalls/config', element: <Configs /> }];
const render = () => renderAt('/m/stalls/config', routes, { me: true });

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

  /** 🔴 "Only two requests at a time" is TWO settings, and the screen sends
   *  both. The number alone is not a rule until the scope says two of what —
   *  under "awaiting a decision" a vendor already selected for two bays may
   *  keep applying, and under "every request" two rejections use up their
   *  year. */
  test('sends the cap on requests at a time together with the rule for which count', async () => {
    const fetch = base([['PATCH', /\/editions\/e1\/settings$/, () => ({})]]);
    render();
    const user = userEvent.setup();

    await openEdition(user, 'Stalls 2026');
    // ⚠️ `fireEvent.change` rather than clear-and-type. The field falls back to
    // 1 on an empty box — a spinner that reads blank is not a cap — so clearing
    // it first leaves a 1 behind and typing appends to it.
    const cap = screen.getByLabelText('Requests at a Time');
    fireEvent.change(cap, { target: { value: '3' } });
    await user.click(screen.getByRole('combobox', { name: 'Which Requests Count' }));
    await user.click(screen.getByRole('option', { name: 'Awaiting a decision' }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PATCH');
      expect(call?.body).toMatchObject({
        maxOpenRequests: 3,
        requestCapScope: 'UNDECIDED',
        // The other cap is untouched — the two are separate rules and editing
        // one must not quietly restate the other.
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

// ── Which steps are asked, and when they open ───────────────────────────────
//
// Two grids. The first says WHETHER a step is asked of a requester type; the
// second says WHEN it opens. The lowest number still outstanding is what a
// requester can act on, so all 1s — the default — opens everything at once and
// locks nothing.

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

  test('a step is switched off for one requester type and left on for the others', async () => {
    const fx = base([['PUT', /\/config\/flow$/, () => ({})]]);
    const user = userEvent.setup();
    render();
    await openFlow(user);

    // 🔴 The thing the three edition-wide switches could not say: no FSSAI for
    // an ashram, and the vendor beside it still asked for one.
    await user.click(await screen.findByLabelText(/fssai certificate upload asked of ashram/i));
    await user.click(screen.getByRole('button', { name: /save/i }));

    const put = await waitFor(() => {
      const hit = fx.calls.find((c) => c.method === 'PUT');
      if (!hit) throw new Error('no PUT yet');
      return hit;
    });
    const body = put.body as { asked: Record<string, Record<string, boolean>> };
    expect(body.asked.ASHRAM.FSSAI).toBe(false);
    expect(body.asked.VENDOR.FSSAI).toBe(true);
    expect(body.asked.LOCAL_WELFARE.FSSAI).toBe(true);
  });

  test('staff registration is switchable, which it never used to be', async () => {
    const fx = base([['PUT', /\/config\/flow$/, () => ({})]]);
    const user = userEvent.setup();
    render();
    await openFlow(user);

    await user.click(await screen.findByLabelText(/staff registration asked of local welfare/i));
    await user.click(screen.getByRole('button', { name: /save/i }));

    const put = await waitFor(() => {
      const hit = fx.calls.find((c) => c.method === 'PUT');
      if (!hit) throw new Error('no PUT yet');
      return hit;
    });
    expect(
      (put.body as { asked: Record<string, Record<string, boolean>> }).asked.LOCAL_WELFARE
        .STAFF_REGISTRATION,
    ).toBe(false);
  });

  test('a switched-off step keeps its number, greyed, rather than losing it', async () => {
    const user = userEvent.setup();
    base();
    render();
    await openFlow(user);

    const stage = await screen.findByLabelText(/fssai certificate upload stage for vendor/i);
    expect(stage).not.toBeDisabled();

    await user.click(screen.getByLabelText(/fssai certificate upload asked of vendor/i));
    // ⚠️ Disabled, not blanked. The number is what the ordering returns to if
    // the step is ticked back on, and a stray click must not cost an edition
    // its numbering.
    expect(stage).toBeDisabled();
    expect(stage).toHaveValue(1);
  });

  test('a step a requester type is never asked draws a dash in BOTH grids', async () => {
    const user = userEvent.setup();
    base();
    render();
    await openFlow(user);

    await screen.findByLabelText(/bank, gst and contract details asked of vendor/i);
    expect(
      screen.queryByLabelText(/bank, gst and contract details asked of local welfare/i),
    ).toBeNull();
    expect(screen.queryByLabelText(/payment details and confirmation asked of ashram/i)).toBeNull();
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
