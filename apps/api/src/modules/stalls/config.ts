import type { PrismaClient, StallEdition, StallRateScope } from '@prisma/client';
import {
  ALL_ASKED,
  ALL_AT_ONCE,
  type ChargesInput,
  type FlowAsked,
  type FlowConfig,
  type FlowInput,
  isStepAsked,
  ONBOARDING_STEPS,
  type OnboardingStep,
  type StallRequestType,
  DEFAULT_PLAN_CATEGORIES,
  DEFAULT_RATE_CARD_2025,
  DEFAULT_TEMPLATES,
  DEFAULT_ZONES_2025,
  type PlanCategoryView,
  type PublicConfig,
  type RateCardEntry,
  type RateScope,
  STALL_REQUEST_TYPES,
  ZONE_BLURB_2025,
  type ZoneView,
  lookupRate,
  rupeesToPaise,
} from '@stalls/core';
import { actorFrom, audit } from './audit';
import { seedBankDeclarations, seedDeclarations } from './declarations';
import { publicFormsFor, seedFormDefinitions } from './form-builder';
import { type Db, activeEdition } from './editions';
import { CategoryInUseError, UnknownZoneError, ZoneExistsError, ZoneInUseError } from './errors';

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
  // The flow, all asked and all at stage 1 — every step open at once, which is
  // how the flow has always behaved. Written rather than left implicit so the
  // Admin grids open on real rows.
  for (const requestType of STALL_REQUEST_TYPES) {
    for (const step of ONBOARDING_STEPS) {
      await db.stallFlowStep.upsert({
        where: { editionId_requestType_step: { editionId, requestType, step } },
        create: { editionId, requestType, step },
        update: {},
      });
    }
  }
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
  // The consent declarations, seeded from the 2025 disclaimers.
  //
  // ⚠️ Here rather than in the dev seed, so an edition CREATED FROM THE ADMIN
  // SCREEN gets them too — the Editions panel promises a new edition is seeded
  // from the 2025 defaults, and a year that opened with no declaration would
  // fall back to a constant nobody can edit.
  await seedDeclarations(db, editionId);
  // The bank form's own two consents. Separate from the four request-form
  // disclaimers above because they are scoped to a different form and seeded
  // from a different source — see `seedBankDeclarations`.
  await seedBankDeclarations(db, editionId);

  // The four request forms, from the same constants that used to BE them.
  await seedFormDefinitions(db, editionId);

  // The outbound letters, seeded from `@stalls/core`. `update: {}` so a
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
    await audit(tx, {
      actor: actorFrom(by),
      action: 'stall_edition.created',
      subject: { type: 'edition', ref: edition.id },
      editionId: edition.id,
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

/** Bays, each with what is standing in it.
 *
 *  ⚠️ The count travels with the row because the Admin screen has to say why a
 *  bay cannot be removed BEFORE the button is pressed. Finding out from a 409
 *  after the fact is a worse screen and an avoidable round trip. */
export async function listZones(
  db: Db,
  editionId: string,
): Promise<Array<ZoneView & { id: string }>> {
  const rows = await db.stallZone.findMany({
    where: { editionId },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { stalls: true } } },
  });
  return rows.map((z) => ({
    id: z.id,
    code: z.code,
    name: z.name,
    expectedCrowd: z.expectedCrowd,
    isClosedToVendors: z.isClosedToVendors,
    sortOrder: z.sortOrder,
    stallCount: z._count.stalls,
  }));
}

/** The planning grid's columns, each saying whether anything stands on it. A
 *  column in use cannot be dropped, and the screen disables it rather than
 *  offering a delete that will be refused. */
export async function listPlanCategories(db: Db, editionId: string): Promise<PlanCategoryView[]> {
  const rows = await db.stallPlanCategory.findMany({
    where: { editionId },
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { plans: true, stalls: true } } },
  });
  return rows.map((c) => ({
    key: c.key,
    name: c.name,
    isFood: c.isFood,
    sortOrder: c.sortOrder,
    inUse: c._count.plans > 0 || c._count.stalls > 0,
  }));
}

export async function chargesFor(db: Db, editionId: string) {
  const c = await db.stallChargeConfig.findUnique({ where: { editionId } });
  if (!c) throw new Error(`edition ${editionId} has no charge config — run ensureEditionDefaults`);
  return c;
}

/** What the public form needs, and NOTHING backoffice-only. Only active custom
 *  fields, only public form types.
 *
 *  ⚠️ `scope` decides which rents come back. The same bay is priced differently
 *  for trade and for local welfare, and A3 and B2 are priced for one and closed
 *  to the other — so "the rent for this zone" is not a question that can be
 *  answered without knowing who is asking. */
export async function getPublicConfig(db: Db, scope: RateScope = 'VENDOR'): Promise<PublicConfig> {
  const edition = await activeEdition(db);
  const [zones, card, charges, customFields, declarations, forms] = await Promise.all([
    listZones(db, edition.id),
    rateCardFor(db, edition.id),
    chargesFor(db, edition.id),
    // ⚠️ `isBuiltIn: false`. This list is `PublicConfig.customFields`, which the
    // page renders AFTER the form's own questions — so without the clause every
    // built-in question would be drawn a second time, below itself.
    db.stallFormField.findMany({
      where: {
        editionId: edition.id,
        isActive: true,
        isBuiltIn: false,
        // ⚠️ No form-type filter any more. It listed the four request forms
        // because they were the only ones with definitions; the bank, FSSAI and
        // staff forms have them now, and a filter here would mean a question an
        // admin added to the bank form never reaching the page that asks it.
      },
      orderBy: [{ formType: 'asc' }, { sortOrder: 'asc' }],
    }),
    // ⚠️ Every live version for every form, not the ones for one form. The
    // public form picks its own with `declarationsFor`, and the picker has to
    // be the same function the API validates a submission with — a server that
    // pre-filtered here would be a second implementation of the fallback rule.
    db.stallDeclaration.findMany({
      where: { editionId: edition.id, isCurrent: true, isActive: true },
      select: {
        id: true,
        key: true,
        formType: true,
        version: true,
        title: true,
        body: true,
        bodyTa: true,
        isActive: true,
        isCurrent: true,
      },
    }),
    publicFormsFor(db, edition.id),
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
    // ⚠️ Nullable, and the page falls back to `FORM_DEFINITIONS` when it is
    // empty. An edition seeded before forms became data has no rows, and a
    // request form that renders nothing is worse than one rendering last year's
    // constant — `seedFormDefinitions` fills it in on the next boot regardless.
    forms,
    customFields: customFields.map((f) => ({
      id: f.id,
      formType: f.formType,
      label: f.label,
      labelTa: f.labelTa,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      sortOrder: f.sortOrder,
    })),
    declarations,
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
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_zone.updated',
    subject: { type: 'zone', ref: zone.id },
    editionId: editionId,
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
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_zone.created',
    subject: { type: 'zone', ref: zone.id },
    editionId: editionId,
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
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_zone.deleted',
    subject: { type: 'zone', ref: zone.id },
    editionId: editionId,
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
    await audit(tx, {
      actor: actorFrom(by),
      action: 'stall_plan_category.replaced',
      subject: { type: 'edition', ref: editionId },
      editionId: editionId,
      detail: { keys: categories.map((c) => c.key) },
    });
  });
  return planCategoriesFor(db, editionId);
}

/** The edition's own settings — the name, the two virtual-account prefixes
 *  Finance issues, and the cap on stalls per request. */
export async function updateEditionSettings(
  db: PrismaClient,
  editionId: string,
  input: {
    name: string;
    virtualAccountRentPrefix: string | null;
    virtualAccountDepositPrefix: string | null;
    maxStallsPerRequest: number;
    termsUrl?: string | null;
  },
  by: string,
) {
  const updated = await db.stallEdition.update({
    where: { id: editionId },
    // An empty string is "there is no document this edition", not a link to
    // nowhere — the form shows the consent without a link rather than a href
    // that 404s.
    data: { ...input, termsUrl: input.termsUrl?.trim() || null },
  });
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_edition.settings_updated',
    subject: { type: 'edition', ref: editionId },
    editionId: editionId,
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
    await audit(tx, {
      actor: actorFrom(by),
      action: 'stall_rate_card.replaced',
      subject: { type: 'edition', ref: editionId },
      editionId: editionId,
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
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_charges.updated',
    subject: { type: 'edition', ref: editionId },
    editionId: editionId,
    detail: input,
  });
  return updated;
}

/** The edition's flow: which steps each requester type is asked, and when each
 *  of them opens.
 *
 *  ⚠️ A missing `stall_flow_step` row reads as asked, at stage 1 — every step
 *  open at once, which is what the module did before any of this existed. That
 *  is what lets the table be sparse, so this never inserts rows on a read path.
 *  The migrations wrote the twelve for every edition that existed and
 *  `seedEdition` writes them for new ones; this only has to survive their
 *  absence.
 *
 *  🔴 A READ path, and it no longer writes. It used to upsert
 *  `stall_flow_config` on every call — a write on the hot path of every portal
 *  view, check-in row and letter — because that table had to exist before it
 *  could be read. There is no such table now.
 */
export async function flowFor(db: Db, editionId: string): Promise<FlowConfig> {
  const rows = await db.stallFlowStep.findMany({ where: { editionId } });
  return flowFrom(rows);
}

type FlowRow = {
  requestType: StallRequestType;
  step: OnboardingStep;
  enabled: boolean;
  stage: number;
};

/** Rows to the shape `pendingSteps` and `gatedSteps` take, filling every gap
 *  with "asked, at stage 1". */
function flowFrom(rows: FlowRow[]): FlowConfig {
  const out: FlowConfig = {
    asked: {
      VENDOR: { ...ALL_ASKED },
      LOCAL_WELFARE: { ...ALL_ASKED },
      ASHRAM: { ...ALL_ASKED },
    },
    stages: {
      VENDOR: { ...ALL_AT_ONCE },
      LOCAL_WELFARE: { ...ALL_AT_ONCE },
      ASHRAM: { ...ALL_AT_ONCE },
    },
  };
  for (const r of rows) {
    out.asked[r.requestType][r.step] = r.enabled;
    out.stages[r.requestType][r.step] = r.stage;
  }
  return out;
}

/** The flow as the Admin screen reads it: the real answer, plus the three
 *  booleans the panel used to be.
 *
 *  ⚠️ The booleans are DERIVED and are here for one reason — a Flow panel
 *  served before this change renders from them, and the web and the API deploy
 *  separately. "Asked of any type" is the truthful summary for such a page:
 *  a step switched off everywhere reads off, and one switched off for ashram
 *  only reads on, which is what that page can express. Nothing in the module
 *  reads them; `updateFlow` accepts them back only when `asked` is absent.
 */
export interface FlowView extends FlowConfig {
  bankStepEnabled: boolean;
  paymentStepEnabled: boolean;
  fssaiStepEnabled: boolean;
}

export async function flowView(db: Db, editionId: string): Promise<FlowView> {
  return toView(await flowFor(db, editionId));
}

function toView(flow: FlowConfig): FlowView {
  const anyType = (step: OnboardingStep) =>
    STALL_REQUEST_TYPES.some((t) => isStepAsked(flow, t, step));
  return {
    ...flow,
    bankStepEnabled: anyType('BANK_FORM'),
    paymentStepEnabled: anyType('PAYMENT'),
    fssaiStepEnabled: anyType('FSSAI'),
  };
}

/** What `asked` the caller meant.
 *
 *  ⚠️ The three booleans are a page served before this change talking. The web
 *  and the API deploy separately, so such a page PUTs `bankStepEnabled` and its
 *  neighbours and nothing else — and it means them for every requester type,
 *  because that is all it could ever mean. Spreading them is therefore not a
 *  guess; it is the old control's exact semantics. `asked` present wins.
 *
 *  Neither present leaves the answer alone, the way an omitted `stages` does. */
function askedFrom(input: FlowInput): FlowAsked | null {
  if (input.asked) return input.asked;
  const { bankStepEnabled: bank, paymentStepEnabled: pay, fssaiStepEnabled: fssai } = input;
  if (bank === undefined && pay === undefined && fssai === undefined) return null;
  const legacy = {
    BANK_FORM: bank ?? true,
    PAYMENT: pay ?? true,
    FSSAI: fssai ?? true,
    // Never had a switch on that page, so it cannot be what the page meant to
    // turn off.
    STAFF_REGISTRATION: true,
  };
  return { VENDOR: { ...legacy }, LOCAL_WELFARE: { ...legacy }, ASHRAM: { ...legacy } };
}

export async function updateFlow(
  db: PrismaClient,
  editionId: string,
  input: FlowInput,
  by: string,
): Promise<FlowView> {
  const asked = askedFrom(input);
  const { stages } = input;

  // ⚠️ Either half omitted leaves that half alone. A caller flipping one switch
  // must not silently reset the ordering, and a caller renumbering the grid
  // must not silently switch every step back on.
  if (asked || stages) {
    await db.$transaction(
      STALL_REQUEST_TYPES.flatMap((requestType) =>
        ONBOARDING_STEPS.map((step) => {
          const enabled = asked?.[requestType][step];
          const stage = stages?.[requestType][step];
          return db.stallFlowStep.upsert({
            where: { editionId_requestType_step: { editionId, requestType, step } },
            create: { editionId, requestType, step, enabled: enabled ?? true, stage: stage ?? 1 },
            update: {
              ...(enabled === undefined ? {} : { enabled }),
              ...(stage === undefined ? {} : { stage }),
            },
          });
        }),
      ),
    );
  }

  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_flow.updated',
    subject: { type: 'edition', ref: editionId },
    editionId: editionId,
    detail: input,
  });
  return flowView(db, editionId);
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
  await audit(db, {
    actor: actorFrom(by),
    action: 'stall_fine_type.upserted',
    subject: { type: 'fine_type', ref: row.id },
    editionId: editionId,
    detail: input,
  });
  return row;
}

/**
 * The APPENDED fields, on the public configuration payload.
 *
 * ⚠️ Read-only, and the last thing left of what was once a Custom fields tab
 * beside the Form Builder. Both edited `stall_form_field`; the shorter screen
 * listed the appended rows without the form they sit on, so it could not
 * reorder and could not say where a question is asked. The Form Builder is now
 * the only way in, and these rows survive because the public request form falls
 * back to them for an edition seeded before forms became data — see the note on
 * `groups` in `RequestForm`.
 *
 * ⚠️ `isBuiltIn: false`. The fallback appends these AFTER the constant's own
 * fields; including a built-in would draw it twice.
 */
export async function listCustomFields(db: Db, editionId: string) {
  return db.stallFormField.findMany({
    where: { editionId, isBuiltIn: false },
    orderBy: [{ formType: 'asc' }, { sortOrder: 'asc' }],
  });
}
