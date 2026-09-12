import { beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@msr/stalls';
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
import { LogMailer, SYSTEM, prisma, resetDatabase, seedEdition, vendorBody } from './helpers/db';

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

  test('rate card matches the printed 2025 form', async () => {
    const e = await seedEdition();
    const card = await rateCardFor(prisma, e.id);
    const find = (g: string, f: boolean) =>
      card.find((c) => c.zoneGroup === g && c.isFood === f)?.amountPaise;
    expect(find('AB', true)).toBe(1_800_000);
    expect(find('AB', false)).toBe(1_500_000);
    expect(find('C', true)).toBe(1_500_000);
    expect(find('C', false)).toBe(1_200_000);
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
    expect(await prisma.stallRateCard.count({ where: { editionId: e.id } })).toBe(4);
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

  test('carries nothing staff-only', async () => {
    await seedEdition();
    const cfg = (await getPublicConfig(prisma)) as unknown as Record<string, unknown>;
    expect(Object.keys(cfg).sort()).toEqual(['charges', 'customFields', 'edition', 'zones']);
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
    );
    await expect(deleteCustomField(prisma, f.id, SYSTEM)).rejects.toBeInstanceOf(
      CustomFieldInUseError,
    );
  });
});
