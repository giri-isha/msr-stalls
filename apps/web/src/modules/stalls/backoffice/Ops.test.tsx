import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  ME_ADMIN,
  auditEvent,
  checkInRow,
  equipmentRow,
  installFetch,
  renderAt,
} from '../test-utils';
import { CheckIn } from './CheckIn';
import { Electrical } from './Electrical';
import { Equipment } from './Equipment';

beforeEach(() => vi.unstubAllGlobals());

// ── Electrical ──────────────────────────────────────────────────────────────

const SHEET = {
  editionName: 'Stalls 2026',
  zoneCode: null,
  rows: [
    {
      stallNumber: 'C1-4',
      zoneCode: 'C1',
      stallName: 'Green Leaf Organics',
      category: 'VENDOR_FOOD',
      requestType: 'VENDOR',
      plugs5aTotal: 5,
      plugs15a: 5,
      gasStoves: 1,
      appliances: [{ name: 'Deep fryer', watts: 2500 }],
      totalWatts: 2500,
    },
  ],
  totals: { stalls: 1, plugs5a: 5, plugs15a: 5, watts: 2500 },
};

describe('the electrical sheet', () => {
  // The bay tabs are the edition's own zones, loaded rather than baked in — the
  // venue layout is redrawn every year. The screen asks /config for them.
  const CONFIG = {
    edition: { id: 'e1', year: 2026, name: 'Stalls 2026', isActive: true },
    zones: ['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2'].map((code, i) => ({
      id: `z-${code}`,
      code,
      name: code,
      expectedCrowd: 1000,
      isClosedToVendors: code === 'A3' || code === 'B2',
      sortOrder: i,
    })),
    rateCard: [],
    charges: {},
    flow: { bankStepEnabled: true, paymentStepEnabled: true, fssaiStepEnabled: true },
    fineTypes: [],
    customFields: [],
  };

  const render = () =>
    renderAt('/m/stalls/electrical', [{ path: '/m/stalls/electrical', element: <Electrical /> }], {
      me: true,
    });

  test('prints the 5A total including the free plug, as the column says', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/zones$/, () => CONFIG.zones],
      ['GET', /\/electrical/, () => SHEET],
    ]);
    render();

    expect(await screen.findByText('C1-4')).toBeInTheDocument();
    expect(screen.getByText('5A (Incl. 1 Default)')).toBeInTheDocument();
    expect(screen.getByText('Deep fryer 2500W')).toBeInTheDocument();
  });

  test('a cluster tab narrows the request, not just the table', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/zones$/, () => CONFIG.zones],
      ['GET', /\/electrical/, () => SHEET],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('C1-4');
    await user.click(screen.getByRole('button', { name: 'B4' }));

    await waitFor(() => expect(fetch.calls.some((c) => c.url.includes('zoneCode=B4'))).toBe(true));
  });

  test('totals the load across the sheet', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/zones$/, () => CONFIG.zones],
      ['GET', /\/electrical/, () => SHEET],
    ]);
    render();
    expect(await screen.findByText('2,500 W total load')).toBeInTheDocument();
  });
});

// ── Check-in ────────────────────────────────────────────────────────────────

describe('check-in', () => {
  const render = () =>
    renderAt('/m/stalls/checkin', [{ path: '/m/stalls/checkin', element: <CheckIn /> }], {
      me: true,
    });

  test('shows the counter the staff count, the passes and what is outstanding', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => [checkInRow()]],
    ]);
    render();

    expect(await screen.findByText('Green Leaf Organics')).toBeInTheDocument();
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByText('FSSAI certificate pending')).toBeInTheDocument();
  });

  test('lets a stall in despite an outstanding item, carrying the note', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => [checkInRow()]],
      [
        'POST',
        /\/checkin\//,
        (_u, _i, body) =>
          checkInRow({
            checkedInAt: '2026-02-14T06:00:00.000Z',
            note: (body as { note?: string }).note ?? null,
          }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Green Leaf Organics');
    await user.type(screen.getByPlaceholderText(/Note \(optional\)/), 'FSSAI shown on paper');
    await user.click(screen.getByRole('button', { name: 'Check in' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toEqual({ note: 'FSSAI shown on paper' });
    });
    expect(await screen.findByRole('button', { name: 'Undo check-in' })).toBeInTheDocument();
  });

  test('says "All Clear" when nothing is outstanding', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => [checkInRow({ pending: [] })]],
    ]);
    render();
    expect(await screen.findByText('All Clear')).toBeInTheDocument();
  });

  test('a volunteer without the action sees the state but no button', async () => {
    installFetch([
      ['GET', /\/me$/, () => ({ ...ME_ADMIN, privileges: ['requests.read'] })],
      ['GET', /\/checkin/, () => [checkInRow()]],
    ]);
    render();

    await screen.findByText('Green Leaf Organics');
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
  });

  /** ⚠️ The counter is a phone job and the tiles are what a phone opens on —
   *  but the same list is read at a desk the night before, to answer "who is
   *  still not in", and that is a question about the whole table at once. */
  test('opens as a table at desk width, and keeps the tiles once they are picked', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => [checkInRow()]],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('Green Leaf Organics');
    const table = screen.getByRole('table');
    expect(within(table).getByText('1 of 3')).toBeInTheDocument();
    expect(within(table).getByText('FSSAI certificate pending')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Card View' }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Green Leaf Organics')).toBeInTheDocument();
  });

  test('the note survives the switch of shape — both views can say why', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => [checkInRow()]],
      [
        'POST',
        /\/checkin\//,
        (_u, _i, body) =>
          checkInRow({
            checkedInAt: '2026-02-14T06:00:00.000Z',
            note: (body as { note?: string }).note ?? null,
          }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Note for Green Leaf Organics'), 'shown on paper');
    await user.click(screen.getByRole('button', { name: 'Check in' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toEqual({ note: 'shown on paper' });
    });
  });

  test('pages the counter, twenty-five at a time, and the filter starts over', async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      checkInRow({
        requestId: `4444${String(i).padStart(4, '0')}-4444-4444-8444-444444444444`,
        stallName: `Stall ${i}`,
        // The last five are already in, which is what the filter then narrows to.
        checkedInAt: i >= 25 ? '2026-02-14T06:00:00.000Z' : null,
      }),
    );
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/checkin/, () => rows],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByRole('table');
    expect(screen.getByText('1–25 of 30 stalls')).toBeInTheDocument();
    expect(screen.getByText('Stall 0')).toBeInTheDocument();
    expect(screen.queryByText('Stall 26')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next Page' }));
    expect(screen.getByText('Stall 26')).toBeInTheDocument();
    expect(screen.queryByText('Stall 0')).not.toBeInTheDocument();

    // ⚠️ Page two of the old list is not page two of the new one. Narrowing on
    // page two and staying there is how a working filter reads as lost rows.
    await user.click(screen.getByRole('button', { name: /^Checked in/ }));
    expect(screen.getByText('5 stalls')).toBeInTheDocument();
    expect(screen.getByText('Stall 25')).toBeInTheDocument();
  });
});

// ── Chairs and tables ───────────────────────────────────────────────────────

describe('chairs and tables', () => {
  const render = () =>
    renderAt('/m/stalls/equipment', [{ path: '/m/stalls/equipment', element: <Equipment /> }], {
      me: true,
    });

  // 🔴 Distribute used to be a bare button that stamped the time, and the
  // extras were typed into a separate Edit dialog somebody had to know to open
  // first. Two screens for one act at the counter is how a stall goes out
  // marked distributed with no record of the four extra chairs that went with
  // it. The totals are asked for, not the extras: a volunteer doing the
  // subtraction in their head while a vendor waits gets it wrong.
  test('shows what was ordered and walks the counter through distribute', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/equipment$/, () => [equipmentRow()]],
      [
        'POST',
        /\/equipment\/.+\/action$/,
        () => equipmentRow({ distributedAt: '2026-02-13T09:00:00.000Z' }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    expect(await screen.findByText('6 ch / 2 tb')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Distribute' }));

    const box = within(screen.getByRole('dialog'));
    // Pre-filled with what was ordered, so a stall taking exactly its order is
    // two taps.
    expect(box.getByLabelText('Chairs Out')).toHaveValue(6);
    await user.clear(box.getByLabelText('Chairs Out'));
    await user.type(box.getByLabelText('Chairs Out'), '10');
    await user.clear(box.getByLabelText('Fan'));
    await user.type(box.getByLabelText('Fan'), '2');

    // 4 extra chairs at ₹100 and 2 fans at ₹80, one day — priced before it is
    // saved, so the counter takes the right cash.
    expect(box.getByText('₹560')).toBeInTheDocument();
    // Nothing in flight while the figures are still being settled.
    expect(fetch.calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.click(box.getByRole('button', { name: 'Distribute' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.url.includes('/action'));
      expect(post?.body).toEqual({
        action: 'DISTRIBUTE',
        handout: { chairs: 10, tables: 2, items: [{ itemId: 'ci1', count: 2 }] },
      });
    });
    expect(await screen.findByText('Out')).toBeInTheDocument();
  });

  // 🔴 These were six inline controls that each fired on its own blur or tick,
  // so a counter correcting an entry sent a request per change.
  //
  // ⚠️ The extras are NOT edited here any more — what goes out is counted on
  // Distribute, and two screens that could both set the same charged figure
  // meant the one opened last won.
  test('the counter’s figures cross the wire once, not once per field', async () => {
    const collected = {
      distributedAt: '2026-02-13T09:00:00.000Z',
      collectedAt: '2026-02-14T09:00:00.000Z',
    };
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/equipment$/, () => [equipmentRow(collected)]],
      ['PATCH', /\/equipment\//, () => equipmentRow({ ...collected, missingChairs: 1 })],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('6 ch / 2 tb');
    await user.click(screen.getByLabelText('Edit Green Leaf Organics'));

    const box = within(screen.getByRole('dialog'));
    expect(box.queryByLabelText('Extra Chairs')).not.toBeInTheDocument();
    await user.clear(box.getByLabelText('Chairs Missing'));
    await user.type(box.getByLabelText('Chairs Missing'), '1');
    // Nothing in flight while the figures are still being settled.
    expect(fetch.calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    await user.click(box.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const patches = fetch.calls.filter((c) => c.method === 'PATCH');
      expect(patches).toHaveLength(1);
      expect(patches[0].body).toEqual({
        missingChairs: 1,
        missingTables: 0,
        damagedChairs: 0,
        damagedTables: 0,
        daysHeld: 1,
        items: [{ itemId: 'ci1', missing: 0, damaged: 0 }],
        note: '',
      });
    });
  });

  // ⚠️ A row that has not been collected has no figures to correct. Offering
  // them here would price a deduction against furniture nobody has confirmed
  // is back, on a row the counter has not walked to.
  test('the edit box offers the return figures only once the stall is collected', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/equipment$/, () => [equipmentRow({ distributedAt: '2026-02-13T09:00:00.000Z' })]],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('6 ch / 2 tb');
    await user.click(screen.getByLabelText('Edit Green Leaf Organics'));

    const box = within(screen.getByRole('dialog'));
    expect(box.queryByLabelText('Chairs Missing')).not.toBeInTheDocument();
    expect(box.getByText(/counted on the Collect step/)).toBeInTheDocument();
  });

  // 🔴 Collect used to be a bare button that stamped the time, so what came
  // back short was recorded later, from memory, by whoever opened the row next.
  // The count and the collection are one act at the counter and one write here.
  //
  // Damaged was also ONE TICK for the whole stall, and the penalty is charged
  // per item — so three broken chairs were deducted as one.
  test('collecting counts what came back, in the same write', async () => {
    const out = { distributedAt: '2026-02-13T09:00:00.000Z' };
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/equipment$/, () => [equipmentRow(out)]],
      [
        'POST',
        /\/equipment\/.+\/action$/,
        () =>
          equipmentRow({
            ...out,
            collectedAt: '2026-02-14T09:00:00.000Z',
            missingChairs: 1,
            damagedChairs: 3,
            damagedTables: 1,
          }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('6 ch / 2 tb');
    await user.click(screen.getByRole('button', { name: 'Collect' }));

    const box = within(screen.getByRole('dialog'));
    // What went out is on the box, so the counter has something to count against.
    expect(box.getByText(/6 chairs and 2 tables went out/)).toBeInTheDocument();
    await user.clear(box.getByLabelText('Chairs Missing'));
    await user.type(box.getByLabelText('Chairs Missing'), '1');
    await user.clear(box.getByLabelText('Chairs Damaged'));
    await user.type(box.getByLabelText('Chairs Damaged'), '3');
    await user.clear(box.getByLabelText('Tables Damaged'));
    await user.type(box.getByLabelText('Tables Damaged'), '1');
    // Nothing is collected until the count is settled.
    expect(fetch.calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await user.click(box.getByRole('button', { name: 'Collect' }));

    await waitFor(() => {
      const posts = fetch.calls.filter((c) => c.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({
        action: 'COLLECT',
        found: {
          missingChairs: 1,
          missingTables: 0,
          damagedChairs: 3,
          damagedTables: 1,
          daysHeld: 1,
          items: [{ itemId: 'ci1', missing: 0, damaged: 0 }],
          note: '',
        },
      });
    });
    // And the row says which, rather than only that something was broken.
    expect(await screen.findByText('3 ch / 1 tb damaged')).toBeInTheDocument();
    expect(await screen.findByText('Collected')).toBeInTheDocument();
  });

  // 🔴 `equipment.read`, not `audit.read`: the volunteer at the table is the
  // one being asked "we returned those this morning, who took them?".
  test('the counter can read its own trail on the row', async () => {
    installFetch([
      ['GET', /\/me$/, () => ({ ...ME_ADMIN, privileges: ['equipment.read'] })],
      ['GET', /\/equipment$/, () => [equipmentRow()]],
      [
        'GET',
        /\/equipment\/.+\/history$/,
        () => [
          auditEvent({
            id: 'e1',
            action: 'stall_equipment.collect',
            label: 'Furniture Collected',
            family: 'equipment',
            glyph: 'circle-check',
            tone: 'ok',
            actorName: 'Kavya Nair',
            changes: [{ field: 'missingChairs', before: 0, after: 1 }],
          }),
        ],
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('6 ch / 2 tb');
    await user.click(screen.getByLabelText('History for Green Leaf Organics'));

    const box = within(screen.getByRole('dialog'));
    expect(await box.findByText('Furniture Collected')).toBeInTheDocument();
    expect(box.getByText('Kavya Nair')).toBeInTheDocument();
  });

  // ⚠️ The extras are frozen once the cash is in the drawer. Re-pricing a charge
  // the vendor has already paid would leave the money and the screen disagreeing.
  test('extras already paid for in cash are stated, not offered for editing', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/equipment$/,
        () => [
          equipmentRow({
            extraChairs: 2,
            extraChargePaise: 10_000,
            extraCollectedAt: '2026-02-13T10:00:00.000Z',
            distributedAt: '2026-02-13T09:00:00.000Z',
            collectedAt: '2026-02-14T09:00:00.000Z',
          }),
        ],
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('6 ch / 2 tb');
    await user.click(screen.getByLabelText('Edit Green Leaf Organics'));

    const box = within(screen.getByRole('dialog'));
    expect(box.queryByLabelText('Extra Chairs')).not.toBeInTheDocument();
    expect(box.getByText(/collected in cash/)).toBeInTheDocument();
    // What was found on return is still the counter's to record.
    expect(box.getByLabelText('Chairs Missing')).toBeInTheDocument();
  });

  test('missing and damaged items show the deduction they will cause', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      [
        'GET',
        /\/equipment$/,
        () => [
          equipmentRow({
            missingChairs: 2,
            damagedChairs: 1,
            deductionPaise: 105_000,
            flagged: true,
          }),
        ],
      ],
    ]);
    render();

    expect(await screen.findByText('Deduction ₹1,050')).toBeInTheDocument();
    expect(screen.getByText('Flagged')).toBeInTheDocument();
  });

  test('the challan prints both copies with what was ordered and what was added', async () => {
    installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/equipment$/, () => [equipmentRow({ extraChairs: 2 })]],
      [
        'GET',
        /\/equipment\/.+\/challan$/,
        () => ({
          stallNumber: 'C1-4',
          stallName: 'Green Leaf Organics',
          ownerName: 'Priya Venkat',
          contactNumber: '9840012345',
          category: 'VENDOR_FOOD',
          chairsOnline: 6,
          tablesOnline: 2,
          extraChairs: 2,
          extraTables: 0,
          items: [{ name: 'Fan', count: 1, amountPaise: 8_000 }],
          extraChargePaise: 10_000,
          daysHeld: 1,
          editionName: 'Stalls 2026',
          printedAt: '2026-02-13T09:00:00.000Z',
        }),
      ],
    ]);
    render();
    const user = userEvent.setup();

    await screen.findByText('6 ch / 2 tb');
    await user.click(screen.getByRole('button', { name: 'Challan' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Vendor copy/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Office copy/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Ordered online:/)).toHaveLength(2);
  });
});
