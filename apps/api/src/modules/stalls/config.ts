import type { PrismaClient, StallEdition, StallRateScope } from '@prisma/client';
import {
  type ChargesInput,
  DEFAULT_PLAN_CATEGORIES,
  DEFAULT_RATE_CARD_2025,
  DEFAULT_TEMPLATES,
  DEFAULT_ZONES_2025,
  type PublicConfig,
  type RateCardEntry,
  type RateScope,
  STALL_REQUEST_TYPES,
  ZONE_BLURB_2025,
  lookupRate,
  rupeesToPaise,
} from '@msr/stalls';
import { recordActivity } from '../../activity';
import { type Db, activeEdition } from './editions';
import {
  CategoryInUseError,
  CustomFieldInUseError,
  UnknownZoneError,
  ZoneExistsError,
  ZoneInUseError,
} from './errors';
import { MODULE_KEY } from './roles';

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
  // The third pair, from the bank-details form a vendor fills in. Seeded
  // rather than inferred: a vendor quoted the ashram figure above is quoted
  // from a form that was never addressed to them.
  vendorChairRatePaise: rupeesToPaise(100),
  vendorTableRatePaise: rupeesToPaise(400),
  plug5aRatePaise: rupeesToPaise(500),
  plug15aRatePaise: rupeesToPaise(1000),
  gstPercent: 18,
  crowdPerStall: 1000,
  // Phase 2 and 3. The 2025 payment sheet carries a flat Rs.4000 "Chair and
  // table Deposit" per vendor; the replacement and damage figures are not
  // printed anywhere and are seeded for an admin to set against what the
  // furniture actually costs to replace.
  chairTableDepositPaise: rupeesToPaise(4000),
  equipmentDays: 1,
  chairReplacementPaise: rupeesToPaise(400),
  tableReplacementPaise: rupeesToPaise(900),
  damagePenaltyPaise: rupeesToPaise(250),
};

const FINES_2025 = [
  { reason: 'Unclean stall', defaultAmountPaise: rupeesToPaise(500) },
  { reason: 'Late setup', defaultAmountPaise: rupeesToPaise(300) },
];

/** Give a new edition everything it needs to accept a request: zones, a rate
 *  card, charges, a flow config, fine types and the four reference counters.
 *  Idempotent — safe to run on an edition that already has some of it. */
export async function ensureEditionDefaults(db: Db, editionId: string): Promise<void> {
  for (const z of DEFAULT_ZONES_2025) {
    await db.stallZone.upsert({
      where: { editionId_code: { editionId, code: z.code } },
      create: {
        editionId,
        code: z.code,
        name: z.name,
        expectedCrowd: z.expectedCrowd,
        isClosedToVendors: z.isClosedToVendors,
        sortOrder: z.sortOrder,
      },
      update: {},
    });
  }
  for (const c of DEFAULT_PLAN_CATEGORIES) {
    await db.stallPlanCategory.upsert({
      where: { editionId_key: { editionId, key: c.key } },
      create: { editionId, key: c.key, name: c.name, isFood: c.isFood, sortOrder: c.sortOrder },
      update: {},
    });
  }
  for (const r of DEFAULT_RATE_CARD_2025) {
    await db.stallRateCard.upsert({
      where: {
        editionId_zoneCode_isFood_scope: {
          editionId,
          zoneCode: r.zoneCode,
          isFood: r.isFood,
          scope: r.scope,
        },
      },
      create: {
        editionId,
        zoneCode: r.zoneCode,
        isFood: r.isFood,
        scope: r.scope,
        amountPaise: r.amountPaise,
        depositPaise: r.depositPaise,
      },
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
  // The outbound letters, seeded from `@msr/stalls`. `update: {}` so a
  // re-run never overwrites wording an admin has edited.
  for (const t of DEFAULT_TEMPLATES) {
    await db.stallEmailTemplate.upsert({
      where: { editionId_key: { editionId, key: t.key } },
      create: {
        editionId,
        key: t.key,
        subject: t.subject,
        body: t.body,
        whatsappBody: t.whatsappBody,
      },
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
    zoneCode: r.zoneCode,
    isFood: r.isFood,
    scope: r.scope as RateScope,
    amountPaise: r.amountPaise,
    depositPaise: r.depositPaise,
  }));
}

export async function planCategoriesFor(db: Db, editionId: string) {
  return db.stallPlanCategory.findMany({ where: { editionId }, orderBy: { sortOrder: 'asc' } });
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
 *  fields, only public form types.
 *
 *  ⚠️ `scope` decides which rents come back. The same bay is priced differently
 *  for trade and for local welfare, and A3 and B2 are priced for one and closed
 *  to the other — so "the rent for this zone" is not a question that can be
 *  answered without knowing who is asking. */
export async function getPublicConfig(db: Db, scope: RateScope = 'VENDOR'): Promise<PublicConfig> {
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
      // A bay closed to vendors is still priced for local welfare — that is the
      // whole reason the rent is resolved against the caller's scope rather
      // than read off the zone.
      const hidden = scope === 'VENDOR' && z.isClosedToVendors;
      const food = hidden ? null : lookupRate(card, z.code, true, scope);
      const nonFood = hidden ? null : lookupRate(card, z.code, false, scope);
      return {
        code: z.code,
        name: z.name,
        blurb: ZONE_BLURB_2025[z.code] ?? null,
        isClosedToVendors: z.isClosedToVendors,
        rentFoodPaise: food?.amountPaise ?? null,
        rentNonFoodPaise: nonFood?.amountPaise ?? null,
        // The advance rides on the rate row, so it is area-wise too. Either row
        // carries it; they are set together.
        depositPaise: (food ?? nonFood)?.depositPaise ?? null,
      };
    }),
    charges: {
      gstPercent: charges.gstPercent,
    },
    maxStallsPerRequest: edition.maxStallsPerRequest,
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

/** Adding a bay. The venue is redrawn every year, so this is configuration
 *  rather than a migration — and the alternative, a code change and a redeploy
 *  in the weeks before the event, is not one the stall team can reach. */
export async function createZone(
  db: PrismaClient,
  editionId: string,
  input: { code: string; name: string; expectedCrowd: number; isClosedToVendors: boolean },
  by: string,
) {
  const existing = await db.stallZone.findUnique({
    where: { editionId_code: { editionId, code: input.code } },
  });
  if (existing) throw new ZoneExistsError(input.code);
  const last = await db.stallZone.findFirst({
    where: { editionId },
    orderBy: { sortOrder: 'desc' },
  });
  const zone = await db.stallZone.create({
    data: { editionId, ...input, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_zone.created',
    subjectRef: zone.id,
    detail: { code: input.code },
  });
  return zone;
}

/** ⚠️ Refuses while the bay holds stalls, rather than cascading.
 *
 *  The cascade would be silent and would take the stalls, their allocations and
 *  the history of who stood where with it. A bay is removed from a layout
 *  BEFORE it is planned, so needing to empty it first is the normal order of
 *  work and not an obstacle. */
export async function deleteZone(db: PrismaClient, editionId: string, code: string, by: string) {
  const zone = await db.stallZone.findUnique({
    where: { editionId_code: { editionId, code } },
    include: { _count: { select: { stalls: true } } },
  });
  if (!zone) throw new UnknownZoneError(code);
  if (zone._count.stalls > 0) throw new ZoneInUseError(code, zone._count.stalls);
  await db.stallZone.delete({ where: { id: zone.id } });
  await db.stallRateCard.deleteMany({ where: { editionId, zoneCode: code } });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_zone.deleted',
    subjectRef: zone.id,
    detail: { code },
  });
}

/** The planning grid's columns. Replaces the set wholesale, but refuses to drop
 *  a column anything is planned or standing against — the same reasoning as a
 *  bay that still holds stalls. */
export async function replacePlanCategories(
  db: PrismaClient,
  editionId: string,
  categories: Array<{ key: string; name: string; isFood: boolean; sortOrder: number }>,
  by: string,
) {
  await db.$transaction(async (tx) => {
    const existing = await tx.stallPlanCategory.findMany({
      where: { editionId },
      include: { _count: { select: { plans: true, stalls: true } } },
    });
    const keep = new Set(categories.map((c) => c.key));
    for (const e of existing) {
      if (keep.has(e.key)) continue;
      if (e._count.plans > 0 || e._count.stalls > 0) {
        throw new CategoryInUseError(e.key, e._count.plans + e._count.stalls);
      }
      await tx.stallPlanCategory.delete({ where: { id: e.id } });
    }
    for (const c of categories) {
      await tx.stallPlanCategory.upsert({
        where: { editionId_key: { editionId, key: c.key } },
        create: { editionId, ...c },
        update: { name: c.name, isFood: c.isFood, sortOrder: c.sortOrder },
      });
    }
    await recordActivity(tx, {
      actorRef: by,
      moduleKey: MODULE_KEY,
      action: 'stall_plan_category.replaced',
      subjectRef: editionId,
      detail: { keys: categories.map((c) => c.key) },
    });
  });
  return planCategoriesFor(db, editionId);
}

/** The season's own settings — the name, the two virtual-account prefixes
 *  Finance issues, and the cap on stalls per request. */
export async function updateEditionSettings(
  db: PrismaClient,
  editionId: string,
  input: {
    name: string;
    virtualAccountRentPrefix: string | null;
    virtualAccountDepositPrefix: string | null;
    maxStallsPerRequest: number;
  },
  by: string,
) {
  const updated = await db.stallEdition.update({ where: { id: editionId }, data: input });
  await recordActivity(db, {
    actorRef: by,
    moduleKey: MODULE_KEY,
    action: 'stall_edition.settings_updated',
    subjectRef: editionId,
    // The prefixes are not secret — they are printed on every payment letter —
    // but recording them is what answers "which account was this season's".
    detail: input,
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
    // ⚠️ Rows the caller did not send are REMOVED, not left behind: a bay that
    // has lost its rate has genuinely lost it, and a stale row would keep
    // quoting a price the team believes they deleted.
    await tx.stallRateCard.deleteMany({ where: { editionId } });
    for (const e of entries) {
      await tx.stallRateCard.create({
        data: {
          editionId,
          zoneCode: e.zoneCode,
          isFood: e.isFood,
          scope: e.scope as StallRateScope,
          amountPaise: e.amountPaise,
          depositPaise: e.depositPaise,
        },
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
