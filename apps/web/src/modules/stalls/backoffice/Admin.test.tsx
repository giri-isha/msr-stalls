import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, installFetch, renderAt } from '../test-utils';
import { Admin } from './Admin';

beforeEach(() => vi.unstubAllGlobals());

/** What the backoffice config endpoint answers. Every list here is the edition's own
 *  configuration — bays and planning columns are rows, not constants — so the
 *  screen has to draw itself from this payload and nothing else. */
const CONFIG = {
  edition: {
    id: 'e1',
    year: 2026,
    name: 'MSR 2026',
    isActive: true,
    virtualAccountRentPrefix: null,
    virtualAccountDepositPrefix: null,
    maxStallsPerRequest: 3,
  },
  zones: [
    {
      id: 'z-c1',
      code: 'C1',
      name: 'C1 — Moon side',
      expectedCrowd: 25000,
      isClosedToVendors: false,
      sortOrder: 0,
      stallCount: 0,
    },
    {
      id: 'z-a3',
      code: 'A3',
      name: 'A3 — Behind Adiyogi',
      expectedCrowd: 4200,
      isClosedToVendors: true,
      sortOrder: 1,
      stallCount: 6,
    },
  ],
  planCategories: [
    { key: 'VENDOR_FOOD', name: 'Vendor food', isFood: true, sortOrder: 0, inUse: true },
    { key: 'BACKUP', name: 'Backup', isFood: false, sortOrder: 1, inUse: false },
  ],
  rateCard: [
    {
      zoneCode: 'C1',
      isFood: true,
      scope: 'VENDOR' as const,
      amountPaise: 1_500_000,
      depositPaise: 400_000,
    },
    {
      zoneCode: 'A3',
      isFood: true,
      scope: 'LOCAL_WELFARE' as const,
      amountPaise: 1_200_000,
      depositPaise: 400_000,
    },
  ],
  charges: {
    id: 'ch1',
    editionId: 'e1',
    chairRatePaise: 5000,
    tableRatePaise: 15000,
    lwChairRatePaise: 10000,
    lwTableRatePaise: 30000,
    vendorChairRatePaise: 10000,
    vendorTableRatePaise: 40000,
    plug5aRatePaise: 50000,
    plug15aRatePaise: 100000,
    gstPercent: 18,
    crowdPerStall: 1000,
    chairTableDepositPaise: 400000,
    equipmentDays: 1,
    chairReplacementPaise: 40000,
    tableReplacementPaise: 90000,
    damagePenaltyPaise: 25000,
  },
  flow: { bankStepEnabled: true, paymentStepEnabled: true, fssaiStepEnabled: true },
  fineTypes: [],
  customFields: [],
};

const routes = [{ path: '/m/stalls/admin', element: <Admin /> }];
const render = () => renderAt('/m/stalls/admin', routes, { me: true });

/** The body of the one call matching `method`, asserted to exist first — a
 *  missing call should fail as "nothing was sent", not as a TypeError several
 *  lines later. */
function sentBody<T>(fetch: ReturnType<typeof installFetch>, method: string): T {
  const call = fetch.calls.find((c) => c.method === method);
  expect(call, `expected a ${method} to have been sent`).toBeDefined();
  return call?.body as T;
}

/** Two of them, so the edition selector has something to choose between — and
 *  so the tests below can point the screen at a year that is not the one every
 *  write goes to. */
const EDITION_SETTINGS = {
  virtualAccountRentPrefix: null,
  virtualAccountDepositPrefix: null,
  maxStallsPerRequest: 3,
  termsUrl: null,
};
const EDITIONS = [
  { id: 'e1', year: 2026, name: 'MSR 2026', isActive: true, ...EDITION_SETTINGS },
  { id: 'e0', year: 2025, name: 'MSR 2025', isActive: false, ...EDITION_SETTINGS },
];

/** Last year's configuration, which is what `/config?editionId=e0` answers. */
const PAST_CONFIG = {
  ...CONFIG,
  edition: { ...CONFIG.edition, id: 'e0', year: 2025, name: 'MSR 2025', isActive: false },
  zones: CONFIG.zones.map((z) => (z.code === 'C1' ? { ...z, name: 'C1 — Moon side (2025)' } : z)),
};

const base = (extra: ReadonlyArray<readonly [string, RegExp, unknown]> = []) =>
  installFetch([
    ['GET', /\/me$/, () => ME_ADMIN],
    [
      'GET',
      /\/config$/,
      (url: URL) => (url.searchParams.get('editionId') === 'e0' ? PAST_CONFIG : CONFIG),
    ],
    ['GET', /\/editions$/, () => EDITIONS],
    ...(extra as ReadonlyArray<readonly [string, RegExp, () => unknown]>),
  ]);

describe('bays', () => {
  test('adds a bay for a layout that has been redrawn', async () => {
    const fetch = base([['POST', /\/config\/zones$/, () => ({ id: 'z-d1' })]]);
    render();
    const user = userEvent.setup();

    await screen.findByLabelText('Edit C1');
    // The panel's header button opens the box; the fields are inside it.
    await user.click(screen.getByRole('button', { name: 'Add bay' }));
    const box = within(await screen.findByRole('dialog'));
    await user.type(box.getByLabelText('Code'), 'D1');
    await user.type(box.getByLabelText('Name'), 'D1 — new lawn');
    await user.type(box.getByLabelText('Expected crowd'), '8000');
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
    render();
    await screen.findByLabelText('Edit C1');

    expect(screen.getByLabelText('Remove C1')).toBeEnabled();
    expect(screen.getByLabelText(/A3 has 6 stalls and cannot be removed/)).toBeDisabled();
  });

  // The figures are read in the row and changed in the box the pencil opens —
  // so what the row shows and what the dialog sends are one assertion apart.
  test('editing a bay sends what the dialog was left holding', async () => {
    const fetch = base([['PUT', /\/config\/zones\/C1$/, () => ({})]]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Edit C1'));
    // Scoped to the dialog. Kept scoped although the add form is a dialog of
    // its own now and cannot be open at the same time: the box is what the
    // test is about, and naming it is how the assertion stays readable.
    const box = within(screen.getByRole('dialog'));
    await user.clear(box.getByLabelText('Name'));
    await user.type(box.getByLabelText('Name'), 'C1 — Moon side, widened');
    await user.clear(box.getByLabelText('Expected crowd'));
    await user.type(box.getByLabelText('Expected crowd'), '31000');
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
    render();
    const user = userEvent.setup();

    await screen.findByLabelText('Edit C1');
    await user.click(screen.getByLabelText('Remove C1'));

    await waitFor(() =>
      expect(
        fetch.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/config/zones/C1')),
      ).toBe(true),
    );
  });
});

describe('planning columns', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByLabelText('Edit C1');
    await user.click(screen.getByRole('tab', { name: /planning columns/i }));
  };

  // 🔴 The 2025 sheet carries sponsor and Adiyogi columns the old enum never
  // had, so a sponsor stall could not be counted apart from an ashram one.
  test('adds a column the sheet carries and the enum never had', async () => {
    const fetch = base([['PUT', /\/config\/plan-categories$/, () => ({})]]);
    render();
    const user = userEvent.setup();
    await open(user);

    await user.click(screen.getByRole('button', { name: 'Add column' }));
    const box = within(await screen.findByRole('dialog'));
    await box.findByLabelText('Key');
    await user.type(box.getByLabelText('Key'), 'SPONSOR_FOOD');
    await user.type(box.getByLabelText('Column heading'), 'Sponsor food');
    await user.click(box.getByRole('button', { name: 'Add column' }));
    await user.click(screen.getByRole('button', { name: /save columns/i }));

    await waitFor(() => {
      const body = sentBody<{ categories: Array<{ key: string }> }>(fetch, 'PUT');
      expect(body.categories.map((x) => x.key)).toEqual(['VENDOR_FOOD', 'BACKUP', 'SPONSOR_FOOD']);
    });
  });

  test('a column already planned against offers no delete at all', async () => {
    base();
    render();
    const user = userEvent.setup();
    await open(user);

    expect(screen.getByText('In use')).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove VENDOR_FOOD')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Remove BACKUP')).toBeInTheDocument();
  });

  test('reordering renumbers the columns from their new positions', async () => {
    const fetch = base([['PUT', /\/config\/plan-categories$/, () => ({})]]);
    render();
    const user = userEvent.setup();
    await open(user);

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

describe('edition settings', () => {
  /** ⚠️ Nothing is editable until a row's pencil is pressed. The settings used
   *  to be five inputs open on the tab; they belong to an edition, so they are
   *  reached through the edition. */
  const openEdition = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await screen.findByLabelText('Edit C1');
    await user.click(screen.getByRole('tab', { name: /editions/i }));
    await user.click(await screen.findByLabelText(`Edit ${name}`));
  };

  test('sends the account prefixes Finance issues, and empty means not issued', async () => {
    const fetch = base([['PATCH', /\/editions\/e1\/settings$/, () => ({})]]);
    render();
    const user = userEvent.setup();

    await openEdition(user, 'MSR 2026');
    await user.type(screen.getByLabelText('Virtual account prefix — rent'), 'MSRRENT');
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
    await user.type(screen.getByLabelText('Virtual account prefix — rent'), 'OLD');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const call = fetch.calls.find((c) => c.method === 'PATCH');
      expect(call?.url).toContain('/editions/e0/settings');
    });
  });
});

describe('the rent matrix', () => {
  test('a bay closed to trade still takes its local welfare figures', async () => {
    base();
    render();
    const user = userEvent.setup();

    await screen.findByLabelText('Edit C1');
    await user.click(screen.getByRole('tab', { name: /rates/i }));

    // Closed to trade, so the row says so where the two vendor figures would be…
    expect(screen.getAllByText('Closed to trade').length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText('Edit A3 food rates'));
    // …and the box offers no vendor fields at all, rather than empty ones
    // nobody may fill.
    expect(screen.queryByLabelText('Vendor rent')).not.toBeInTheDocument();
    // …and it is priced for local welfare, which is the whole point of the rework.
    expect(screen.getByLabelText('Local welfare rent')).toHaveValue(12000);
    expect(screen.getByLabelText('Local welfare advance')).toHaveValue(4000);
  });

  test('a row left at zero is dropped rather than saved as a free stall', async () => {
    const fetch = base([['PUT', /\/config\/rate-card$/, () => ({})]]);
    render();
    const user = userEvent.setup();

    await screen.findByLabelText('Edit C1');
    await user.click(screen.getByRole('tab', { name: /rates/i }));
    await user.click(screen.getByLabelText('Edit C1 food rates'));
    await user.clear(screen.getByLabelText('Vendor rent'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: /save rates/i }));

    await waitFor(() => {
      const body = sentBody<{ entries: Array<{ zoneCode: string }> }>(fetch, 'PUT');
      expect(body.entries.map((e) => e.zoneCode)).toEqual(['A3']);
    });
  });
});

describe('looking at another edition', () => {
  const show = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
    await screen.findByLabelText('Edit C1');
    await user.selectOptions(
      screen.getByLabelText('Showing'),
      screen.getByRole('option', { name }),
    );
  };

  test('re-reads the configuration for the edition chosen', async () => {
    const fetch = base();
    render();
    const user = userEvent.setup();
    await show(user, /MSR 2025/);

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
    render();
    const user = userEvent.setup();
    await show(user, /MSR 2025/);

    expect(await screen.findByText('past edition · read only')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add bay' })).toBeDisabled());
    expect(screen.getByRole('button', { name: /copy from/i })).toBeDisabled();
  });
});

describe('copying from another edition', () => {
  const PLAN = {
    section: 'zones',
    fromEditionId: 'e0',
    fromEditionName: 'MSR 2025',
    intoEditionName: 'MSR 2026',
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
    await screen.findByLabelText('Edit C1');
    await user.click(screen.getByRole('button', { name: /copy from/i }));
    return within(await screen.findByRole('dialog'));
  };

  test('shows what would change, before → after, and writes nothing yet', async () => {
    const fetch = base([['POST', /\/config\/copy\/preview$/, () => PLAN]]);
    render();
    const user = userEvent.setup();
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
    render();
    const user = userEvent.setup();
    const box = await openCopy(user);

    expect(await box.findByRole('button', { name: 'Copy 2 changes into MSR 2026' })).toBeEnabled();
  });

  test('confirming sends the section and the source edition, and nothing else', async () => {
    const fetch = base([
      ['POST', /\/config\/copy\/preview$/, () => PLAN],
      ['POST', /\/config\/copy$/, () => ({ created: 1, overwritten: 1, skipped: 1 })],
    ]);
    render();
    const user = userEvent.setup();
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
    render();
    const user = userEvent.setup();
    const box = await openCopy(user);

    expect(await box.findByText(/MSR 2026 already matches MSR 2025/)).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Nothing to copy' })).toBeDisabled();
  });
});
