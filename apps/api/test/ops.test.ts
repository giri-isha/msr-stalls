import { DEFAULT_STAFF_COUPON_CAPACITY, rupeesToPaise } from '@msr/stalls';
import type { StallEdition } from '@prisma/client';
import { beforeEach, describe, expect, test } from 'vitest';
import { checkIn, listCheckIns, undoCheckIn } from '../src/modules/stalls/checkin';
import { electricalSheet } from '../src/modules/stalls/electrical';
import { ensureCoupon } from '../src/modules/stalls/onboarding';
import {
  actOnEquipment,
  challan,
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
    expect(v.extraChargePaise).toBe(rupeesToPaise(100)); // 2 × Rs.50
    expect(l.extraChargePaise).toBe(rupeesToPaise(200)); // 2 × Rs.100
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
      { missingChairs: 1, missingTables: 1, damaged: true, note: '1 chair broken', flagged: true },
      SYSTEM,
    );
    expect(row.deductionPaise).toBe(rupeesToPaise(400 + 900 + 250));
    expect(row.flagged).toBe(true);
    expect(row.note).toBe('1 chair broken');
  });

  test('the challan carries both what was ordered and what was taken at the counter', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 4, tablesNeeded: 2 });
    await patchEquipment(prisma, requestId, { extraChairs: 2, extraTables: 1 }, SYSTEM);

    const slip = await challan(prisma, requestId);
    expect(slip.stallNumber).toBe('C1-1');
    expect(slip.chairsOnline).toBe(4);
    expect(slip.tablesOnline).toBe(2);
    expect(slip.extraChairs).toBe(2);
    expect(slip.extraChargePaise).toBe(rupeesToPaise(2 * 50 + 150));
    expect(slip.editionName).toBe('MSR 2026');
  });

  test('an undo puts the counter back where it was', async () => {
    const { requestId } = await selected(['C1-1'], { chairsNeeded: 4 });
    await actOnEquipment(prisma, requestId, 'DISTRIBUTE', SYSTEM);
    const row = await actOnEquipment(prisma, requestId, 'UNDISTRIBUTE', SYSTEM);
    expect(row.distributedAt).toBeNull();
  });
});
