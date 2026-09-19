import { DEFAULT_STAFF_COUPON_CAPACITY, rupeesToPaise } from '@stalls/core';
import type { StallEdition } from '@prisma/client';
import { beforeEach, describe, expect, test } from 'vitest';
import { checkIn, listCheckIns, undoCheckIn } from '../src/modules/stalls/checkin';
import { electricalSheet } from '../src/modules/stalls/electrical';
import { ensureCoupon } from '../src/modules/stalls/onboarding';
import {
  actOnEquipment,
  challan,
  equipmentHistory,
  listEquipment,
  patchEquipment,
} from '../src/modules/stalls/equipment';
import { SYSTEM, prisma, resetDatabase, seedEdition } from './helpers/db';
import { selected } from './helpers/onboarding';
import { makeStalls } from './helpers/plan';

let edition: StallEdition;

beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  await makeStalls(edition.id, 'C1', { VENDOR_FOOD: 12, LW_FOOD: 5 });
  await makeStalls(edition.id, 'B4', { VENDOR_FOOD: 5 });
});

describe('the electrical sheet', () => {
  test('prints the 5A total including the free plug', async () => {
    await selected(['C1-1'], { plugs5a: 4, plugs15a: 5 });
    const sheet = await electricalSheet(prisma, edition.id);
    // The form asked for 4 "excluding default"; the sheet says 5.
    expect(sheet.rows[0].plugs5aTotal).toBe(5);
    expect(sheet.rows[0].plugs15a).toBe(5);
  });

  test('sums appliance wattage per stall and across the sheet', async () => {
    await selected(['C1-1'], {
      appliances: [
        { name: 'Deep fryer', watts: 2500 },
        { name: 'Freezer', watts: 1500 },
      ],
    });
    const sheet = await electricalSheet(prisma, edition.id);
    expect(sheet.rows[0].totalWatts).toBe(4000);
    expect(sheet.totals.watts).toBe(4000);
  });

  test('walks a bay in stall-number order, not string order', async () => {
    await selected(['C1-9'], { email: 'a@x.example' });
    await selected(['C1-10'], { email: 'b@x.example' });
    await selected(['C1-2'], { email: 'c@x.example' });
    const sheet = await electricalSheet(prisma, edition.id, 'C1');
    expect(sheet.rows.map((r) => r.stallNumber)).toEqual(['C1-2', 'C1-9', 'C1-10']);
  });

  test('filters to one cluster for the printed A4 page', async () => {
    await selected(['C1-1'], { email: 'a@x.example' });
    await selected(['B4-1'], { email: 'b@x.example', preferredZoneCode: 'B4' });

    const all = await electricalSheet(prisma, edition.id);
    const b4 = await electricalSheet(prisma, edition.id, 'B4');
    expect(all.rows).toHaveLength(2);
    expect(b4.rows.map((r) => r.stallNumber)).toEqual(['B4-1']);
    expect(b4.zoneCode).toBe('B4');
  });

  test('a released stall leaves the sheet with its old occupant', async () => {
    const { requestId } = await selected(['C1-1']);
    expect((await electricalSheet(prisma, edition.id)).rows).toHaveLength(1);

    await prisma.stallAllocation.updateMany({
      where: { requestId },
      data: { activeStallId: null, releasedAt: new Date(), releasedBy: SYSTEM },
    });
    expect((await electricalSheet(prisma, edition.id)).rows).toEqual([]);
  });
});

describe('check-in', () => {
  test('shows the counter what it needs without a second lookup', async () => {
    const { requestId } = await selected(['C1-1'], {
      passes2w: 2,
      passes4w: 1,
      passesStaff: 3,
    });
    const [row] = await listCheckIns(prisma, edition.id);
    expect(row.requestId).toBe(requestId);
    expect(row.stallNumbers).toEqual(['C1-1']);
    expect(row.passes2w).toBe(2);
    expect(row.staffRegistered).toBe(0);
    // 🔴 The counter enforces the COUPON's capacity, not the number the vendor
    // asked for on a form months earlier. No coupon issued yet, so nothing is
    // expected of them and nothing is pending — and zero here means zero, not
    // "no limit", which is how a stall with eight passes registered eighty.
    expect(row.staffExpected).toBe(0);
    expect(row.pending.map((p) => p.step)).not.toContain('STAFF_REGISTRATION');
  });

  test('once a coupon is issued the counter expects its capacity, not the form’s', async () => {
    const { requestId } = await selected(['C1-2'], { passesStaff: 3 });
    await ensureCoupon(prisma, requestId, 'Green Leaf Organics', edition.year, SYSTEM);

    const row = (await listCheckIns(prisma, edition.id)).find((r) => r.requestId === requestId);
    // Eight is the team's default — "as a default we raise the coupon code with
    // eight staff members for each stall" — and it is not the 3 on the form.
    expect(row?.staffExpected).toBe(DEFAULT_STAFF_COUPON_CAPACITY);
    expect(row?.pending.map((p) => p.step)).toContain('STAFF_REGISTRATION');
  });

  test('finds a stall by its number as well as by name', async () => {
    await selected(['C1-3'], { stallName: 'Coastal Spice Kitchen' });
    expect(await listCheckIns(prisma, edition.id, 'C1-3')).toHaveLength(1);
    expect(await listCheckIns(prisma, edition.id, 'coastal')).toHaveLength(1);
    expect(await listCheckIns(prisma, edition.id, 'nothing')).toHaveLength(0);
  });

  test('lets a stall in with an outstanding item and a note', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 3 });
    const row = await checkIn(prisma, requestId, 'FSSAI shown on paper', SYSTEM);
    expect(row.checkedInAt).not.toBeNull();
    expect(row.note).toBe('FSSAI shown on paper');
    // Still honest about what is outstanding.
    expect(row.pending.length).toBeGreaterThan(0);
    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } })).stage).toBe(
      'CHECKED_IN',
    );
  });

  test('a checked-in stall keeps its stage through later updates', async () => {
    const { requestId } = await selected(['C1-1']);
    await checkIn(prisma, requestId, undefined, SYSTEM);
    await prisma.stallFssaiCertificate.create({ data: { requestId } });
    // A fact changing must not quietly un-check-in the stall.
    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } })).stage).toBe(
      'CHECKED_IN',
    );
  });

  test('the wrong stall ticked can be undone, and the stage falls back', async () => {
    const { requestId } = await selected(['C1-1'], { passesStaff: 2 });
    await checkIn(prisma, requestId, undefined, SYSTEM);
    const row = await undoCheckIn(prisma, requestId, SYSTEM);
    expect(row.checkedInAt).toBeNull();
    expect((await prisma.stallRequest.findUniqueOrThrow({ where: { id: requestId } })).stage).toBe(
      'NEW',
    );
  });
});

describe('chairs and tables', () => {
  test('opens a counter row snapshotting what was ordered', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6, tablesNeeded: 2 });
    const [row] = await listEquipment(prisma, edition.id);
    expect(row.chairsRequested).toBe(6);
    expect(row.tablesRequested).toBe(2);

    // Editing the request afterwards does not move what the challan promised.
    await prisma.stallRequest.update({ where: { id: requestId }, data: { chairsNeeded: 99 } });
    expect((await listEquipment(prisma, edition.id))[0].chairsRequested).toBe(6);
  });

  test('a stall that ordered nothing is absent until it takes something', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 0, tablesNeeded: 0 });
    expect(await listEquipment(prisma, edition.id)).toEqual([]);

    await patchEquipment(prisma, requestId, { extraChairs: 2 }, SYSTEM);
    const rows = await listEquipment(prisma, edition.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].extraChairs).toBe(2);
  });

  // 🔴 THREE rates, not two. A vendor used to fall through to the ashram
  // figure here — the one requester type that is never billed at all — so the
  // counter took Rs.50 for a chair the payment letter had quoted at Rs.100, and
  // the paper and the till disagreed all day. `quote.ts` has carried the vendor
  // pair since the letter was written; this file did not.
  test('prices the extras at the requester type’s own rate', async () => {
    const vendor = await selected(['C1-1'], { chairsNeeded: 2, email: 'v@x.example' });
    const lw = await selected(['C1-13'], {
      chairsNeeded: 2,
      email: 'lw@x.example',
      requestType: 'LOCAL_WELFARE',
      depositAcknowledged: true,
    });

    const v = await patchEquipment(prisma, vendor.requestId, { extraChairs: 2 }, SYSTEM);
    const l = await patchEquipment(prisma, lw.requestId, { extraChairs: 2 }, SYSTEM);
    expect(v.extraChargePaise).toBe(rupeesToPaise(200)); // 2 × Rs.100, the vendor rate
    expect(l.extraChargePaise).toBe(rupeesToPaise(200)); // 2 × Rs.100, the local welfare one
  });

  test('walks the two days: distribute, take cash, collect', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 4, tablesNeeded: 2 });
    let row = await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM);
    expect(row.distributedAt).not.toBeNull();

    row = await patchEquipment(prisma, requestId, { extraChairs: 2 }, SYSTEM);
    row = await actOnEquipment(prisma, requestId, 'COLLECT_EXTRA_PAYMENT', SYSTEM);
    expect(row.extraCollectedAt).not.toBeNull();

    row = await actOnEquipment(prisma, requestId, 'COLLECT', SYSTEM);
    expect(row.collectedAt).not.toBeNull();
  });

  test('missing and damaged furniture is priced for the refund screen', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6 });
    const row = await patchEquipment(
      prisma,
      requestId,
      {
        missingChairs: 1,
        missingTables: 1,
        damagedChairs: 2,
        note: '2 chairs broken',
        flagged: true,
      },
      SYSTEM,
    );
    expect(row.deductionPaise).toBe(rupeesToPaise(400 + 900 + 2 * 250));
    expect(row.flagged).toBe(true);
    expect(row.note).toBe('2 chairs broken');
  });

  test('the challan carries both what was ordered and what was taken at the counter', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 4, tablesNeeded: 2 });
    await patchEquipment(prisma, requestId, { extraChairs: 2, extraTables: 1 }, SYSTEM);

    const slip = await challan(prisma, requestId);
    expect(slip.stallNumber).toBe('C1-1');
    expect(slip.chairsOnline).toBe(4);
    expect(slip.tablesOnline).toBe(2);
    expect(slip.extraChairs).toBe(2);
    // The VENDOR rates — Rs.100 a chair and Rs.400 a table — not the ashram
    // figures this used to quote. See the rate test above.
    expect(slip.extraChargePaise).toBe(rupeesToPaise(2 * 100 + 400));
    expect(slip.editionName).toBe('Stalls 2026');
  });

  // 🔴 The count and the collection are ONE write. Two requests over the
  // marquee's wifi, and the half that lands alone leaves either a collected row
  // with nobody's figures on it or figures against a row still reading as out —
  // which the refund screen would price anyway.
  test('what was found comes back with the collection, in one act', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6, tablesNeeded: 2 });
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM);
    const row = await actOnEquipment(prisma, requestId, 'COLLECT', SYSTEM, {
      missingChairs: 1,
      missingTables: 0,
      damagedChairs: 3,
      damagedTables: 0,
      daysHeld: 1,
      items: [],
      note: '3 chairs broken',
    });

    expect(row.collectedAt).not.toBeNull();
    expect(row.missingChairs).toBe(1);
    expect(row.damagedChairs).toBe(3);
    expect(row.note).toBe('3 chairs broken');
    expect(row.deductionPaise).toBe(rupeesToPaise(400 + 3 * 250));
  });

  // ⚠️ Undoing a collection does not erase what was found. The figures stay for
  // whoever re-collects the row, and the log carries both events.
  test('an undo leaves the figures where the counter put them', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6 });
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM);
    await actOnEquipment(prisma, requestId, 'COLLECT', SYSTEM, {
      missingChairs: 2,
      missingTables: 0,
      damagedChairs: 0,
      damagedTables: 0,
      daysHeld: 1,
      items: [],
    });
    const row = await actOnEquipment(prisma, requestId, 'UNCOLLECT', SYSTEM);

    expect(row.collectedAt).toBeNull();
    expect(row.missingChairs).toBe(2);
  });

  test('the counter’s own trail says what happened, what changed and who', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6 });
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM);
    await actOnEquipment(prisma, requestId, 'COLLECT', SYSTEM, {
      missingChairs: 1,
      missingTables: 0,
      damagedChairs: 0,
      damagedTables: 0,
      daysHeld: 1,
      items: [],
    });
    await patchEquipment(prisma, requestId, { missingChairs: 3 }, SYSTEM);

    const history = await equipmentHistory(prisma, requestId);
    // Newest first, and nothing from the rest of the request's life.
    expect(history.map((e) => e.action)).toEqual([
      'stall_equipment.updated',
      'stall_equipment.collect',
      'stall_equipment.distribute',
    ]);
    // 🔴 What CHANGED, not what was sent: the correction reads 1 → 3 rather
    // than repeating every field the dialog happened to hold.
    expect(history[0].changes).toEqual([{ field: 'missingChairs', before: 1, after: 3 }]);
    expect(history[1].changes).toContainEqual({ field: 'missingChairs', before: 0, after: 1 });
  });

  /** A fan, priced for whoever is being charged. */
  async function fan(over: Record<string, unknown> = {}) {
    return prisma.stallChargeItem.create({
      data: {
        editionId: edition.id,
        key: 'FAN',
        name: 'Fan',
        ashramRatePaise: rupeesToPaise(30),
        lwRatePaise: rupeesToPaise(50),
        vendorRatePaise: rupeesToPaise(80),
        perDay: true,
        missingPaise: rupeesToPaise(600),
        damagedPaise: rupeesToPaise(300),
        ...over,
      },
    });
  }

  // 🔴 TOTALS, not extras. The dialog asks how many chairs are going over the
  // counter and the extra is derived, because a volunteer asked for "the extra"
  // does the subtraction in their head while a vendor waits.
  test('distributing takes the totals and works out what is chargeable', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6, tablesNeeded: 2 });
    const item = await fan();

    const row = await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM, undefined, {
      chairs: 10,
      tables: 2,
      items: [{ itemId: item.id, count: 2 }],
    });

    expect(row.distributedAt).not.toBeNull();
    expect(row.extraChairs).toBe(4);
    expect(row.extraTables).toBe(0);
    // 4 extra chairs at the VENDOR rate of Rs.100, plus 2 fans at Rs.80 — one
    // day, which is all the counter takes cash for.
    expect(row.extraChargePaise).toBe(rupeesToPaise(4 * 100 + 2 * 80));
    expect(row.items.find((i) => i.itemId === item.id)?.count).toBe(2);
  });

  // ⚠️ Cash already in the drawer freezes the counts. Undo-and-redistribute
  // would otherwise rewrite the figure on the signed challan silently.
  test('refuses to re-count a handout the vendor has already paid for', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6 });
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM, undefined, {
      chairs: 8,
      tables: 0,
      items: [],
    });
    await actOnEquipment(prisma, requestId, 'COLLECT_EXTRA_PAYMENT', SYSTEM);

    await expect(
      actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM, undefined, {
        chairs: 20,
        tables: 0,
        items: [],
      }),
    ).rejects.toThrow();
    expect((await listEquipment(prisma, edition.id))[0].extraChairs).toBe(2);
  });

  // 🔴 The counter takes ONE day's cash and the rest is settled at return. On
  // the morning it goes out nobody knows how many days it will really be.
  test('settles the days past the first against the deposit', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 6 });
    const item = await fan();
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM, undefined, {
      chairs: 10,
      tables: 0,
      items: [{ itemId: item.id, count: 2 }],
    });

    const row = await actOnEquipment(prisma, requestId, 'COLLECT', SYSTEM, {
      missingChairs: 0,
      missingTables: 0,
      damagedChairs: 0,
      damagedTables: 0,
      daysHeld: 3,
      items: [{ itemId: item.id, missing: 0, damaged: 0 }],
    });

    // Two days beyond the one already paid, on the 4 extra chairs and 2 fans.
    // The six ORDERED chairs are not charged: the payment letter covered them.
    expect(row.deductionPaise).toBe(rupeesToPaise((4 * 100 + 2 * 80) * 2));
    expect(row.deductionLines.map((l) => l.label)).toEqual([
      'Chair — 2 extra days',
      'Fan — 2 extra days',
    ]);
  });

  // ⚠️ Rent AND replacement. They had it for those days and then lost it;
  // waiving the rent would make losing a fan cheaper than returning it late.
  test('charges a lost item its rent and its replacement', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 0, tablesNeeded: 0 });
    const item = await fan();
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM, undefined, {
      chairs: 0,
      tables: 0,
      items: [{ itemId: item.id, count: 2 }],
    });

    const row = await actOnEquipment(prisma, requestId, 'COLLECT', SYSTEM, {
      missingChairs: 0,
      missingTables: 0,
      damagedChairs: 0,
      damagedTables: 0,
      daysHeld: 2,
      items: [{ itemId: item.id, missing: 1, damaged: 1 }],
    });

    expect(row.deductionPaise).toBe(rupeesToPaise(2 * 80 * 1 + 600 + 300));
  });

  // A carpet costs what it costs whether it is walked on for one day or three.
  test('never charges extra days on a flat item', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 0, tablesNeeded: 0 });
    const item = await fan({ key: 'CARPET', name: 'Carpet', perDay: false });
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM, undefined, {
      chairs: 0,
      tables: 0,
      items: [{ itemId: item.id, count: 2 }],
    });

    const row = await actOnEquipment(prisma, requestId, 'COLLECT', SYSTEM, {
      missingChairs: 0,
      missingTables: 0,
      damagedChairs: 0,
      damagedTables: 0,
      daysHeld: 5,
      items: [{ itemId: item.id, missing: 0, damaged: 0 }],
    });

    expect(row.deductionPaise).toBe(0);
  });

  // 🔴 On the PAPER the vendor signs. A fan that left the store with no line on
  // the challan has no record the vendor ever saw.
  test('the challan lists what left the store beyond chairs and tables', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 2 });
    const item = await fan();
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM, undefined, {
      chairs: 2,
      tables: 0,
      items: [{ itemId: item.id, count: 3 }],
    });

    const slip = await challan(prisma, requestId);
    expect(slip.items).toEqual([{ name: 'Fan', count: 3, amountPaise: rupeesToPaise(240) }]);
  });

  test('an undo puts the counter back where it was', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 4 });
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM);
    const row = await actOnEquipment(prisma, requestId, 'UNDISTRIBUTE', SYSTEM);
    expect(row.distributedAt).toBeNull();
  });
});
