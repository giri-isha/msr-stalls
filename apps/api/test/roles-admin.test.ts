import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { buildApp } from '../src/app';
import { seedRbac } from '../src/modules/stalls/seed-rbac';
import { type Staff, LogMailer, prisma, resetDatabase, seedEdition, seedStaff } from './helpers/db';

/**
 * Authoring roles.
 *
 * 🔴 The tests that matter most here are the ESCALATION ones. `roles.write`
 * composes privileges, and anyone who can also grant roles can hand the result
 * to themselves — so a role must never be able to carry more than its author
 * already carries. Every other rule in this file is housekeeping beside that.
 */
let app: FastifyInstance;
let admin: Staff;
let author: Staff;

beforeAll(async () => {
  app = await buildApp({ logger: false, mail: new LogMailer(), webOrigin: 'http://web.example' });
});
afterAll(() => app.close());

beforeEach(async () => {
  await resetDatabase();
  await seedEdition();
  admin = await seedStaff(['stalls_admin'], 'admin@example.org');
  author = await seedStaff(['stalls_lead'], 'author@example.org');
});

/** Give a role a privilege, the way the editor will. */
async function givePrivilege(roleKey: string, code: string) {
  const [role, privilege] = await Promise.all([
    prisma.stallRole.findUniqueOrThrow({ where: { roleKey } }),
    prisma.stallPrivilege.findUniqueOrThrow({ where: { code } }),
  ]);
  await prisma.stallRolePrivilege.upsert({
    where: { roleId_privilegeId: { roleId: role.id, privilegeId: privilege.id } },
    update: {},
    create: { roleId: role.id, privilegeId: privilege.id },
  });
}

/**
 * Put the shipped roles back exactly as they ship.
 *
 * ⚠️ NOT optional, and not a tidy-up. `resetDatabase` deliberately leaves the
 * RBAC tables alone — they are reference data the migration installed, and
 * truncating them would break the foreign key every `seedStaff` call depends
 * on — so anything this file does to a shipped role survives into every test
 * file that runs afterwards. The tests below retune `stalls_volunteer`, and
 * without this the volunteer loses `checkin.write` for the rest of the suite
 * and a completely unrelated file fails with a 403.
 *
 * `seedRbac` rewrites each shipped role's bundle as a SET, so it restores
 * removals as well as additions — which an ad-hoc "delete the rows we added"
 * cleanup does not.
 */
afterEach(async () => {
  await prisma.stallStaffRole.deleteMany({ where: { role: { isSystem: false } } });
  await prisma.stallRole.deleteMany({ where: { isSystem: false } });
  await seedRbac(prisma);
});

const body = (over: Record<string, unknown> = {}) => ({
  name: 'Bay Marshal',
  description: 'Runs one bay on the day',
  parentKey: 'stalls_lead',
  privileges: ['requests.read', 'checkin.write'],
  allPrivileges: false,
  canAssignSameLevel: false,
  requestTypeScope: [],
  ...over,
});

const create = (by: Staff, over: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/m/stalls/roles',
    headers: by.headers,
    payload: { roleKey: 'bay_marshal', ...body(over) },
  });

describe('authoring a role', () => {
  test('an admin composes one from the vocabulary, and it takes effect with no deploy', async () => {
    const res = await create(admin);
    expect(res.statusCode).toBe(201);
    expect(res.json().privileges.sort()).toEqual(['checkin.write', 'requests.read']);

    // The point of the whole exercise: a person granted the new role resolves
    // its privileges on their very next request.
    const marshal = await seedStaff([], 'marshal@example.org');
    await app.inject({
      method: 'POST',
      url: '/api/m/stalls/staff',
      headers: admin.headers,
      payload: { personRef: marshal.personId, roleKey: 'bay_marshal' },
    });
    const me = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/me',
      headers: marshal.headers,
    });
    expect(me.json().privileges.sort()).toEqual(['checkin.write', 'requests.read']);
  });

  test('a role without roles.write cannot author one', async () => {
    expect((await create(author)).statusCode).toBe(403);
  });

  test('a key somebody already used is refused', async () => {
    await create(admin);
    expect((await create(admin)).statusCode).toBe(409);
  });

  test('a key that is not a key at all is refused before it reaches the table', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/roles',
      headers: admin.headers,
      payload: { roleKey: 'Bay Marshal!', ...body() },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('escalation', () => {
  beforeEach(() => givePrivilege('stalls_lead', 'roles.write'));

  // 🔴 The guard the whole feature rests on. A lead holds no `config.write`, so
  // a lead cannot build a role that does — otherwise they grant it to themselves
  // and the hierarchy has been walked around rather than through.
  test('a role cannot be given a privilege its author does not hold', async () => {
    const res = await create(author, { privileges: ['requests.read', 'config.write'] });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('config.write');
  });

  test('nor the flag that carries every privilege, present and future', async () => {
    const res = await create(author, { privileges: [], allPrivileges: true });
    expect(res.statusCode).toBe(403);
  });

  test('an author may compose freely inside what they already hold', async () => {
    const res = await create(author, { privileges: ['planning.write', 'selection.write'] });
    expect(res.statusCode).toBe(201);
  });

  // A root role sits above everything, so making one is making a peer of Admin.
  test('only somebody at the top of the tree can create a role with no parent', async () => {
    expect((await create(author, { parentKey: null })).statusCode).toBe(403);
    expect((await create(admin, { parentKey: null, roleKey: 'other_root' })).statusCode).toBe(201);
  });

  // Composed from privileges the author DOES hold, so the refusal that lands is
  // the hierarchy one and not the escalation guard sitting in front of it.
  test('a parent above the author is refused', async () => {
    const res = await create(author, {
      parentKey: 'stalls_admin',
      privileges: ['requests.read'],
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('above you in the role hierarchy');
  });

  // A scoped author must not author an unscoped role — that would reach every
  // requester type through a role they built for themselves.
  test('a scoped author cannot give a role wider reach than their own', async () => {
    await givePrivilege('stalls_local_welfare', 'roles.write');
    const welfare = await seedStaff(['stalls_local_welfare'], 'welfare@example.org');
    const res = await app.inject({
      method: 'POST',
      url: '/api/m/stalls/roles',
      headers: welfare.headers,
      payload: {
        roleKey: 'welfare_helper',
        ...body({
          parentKey: 'stalls_local_welfare',
          privileges: ['requests.read'],
          requestTypeScope: [],
        }),
      },
    });
    expect(res.statusCode).toBe(403);

    const lead = await prisma.stallRole.findUniqueOrThrow({
      where: { roleKey: 'stalls_local_welfare' },
    });
    const code = await prisma.stallPrivilege.findUniqueOrThrow({ where: { code: 'roles.write' } });
    await prisma.stallRolePrivilege.deleteMany({
      where: { roleId: lead.id, privilegeId: code.id },
    });
  });
});

describe('editing a role', () => {
  const save = (by: Staff, roleKey: string, over: Record<string, unknown> = {}) =>
    app.inject({
      method: 'PUT',
      url: `/api/m/stalls/roles/${roleKey}`,
      headers: by.headers,
      payload: body(over),
    });

  test('retuning a shipped role is allowed, and is the point', async () => {
    const res = await save(admin, 'stalls_volunteer', {
      name: 'Volunteer',
      parentKey: 'stalls_lead',
      privileges: ['requests.read', 'checkin.write', 'planning.read'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().privileges).toContain('planning.read');
  });

  // Rewritten as a SET: a privilege cleared in the editor has to actually leave
  // the role, which an upsert of what is ticked would never do.
  test('clearing a privilege removes it rather than leaving it behind', async () => {
    await save(admin, 'stalls_volunteer', { privileges: ['requests.read'] });
    const res = await app.inject({
      method: 'GET',
      url: '/api/m/stalls/roles/stalls_volunteer',
      headers: admin.headers,
    });
    expect(res.json().privileges).toEqual(['requests.read']);
  });

  test('a role above the editor is refused', async () => {
    await givePrivilege('stalls_lead', 'roles.write');
    expect((await save(author, 'stalls_admin')).statusCode).toBe(403);
  });

  // Editing the role you hold but cannot hand out is editing your own reach.
  test('and so is the editor own role, unless they may hand it out', async () => {
    await givePrivilege('stalls_lead', 'roles.write');
    expect((await save(author, 'stalls_lead')).statusCode).toBe(403);
  });

  test('a parent that would loop back on itself is refused', async () => {
    await create(admin);
    const res = await save(admin, 'stalls_lead', { parentKey: 'bay_marshal' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('loop back');
  });
});

describe('deleting a role', () => {
  const remove = (by: Staff, roleKey: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/m/stalls/roles/${roleKey}`,
      headers: by.headers,
    });

  test('an authored role goes when nobody holds it', async () => {
    await create(admin);
    expect((await remove(admin, 'bay_marshal')).statusCode).toBe(204);
  });

  // The grant table refuses this at the foreign key too; this is the readable
  // version, raised before the database has to.
  test('a role people still hold is refused, and says how many', async () => {
    await create(admin);
    const marshal = await seedStaff([], 'marshal@example.org');
    await app.inject({
      method: 'POST',
      url: '/api/m/stalls/staff',
      headers: admin.headers,
      payload: { personRef: marshal.personId, roleKey: 'bay_marshal' },
    });
    const res = await remove(admin, 'bay_marshal');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('1 person');
  });

  // The seed would put it straight back, and grants refer to its key.
  test('a shipped role cannot be deleted, however senior the caller', async () => {
    const res = await remove(admin, 'stalls_volunteer');
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('ships with the module');
  });

  test('children are lifted to the root rather than deleted with it', async () => {
    await create(admin);
    await create(admin, { roleKey: 'bay_helper', parentKey: 'bay_marshal' });
    await remove(admin, 'bay_marshal');
    const child = await prisma.stallRole.findUniqueOrThrow({ where: { roleKey: 'bay_helper' } });
    expect(child.parentKey).toBeNull();
  });
});
