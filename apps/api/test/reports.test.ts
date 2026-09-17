// Reports & Dashboards.
//
// The catalog's rules are unit-tested in `@stalls/core` (`reports.test.ts`).
// What is worth asserting here is what only exists with rows behind it: that a
// report counts what it says it counts, that the catalog narrows to what the
// caller may open, that a report they may not open is refused, and that the CSV
// is the same table with money in rupees.
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SubmitRequestInput } from '@stalls/core';
import { buildApp } from '../src/app';
import { submitRequest } from '../src/modules/stalls/submit';
import {
  accountFor,
  LogMailer,
  prisma,
  resetDatabase,
  seedBackoffice,
  seedEdition,
  vendorBody,
  type Backoffice,
} from './helpers/db';

let app: FastifyInstance;
let admin: Backoffice;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
  admin = await seedBackoffice(['stalls_admin'], 'admin@example.org');
});

const submit = async (body: Record<string, unknown> = {}) =>
  submitRequest(
    prisma,
    SubmitRequestInput.parse(vendorBody(body)),
    { mail: new LogMailer(), statusUrl: (t) => t },
    await accountFor(body),
  );

const get = (url: string, who: Backoffice) =>
  app.inject({ method: 'GET', url, headers: who.headers });

describe('the catalog', () => {
  test('offers an admin every report, and a finance officer only what they read', async () => {
    const all = (await get('/api/m/stalls/reports', admin)).json();
    const keys = all.reports.map((r: { key: string }) => r.key);
    expect(keys).toContain('collections');
    expect(keys).toContain('checkin_status');
    expect(keys).toContain('equipment_ledger');

    // ⚠️ The Finance role reads requests and onboarding as well as the money —
    // it has to, to chase a payment — so it gets those reports too. What it does
    // NOT get is the event day, which is the assertion worth making.
    const finance = await seedBackoffice(['stalls_finance'], 'fin@example.org');
    const theirs = (await get('/api/m/stalls/reports', finance)).json();
    const mine = theirs.reports.map((r: { key: string }) => r.key);
    expect(mine).toContain('collections');
    expect(mine).not.toContain('checkin_status');
    expect(mine).not.toContain('equipment_ledger');
  });

  /** 🔴 The catalog narrows the LIST; the route narrows the ACT. A key typed
   *  into the address bar must meet the same guard the tile did. */
  test('refuses a report the caller may not open, even by a typed URL', async () => {
    const finance = await seedBackoffice(['stalls_finance'], 'fin2@example.org');
    expect((await get('/api/m/stalls/reports/checkin_status', finance)).statusCode).toBe(403);
  });

  test('404s a key the catalog does not have', async () => {
    expect((await get('/api/m/stalls/reports/made_up', admin)).statusCode).toBe(404);
  });
});

describe('a report', () => {
  test('counts the requests that are there, and totals its own body', async () => {
    await submit({ email: 'one@example.org', contactNumber: '9840000001' });
    await submit({ email: 'two@example.org', contactNumber: '9840000002' });

    const res = await get('/api/m/stalls/reports/requests_by_status', admin);
    expect(res.statusCode).toBe(200);
    const view = res.json();
    expect(view.title).toBe('Requests by Status');

    const submitted = view.rows.find((r: { status: string }) => r.status === 'Submitted');
    expect(submitted).toMatchObject({ VENDOR: 2, LOCAL_WELFARE: 0, ASHRAM: 0, all: 2 });
    // The foot is computed from the body it sits under, never queried again —
    // which is the only way the two cannot disagree.
    expect(view.total).toMatchObject({ status: 'Total', all: 2 });
  });

  test('names the edition it is about, so a tab left open says which year it shows', async () => {
    const view = (await get('/api/m/stalls/reports/requests_by_status', admin)).json();
    expect(view.editionLabel).toBe('Stalls 2026');
  });

  test('comes back empty-bodied rather than erroring when there is nothing yet', async () => {
    const view = (await get('/api/m/stalls/reports/onboarding_progress', admin)).json();
    expect(view.rows).toHaveLength(4);
    expect(view.rows.every((r: { pending: number }) => r.pending === 0)).toBe(true);
  });
});

describe('the CSV', () => {
  test('is the same table as a file, with a name somebody can find again', async () => {
    await submit();
    const res = await get('/api/m/stalls/reports/requests_by_status?format=csv', admin);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="requests_by_status-2026.csv"',
    );

    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('Status,Vendor,Local Welfare,Ashram,All');
    expect(lines[1]).toBe('Submitted,1,0,0,1');
    expect(lines.at(-1)).toBe('Total,1,0,0,1');
  });

  /** ⚠️ RUPEES. A column headed "Collected" whose cells are a hundred times the
   *  figure on the screen is a spreadsheet somebody will circulate. */
  test('writes money in rupees, not paise', async () => {
    const res = await get('/api/m/stalls/reports/collections?format=csv', admin);
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('Requester Type,Quoted,Collected,Outstanding');
    expect(lines[1]).toBe('Vendor,0.00,0.00,0.00');
  });
});
