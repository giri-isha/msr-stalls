// Configs › Sidebar Layout and Home Page, end to end.
//
// The rules themselves are unit-tested in `@stalls/core` (`nav.test.ts`,
// `widgets.test.ts`) without a database. What is worth asserting here is the
// half that only exists once there are rows: that `/me` serves the arrangement,
// that a write is a SET rather than an upsert, that the privilege filter still
// runs after the table, and that the role hierarchy is honoured.
import type { StallEdition } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { NAV_ITEMS, WIDGETS } from '@stalls/core';
import { buildApp } from '../src/app';
import {
  LogMailer,
  prisma,
  resetDatabase,
  seedBackoffice,
  seedEdition,
  type Backoffice,
} from './helpers/db';

let app: FastifyInstance;
let admin: Backoffice;
let lead: Backoffice;
let edition: StallEdition;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer() });
});
afterAll(() => app.close());
beforeEach(async () => {
  await resetDatabase();
  edition = await seedEdition();
  admin = await seedBackoffice(['stalls_admin'], 'admin@example.org');
  lead = await seedBackoffice(['stalls_lead'], 'lead@example.org');
});

// ⚠️ `await`ed inside rather than returned bare. `app.inject` is overloaded, and
// a bare return resolves to its CHAINABLE form — every `.statusCode` below then
// fails to typecheck against a builder that has not been dispatched yet.
const get = async (url: string, who: Backoffice) =>
  await app.inject({ method: 'GET', url, headers: who.headers });
const put = async (url: string, who: Backoffice, payload: object) =>
  await app.inject({ method: 'PUT', url, headers: who.headers, payload });

/** The labels in a caller's own sidebar, in order, flattened across headings. */
async function sidebarOf(who: Backoffice): Promise<string[]> {
  const me = await get('/api/m/stalls/me', who);
  const groups = me.json().nav as Array<{ title: string; items: Array<{ label: string }> }>;
  return groups.flatMap((g) => g.items.map((i) => i.label));
}

describe('the sidebar a caller is served', () => {
  test('is the registry defaults until somebody arranges the role', async () => {
    const me = await get('/api/m/stalls/me', admin);
    expect(me.statusCode).toBe(200);
    const groups = me.json().nav as Array<{ title: string; items: unknown[] }>;
    expect(groups[0].title).toBe('Overview');
    expect(await sidebarOf(admin)).toContain('Home');
    expect(await sidebarOf(admin)).toContain('Reports & Dashboards');
  });

  test('never carries a link the caller has no privilege for', async () => {
    const volunteer = await seedBackoffice(['stalls_volunteer'], 'vol@example.org');
    const labels = await sidebarOf(volunteer);
    expect(labels).toContain('Home');
    // Roles & Privileges is `config.read`, which a volunteer does not hold.
    expect(labels).not.toContain('Roles & Privileges');
  });

  test('follows the arrangement once one is saved, order and heading and all', async () => {
    const res = await put('/api/m/stalls/config/sidebar/stalls_admin', admin, {
      items: [
        { key: 'finance', category: 'c_overview', shown: true },
        { key: 'home', category: 'c_overview', shown: true },
        { key: 'requests', category: 'c_requests', shown: false },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ shown: 2 });

    const me = await get('/api/m/stalls/me', admin);
    const groups = me.json().nav as Array<{ title: string; items: Array<{ label: string }> }>;
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('Overview');
    expect(groups[0].items.map((i) => i.label)).toEqual(['Finance', 'Home']);
  });

  /** 🔴 The guarantee that makes this safe to hand an admin. */
  test('cannot show a link the role has no privilege for, whatever is written', async () => {
    const refused = await put('/api/m/stalls/config/sidebar/stalls_volunteer', admin, {
      items: [{ key: 'finance', category: 'c_overview', shown: true }],
    });
    expect(refused.statusCode).toBe(400);

    const volunteer = await seedBackoffice(['stalls_volunteer'], 'vol2@example.org');
    expect(await sidebarOf(volunteer)).not.toContain('Finance');
  });

  test('replaces the whole list rather than merging into it', async () => {
    await put('/api/m/stalls/config/sidebar/stalls_admin', admin, {
      items: [
        { key: 'home', category: 'c_overview', shown: true },
        { key: 'finance', category: 'c_onboarding', shown: true },
      ],
    });
    await put('/api/m/stalls/config/sidebar/stalls_admin', admin, {
      items: [{ key: 'home', category: 'c_overview', shown: true }],
    });

    const rows = await prisma.stallRoleNavItem.findMany({ where: { roleKey: 'stalls_admin' } });
    expect(rows.map((r) => r.itemKey)).toEqual(['home']);
    expect(await sidebarOf(admin)).toEqual(['Home']);
  });

  test('refuses the same item twice — an ordered list cannot hold one row in two places', async () => {
    const res = await put('/api/m/stalls/config/sidebar/stalls_admin', admin, {
      items: [
        { key: 'home', category: 'c_overview', shown: true },
        { key: 'home', category: 'c_requests', shown: true },
      ],
    });
    expect(res.statusCode).toBe(400);
  });

  /** ⚠️ `admin` was the Admin screen's key before its five tabs became five tabs
   *  of Configs. A role arranged before that must not lose the link. */
  test('reads a row written against the retired Admin key as Configs', async () => {
    await prisma.stallRoleNavItem.create({
      data: { roleKey: 'stalls_admin', itemKey: 'admin', categoryKey: 'c_config', ordinal: 0 },
    });
    expect(await sidebarOf(admin)).toEqual(['Configs']);
  });
});

describe('the home page a caller is served', () => {
  test('is every card their privileges reach until somebody arranges the role', async () => {
    const res = await get('/api/m/stalls/home', admin);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.editionLabel).toBe(edition.name);
    expect(body.widgets.map((w: { key: string }) => w.key)).toEqual(WIDGETS.map((w) => w.key));
  });

  /** The electrical and venue-prep team hold one privilege, and it opens no
   *  card. They still land on Home, like everybody else. */
  test('gives a caller whose privileges reach no figures the card that gates on nothing', async () => {
    const sparky = await seedBackoffice(['stalls_electrical'], 'volts@example.org');
    const res = await get('/api/m/stalls/home', sparky);
    // ⚠️ 200, not 403. Home is where every member lands, and a landing the shell
    // refuses is indistinguishable from an app that is broken.
    expect(res.statusCode).toBe(200);
    expect(res.json().widgets.map((w: { key: string }) => w.key)).toEqual(['quick_links']);
  });

  test('follows the arrangement, and drops what is switched off', async () => {
    await put('/api/m/stalls/config/home/stalls_admin', admin, {
      widgets: [
        { key: 'finance_summary', shown: true },
        { key: 'quick_links', shown: true },
        { key: 'requests_summary', shown: false },
      ],
    });
    const keys = (await get('/api/m/stalls/home', admin))
      .json()
      .widgets.map((w: { key: string }) => w.key);
    expect(keys).toEqual(['finance_summary', 'quick_links']);
  });

  test('sends `{}` for a card with no figures and a filled object for one with them', async () => {
    const widgets = (await get('/api/m/stalls/home', admin)).json().widgets as Array<{
      key: string;
      data: Record<string, number> | null;
    }>;
    // Quick Links draws itself from the caller's own nav — it RAN, it just has
    // nothing to count. `null` is reserved for a loader that failed.
    expect(widgets.find((w) => w.key === 'quick_links')?.data).toEqual({});
    expect(widgets.find((w) => w.key === 'requests_summary')?.data).toMatchObject({ total: 0 });
  });
});

describe('the two config screens', () => {
  test('offer every role the caller may edit, with the cards and links each reaches', async () => {
    const res = await get('/api/m/stalls/config/sidebar', admin);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories.map((c: { key: string }) => c.key)).toContain('c_overview');

    const volunteer = body.roles.find((r: { roleKey: string }) => r.roleKey === 'stalls_volunteer');
    expect(volunteer.configured).toBe(false);
    // Everything ON, because that IS what its holders are seeing — and the flag
    // above is what tells the screen to say so rather than imply somebody chose.
    expect(volunteer.shownCount).toBe(volunteer.total);
    expect(volunteer.items.map((i: { key: string }) => i.key)).not.toContain('finance');
    expect(volunteer.total).toBeLessThan(NAV_ITEMS.length);
  });

  test('are readable on config.read and writable only on config.write', async () => {
    // The Lead holds `config.read` and not `config.write`.
    expect((await get('/api/m/stalls/config/sidebar', lead)).statusCode).toBe(200);
    expect((await get('/api/m/stalls/config/home', lead)).statusCode).toBe(200);

    const write = await put('/api/m/stalls/config/home/stalls_volunteer', lead, {
      widgets: [{ key: 'quick_links', shown: true }],
    });
    expect(write.statusCode).toBe(403);
  });

  test('refuse a role above the caller in the hierarchy', async () => {
    const other = await seedBackoffice(['stalls_finance'], 'fin@example.org');
    const res = await put('/api/m/stalls/config/home/stalls_admin', other, {
      widgets: [{ key: 'quick_links', shown: true }],
    });
    // Either the role is out of reach (403) or the writer holds no
    // `config.write` at all (403) — both are the same refusal to this caller.
    expect(res.statusCode).toBe(403);
  });

  test('404 a role that does not exist', async () => {
    const res = await put('/api/m/stalls/config/home/stalls_nope', admin, { widgets: [] });
    expect(res.statusCode).toBe(404);
  });
});

describe('the headings', () => {
  const post = async (url: string, who: Backoffice, payload: object) =>
    await app.inject({ method: 'POST', url, headers: who.headers, payload });

  test('add one, use it, rename it, and the sidebar follows', async () => {
    const created = await post('/api/m/stalls/config/sidebar-headings', admin, {
      label: 'My Bits',
    });
    expect(created.statusCode).toBe(201);
    const { key } = created.json();

    await put('/api/m/stalls/config/sidebar/stalls_admin', admin, {
      items: [{ key: 'home', category: key, shown: true }],
    });
    let groups = (await get('/api/m/stalls/me', admin)).json().nav;
    expect(groups[0].title).toBe('My Bits');

    await put(`/api/m/stalls/config/sidebar-headings/${key}`, admin, { label: 'My Things' });
    groups = (await get('/api/m/stalls/me', admin)).json().nav;
    expect(groups[0].title).toBe('My Things');
  });

  /** ⚠️ The registry would put a built-in straight back on the next read, so the
   *  delete would appear to work and change nothing. */
  test('refuse to delete a shipped heading, and allow it to be renamed', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/m/stalls/config/sidebar-headings/c_overview',
      headers: admin.headers,
    });
    expect(del.statusCode).toBe(409);

    await put('/api/m/stalls/config/sidebar-headings/c_overview', admin, { label: 'Top' });
    expect((await get('/api/m/stalls/me', admin)).json().nav[0].title).toBe('Top');
  });

  test('leave a link working when the heading it named is deleted', async () => {
    const { key } = (
      await post('/api/m/stalls/config/sidebar-headings', admin, { label: 'Temp' })
    ).json();
    await put('/api/m/stalls/config/sidebar/stalls_admin', admin, {
      items: [{ key: 'finance', category: key, shown: true }],
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/config/sidebar-headings/${key}`,
      headers: admin.headers,
    });

    // Falls back to the item's registry heading rather than vanishing.
    const groups = (await get('/api/m/stalls/me', admin)).json().nav;
    expect(groups[0].title).toBe('Onboarding & Money');
    expect(groups[0].items[0].label).toBe('Finance');
  });
});
