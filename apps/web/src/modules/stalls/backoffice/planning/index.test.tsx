import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  BACKOFFICE_CONFIG,
  choose,
  EDITIONS,
  installFetch,
  ME_ADMIN,
  ME_LEAD,
  PAST_CONFIG,
  renderAt,
} from '../../test-utils';
import { Planning } from '.';

beforeEach(() => vi.unstubAllGlobals());

const routes = [{ path: '/m/stalls/planning', element: <Planning /> }];
const render = () => renderAt('/m/stalls/planning', routes, { me: true });

/** The plan grid, stubbed although most of the suites below click straight past
 *  it. The Plan tab is what the strip opens on, so it mounts whatever the test
 *  is about — and an unstubbed screen behind the one under test is an error
 *  banner waiting to be read as the real failure. */
const PLAN = {
  crowdPerStall: 1000,
  categories: BACKOFFICE_CONFIG.planCategories.map(({ key, name, isFood }) => ({
    key,
    name,
    isFood,
  })),
  rows: [
    {
      zoneCode: 'C1',
      zoneName: 'C1 — Moon side',
      isClosedToVendors: false,
      expectedCrowd: 25000,
      suggested: 25,
      counts: { VENDOR_FOOD: 4, BACKUP: 0 },
      total: 4,
      stallsExisting: 0,
      stallsAllocated: 0,
    },
  ],
  totals: { byCategory: { VENDOR_FOOD: 4, BACKUP: 0 }, grandTotal: 4 },
};

const base = (extra: ReadonlyArray<readonly [string, RegExp, unknown]> = []) =>
  installFetch([
    ['GET', /\/me$/, () => ME_ADMIN],
    ['GET', /\/planning$/, () => PLAN],
    [
      'GET',
      /\/config$/,
      (url: URL) => (url.searchParams.get('editionId') === 'e0' ? PAST_CONFIG : BACKOFFICE_CONFIG),
    ],
    ['GET', /\/editions$/, () => EDITIONS],
    ...(extra as ReadonlyArray<readonly [string, RegExp, () => unknown]>),
  ]);

/**
 * Renders the screen and opens one of its tabs.
 *
 * ⚠️ Every suite below says which panel it is about. These five used to be on
 * Admin, where Bays happened to be the first tab and a test could just wait for
 * a bay to appear; here the strip opens on Plan, because the grid is what the
 * screen is named for.
 */
const openTab = async (name: RegExp) => {
  render();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name }));
  return user;
};

/** The body of the one call matching `method`, asserted to exist first — a
 *  missing call should fail as "nothing was sent", not as a TypeError several
 *  lines later. */
function sentBody<T>(fetch: ReturnType<typeof installFetch>, method: string): T {
  const call = fetch.calls.find((c) => c.method === method);
  expect(call, `expected a ${method} to have been sent`).toBeDefined();
  return call?.body as T;
}

/**
 * 🔴 Each tab carries its OWN privilege, and this is the suite that says so.
 *
 * The five configuration panels moved here from Admin, where they were gated on
 * `config.read`. Folding them into the page's `planning.read` would have handed
 * the rate card to every coordinator who plans stalls, and taken the panels away
 * from every admin who does not.
 */
describe('the strip', () => {
  const planningOnly = {
    ...ME_LEAD,
    roleKeys: ['stalls_volunteer'],
    privileges: ['planning.read', 'planning.write'],
  };

  test('a coordinator who only plans gets the grid, and is never asked for the configuration', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => planningOnly],
      ['GET', /\/planning$/, () => PLAN],
    ]);
    render();

    // One tab is no strip at all — the page is the grid, as it was before.
    expect(await screen.findByTestId('grand-total')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /rates/i })).not.toBeInTheDocument();
    // ⚠️ Not merely hidden. A request the API is right to refuse would show up
    // as an error banner on a screen the coordinator is entitled to.
    expect(fetch.calls.some((c) => c.url.includes('/config'))).toBe(false);
  });

  test('an admin who never plans still gets the configuration tabs, and opens on the first', async () => {
    installFetch([
      ['GET', /\/me$/, () => ({ ...ME_ADMIN, privileges: ['config.read', 'config.write'] })],
      ['GET', /\/config$/, () => BACKOFFICE_CONFIG],
      ['GET', /\/editions$/, () => EDITIONS],
    ]);
    render();

    expect(await screen.findByLabelText('Edit C1')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^plan$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^bays$/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('the grid never carries the edition selector', async () => {
    base();
    render();

    // 🔴 `getPlan` takes no edition, so the grid is ALWAYS the active one. A
    // "Showing Stalls 2025" over it would name a year it is not showing.
    await screen.findByTestId('grand-total');
    expect(screen.queryByLabelText('Showing')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^bays$/i }));
    expect(await screen.findByLabelText('Showing')).toBeInTheDocument();
  });
});

describe('bays', () => {
  test('adds a bay for a layout that has been redrawn', async () => {
    const fetch = base([['POST', /\/config\/zones$/, () => ({ id: 'z-d1' })]]);
    const user = await openTab(/^bays$/i);
    // The panel's header button opens the box; the fields are inside it.
    await user.click(screen.getByRole('button', { name: 'Add bay' }));
    const box = within(await screen.findByRole('dialog'));
    await user.type(box.getByLabelText('Code'), 'D1');
    await user.type(box.getByLabelText('Name'), 'D1 — new lawn');
    await user.type(box.getByLabelText('Expected Crowd'), '8000');
    await user.click(box.getByRole('button', { name: 'Add bay' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/config/zones'));
      expect(call?.body).toMatchObject({ code: 'D1', name: 'D1 — new lawn', expectedCrowd: 8000 });
    });
  });

  // ⚠️ Disabled with the reason on it, not offered and then refused. Removing a
  // bay that holds stalls would have to cascade away the stalls, the
  // allocations and the record of who stood where.
  test('a bay with stalls in it cannot be removed, and says why', async () => {
    base();
    await openTab(/^bays$/i);

    expect(screen.getByLabelText('Remove C1')).toBeEnabled();
    expect(screen.getByLabelText(/A3 has 6 stalls and cannot be removed/)).toBeDisabled();
  });

  // The figures are read in the row and changed in the box the pencil opens —
  // so what the row shows and what the dialog sends are one assertion apart.
  test('editing a bay sends what the dialog was left holding', async () => {
    const fetch = base([['PUT', /\/config\/zones\/C1$/, () => ({})]]);
    const user = await openTab(/^bays$/i);
    await user.click(await screen.findByLabelText('Edit C1'));
    // Scoped to the dialog. Kept scoped although the add form is a dialog of
    // its own now and cannot be open at the same time: the box is what the
    // test is about, and naming it is how the assertion stays readable.
    const box = within(screen.getByRole('dialog'));
    await user.clear(box.getByLabelText('Name'));
    await user.type(box.getByLabelText('Name'), 'C1 — Moon side, widened');
    await user.clear(box.getByLabelText('Expected Crowd'));
    await user.type(box.getByLabelText('Expected Crowd'), '31000');
    await user.click(box.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PUT');
      expect(call?.body).toMatchObject({
        name: 'C1 — Moon side, widened',
        expectedCrowd: 31000,
        isClosedToVendors: false,
      });
    });
  });

  test('removing an empty bay asks the API to delete it', async () => {
    const fetch = base([['DELETE', /\/config\/zones\/C1$/, () => null]]);
    const user = await openTab(/^bays$/i);
    await user.click(screen.getByLabelText('Remove C1'));

    await waitFor(() =>
      expect(
        fetch.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/config/zones/C1')),
      ).toBe(true),
    );
  });
});

describe('planning columns', () => {
  const open = () => openTab(/planning columns/i);

  // 🔴 The 2025 sheet carries sponsor and Adiyogi columns the old enum never
  // had, so a sponsor stall could not be counted apart from an ashram one.
  test('adds a column the sheet carries and the enum never had', async () => {
    const fetch = base([['PUT', /\/config\/plan-categories$/, () => ({})]]);
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Add column' }));
    const box = within(await screen.findByRole('dialog'));
    await box.findByLabelText('Key');
    await user.type(box.getByLabelText('Key'), 'SPONSOR_FOOD');
    await user.type(box.getByLabelText('Column Heading'), 'Sponsor food');
    await user.click(box.getByRole('button', { name: 'Add column' }));
    await user.click(screen.getByRole('button', { name: /save columns/i }));

    await waitFor(() => {
      const body = sentBody<{ categories: Array<{ key: string }> }>(fetch, 'PUT');
      expect(body.categories.map((x) => x.key)).toEqual(['VENDOR_FOOD', 'BACKUP', 'SPONSOR_FOOD']);
    });
  });

  test('a column already planned against offers no delete at all', async () => {
    base();
    await open();

    expect(screen.getByText('In use')).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove VENDOR_FOOD')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remove BACKUP')).toBeInTheDocument();
  });

  test('reordering renumbers the columns from their new positions', async () => {
    const fetch = base([['PUT', /\/config\/plan-categories$/, () => ({})]]);
    const user = await open();

    await user.click(screen.getByLabelText('Move BACKUP up'));
    await user.click(screen.getByRole('button', { name: /save columns/i }));

    await waitFor(() => {
      const body = sentBody<{ categories: Array<{ key: string; sortOrder: number }> }>(
        fetch,
        'PUT',
      );
      expect(body.categories).toEqual([
        { key: 'BACKUP', name: 'Backup', isFood: false, sortOrder: 0 },
        { key: 'VENDOR_FOOD', name: 'Vendor food', isFood: true, sortOrder: 1 },
      ]);
    });
  });
});

describe('the rent matrix', () => {
  test('a bay closed to trade still takes its local welfare figures', async () => {
    base();
    const user = await openTab(/^rates$/i);

    // Closed to trade, so the row says so where the two vendor figures would be…
    expect(screen.getAllByText('Closed to Trade').length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText('Edit A3 food rates'));
    // …and the box offers no vendor fields at all, rather than empty ones
    // nobody may fill.
    expect(screen.queryByLabelText('Vendor Rent')).not.toBeInTheDocument();
    // …and it is priced for local welfare, which is the whole point of the rework.
    expect(screen.getByLabelText('Local Welfare Rent')).toHaveValue(12000);
    expect(screen.getByLabelText('Local Welfare Advance')).toHaveValue(4000);
  });

  test('a row left at zero is dropped rather than saved as a free stall', async () => {
    const fetch = base([['PUT', /\/config\/rate-card$/, () => ({})]]);
    const user = await openTab(/^rates$/i);
    await user.click(screen.getByLabelText('Edit C1 food rates'));
    await user.clear(screen.getByLabelText('Vendor Rent'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: /save rates/i }));

    await waitFor(() => {
      const body = sentBody<{ entries: Array<{ zoneCode: string }> }>(fetch, 'PUT');
      expect(body.entries.map((e) => e.zoneCode)).toEqual(['A3']);
    });
  });
});

describe('charges', () => {
  const openCharges = () => openTab(/^charges$/i);

  // 🔴 The figures are READ in the row and changed in the box the pencil opens.
  // Forty-five live number inputs was a wall nobody could read a price off, and
  // left every rate one stray keystroke from moving while an admin scrolled.
  test('the matrix is read only, and the pencil opens the row', async () => {
    const fetch = base([
      ['PUT', /\/config\/charges$/, () => ({})],
      ['PUT', /\/config\/charge-items$/, () => []],
    ]);
    const user = await openCharges();

    // Nothing in the table is typeable.
    expect(screen.queryByLabelText('Chair rate, Vendor')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Edit Chair'));
    const box = within(await screen.findByRole('dialog'));
    await user.clear(box.getByLabelText('Vendor'));
    await user.type(box.getByLabelText('Vendor'), '250');
    await user.click(box.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save Charges' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PUT' && c.url.endsWith('/config/charges'));
      expect(call?.body).toMatchObject({ vendorChairRatePaise: 25_000 });
    });
  });

  // 🔴 Chair and Table used to read "Always". The 2025 forms do quote them by
  // the day, but a year the team charges flat, the only way to say so was
  // halving the rate and setting the days to one — which prices correctly and
  // reads as a lie on the payment letter.
  test('chair and table can be taken off the daily rate', async () => {
    const fetch = base([
      ['PUT', /\/config\/charges$/, () => ({})],
      ['PUT', /\/config\/charge-items$/, () => []],
    ]);
    const user = await openCharges();

    await user.click(screen.getByLabelText('Edit Table'));
    const box = within(await screen.findByRole('dialog'));
    await user.click(box.getByLabelText('Charged per day'));
    await user.click(box.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save Charges' }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PUT' && c.url.endsWith('/config/charges'));
      expect(call?.body).toMatchObject({ tablePerDay: false, chairPerDay: true });
    });
  });

  // 🔴 Archiving and deleting are two different acts. One button could only
  // offer whichever the row's state selected, so an archived item that had
  // never been lent offered a bin and no way back — the one state where
  // bringing it back is most obviously what somebody meant.
  test('an archived item can be brought back', async () => {
    const fetch = base([
      ['PUT', /\/config\/charges$/, () => ({})],
      ['PUT', /\/config\/charge-items$/, () => []],
    ]);
    const user = await openCharges();

    await user.click(screen.getByLabelText('Archive Fan'));
    expect(screen.getByText('Archived')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Unarchive Fan'));
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save Charges' }));
    await waitFor(() => {
      const body = fetch.calls.find((c) => c.url.endsWith('/config/charge-items'))?.body as
        | { items: Array<{ isActive: boolean }> }
        | undefined;
      expect(body?.items[0].isActive).toBe(true);
    });
  });

  // ⚠️ The key is what the audit trail and the challan quote, so a rename must
  // not move it — the row that says a vendor was handed two of them is keyed on
  // it.
  test('renaming an item keeps the key it was lent under', async () => {
    const fetch = base([
      ['PUT', /\/config\/charges$/, () => ({})],
      ['PUT', /\/config\/charge-items$/, () => []],
    ]);
    const user = await openCharges();

    await user.click(screen.getByLabelText('Edit Fan'));
    const box = within(await screen.findByRole('dialog'));
    await user.clear(box.getByLabelText('Name'));
    await user.type(box.getByLabelText('Name'), 'Pedestal Fan');
    await user.click(box.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save Charges' }));

    await waitFor(() => {
      const body = fetch.calls.find((c) => c.url.endsWith('/config/charge-items'))?.body as
        | { items: Array<{ key: string; name: string }> }
        | undefined;
      expect(body?.items[0]).toMatchObject({ key: 'FAN', name: 'Pedestal Fan' });
    });
  });

  // A new row carries a stand-in id so React can key it. It is not a uuid and
  // the server would refuse it, so it must not be sent.
  test('a new item is sent without its stand-in id', async () => {
    const fetch = base([
      ['PUT', /\/config\/charges$/, () => ({})],
      ['PUT', /\/config\/charge-items$/, () => []],
    ]);
    const user = await openCharges();

    await user.click(screen.getByRole('button', { name: 'Add Item' }));
    const box = within(await screen.findByRole('dialog'));
    await user.type(box.getByLabelText('Name'), 'Carpet');
    await user.clear(box.getByLabelText('Vendor'));
    await user.type(box.getByLabelText('Vendor'), '500');
    await user.click(box.getByLabelText('Charged per day'));
    await user.click(box.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save Charges' }));

    await waitFor(() => {
      const body = fetch.calls.find((c) => c.url.endsWith('/config/charge-items'))?.body as
        | { items: Array<Record<string, unknown>> }
        | undefined;
      const carpet = body?.items.find((i) => i.key === 'CARPET');
      expect(carpet).toMatchObject({ name: 'Carpet', vendorRatePaise: 50_000, perDay: false });
      expect(carpet).not.toHaveProperty('id');
    });
  });
});

describe('looking at another edition', () => {
  const show = async (user: ReturnType<typeof userEvent.setup>, editionId: string) => {
    await choose(user, screen.getByLabelText('Showing'), editionId);
  };

  test('re-reads the configuration for the edition chosen', async () => {
    const fetch = base();
    const user = await openTab(/^bays$/i);
    await show(user, 'e0');

    await waitFor(() =>
      expect(fetch.calls.some((c) => c.url.includes('/config?editionId=e0'))).toBe(true),
    );
    expect(await screen.findByText('C1 — Moon side (2025)')).toBeInTheDocument();
  });

  // 🔴 Every write on this screen goes to the ACTIVE edition and carries no
  // edition at all, so a past year with its controls live would write last
  // year's figures into this one under a heading naming last year.
  test('is read only, and says so', async () => {
    base();
    const user = await openTab(/^bays$/i);
    await show(user, 'e0');

    expect(await screen.findByText('past edition · read only')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add bay' })).toBeDisabled());
    expect(screen.getByRole('button', { name: /copy from/i })).toBeDisabled();
  });
});

describe('copying from another edition', () => {
  const PLAN = {
    section: 'zones',
    fromEditionId: 'e0',
    fromEditionName: 'Stalls 2025',
    intoEditionName: 'Stalls 2026',
    create: [
      {
        key: 'D1',
        label: 'D1 · New lawn',
        changes: [{ field: 'Name', before: null, after: 'New lawn' }],
      },
    ],
    overwrite: [
      {
        key: 'C1',
        label: 'C1 · Moon side',
        changes: [{ field: 'Name', before: 'C1 — Moon side', after: 'C1 — Moon side (2025)' }],
      },
    ],
    skip: [
      { key: 'E9|true|VENDOR', label: 'E9 · Food · Vendor', reason: 'this edition has no bay E9' },
    ],
    unchanged: 4,
  };

  const openCopy = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /copy from/i }));
    return within(await screen.findByRole('dialog'));
  };

  test('shows what would change, before → after, and writes nothing yet', async () => {
    const fetch = base([['POST', /\/config\/copy\/preview$/, () => PLAN]]);
    const user = await openTab(/^bays$/i);
    const box = await openCopy(user);

    expect(await box.findByText('D1 · New lawn')).toBeInTheDocument();
    expect(box.getByText('C1 — Moon side')).toBeInTheDocument();
    expect(box.getByText('C1 — Moon side (2025)')).toBeInTheDocument();
    expect(box.getByText(/this edition has no bay E9/)).toBeInTheDocument();
    expect(box.getByText(/4 already the same/)).toBeInTheDocument();
    // The preview is a POST, but it is the only one so far.
    expect(fetch.calls.filter((c) => c.url.endsWith('/config/copy')).length).toBe(0);
  });

  test('the confirm button counts the changes and names the edition they land in', async () => {
    base([['POST', /\/config\/copy\/preview$/, () => PLAN]]);
    const user = await openTab(/^bays$/i);
    const box = await openCopy(user);

    expect(
      await box.findByRole('button', { name: 'Copy 2 changes into Stalls 2026' }),
    ).toBeEnabled();
  });

  test('confirming sends the section and the source edition, and nothing else', async () => {
    const fetch = base([
      ['POST', /\/config\/copy\/preview$/, () => PLAN],
      ['POST', /\/config\/copy$/, () => ({ created: 1, overwritten: 1, skipped: 1 })],
    ]);
    const user = await openTab(/^bays$/i);
    const box = await openCopy(user);
    await user.click(await box.findByRole('button', { name: /^Copy 2 changes/ }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'POST' && c.url.endsWith('/config/copy'));
      expect(call?.body).toEqual({ fromEditionId: 'e0', section: 'zones' });
    });
  });

  test('a plan with nothing in it cannot be confirmed', async () => {
    base([
      [
        'POST',
        /\/config\/copy\/preview$/,
        () => ({ ...PLAN, create: [], overwrite: [], skip: [], unchanged: 7 }),
      ],
    ]);
    const user = await openTab(/^bays$/i);
    const box = await openCopy(user);

    expect(await box.findByText(/Stalls 2026 already matches Stalls 2025/)).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Nothing to copy' })).toBeDisabled();
  });
});
