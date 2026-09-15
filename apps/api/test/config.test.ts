import { beforeEach, describe, expect, test } from 'vitest';
import { type RateScope, SubmitRequestInput, lookupRate } from '@msr/stalls';
import {
  createCustomField,
  createEdition,
  deleteCustomField,
  getPublicConfig,
  listZones,
  rateCardFor,
} from '../src/modules/stalls/config';
import { activeEdition } from '../src/modules/stalls/editions';
import { CustomFieldInUseError, NoActiveEditionError } from '../src/modules/stalls/errors';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  accountFor,
  LogMailer,
  prisma,
  resetDatabase,
  seedEdition,
  SYSTEM,
  vendorBody,
} from './helpers/db';

beforeEach(resetDatabase);

describe('activeEdition', () => {
  test('throws when none is active rather than picking one', async () => {
    await createEdition(prisma, { year: 2025, name: 'MSR 2025', activate: false }, SYSTEM);
    await expect(activeEdition(prisma)).rejects.toBeInstanceOf(NoActiveEditionError);
  });

  test('activating a new edition deactivates the previous one', async () => {
    await seedEdition(2025);
    await seedEdition(2026);
    const active = await prisma.stallEdition.findMany({ where: { isActive: true } });
    expect(active.map((e) => e.year)).toEqual([2026]);
  });
});

describe('seeded defaults', () => {
  test('creates the seven 2025 zones in walking order', async () => {
    const e = await seedEdition();
    const zones = await listZones(prisma, e.id);
    expect(zones.map((z) => z.code)).toEqual(['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2']);
  });

  test('marks A3 and B2 closed to vendors', async () => {
    const e = await seedEdition();
    const zones = await listZones(prisma, e.id);
    const closed = zones.filter((z) => z.isClosedToVendors).map((z) => z.code);
    expect(closed).toEqual(['A3', 'B2']);
  });

  test('rate card matches the printed 2025 form, bay by bay', async () => {
    const e = await seedEdition();
    const card = await rateCardFor(prisma, e.id);
    const rent = (zoneCode: string, isFood: boolean, scope: RateScope) =>
      lookupRate(card, zoneCode, isFood, scope)?.amountPaise;

    // Page 3 of the vendor form, which quotes a band. It is stored per bay, so
    // every bay in the band has to carry the band's figure in its own right.
    for (const zoneCode of ['A4', 'B3', 'B4']) {
      expect(rent(zoneCode, true, 'VENDOR')).toBe(1_800_000);
      expect(rent(zoneCode, false, 'VENDOR')).toBe(1_500_000);
    }
    for (const zoneCode of ['C1', 'C2']) {
      expect(rent(zoneCode, true, 'VENDOR')).toBe(1_500_000);
      expect(rent(zoneCode, false, 'VENDOR')).toBe(1_200_000);
    }
  });

  test('the bays closed to trade are priced for local welfare, not unpriced', async () => {
    const e = await seedEdition();
    const card = await rateCardFor(prisma, e.id);
    // "Closed" on the printed form means closed TO VENDORS. A3 and B2 carry the
    // VAP traders, who pay the most of any local welfare stall — quoting them
    // nothing is what left those stalls unbillable.
    for (const zoneCode of ['A3', 'B2']) {
      expect(lookupRate(card, zoneCode, true, 'VENDOR')).toBeNull();
      expect(lookupRate(card, zoneCode, true, 'LOCAL_WELFARE')?.amountPaise).toBeGreaterThan(0);
    }
  });

  test('each rate row carries its own refundable advance', async () => {
    const e = await seedEdition();
    const card = await rateCardFor(prisma, e.id);
    // Area-wise, not one flat figure: the advance rides on the rate row so a
    // bay's rent and its advance are edited together and cannot drift apart.
    for (const row of card) {
      expect(row.depositPaise).toBeGreaterThan(0);
    }
  });

  test('creates a reference counter for each of the four request types', async () => {
    const e = await seedEdition();
    const seqs = await prisma.stallReferenceSequence.findMany({ where: { editionId: e.id } });
    expect(seqs.map((s) => s.requestType).sort()).toEqual([
      'ASHRAM',
      'ASHRAM_FOOD',
      'LOCAL_WELFARE',
      'VENDOR',
    ]);
  });

  test('is idempotent — creating twice does not duplicate anything', async () => {
    const e = await seedEdition();
    const { ensureEditionDefaults } = await import('../src/modules/stalls/config');
    await ensureEditionDefaults(prisma, e.id);
    expect(await prisma.stallZone.count({ where: { editionId: e.id } })).toBe(7);
    // Per bay x food/non-food x scope, not four banded rows: five bays priced
    // for trade and all seven for local welfare, doubled for food and non-food.
    expect(await prisma.stallRateCard.count({ where: { editionId: e.id } })).toBe(5 * 2 + 7 * 2);
  });
});

describe('getPublicConfig', () => {
  test('quotes rent for open zones and none for closed ones', async () => {
    await seedEdition();
    const cfg = await getPublicConfig(prisma);
    const byCode = new Map(cfg.zones.map((z) => [z.code, z]));
    expect(byCode.get('C1')?.rentFoodPaise).toBe(1_500_000);
    expect(byCode.get('A4')?.rentNonFoodPaise).toBe(1_500_000);
    expect(byCode.get('A3')?.rentFoodPaise).toBeNull();
    expect(byCode.get('A3')?.isClosedToVendors).toBe(true);
  });

  test('exposes only active custom fields for public form types', async () => {
    const e = await seedEdition();
    const active = await createCustomField(
      prisma,
      e.id,
      {
        formType: 'VENDOR',
        label: 'Instagram handle',
        fieldType: 'text',
        isRequired: false,
        sortOrder: 0,
      },
      SYSTEM,
    );
    const bank = await createCustomField(
      prisma,
      e.id,
      { formType: 'BANK', label: 'UPI id', fieldType: 'text', isRequired: false, sortOrder: 0 },
      SYSTEM,
    );
    await prisma.stallCustomField.update({ where: { id: bank.id }, data: { isActive: true } });
    const cfg = await getPublicConfig(prisma);
    expect(cfg.customFields.map((f) => f.id)).toEqual([active.id]);
  });

  test('carries nothing backoffice-only', async () => {
    await seedEdition();
    const cfg = (await getPublicConfig(prisma)) as unknown as Record<string, unknown>;
    expect(Object.keys(cfg).sort()).toEqual([
      'charges',
      'customFields',
      'edition',
      'maxStallsPerRequest',
      'zones',
    ]);
  });
});

describe('deleteCustomField', () => {
  test('deletes a field nobody has answered', async () => {
    const e = await seedEdition();
    const f = await createCustomField(
      prisma,
      e.id,
      { formType: 'VENDOR', label: 'Website', fieldType: 'text', isRequired: false, sortOrder: 0 },
      SYSTEM,
    );
    await deleteCustomField(prisma, f.id, SYSTEM);
    expect(await prisma.stallCustomField.findUnique({ where: { id: f.id } })).toBeNull();
  });

  test('refuses to delete a field that already has answers', async () => {
    const e = await seedEdition();
    const f = await createCustomField(
      prisma,
      e.id,
      { formType: 'VENDOR', label: 'Website', fieldType: 'text', isRequired: false, sortOrder: 0 },
      SYSTEM,
    );
    await submitRequest(
      prisma,
      SubmitRequestInput.parse(vendorBody({ customFields: { [f.id]: 'greenleaf.example' } })),
      { mail: new LogMailer(), statusUrl: (t) => `http://x/${t}` },
      await accountFor(),
    );
    await expect(deleteCustomField(prisma, f.id, SYSTEM)).rejects.toBeInstanceOf(
      CustomFieldInUseError,
    );
  });
});
