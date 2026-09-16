import { randomUUID } from 'node:crypto';
import type { StallEdition } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { CopyPlan, CopyResult, CopySection } from '@msr/stalls';
import { buildApp } from '../src/app';
import {
  type Backoffice,
  LogMailer,
  prisma,
  resetDatabase,
  seedBackoffice,
  seedEdition,
} from './helpers/db';

/**
 * Copying a section of one edition's configuration into the active one.
 *
 * The rule under nearly every test here: a copy MERGES and never deletes, and
 * running it twice changes nothing the second time. The second half of that is
 * what catches an appended form field duplicating on every copy, which is the
 * one way this feature could quietly corrupt a public form.
 */
let app: FastifyInstance;
let admin: Backoffice;
let lead: Backoffice;
/** Last year, inactive — the source. */
let past: StallEdition;
/** This year, active — every copy's target, and never named in a request. */
let current: StallEdition;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  past = await seedEdition(2025);
  current = await seedEdition(2026);
  admin = await seedBackoffice(['stalls_admin'], 'admin@example.org');
  lead = await seedBackoffice(['stalls_lead'], 'lead@example.org');
});

const preview = (section: CopySection, who: Backoffice = admin, fromEditionId = past.id) =>
  app.inject({
    method: 'POST',
    url: '/api/m/stalls/config/copy/preview',
    headers: who.headers,
    payload: { fromEditionId, section },
  });

const copy = (section: CopySection, who: Backoffice = admin, fromEditionId = past.id) =>
  app.inject({
    method: 'POST',
    url: '/api/m/stalls/config/copy',
    headers: who.headers,
    payload: { fromEditionId, section },
  });

const plan = async (section: CopySection): Promise<CopyPlan> => (await preview(section)).json();
const applied = async (section: CopySection): Promise<CopyResult> => {
  const res = await copy(section);
  expect(res.statusCode).toBe(200);
  return res.json();
};

describe('bays', () => {
  test('overwrites a bay that differs, creates one this edition lacks, leaves an extra alone', async () => {
    await prisma.stallZone.update({
      where: { editionId_code: { editionId: past.id, code: 'C1' } },
      data: { name: 'Sangha Ground (2025 name)', expectedCrowd: 77_000 },
    });
    await prisma.stallZone.create({
      data: { editionId: past.id, code: 'D1', name: 'New ground', sortOrder: 9 },
    });
    // Only this year has it. A copy must not take it away.
    await prisma.stallZone.create({
      data: { editionId: current.id, code: 'E9', name: 'Overflow', sortOrder: 20 },
    });

    const p = await plan('zones');
    expect(p.create.map((r) => r.key)).toEqual(['D1']);
    expect(p.overwrite.map((r) => r.key)).toEqual(['C1']);
    expect(p.overwrite[0].changes).toContainEqual({
      field: 'Name',
      before: 'C1 — Moon side (General seating)',
      after: 'Sangha Ground (2025 name)',
    });

    // The preview wrote nothing.
    expect(await prisma.stallZone.count({ where: { editionId: current.id, code: 'D1' } })).toBe(0);

    expect(await applied('zones')).toEqual({ created: 1, overwritten: 1, skipped: 0 });
    const after = await prisma.stallZone.findMany({ where: { editionId: current.id } });
    expect(after.find((z) => z.code === 'C1')?.name).toBe('Sangha Ground (2025 name)');
    expect(after.find((z) => z.code === 'C1')?.expectedCrowd).toBe(77_000);
    expect(after.find((z) => z.code === 'D1')).toBeTruthy();
    expect(after.find((z) => z.code === 'E9')).toBeTruthy();
  });

  test('a second copy changes nothing', async () => {
    await prisma.stallZone.update({
      where: { editionId_code: { editionId: past.id, code: 'C1' } },
      data: { name: 'Renamed' },
    });
    await applied('zones');
    const second = await plan('zones');
    expect(second.create).toEqual([]);
    expect(second.overwrite).toEqual([]);
    expect(second.unchanged).toBeGreaterThan(0);
  });
});

describe('rates', () => {
  test('a rate for a bay this edition has no bay for is skipped, not written', async () => {
    await prisma.stallZone.create({
      data: { editionId: past.id, code: 'D1', name: 'New ground', sortOrder: 9 },
    });
    await prisma.stallRateCard.create({
      data: {
        editionId: past.id,
        zoneCode: 'D1',
        isFood: true,
        scope: 'VENDOR',
        amountPaise: 1_000_000,
        depositPaise: 400_000,
      },
    });

    const p = await plan('rates');
    expect(p.skip.map((s) => s.key)).toEqual(['D1|true|VENDOR']);
    expect(p.skip[0].reason).toContain('D1');

    expect((await applied('rates')).skipped).toBe(1);
    expect(
      await prisma.stallRateCard.count({ where: { editionId: current.id, zoneCode: 'D1' } }),
    ).toBe(0);

    // Copy the bays first and the rate goes through.
    await applied('zones');
    expect((await applied('rates')).created).toBe(1);
    expect(
      await prisma.stallRateCard.count({ where: { editionId: current.id, zoneCode: 'D1' } }),
    ).toBe(1);
  });

  test('a changed rent comes across as rupees, both sides of the arrow', async () => {
    await prisma.stallRateCard.updateMany({
      where: { editionId: past.id, zoneCode: 'C1', isFood: true, scope: 'VENDOR' },
      data: { amountPaise: 2_000_000 },
    });
    const p = await plan('rates');
    const row = p.overwrite.find((r) => r.key === 'C1|true|VENDOR');
    expect(row?.changes).toContainEqual({
      field: 'Rent',
      before: '₹15,000',
      after: '₹20,000',
    });
  });
});

describe('charges', () => {
  test('is one row, so the plan is field by field', async () => {
    await prisma.stallChargeConfig.update({
      where: { editionId: past.id },
      data: { gstPercent: 12, chairRatePaise: 7_500 },
    });
    const p = await plan('charges');
    expect(p.overwrite).toHaveLength(1);
    expect(p.overwrite[0].changes.map((c) => c.field).sort()).toEqual(['Chair (ashram)', 'GST']);

    await applied('charges');
    const after = await prisma.stallChargeConfig.findUniqueOrThrow({
      where: { editionId: current.id },
    });
    expect(after.gstPercent).toBe(12);
    expect(after.chairRatePaise).toBe(7_500);
  });

  test("never carries the edition's own settings across", async () => {
    await prisma.stallEdition.update({
      where: { id: past.id },
      data: { virtualAccountRentPrefix: 'MSR2025', termsUrl: 'https://example.org/2025' },
    });
    await applied('charges');
    const after = await prisma.stallEdition.findUniqueOrThrow({ where: { id: current.id } });
    expect(after.virtualAccountRentPrefix).toBeNull();
    expect(after.termsUrl).toBeNull();
  });
});

describe('fines', () => {
  test('creates one this edition lacks and updates the amount of one it has', async () => {
    await prisma.stallFineType.updateMany({
      where: { editionId: past.id, reason: 'Late setup' },
      data: { defaultAmountPaise: 90_000 },
    });
    await prisma.stallFineType.create({
      data: { editionId: past.id, reason: 'Blocked walkway', defaultAmountPaise: 25_000 },
    });

    expect(await applied('fineTypes')).toEqual({ created: 1, overwritten: 1, skipped: 0 });
    const rows = await prisma.stallFineType.findMany({ where: { editionId: current.id } });
    expect(rows.find((r) => r.reason === 'Late setup')?.defaultAmountPaise).toBe(90_000);
    expect(rows.find((r) => r.reason === 'Blocked walkway')).toBeTruthy();
  });
});

describe('forms', () => {
  const vendorForm = (editionId: string) =>
    prisma.stallFormDefinition.findUniqueOrThrow({
      where: { editionId_formType: { editionId, formType: 'VENDOR' } },
    });

  test("brings a built-in's wording across without touching its name or type", async () => {
    const def = await vendorForm(past.id);
    const field = await prisma.stallFormField.findFirstOrThrow({
      where: { definitionId: def.id, isBuiltIn: true, name: { not: null } },
      orderBy: { sortOrder: 'asc' },
    });
    await prisma.stallFormField.update({
      where: { id: field.id },
      data: { label: 'Name of the stall (2025 wording)', isRequired: false },
    });

    await applied('forms');
    const mine = await prisma.stallFormField.findFirstOrThrow({
      where: { editionId: current.id, formType: 'VENDOR', name: field.name },
    });
    expect(mine.label).toBe('Name of the stall (2025 wording)');
    expect(mine.isRequired).toBe(false);
    expect(mine.name).toBe(field.name);
    expect(mine.fieldType).toBe(field.fieldType);
    expect(mine.isBuiltIn).toBe(true);
  });

  test('an appended question is created once, not once per copy', async () => {
    const def = await vendorForm(past.id);
    await prisma.stallFormField.create({
      data: {
        editionId: past.id,
        definitionId: def.id,
        formType: 'VENDOR',
        label: 'Do you need overnight storage?',
        fieldType: 'checkbox',
        isRequired: false,
        sortOrder: 99,
      },
    });

    await applied('forms');
    await applied('forms');

    const mine = await prisma.stallFormField.findMany({
      where: { editionId: current.id, formType: 'VENDOR', label: 'Do you need overnight storage?' },
    });
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBeNull();
    expect(mine[0].isBuiltIn).toBe(false);
  });

  test('a heading is created before the questions that sit under it', async () => {
    const def = await vendorForm(past.id);
    const section = await prisma.stallFormSection.create({
      data: { definitionId: def.id, heading: 'Electricity', sortOrder: 5 },
    });
    const field = await prisma.stallFormField.findFirstOrThrow({
      where: { definitionId: def.id },
      orderBy: { sortOrder: 'asc' },
    });
    await prisma.stallFormField.update({
      where: { id: field.id },
      data: { sectionId: section.id },
    });

    await applied('forms');
    const mineDef = await vendorForm(current.id);
    const mineSection = await prisma.stallFormSection.findFirstOrThrow({
      where: { definitionId: mineDef.id, heading: 'Electricity' },
    });
    const mineField = await prisma.stallFormField.findFirstOrThrow({
      where: { editionId: current.id, formType: 'VENDOR', name: field.name },
    });
    expect(mineField.sectionId).toBe(mineSection.id);
  });

  test('a second copy changes nothing', async () => {
    await applied('forms');
    const second = await plan('forms');
    expect(second.create).toEqual([]);
    expect(second.overwrite).toEqual([]);
  });
});

describe('declarations', () => {
  const currentRow = (editionId: string) =>
    prisma.stallDeclaration.findFirstOrThrow({
      where: { editionId, requestType: 'VENDOR', isCurrent: true },
    });

  test('different wording writes a NEW version and archives the old one', async () => {
    await prisma.stallDeclaration.updateMany({
      where: { editionId: past.id, requestType: 'VENDOR', isCurrent: true },
      data: { body: 'The 2025 wording, as it actually stood.' },
    });
    const before = await currentRow(current.id);

    await applied('declarations');

    const after = await currentRow(current.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.body).toBe('The 2025 wording, as it actually stood.');
    const old = await prisma.stallDeclaration.findUniqueOrThrow({ where: { id: before.id } });
    expect(old.isCurrent).toBe(false);
    expect(old.archivedAt).not.toBeNull();
    // What anybody agreed to is the ARCHIVED row, and it still says what it said.
    expect(old.body).toBe(before.body);
  });

  test('a second copy adds no third version', async () => {
    await prisma.stallDeclaration.updateMany({
      where: { editionId: past.id, requestType: 'VENDOR', isCurrent: true },
      data: { body: 'The 2025 wording.' },
    });
    await applied('declarations');
    await applied('declarations');
    const all = await prisma.stallDeclaration.findMany({
      where: { editionId: current.id, requestType: 'VENDOR' },
    });
    expect(all).toHaveLength(2);
  });

  test('a title-only difference edits the row rather than versioning it', async () => {
    await prisma.stallDeclaration.updateMany({
      where: { editionId: past.id, requestType: 'VENDOR', isCurrent: true },
      data: { title: 'Stall request — 2025' },
    });
    const before = await currentRow(current.id);

    await applied('declarations');

    const after = await currentRow(current.id);
    expect(after.id).toBe(before.id);
    expect(after.version).toBe(before.version);
    expect(after.title).toBe('Stall request — 2025');
  });
});

describe('reading another edition', () => {
  test('config can be read for a past edition, and says which one it is', async () => {
    await prisma.stallZone.update({
      where: { editionId_code: { editionId: past.id, code: 'C1' } },
      data: { name: 'Last year’s name' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/config?editionId=${past.id}`,
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().edition.year).toBe(2025);
    expect(res.json().edition.isActive).toBe(false);
    expect(res.json().zones.find((z: { code: string }) => z.code === 'C1').name).toBe(
      'Last year’s name',
    );
  });

  test('without an editionId it is still the active edition', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/config',
      headers: admin.headers,
    });
    expect(res.json().edition.year).toBe(2026);
  });

  test('an edition that does not exist is a 404, not an empty screen', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/m/stalls/config?editionId=${randomUUID()}`,
      headers: admin.headers,
    });
    expect(res.statusCode).toBe(404);
  });

  test('forms and declarations take the same edition', async () => {
    for (const path of ['config/forms', 'config/declarations']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/m/stalls/${path}?editionId=${past.id}`,
        headers: admin.headers,
      });
      expect(res.statusCode).toBe(200);
    }
  });
});

describe('authorisation', () => {
  test('a lead may preview but not copy', async () => {
    expect((await preview('zones', lead)).statusCode).toBe(200);
    expect((await copy('zones', lead)).statusCode).toBe(403);
  });

  test('a grant that does not reach the source edition is refused', async () => {
    const scoped = await seedBackoffice([], 'scoped@example.org');
    await prisma.stallBackofficeRole.create({
      data: {
        personRef: scoped.personId,
        roleKey: 'stalls_admin',
        grantedBy: admin.personId,
        // This year only. Last year is not theirs to read, let alone copy.
        editionScope: [current.id],
      },
    });
    const res = await preview('zones', scoped);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('edition');
  });

  test('copying the active edition into itself is refused', async () => {
    const res = await copy('zones', admin, current.id);
    expect(res.statusCode).toBe(409);
  });

  test('the copy is on the activity trail, with what it moved', async () => {
    await applied('fineTypes');
    const row = await prisma.activityTrail.findFirstOrThrow({
      where: { action: 'stall_edition.copied' },
    });
    expect(row.subjectRef).toBe(current.id);
    expect(row.detail).toMatchObject({ section: 'fineTypes', fromYear: 2025 });
  });
});
