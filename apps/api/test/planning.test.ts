import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@msr/stalls';
import type { StallEdition } from '@prisma/client';
import { buildApp } from '../src/app';
import { applyPlan, readPlan, writePlan } from '../src/modules/stalls/planning';
import { selectRequest } from '../src/modules/stalls/selection';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  LogMailer,
  SYSTEM,
  type Staff,
  prisma,
  resetDatabase,
  seedEdition,
  seedStaff,
  vendorBody,
} from './helpers/db';
import { counts, makeStalls } from './helpers/plan';

let app: FastifyInstance;
let edition: StallEdition;
let lead: Staff;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  lead = await seedStaff(['stalls_lead']);
});

describe('readPlan', () => {
  test('one row per zone, with the crowd-based suggestion', async () => {
    const plan = await readPlan(prisma, edition.id);
    expect(plan.rows.map((r) => r.zoneCode)).toEqual(['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2']);
    const a4 = plan.rows.find((r) => r.zoneCode === 'A4');
    expect(a4?.expectedCrowd).toBe(25000);
    expect(a4?.suggested).toBe(25);
    expect(plan.crowdPerStall).toBe(1000);
    expect(plan.totals.grandTotal).toBe(0);
  });

  test('changing the divisor changes every suggestion', async () => {
    await writePlan(prisma, edition.id, { crowdPerStall: 500, rows: [] }, SYSTEM);
    const plan = await readPlan(prisma, edition.id);
    expect(plan.rows.find((r) => r.zoneCode === 'A4')?.suggested).toBe(50);
  });
});

describe('applyPlan', () => {
  test('creates a contiguous run of stalls, categories in planning order', async () => {
    const r = await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 2, ASHRAM_NON_FOOD: 1 });
    expect(r.created).toEqual(['A4-1', 'A4-2', 'A4-3']);
    const stalls = await prisma.stall.findMany({
      where: { zone: { code: 'A4' } },
      orderBy: { number: 'asc' },
    });
    expect(stalls.map((s) => s.category)).toEqual([
      'VENDOR_FOOD',
      'VENDOR_FOOD',
      'ASHRAM_NON_FOOD',
    ]);
  });

  test('is idempotent — applying the same plan twice changes nothing', async () => {
    await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 3 });
    const again = await applyPlan(prisma, edition.id, SYSTEM);
    expect(again).toEqual({ created: [], removed: [], kept: [] });
    expect(await prisma.stall.count()).toBe(3);
  });

  test('grows a zone with fresh numbers after the highest existing one', async () => {
    await makeStalls(edition.id, 'C1', { LW_FOOD: 2 });
    const r = await makeStalls(edition.id, 'C1', { LW_FOOD: 4 });
    expect(r.created).toEqual(['C1-3', 'C1-4']);
  });

  test('shrinks a zone by removing surplus available stalls', async () => {
    await makeStalls(edition.id, 'C1', { LW_FOOD: 4 });
    const r = await makeStalls(edition.id, 'C1', { LW_FOOD: 1 });
    expect(r.removed).toEqual(['C1-2', 'C1-3', 'C1-4']);
    expect(await prisma.stall.count()).toBe(1);
  });

  test('NEVER removes a stall that holds a live allocation', async () => {
    await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 30 });
    const req = await submitRequest(prisma, SubmitRequestInput.parse(vendorBody()), {
      mail: new LogMailer(),
      statusUrl: (t) => t,
    });
    await selectRequest(prisma, { requestId: req.requestId, stallNumbers: ['A4-5'] }, SYSTEM);

    const r = await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 3 });

    expect(r.kept).toEqual([]); // A4-5 consumed one of the 3 VENDOR_FOOD slots
    expect(r.removed).not.toContain('A4-5');
    const survivors = await prisma.stall.findMany({
      where: { zone: { code: 'A4' } },
      orderBy: { number: 'asc' },
    });
    expect(survivors.map((s) => s.number)).toContain('A4-5');
    expect(survivors).toHaveLength(3);
    expect(survivors.find((s) => s.number === 'A4-5')?.status).toBe('ALLOCATED');
  });

  test('reports an allocated stall in `kept` when the plan no longer wants its category, and re-labels a free one rather than churning it', async () => {
    await makeStalls(edition.id, 'A4', { VENDOR_FOOD: 2 });
    const req = await submitRequest(prisma, SubmitRequestInput.parse(vendorBody()), {
      mail: new LogMailer(),
      statusUrl: (t) => t,
    });
    await selectRequest(prisma, { requestId: req.requestId, stallNumbers: ['A4-1'] }, SYSTEM);

    const r = await makeStalls(edition.id, 'A4', { ASHRAM_FOOD: 1 });

    // A4-1 is allocated as VENDOR_FOOD and the plan has no VENDOR_FOOD slot
    // left: it is kept, unchanged, and reported. A4-2 is free, so it takes the
    // one ASHRAM_FOOD slot by re-labelling — no delete, no fresh number.
    expect(r.kept).toEqual(['A4-1']);
    expect(r.removed).toEqual([]);
    expect(r.created).toEqual([]);
    const stalls = await prisma.stall.findMany({
      where: { zone: { code: 'A4' } },
      orderBy: { number: 'asc' },
    });
    expect(stalls.map((s) => [s.number, s.category, s.status])).toEqual([
      ['A4-1', 'VENDOR_FOOD', 'ALLOCATED'],
      ['A4-2', 'ASHRAM_FOOD', 'AVAILABLE'],
    ]);
  });
});

describe('planning routes', () => {
  test('a negative count is refused at the edge', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/planning',
      headers: lead.headers,
      payload: { rows: [{ zoneCode: 'A4', counts: counts({ VENDOR_FOOD: -1 }) }] },
    });
    expect(res.statusCode).toBe(400);
  });

  test('a volunteer may not write the plan', async () => {
    const volunteer = await seedStaff(['stalls_volunteer']);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/planning',
      headers: volunteer.headers,
      payload: { rows: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  test('PUT then POST apply round-trips through HTTP', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/m/stalls/planning',
      headers: lead.headers,
      payload: { rows: [{ zoneCode: 'B4', counts: counts({ HELP_DESK: 1, BACKUP: 1 }) }] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().totals.grandTotal).toBe(2);
    const apply = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/planning/apply',
      headers: lead.headers,
    });
    expect(apply.json().created).toEqual(['B4-1', 'B4-2']);
  });
});
