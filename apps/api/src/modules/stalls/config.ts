import type { PrismaClient, StallEdition } from '@prisma/client';
import {
  type ChargesInput,
  DEFAULT_RATE_CARD_2025,
  type PublicConfig,
  type RateCardEntry,
  STALL_REQUEST_TYPES,
  type ZONE_CODES,
  lookupRate,
  rupeesToPaise,
  zoneGroupOf,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import { type Db, activeEdition } from './editions';
import { CustomFieldInUseError, UnknownZoneError } from './errors';
import { MODULE_KEY } from './roles';

/** The 2025 zones, with the expected crowd per bay from the 2025 planning
 *  sheet (the prototype's seed carries the same figures). */
const ZONE_SEED: Array<{ code: string; name: string; crowd: number }> = [
  { code: 'A3', name: 'A3 — Behind Adiyogi, Snake side (VIP seating)', crowd: 4200 },
  { code: 'A4', name: 'A4 — Snake side (Paid seating)', crowd: 25000 },
  { code: 'B2', name: 'B2 — Behind Adiyogi, Moon side (VIP seating)', crowd: 4200 },
  { code: 'B3', name: 'B3 — Behind Adiyogi, Moon side (Paid seating)', crowd: 12500 },
  { code: 'B4', name: 'B4 — Moon side (Paid seating)', crowd: 27500 },
  { code: 'C1', name: 'C1 — Moon side (General seating)', crowd: 20000 },
  { code: 'C2', name: 'C2 — Moon side (General seating)', crowd: 15000 },
];

/** Charges as printed on the 2025 forms. See the warning in `forms.ts`: the
 *  ashram and local welfare forms quote DIFFERENT chair rates, and both are
 *  kept. Deposits: the local welfare form prints Rs.4000; the vendor deposit
 *  is not printed on the request form (it appears on the bank-details step)
 *  and is seeded at the same figure for an admin to correct. */
const CHARGES_2025 = {
  chairRatePaise: rupeesToPaise(50),
  tableRatePaise: rupeesToPaise(150),
  lwChairRatePaise: rupeesToPaise(100),
  lwTableRatePaise: rupeesToPaise(300),
  vendorDepositPaise: rupeesToPaise(4000),
  localWelfareDepositPaise: rupeesToPaise(4000),
  plug5aRatePaise: rupeesToPaise(500),
  plug15aRatePaise: rupeesToPaise(1000),
  gstPercent: 18,
  crowdPerStall: 1000,
};

const FINES_2025 = [
  { reason: 'Unclean stall', defaultAmountPaise: rupeesToPaise(500) },
  { reason: 'Late setup', defaultAmountPaise: rupeesToPaise(300) },
];

/** Give a new edition everything it needs to accept a request: zones, a rate
 *  card, charges, a flow config, fine types and the four reference counters.
 *  Idempotent — safe to run on an edition that already has some of it. */
export async function ensureEditionDefaults(db: Db, editionId: string): Promise<void> {
  for (const [i, z] of ZONE_SEED.entries()) {
    await db.stallZone.upsert({
      where: { editionId_code: { editionId, code: z.code } },
      create: {
        editionId,
        code: z.code,
        name: z.name,
        expectedCrowd: z.crowd,
        isClosedToVendors: zoneGroupOf(z.code as (typeof ZONE_CODES)[number]) === 'CLOSED',
        sortOrder: i,
      },
      update: {},
    });
  }
  for (const r of DEFAULT_RATE_CARD_2025) {
    await db.stallRateCard.upsert({
      where: {
        editionId_zoneGroup_isFood: { editionId, zoneGroup: r.zoneGroup, isFood: r.isFood },
      },
      create: { editionId, zoneGroup: r.zoneGroup, isFood: r.isFood, amountPaise: r.amountPaise },
      update: {},
    });
  }
  await db.stallChargeConfig.upsert({
    where: { editionId },
    create: { editionId, ...CHARGES_2025 },
    update: {},
  });
  await db.stallFlowConfig.upsert({ where: { editionId }, create: { editionId }, update: {} });
  for (const f of FINES_2025) {
    await db.stallFineType.upsert({
      where: { editionId_reason: { editionId, reason: f.reason } },
      create: { editionId, ...f },
      update: {},
    });
  }
  for (const requestType of STALL_REQUEST_TYPES) {
    await db.stallReferenceSequence.upsert({
      where: { editionId_requestType: { editionId, requestType } },
      create: { editionId, requestType },
      update: {},
    });
  }
}

export async function createEdition(
  db: PrismaClient,
  input: { year: number; name: string; activate: boolean },
  by: string,
): Promise<StallEdition> {
  return db.$transaction(async (tx) => {
    if (input.activate) {
      await tx.stallEdition.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    const edition = await tx.stallEdition.create({
      data: { year: input.year, name: input.name, isActive: input.activate },
    });
    await ensureEditionDefaults(tx, edition.id);
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_edition.created',
      subjectRef: edition.id,
      detail: { year: input.year },
    });
    return edition;
  });
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function rateCardFor(db: Db, editionId: string): Promise<RateCardEntry[]> {
  const rows = await db.stallRateCard.findMany({ where: { editionId } });
  return rows.map((r) => ({
    zoneGroup: r.zoneGroup,
    isFood: r.isFood,
    amountPaise: r.amountPaise,
  }));
}

export async function listZones(db: Db, editionId: string) {
  return db.stallZone.findMany({ where: { editionId }, orderBy: { sortOrder: 'asc' } });
}

export async function chargesFor(db: Db, editionId: string) {
  const c = await db.stallChargeConfig.findUnique({ where: { editionId } });
  if (!c) throw new Error(`edition ${editionId} has no charge config — run ensureEditionDefaults`);
  return c;
}

/** What the public form needs, and NOTHING staff-only. Only active custom
 *  fields, only public form types. */
export async function getPublicConfig(db: Db): Promise<PublicConfig> {
  const edition = await activeEdition(db);
  const [zones, card, charges, customFields] = await Promise.all([
    listZones(db, edition.id),
    rateCardFor(db, edition.id),
    chargesFor(db, edition.id),
    db.stallCustomField.findMany({
      where: {
        editionId: edition.id,
        isActive: true,
        formType: { in: ['ASHRAM', 'ASHRAM_FOOD', 'LOCAL_WELFARE', 'VENDOR'] },
      },
      orderBy: [{ formType: 'asc' }, { sortOrder: 'asc' }],
    }),
  ]);
  return {
    edition: { year: edition.year, name: edition.name },
    zones: zones.map((z) => {
      const group = zoneGroupOf(z.code as (typeof ZONE_CODES)[number]);
      const closed = z.isClosedToVendors || group === 'CLOSED';
      return {
        code: z.code,
        name: z.name,
        isClosedToVendors: closed,
        rentFoodPaise: closed ? null : lookupRate(card, group, true),
        rentNonFoodPaise: closed ? null : lookupRate(card, group, false),
      };
    }),
    charges: {
      vendorDepositPaise: charges.vendorDepositPaise,
      localWelfareDepositPaise: charges.localWelfareDepositPaise,
      gstPercent: charges.gstPercent,
    },
    customFields: customFields.map((f) => ({
      id: f.id,
      formType: f.formType,
      label: f.label,
      labelTa: f.labelTa,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      sortOrder: f.sortOrder,
    })),
  };
}

// ── Admin writes ────────────────────────────────────────────────────────────

export async function updateZone(
  db: PrismaClient,
  editionId: string,
  code: string,
  patch: { name: string; expectedCrowd: number; isClosedToVendors: boolean },
  by: string,
) {
  const zone = await db.stallZone.findUnique({ where: { editionId_code: { editionId, code } } });
  if (!zone) throw new UnknownZoneError(code);
  const updated = await db.stallZone.update({ where: { id: zone.id }, data: patch });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_zone.updated',
    subjectRef: zone.id,
    detail: patch,
  });
  return updated;
}

export async function replaceRateCard(
  db: PrismaClient,
  editionId: string,
  entries: RateCardEntry[],
  by: string,
) {
  await db.$transaction(async (tx) => {
    for (const e of entries) {
      await tx.stallRateCard.upsert({
        where: {
          editionId_zoneGroup_isFood: { editionId, zoneGroup: e.zoneGroup, isFood: e.isFood },
        },
        create: { editionId, ...e },
        update: { amountPaise: e.amountPaise },
      });
    }
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_rate_card.replaced',
      subjectRef: editionId,
      detail: { entries },
    });
  });
  return rateCardFor(db, editionId);
}

export async function updateCharges(
  db: PrismaClient,
  editionId: string,
  input: ChargesInput,
  by: string,
) {
  const updated = await db.stallChargeConfig.update({ where: { editionId }, data: input });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_charges.updated',
    subjectRef: editionId,
    detail: input,
  });
  return updated;
}

export async function flowFor(db: Db, editionId: string) {
  return db.stallFlowConfig.upsert({ where: { editionId }, create: { editionId }, update: {} });
}

export async function updateFlow(
  db: PrismaClient,
  editionId: string,
  input: { bankStepEnabled: boolean; paymentStepEnabled: boolean; fssaiStepEnabled: boolean },
  by: string,
) {
  const updated = await db.stallFlowConfig.upsert({
    where: { editionId },
    create: { editionId, ...input },
    update: input,
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_flow.updated',
    subjectRef: editionId,
    detail: input,
  });
  return updated;
}

export async function listFineTypes(db: Db, editionId: string) {
  return db.stallFineType.findMany({ where: { editionId }, orderBy: { reason: 'asc' } });
}

export async function upsertFineType(
  db: PrismaClient,
  editionId: string,
  input: { reason: string; defaultAmountPaise: number; isActive: boolean },
  by: string,
) {
  const row = await db.stallFineType.upsert({
    where: { editionId_reason: { editionId, reason: input.reason } },
    create: { editionId, ...input },
    update: { defaultAmountPaise: input.defaultAmountPaise, isActive: input.isActive },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_fine_type.upserted',
    subjectRef: row.id,
    detail: input,
  });
  return row;
}

export async function listCustomFields(db: Db, editionId: string) {
  return db.stallCustomField.findMany({
    where: { editionId },
    orderBy: [{ formType: 'asc' }, { sortOrder: 'asc' }],
  });
}

export async function createCustomField(
  db: PrismaClient,
  editionId: string,
  input: {
    formType: 'ASHRAM' | 'ASHRAM_FOOD' | 'LOCAL_WELFARE' | 'VENDOR' | 'BANK' | 'FSSAI';
    label: string;
    labelTa?: string | null;
    fieldType: string;
    isRequired: boolean;
    sortOrder: number;
  },
  by: string,
) {
  const row = await db.stallCustomField.create({
    data: { editionId, ...input, labelTa: input.labelTa ?? null },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_custom_field.created',
    subjectRef: row.id,
    detail: input,
  });
  return row;
}

export async function updateCustomField(
  db: PrismaClient,
  id: string,
  patch: Partial<{
    label: string;
    labelTa: string | null;
    fieldType: string;
    isRequired: boolean;
    sortOrder: number;
    isActive: boolean;
  }>,
  by: string,
) {
  const row = await db.stallCustomField.update({ where: { id }, data: patch });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_custom_field.updated',
    subjectRef: id,
    detail: patch,
  });
  return row;
}

/** Delete only while nothing has been typed into it. After that, deactivate. */
export async function deleteCustomField(db: PrismaClient, id: string, by: string): Promise<void> {
  const used = await db.stallCustomFieldValue.count({ where: { customFieldId: id } });
  if (used > 0) throw new CustomFieldInUseError(id);
  await db.stallCustomField.delete({ where: { id } });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_custom_field.deleted',
    subjectRef: id,
  });
}
