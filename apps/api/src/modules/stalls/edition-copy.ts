// Copying one edition's configuration into another.
//
// 🔴 The preview and the write are THE SAME PLAN. Every section planner below
// returns the rows a dialog shows and, beside them, the operations that produce
// exactly those rows — so "4 new, 7 overwritten" cannot describe one thing while
// the transaction does another. Nothing here formats for display a second time
// and nothing here decides twice what a change is.
//
// ⚠️ Configuration only, and never a delete. A row this edition has that the
// source does not is left alone, because the rows that could be lost are the
// ones something already stands on — a bay holding stalls, a field holding
// answers, a declaration holding consents.
import { Prisma } from '@prisma/client';
import type { PrismaClient, StallEdition, StallFormType } from '@prisma/client';
import {
  COPY_SECTION_LABELS,
  type ChargesInput,
  clearedRulesFor,
  type CopyChange,
  type CopyPlan,
  type CopyResult,
  type CopyRow,
  type CopySection,
  type CopySkip,
  type DateWindow,
  type FieldType,
  formatInr,
  needsNewVersion,
  sameValueShape,
} from '@stalls/core';
import { actorFrom, audit } from './audit';
import type { Db } from './editions';
import { SameEditionCopyError } from './errors';

/** One write, deferred so it can run inside the caller's transaction. Built at
 *  plan time beside the row that describes it. */
type Op = (tx: Db) => Promise<unknown>;

interface SectionPlan {
  create: CopyRow[];
  overwrite: CopyRow[];
  skip: CopySkip[];
  unchanged: number;
  ops: Op[];
}

const empty = (): SectionPlan => ({ create: [], overwrite: [], skip: [], unchanged: 0, ops: [] });

/* ── Rendering a value ──────────────────────────────────────────────────────*/

/** ⚠️ Values are rendered HERE, once, and travel as strings. A dialog that
 *  reformatted paise itself could show a figure the write does not make. */
const text = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));
const money = (v: unknown): string => formatInr(Number(v ?? 0));
const yesNo = (v: unknown): string => (v ? 'Yes' : 'No');
const count = (v: unknown): string => Number(v ?? 0).toLocaleString('en-IN');
const percent = (v: unknown): string => `${Number(v ?? 0)}%`;

/** Long prose — a declaration body — shortened for a list. The full wording is
 *  on the Declarations screen; this is here to be recognised, not read. */
const excerpt = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  const one = String(v).replace(/\s+/g, ' ').trim();
  return one.length > 140 ? `${one.slice(0, 139)}…` : one;
};

/** A display block's picture. The KEY is meaningless to read — what the list
 *  has to say is whether one is there. */
const picture = (v: unknown): string => (v ? 'A picture' : '—');

const options = (v: unknown): string => {
  if (!Array.isArray(v) || v.length === 0) return '—';
  return (v as Array<{ label?: string; value?: string }>)
    .map((o) => o.label ?? o.value ?? '')
    .join(', ');
};

interface Field<T> {
  label: string;
  of: (row: T) => unknown;
  show: (v: unknown) => string;
}

function f<T>(
  label: string,
  of: (row: T) => unknown,
  show: (v: unknown) => string = text,
): Field<T> {
  return { label, of, show };
}

/** Deep enough for what is compared here: scalars, nulls, and the options JSON.
 *  `undefined` and `null` are the same absence — a column that is null and a
 *  field the source does not carry are not a difference worth showing. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a ?? null) === null && (b ?? null) === null) return true;
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The changes between what this edition has and what the source would give it.
 *  A null `before` means the row does not exist here yet, so every field is a
 *  change and each one shows what it would be set to. */
function changesBetween<T>(fields: Field<T>[], before: T | null, after: T): CopyChange[] {
  const out: CopyChange[] = [];
  for (const fd of fields) {
    const next = fd.of(after);
    if (before === null) {
      out.push({ field: fd.label, before: null, after: fd.show(next) });
      continue;
    }
    const prev = fd.of(before);
    if (same(prev, next)) continue;
    out.push({ field: fd.label, before: fd.show(prev), after: fd.show(next) });
  }
  return out;
}

/* ── Bays ───────────────────────────────────────────────────────────────────*/

type ZoneRow = {
  code: string;
  name: string;
  expectedCrowd: number;
  isClosedToVendors: boolean;
  sortOrder: number;
};

const ZONE_FIELDS: Field<ZoneRow>[] = [
  f('Name', (r) => r.name),
  f('Expected crowd', (r) => r.expectedCrowd, count),
  f('Closed to vendors', (r) => r.isClosedToVendors, yesNo),
  f('Order', (r) => r.sortOrder),
];

async function planZones(db: Db, from: string, to: string): Promise<SectionPlan> {
  const [src, dst] = await Promise.all([
    db.stallZone.findMany({ where: { editionId: from }, orderBy: { sortOrder: 'asc' } }),
    db.stallZone.findMany({ where: { editionId: to } }),
  ]);
  const have = new Map(dst.map((z) => [z.code, z]));
  const plan = empty();
  for (const z of src) {
    const mine = have.get(z.code) ?? null;
    const row = {
      key: z.code,
      label: `${z.code} · ${z.name}`,
      changes: changesBetween(ZONE_FIELDS, mine, z),
    };
    const data = {
      name: z.name,
      expectedCrowd: z.expectedCrowd,
      isClosedToVendors: z.isClosedToVendors,
      sortOrder: z.sortOrder,
    };
    if (!mine) {
      plan.create.push(row);
      plan.ops.push((tx) =>
        tx.stallZone.create({ data: { editionId: to, code: z.code, ...data } }),
      );
    } else if (row.changes.length > 0) {
      plan.overwrite.push(row);
      plan.ops.push((tx) =>
        tx.stallZone.update({ where: { editionId_code: { editionId: to, code: z.code } }, data }),
      );
    } else {
      plan.unchanged += 1;
    }
  }
  return plan;
}

/* ── Planning columns ───────────────────────────────────────────────────────*/

type CategoryRow = { key: string; name: string; isFood: boolean; sortOrder: number };

const CATEGORY_FIELDS: Field<CategoryRow>[] = [
  f('Name', (r) => r.name),
  f('Food', (r) => r.isFood, yesNo),
  f('Order', (r) => r.sortOrder),
];

async function planCategories(db: Db, from: string, to: string): Promise<SectionPlan> {
  const [src, dst] = await Promise.all([
    db.stallPlanCategory.findMany({ where: { editionId: from }, orderBy: { sortOrder: 'asc' } }),
    db.stallPlanCategory.findMany({ where: { editionId: to } }),
  ]);
  const have = new Map(dst.map((c) => [c.key, c]));
  const plan = empty();
  for (const c of src) {
    const mine = have.get(c.key) ?? null;
    const row = { key: c.key, label: c.name, changes: changesBetween(CATEGORY_FIELDS, mine, c) };
    const data = { name: c.name, isFood: c.isFood, sortOrder: c.sortOrder };
    if (!mine) {
      plan.create.push(row);
      plan.ops.push((tx) =>
        tx.stallPlanCategory.create({ data: { editionId: to, key: c.key, ...data } }),
      );
    } else if (row.changes.length > 0) {
      plan.overwrite.push(row);
      plan.ops.push((tx) =>
        tx.stallPlanCategory.update({
          where: { editionId_key: { editionId: to, key: c.key } },
          data,
        }),
      );
    } else {
      plan.unchanged += 1;
    }
  }
  return plan;
}

/* ── Rates ──────────────────────────────────────────────────────────────────*/

type RateRow = {
  zoneCode: string;
  isFood: boolean;
  scope: string;
  amountPaise: number;
  depositPaise: number;
};

const RATE_FIELDS: Field<RateRow>[] = [
  f('Rent', (r) => r.amountPaise, money),
  f('Deposit', (r) => r.depositPaise, money),
];

const rateLabel = (r: RateRow) =>
  `${r.zoneCode} · ${r.isFood ? 'Food' : 'Non-food'} · ${r.scope === 'VENDOR' ? 'Vendor' : 'Local welfare'}`;

/**
 * ⚠️ A rate whose bay this edition does not have is SKIPPED, not written.
 * `lookupRate` is asked for a rate by bay, so a row keyed on a bay that is not
 * in the layout is a row nothing can ever read — and writing it would hide the
 * real problem, which is that Bays has not been copied yet.
 */
async function planRates(db: Db, from: string, to: string): Promise<SectionPlan> {
  const [src, dst, zones] = await Promise.all([
    db.stallRateCard.findMany({ where: { editionId: from } }),
    db.stallRateCard.findMany({ where: { editionId: to } }),
    db.stallZone.findMany({ where: { editionId: to }, select: { code: true } }),
  ]);
  const codes = new Set(zones.map((z) => z.code));
  const keyOf = (r: RateRow) => `${r.zoneCode}|${r.isFood}|${r.scope}`;
  const have = new Map(dst.map((r) => [keyOf(r), r]));
  const plan = empty();
  for (const r of src) {
    const key = keyOf(r);
    const label = rateLabel(r);
    if (!codes.has(r.zoneCode)) {
      plan.skip.push({
        key,
        label,
        reason: `this edition has no bay ${r.zoneCode} — copy Bays first`,
      });
      continue;
    }
    const mine = have.get(key) ?? null;
    const row = { key, label, changes: changesBetween(RATE_FIELDS, mine, r) };
    const data = { amountPaise: r.amountPaise, depositPaise: r.depositPaise };
    const where = {
      editionId_zoneCode_isFood_scope: {
        editionId: to,
        zoneCode: r.zoneCode,
        isFood: r.isFood,
        scope: r.scope,
      },
    };
    if (!mine) {
      plan.create.push(row);
      plan.ops.push((tx) =>
        tx.stallRateCard.create({
          data: { editionId: to, zoneCode: r.zoneCode, isFood: r.isFood, scope: r.scope, ...data },
        }),
      );
    } else if (row.changes.length > 0) {
      plan.overwrite.push(row);
      plan.ops.push((tx) => tx.stallRateCard.update({ where, data }));
    } else {
      plan.unchanged += 1;
    }
  }
  return plan;
}

/* ── Charges ────────────────────────────────────────────────────────────────*/

/** ⚠️ Not `Record<…, number>` any more. Two of the charge fields are booleans —
 *  whether the chair and table rates are daily rates at all — and typing them
 *  as numbers made `true` copy across as a value the formatter printed as a
 *  figure. */
type ChargeRow = Pick<ChargesInput, (typeof CHARGE_KEYS)[number]>;

/**
 * One row per edition, so the plan is field-by-field rather than row-by-row.
 *
 * 🔴 The edition's OWN settings are not here and never will be: the name, the
 * two virtual-account prefixes and the terms URL. A virtual account belongs to
 * the year Finance issued it for, and copying one forward would print last
 * year's account on this year's payment letter.
 */
const CHARGE_FIELDS: Field<ChargeRow>[] = [
  f('Chair (ashram)', (r) => r.chairRatePaise, money),
  f('Table (ashram)', (r) => r.tableRatePaise, money),
  f('Chair (local welfare)', (r) => r.lwChairRatePaise, money),
  f('Table (local welfare)', (r) => r.lwTableRatePaise, money),
  f('Chair (vendor)', (r) => r.vendorChairRatePaise, money),
  f('Table (vendor)', (r) => r.vendorTableRatePaise, money),
  f('5A plug', (r) => r.plug5aRatePaise, money),
  f('15A plug', (r) => r.plug15aRatePaise, money),
  f('GST on rent', (r) => r.gstRentPercent, percent),
  f('GST on items', (r) => r.gstItemsPercent, percent),
  f('GST on deposit', (r) => r.gstDepositPercent, percent),
  f('Crowd per stall', (r) => r.crowdPerStall, count),
  f('Chair and table deposit', (r) => r.chairTableDepositPaise, money),
  f('Days furniture is held', (r) => r.equipmentDays, count),
  f('Chair charged per day', (r) => r.chairPerDay, yesNo),
  f('Table charged per day', (r) => r.tablePerDay, yesNo),
  f('Chair replacement', (r) => r.chairReplacementPaise, money),
  f('Table replacement', (r) => r.tableReplacementPaise, money),
  f('Chair damage penalty', (r) => r.chairDamagePaise, money),
  f('Table damage penalty', (r) => r.tableDamagePaise, money),
];

const CHARGE_KEYS = [
  'chairRatePaise',
  'tableRatePaise',
  'lwChairRatePaise',
  'lwTableRatePaise',
  'vendorChairRatePaise',
  'vendorTableRatePaise',
  'plug5aRatePaise',
  'plug15aRatePaise',
  'gstRentPercent',
  'gstItemsPercent',
  'gstDepositPercent',
  'crowdPerStall',
  'chairTableDepositPaise',
  'equipmentDays',
  'chairPerDay',
  'tablePerDay',
  'chairReplacementPaise',
  'tableReplacementPaise',
  'chairDamagePaise',
  'tableDamagePaise',
] as const satisfies readonly (keyof ChargesInput)[];

/* ── The item catalogue ─────────────────────────────────────────────────────*/

/** ⚠️ Copied WITH the charges, not as its own section. "Copy the charges from
 *  last year" and "copy what we lend from last year" are one decision on the
 *  screen, and a new edition that inherited the rates but not the fan would
 *  price a challan it cannot print a line for. */
type ItemRow = {
  key: string;
  name: string;
  ashramRatePaise: number;
  lwRatePaise: number;
  vendorRatePaise: number;
  perDay: boolean;
  missingPaise: number;
  damagedPaise: number;
  isActive: boolean;
  sortOrder: number;
};

const ITEM_FIELDS: Field<ItemRow>[] = [
  f('Name', (r) => r.name),
  f('Rate (ashram)', (r) => r.ashramRatePaise, money),
  f('Rate (local welfare)', (r) => r.lwRatePaise, money),
  f('Rate (vendor)', (r) => r.vendorRatePaise, money),
  f('Charged per day', (r) => r.perDay, yesNo),
  f('Not returned', (r) => r.missingPaise, money),
  f('Damaged', (r) => r.damagedPaise, money),
  f('In use', (r) => r.isActive, yesNo),
];

const itemData = (r: ItemRow): Omit<ItemRow, 'key'> => ({
  name: r.name,
  ashramRatePaise: r.ashramRatePaise,
  lwRatePaise: r.lwRatePaise,
  vendorRatePaise: r.vendorRatePaise,
  perDay: r.perDay,
  missingPaise: r.missingPaise,
  damagedPaise: r.damagedPaise,
  isActive: r.isActive,
  sortOrder: r.sortOrder,
});

async function planChargeItems(db: Db, from: string, to: string, plan: SectionPlan): Promise<void> {
  const [src, dst] = await Promise.all([
    db.stallChargeItem.findMany({ where: { editionId: from }, orderBy: { sortOrder: 'asc' } }),
    db.stallChargeItem.findMany({ where: { editionId: to } }),
  ]);
  const have = new Map(dst.map((x) => [x.key, x]));
  for (const item of src) {
    const mine = have.get(item.key) ?? null;
    const row = {
      key: item.key,
      label: item.name,
      changes: changesBetween(ITEM_FIELDS, mine, item),
    };
    const data = itemData(item);
    if (!mine) {
      plan.create.push(row);
      plan.ops.push((tx) =>
        tx.stallChargeItem.create({ data: { editionId: to, key: item.key, ...data } }),
      );
    } else if (row.changes.length > 0) {
      plan.overwrite.push(row);
      plan.ops.push((tx) =>
        tx.stallChargeItem.update({
          where: { editionId_key: { editionId: to, key: item.key } },
          data,
        }),
      );
    } else {
      plan.unchanged += 1;
    }
  }
}

const chargeData = (r: ChargeRow): ChargeRow =>
  Object.fromEntries(CHARGE_KEYS.map((k) => [k, r[k]])) as ChargeRow;

async function planCharges(db: Db, from: string, to: string): Promise<SectionPlan> {
  const [src, dst] = await Promise.all([
    db.stallChargeConfig.findUnique({ where: { editionId: from } }),
    db.stallChargeConfig.findUnique({ where: { editionId: to } }),
  ]);
  const plan = empty();
  await planChargeItems(db, from, to, plan);
  if (!src) return plan;
  const row = {
    key: 'charges',
    label: 'Charges',
    changes: changesBetween(CHARGE_FIELDS, dst, src),
  };
  const data = chargeData(src);
  if (!dst) {
    plan.create.push(row);
    plan.ops.push((tx) => tx.stallChargeConfig.create({ data: { editionId: to, ...data } }));
  } else if (row.changes.length > 0) {
    plan.overwrite.push(row);
    plan.ops.push((tx) => tx.stallChargeConfig.update({ where: { editionId: to }, data }));
  } else {
    plan.unchanged += 1;
  }
  return plan;
}

/* ── Fines ──────────────────────────────────────────────────────────────────*/

type FineRow = { reason: string; defaultAmountPaise: number; isActive: boolean };

const FINE_FIELDS: Field<FineRow>[] = [
  f('Default amount', (r) => r.defaultAmountPaise, money),
  f('In use', (r) => r.isActive, yesNo),
];

async function planFines(db: Db, from: string, to: string): Promise<SectionPlan> {
  const [src, dst] = await Promise.all([
    db.stallFineType.findMany({ where: { editionId: from }, orderBy: { reason: 'asc' } }),
    db.stallFineType.findMany({ where: { editionId: to } }),
  ]);
  const have = new Map(dst.map((x) => [x.reason, x]));
  const plan = empty();
  for (const t of src) {
    const mine = have.get(t.reason) ?? null;
    const row = { key: t.reason, label: t.reason, changes: changesBetween(FINE_FIELDS, mine, t) };
    const data = { defaultAmountPaise: t.defaultAmountPaise, isActive: t.isActive };
    if (!mine) {
      plan.create.push(row);
      plan.ops.push((tx) =>
        tx.stallFineType.create({ data: { editionId: to, reason: t.reason, ...data } }),
      );
    } else if (row.changes.length > 0) {
      plan.overwrite.push(row);
      plan.ops.push((tx) =>
        tx.stallFineType.update({
          where: { editionId_reason: { editionId: to, reason: t.reason } },
          data,
        }),
      );
    } else {
      plan.unchanged += 1;
    }
  }
  return plan;
}

/* ── Forms ──────────────────────────────────────────────────────────────────*/

const FORM_SELECT = {
  id: true,
  formType: true,
  title: true,
  titleTa: true,
  sections: {
    select: { id: true, heading: true, headingTa: true, help: true, sortOrder: true },
  },
  fields: {
    select: {
      id: true,
      definitionId: true,
      name: true,
      label: true,
      labelTa: true,
      help: true,
      helpTa: true,
      fieldType: true,
      isRequired: true,
      isActive: true,
      isBuiltIn: true,
      sectionId: true,
      sortOrder: true,
      options: true,
      min: true,
      max: true,
      minLen: true,
      maxLen: true,
      decimals: true,
      pattern: true,
      patternHint: true,
      dateWindow: true,
      mediaKey: true,
    },
  },
} as const;

type FormFieldRow = {
  id: string;
  definitionId: string | null;
  name: string | null;
  label: string;
  labelTa: string | null;
  help: string | null;
  helpTa: string | null;
  fieldType: string;
  isRequired: boolean;
  isActive: boolean;
  isBuiltIn: boolean;
  sectionId: string | null;
  sortOrder: number;
  options: Prisma.JsonValue;
  min: number | null;
  max: number | null;
  minLen: number | null;
  maxLen: number | null;
  decimals: number | null;
  pattern: string | null;
  patternHint: string | null;
  dateWindow: Prisma.JsonValue;
  mediaKey: string | null;
  /** Denormalised at read time: sections are matched across editions by their
   *  heading, because a section id means nothing in another edition. */
  sectionHeading: string | null;
};

type SectionRow = {
  id: string;
  heading: string;
  headingTa: string | null;
  help: string | null;
  sortOrder: number;
};

const SECTION_FIELDS: Field<SectionRow>[] = [
  f('Tamil heading', (r) => r.headingTa),
  f('Help', (r) => r.help),
  f('Order', (r) => r.sortOrder),
];

const DEFINITION_FIELDS: Field<{ title: string; titleTa: string | null }>[] = [
  f('Title', (r) => r.title),
  f('Tamil title', (r) => r.titleTa),
];

/**
 * ⚠️ `name` is NOT here, and a copy never writes it. A built-in's answers land
 * in a typed column on `stall_request`, and renaming one posts an answer the
 * submit path has nowhere to put. What the Form Builder itself can change is
 * what a copy carries.
 *
 * 🔴 `fieldType` IS here now, and it is the one entry with a condition on it: a
 * copy carries it only where the two types post the same KIND of answer — the
 * same rule `canRetypeBuiltInTo` enforces, for the same reason. Last year's
 * "Items Selling" rewritten as a paragraph box should arrive as one; last
 * year's text question matched by label to this year's number question should
 * not quietly become text and take a column's worth of answers with it. See
 * `typeToCopy`.
 */
const FORM_FIELD_FIELDS: Field<FormFieldRow>[] = [
  f('Label', (r) => r.label),
  f('Tamil label', (r) => r.labelTa),
  f('Help', (r) => r.help),
  f('Tamil help', (r) => r.helpTa),
  f('Required', (r) => r.isRequired, yesNo),
  f('Asked', (r) => r.isActive, yesNo),
  f('Order', (r) => r.sortOrder),
  f('Section', (r) => r.sectionHeading),
  f('Choices', (r) => r.options, options),
  f('Answer type', (r) => r.fieldType),
  // The limits, in the order the builder draws them. `Minimum`/`Maximum` read
  // three ways — value, digit count, file count — decided by the type beside
  // them; see `FieldRuleValues`.
  f('Minimum', (r) => r.min),
  f('Maximum', (r) => r.max),
  f('Shortest', (r) => r.minLen),
  f('Longest', (r) => r.maxLen),
  f('Decimal places', (r) => r.decimals),
  f('Pattern', (r) => r.pattern),
  f('Pattern in words', (r) => r.patternHint),
  f('Accepted dates', (r) => r.dateWindow, options),
  // ⚠️ The picture travels, unlike `name` and `field_type`. It is part of what
  // a display block SAYS — the venue layout above the location question — and a
  // copy that left it behind would carry the wording into the new edition with
  // a hole where the map was. The key points at an object in the same store,
  // which both editions read.
  f('Picture', (r) => r.mediaKey, picture),
];

/**
 * The type a copy gives the target field.
 *
 * 🔴 The source's, where the two post the same KIND of answer — a question
 * reworded into a paragraph box last year should arrive as one — and the
 * TARGET'S otherwise. An appended field is matched across editions by its
 * label, so "Arrival" as a date in one edition and as text in the other is a
 * real possibility, and overwriting the type there would leave the target's own
 * answers under a control that cannot read them.
 *
 * ⚠️ The same rule the Form Builder's picker offers and the API refuses on.
 * Three spellings of "which retypes are safe" is how one of them ends up
 * letting through what the other two stop.
 */
function typeToCopy(source: string, target: string | null): string {
  if (target === null) return source;
  return sameValueShape(source as FieldType, target as FieldType) ? source : target;
}

/**
 * The source's limits, kept where the type they are landing on still gives them
 * a meaning.
 *
 * ⚠️ `clearedRulesFor` rather than a straight copy, and the reason is the same
 * one it exists for: `max` is a value on a number, a digit count on a telephone
 * number and a file count on a `files`. Carrying 50 from one to another is not
 * carrying a limit, it is inventing a different one.
 */
function ruleColumnsFor(fl: FormFieldRow, nextType: string) {
  const kept = clearedRulesFor(fl.fieldType as FieldType, nextType as FieldType, {
    min: fl.min,
    max: fl.max,
    minLen: fl.minLen,
    maxLen: fl.maxLen,
    decimals: fl.decimals,
    pattern: fl.pattern,
    patternHint: fl.patternHint,
    window: (fl.dateWindow as DateWindow | null) ?? null,
  });
  return {
    min: kept.min,
    max: kept.max,
    minLen: kept.minLen,
    maxLen: kept.maxLen,
    decimals: kept.decimals,
    pattern: kept.pattern,
    patternHint: kept.patternHint,
    dateWindow: kept.window === null ? Prisma.DbNull : (kept.window as Prisma.InputJsonValue),
  };
}

/** A field's identity ACROSS editions. A built-in is its `name`, which is the
 *  contract's own and cannot be edited. An appended field has no name — its id
 *  is its key, and an id is meaningless in another edition — so it is matched
 *  on its label, which is the only stable thing an admin gave it. */
const fieldKey = (r: { name: string | null; label: string }): string =>
  r.name ? `name:${r.name}` : `label:${r.label.trim().toLowerCase()}`;

const headingKey = (heading: string): string => heading.trim().toLowerCase();

const jsonIn = (v: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

/** The target's section with this heading, or null for a field that sits in the
 *  form's own flow.
 *
 *  ⚠️ Resolved when the op RUNS, not when it is planned: the section may be one
 *  the same copy is about to create, and sections are pushed ahead of fields
 *  for exactly that reason. */
async function sectionIdFor(
  tx: Db,
  definitionId: string,
  heading: string | null,
): Promise<string | null> {
  if (!heading) return null;
  const rows = await tx.stallFormSection.findMany({
    where: { definitionId },
    select: { id: true, heading: true },
  });
  return rows.find((sec) => headingKey(sec.heading) === headingKey(heading))?.id ?? null;
}

async function readForms(db: Db, editionId: string) {
  const rows = await db.stallFormDefinition.findMany({
    where: { editionId },
    select: FORM_SELECT,
  });
  return rows.map((d) => {
    const heading = new Map(d.sections.map((s) => [s.id, s.heading]));
    return {
      ...d,
      fields: d.fields.map(
        (fl): FormFieldRow => ({
          ...fl,
          sectionHeading: fl.sectionId ? (heading.get(fl.sectionId) ?? null) : null,
        }),
      ),
    };
  });
}

async function planForms(db: Db, from: string, to: string): Promise<SectionPlan> {
  const [src, dst] = await Promise.all([readForms(db, from), readForms(db, to)]);
  const mine = new Map(dst.map((d) => [d.formType, d]));
  const plan = empty();

  for (const form of src) {
    const formType = form.formType as StallFormType;
    const formLabel = form.title;
    const target = mine.get(formType) ?? null;

    // The definition itself.
    const defRow = {
      key: `${formType}`,
      label: formLabel,
      changes: changesBetween(DEFINITION_FIELDS, target, form),
    };
    if (!target) {
      plan.create.push(defRow);
      plan.ops.push((tx) =>
        tx.stallFormDefinition.create({
          data: { editionId: to, formType, title: form.title, titleTa: form.titleTa },
        }),
      );
    } else if (defRow.changes.length > 0) {
      plan.overwrite.push(defRow);
      plan.ops.push((tx) =>
        tx.stallFormDefinition.update({
          where: { editionId_formType: { editionId: to, formType } },
          data: { title: form.title, titleTa: form.titleTa },
        }),
      );
    } else {
      plan.unchanged += 1;
    }

    // ⚠️ Sections before fields, always: a field created into a section needs
    // that section to exist, and the ops run in the order they are pushed.
    const haveSections = new Map((target?.sections ?? []).map((s) => [headingKey(s.heading), s]));
    for (const s of form.sections) {
      const theirs = haveSections.get(headingKey(s.heading)) ?? null;
      const row = {
        key: `${formType}:section:${headingKey(s.heading)}`,
        label: `${formLabel} · section “${s.heading}”`,
        changes: changesBetween(SECTION_FIELDS, theirs, s),
      };
      const data = { headingTa: s.headingTa, help: s.help, sortOrder: s.sortOrder };
      if (!theirs) {
        plan.create.push(row);
        plan.ops.push(async (tx) => {
          const def = await tx.stallFormDefinition.findUniqueOrThrow({
            where: { editionId_formType: { editionId: to, formType } },
            select: { id: true },
          });
          return tx.stallFormSection.create({
            data: { definitionId: def.id, heading: s.heading, ...data },
          });
        });
      } else if (row.changes.length > 0) {
        plan.overwrite.push(row);
        plan.ops.push((tx) => tx.stallFormSection.update({ where: { id: theirs.id }, data }));
      } else {
        plan.unchanged += 1;
      }
    }

    const haveFields = new Map((target?.fields ?? []).map((x) => [fieldKey(x), x]));
    for (const fl of form.fields) {
      const key = fieldKey(fl);
      const theirs = haveFields.get(key) ?? null;
      const row = {
        key: `${formType}:${key}`,
        label: `${formLabel} · ${fl.label}`,
        changes: changesBetween(FORM_FIELD_FIELDS, theirs, fl),
      };
      // The type this field will HAVE in the target, and the limits that still
      // mean something under it — see `typeToCopy`.
      const nextType = typeToCopy(fl.fieldType, theirs?.fieldType ?? null);
      const shared = {
        label: fl.label,
        labelTa: fl.labelTa,
        help: fl.help,
        helpTa: fl.helpTa,
        isRequired: fl.isRequired,
        isActive: fl.isActive,
        sortOrder: fl.sortOrder,
        options: jsonIn(fl.options),
        ...ruleColumnsFor(fl, nextType),
        mediaKey: fl.mediaKey,
      };
      const heading = fl.sectionHeading;
      if (!theirs) {
        plan.create.push(row);
        plan.ops.push(async (tx) => {
          const def = await tx.stallFormDefinition.findUniqueOrThrow({
            where: { editionId_formType: { editionId: to, formType } },
            select: { id: true },
          });
          const sectionId = await sectionIdFor(tx, def.id, heading);
          return tx.stallFormField.create({
            data: {
              editionId: to,
              definitionId: def.id,
              sectionId,
              formType,
              // Only ever set at CREATE, never on an overwrite — see the note
              // on `FORM_FIELD_FIELDS`.
              name: fl.name,
              fieldType: nextType,
              isBuiltIn: fl.isBuiltIn,
              ...shared,
            },
          });
        });
      } else if (row.changes.length > 0) {
        plan.overwrite.push(row);
        const definitionId = theirs.definitionId ?? target?.id ?? null;
        plan.ops.push(async (tx) => {
          const sectionId = definitionId ? await sectionIdFor(tx, definitionId, heading) : null;
          return tx.stallFormField.update({
            where: { id: theirs.id },
            data: { ...shared, fieldType: nextType, sectionId },
          });
        });
      } else {
        plan.unchanged += 1;
      }
    }
  }
  return plan;
}

/* ── Declarations ───────────────────────────────────────────────────────────*/

type DeclRow = {
  id: string;
  key: string;
  formType: StallFormType | null;
  version: number;
  title: string;
  body: string;
  bodyTa: string | null;
  isActive: boolean;
};

const DECLARATION_FIELDS: Field<DeclRow>[] = [
  f('Title', (r) => r.title),
  f('Wording', (r) => r.body, excerpt),
  f('Tamil wording', (r) => r.bodyTa, excerpt),
  f('Shown on the form', (r) => r.isActive, yesNo),
];

/**
 * 🔴 A copy never rewrites a declaration in place. A consent points at a
 * VERSION, and rewriting the version it points at would change what a requester
 * is recorded as having agreed to — the whole reason declarations stopped being
 * a constant in `forms.ts`. Different wording archives the current version and
 * writes the next one, exactly as `updateDeclaration` does; a title or a
 * visibility flag edits the row, because neither changes what anybody agreed
 * to.
 */
async function planDeclarations(db: Db, from: string, to: string): Promise<SectionPlan> {
  const [src, dst] = await Promise.all([
    db.stallDeclaration.findMany({ where: { editionId: from, isCurrent: true } }),
    db.stallDeclaration.findMany({ where: { editionId: to, isCurrent: true } }),
  ]);
  const keyOf = (d: DeclRow) => `${d.key}|${d.formType ?? 'ANY'}`;
  const have = new Map(dst.map((d) => [keyOf(d), d]));
  const plan = empty();

  for (const d of src) {
    const key = keyOf(d);
    const theirs = have.get(key) ?? null;
    const label = `${d.title} · ${d.formType ?? 'every form'}`;
    const row = { key, label, changes: changesBetween(DECLARATION_FIELDS, theirs, d) };

    if (!theirs) {
      plan.create.push(row);
      plan.ops.push((tx) =>
        tx.stallDeclaration.create({
          data: {
            editionId: to,
            key: d.key,
            formType: d.formType,
            version: 1,
            title: d.title,
            body: d.body,
            bodyTa: d.bodyTa,
            isActive: d.isActive,
            isCurrent: true,
          },
        }),
      );
      continue;
    }

    if (row.changes.length === 0) {
      plan.unchanged += 1;
      continue;
    }

    plan.overwrite.push(row);
    if (needsNewVersion(theirs, d)) {
      plan.ops.push(async (tx) => {
        // Re-read rather than trusting the plan's copy: the version number has
        // to be the one that is current when the write happens, and exactly one
        // version may be current at a time — enforced by a partial unique index
        // rather than by this code.
        const current = await tx.stallDeclaration.findFirstOrThrow({
          where: { editionId: to, key: d.key, formType: theirs.formType, isCurrent: true },
        });
        await tx.stallDeclaration.update({
          where: { id: current.id },
          data: { isCurrent: false, archivedAt: new Date() },
        });
        return tx.stallDeclaration.create({
          data: {
            editionId: to,
            key: current.key,
            formType: current.formType,
            version: current.version + 1,
            title: d.title,
            body: d.body,
            bodyTa: d.bodyTa,
            isActive: d.isActive,
            isCurrent: true,
          },
        });
      });
    } else {
      plan.ops.push((tx) =>
        tx.stallDeclaration.update({
          where: { id: theirs.id },
          data: { title: d.title, isActive: d.isActive },
        }),
      );
    }
  }
  return plan;
}

/* ── The plan, and applying it ──────────────────────────────────────────────*/

const PLANNERS: Record<CopySection, (db: Db, from: string, to: string) => Promise<SectionPlan>> = {
  zones: planZones,
  planCategories: planCategories,
  rates: planRates,
  charges: planCharges,
  fineTypes: planFines,
  forms: planForms,
  declarations: planDeclarations,
};

/** What copying this section would do. Nothing is written. */
export async function planCopy(
  db: Db,
  from: StallEdition,
  into: StallEdition,
  section: CopySection,
): Promise<CopyPlan> {
  if (from.id === into.id) throw new SameEditionCopyError();
  const plan = await PLANNERS[section](db, from.id, into.id);
  return {
    section,
    fromEditionId: from.id,
    fromEditionName: from.name,
    intoEditionName: into.name,
    create: plan.create,
    overwrite: plan.overwrite,
    skip: plan.skip,
    unchanged: plan.unchanged,
  };
}

/**
 * Does it.
 *
 * ⚠️ The plan is rebuilt INSIDE the transaction rather than taken from the
 * preview. The admin may have sat on the dialog while somebody else edited a
 * rate, and writing a plan computed against a row that has since moved would
 * silently undo their edit. What is applied is what is true at the moment of
 * the write, and the counts returned describe that — not what the dialog said.
 */
export async function applyCopy(
  db: PrismaClient,
  from: StallEdition,
  into: StallEdition,
  section: CopySection,
  by: string,
): Promise<CopyResult> {
  if (from.id === into.id) throw new SameEditionCopyError();
  return db.$transaction(async (tx) => {
    const plan = await PLANNERS[section](tx, from.id, into.id);
    for (const op of plan.ops) await op(tx);
    const result: CopyResult = {
      created: plan.create.length,
      overwritten: plan.overwrite.length,
      skipped: plan.skip.length,
    };
    await audit(tx, {
      actor: actorFrom(by),
      action: 'stall_edition.copied',
      subject: { type: 'edition', ref: into.id },
      editionId: into.id,
      detail: {
        section,
        sectionLabel: COPY_SECTION_LABELS[section],
        fromEditionId: from.id,
        fromYear: from.year,
        ...result,
      },
    });
    return result;
  });
}
