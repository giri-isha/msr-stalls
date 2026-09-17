import { describe, expect, test } from 'vitest';
import {
  MODULE_KEY,
  PRIVILEGE_CATEGORIES,
  SEED_ROLES,
  STALL_PRIVILEGES,
  type HeldRole,
  type RoleNode,
  assignableRoleKeys,
  can,
  privilegeCategoryName,
  canReach,
  canReachRequestType,
  cannotAssign,
  cannotEdit,
  editableRoleKeys,
  unionEditionScope,
  unionPrivileges,
  unionRequestTypeScope,
  unionZoneScope,
  zoneOfRequest,
} from './rbac';

describe('MODULE_KEY', () => {
  test('is the key the host module registry will store', () => {
    expect(MODULE_KEY).toBe('stalls');
  });
});

describe('the vocabulary', () => {
  // The codes are declared as literals so the compiler checks every call site,
  // and the categories repeat them so the role editor can group them. These two
  // lists are the only place that duplication exists, so this is the test that
  // stops them drifting apart.
  test('every category item is a declared privilege, and every one is grouped', () => {
    const grouped = PRIVILEGE_CATEGORIES.flatMap((c) => c.items.map((i) => i.code));
    expect([...grouped].sort()).toEqual([...STALL_PRIVILEGES].sort());
  });

  test('no privilege is grouped twice', () => {
    const grouped = PRIVILEGE_CATEGORIES.flatMap((c) => c.items.map((i) => i.code));
    expect(grouped.length).toBe(new Set(grouped).size);
  });

  test('every privilege carries a label and a description for the role editor', () => {
    for (const category of PRIVILEGE_CATEGORIES) {
      expect(category.name.length).toBeGreaterThan(0);
      for (const item of category.items) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.description.length).toBeGreaterThan(0);
      }
    }
  });

  // The requirement is to SHARE the stall-wise electrical sheet with the
  // electrical and venue-prep teams. A category is the unit a role is granted
  // whole, so folding this into Planning would hand them the planning grid and
  // every requester's details to get a plug-point count.
  test('the electrical sheet is its own category, not a corner of planning', () => {
    const electrical = PRIVILEGE_CATEGORIES.find((c) => c.key === 'electrical');
    expect(electrical?.items.map((i) => i.code)).toEqual(['electrical.read']);
    const planning = PRIVILEGE_CATEGORIES.find((c) => c.key === 'planning');
    expect(planning?.items.map((i) => i.code)).not.toContain('electrical.read');
  });

  test('reading bank details is marked sensitive, not an ordinary view', () => {
    const finance = PRIVILEGE_CATEGORIES.find((c) => c.key === 'finance');
    expect(finance?.items.find((i) => i.code === 'finance.read')?.kind).toBe('sensitive');
  });
});

describe('the seeded roles', () => {
  test('declares the backoffice roles from the requirements', () => {
    expect(SEED_ROLES.map((r) => r.roleKey).sort()).toEqual([
      'stalls_admin',
      'stalls_electrical',
      'stalls_finance',
      'stalls_lead',
      'stalls_local_welfare',
      'stalls_volunteer',
    ]);
  });

  test('every seeded privilege is a real one', () => {
    for (const role of SEED_ROLES) {
      for (const code of role.privileges) expect(STALL_PRIVILEGES).toContain(code);
    }
  });

  test('every parent named is a role that exists', () => {
    const keys = new Set(SEED_ROLES.map((r) => r.roleKey));
    for (const role of SEED_ROLES) {
      if (role.parentKey) expect(keys).toContain(role.parentKey);
    }
  });

  // The flag expands against the live privilege table, so a role carrying it
  // holds no join rows. Seeding both would mean two answers to one question.
  test('the role holding every privilege carries no explicit ones', () => {
    for (const role of SEED_ROLES) {
      if (role.allPrivileges) expect(role.privileges).toEqual([]);
    }
  });

  // The local welfare team files requests inside this application, because the
  // traders they file for mostly have no email address. That makes them backoffice members —
  // it does not give them a commercial vendor's bank details.
  test('only the local welfare role is scoped, and only to its own requests', () => {
    const scoped = SEED_ROLES.filter((r) => r.requestTypeScope !== null);
    expect(scoped.map((r) => r.roleKey)).toEqual(['stalls_local_welfare']);
    expect(scoped[0].requestTypeScope).toEqual(['LOCAL_WELFARE']);
  });

  test('only the admin may appoint its own kind', () => {
    const sameLevel = SEED_ROLES.filter((r) => r.canAssignSameLevel);
    expect(sameLevel.map((r) => r.roleKey)).toEqual(['stalls_admin']);
  });
});

/**
 * What each shipped role HOLDS, frozen here.
 *
 * ⚠️ A literal rather than something derived from `SEED_ROLES`: derived, it
 * would agree with any seed, including a wrong one. Written out, it fails the
 * day a seed edit silently widens or narrows what a shipped role grants — and
 * it did exactly that when the reads were split out of the writes, which is
 * what the notes below record.
 *
 * ⚠️ Holdings, not effective access. `unionPrivileges` is the raw union; the
 * read a write implies is resolved by `can` and deliberately does not appear
 * here — see `IMPLIED_READ` and the tests for it further down.
 */
const SHIPPED_HOLDINGS: Record<string, readonly string[]> = {
  stalls_admin: STALL_PRIVILEGES,
  stalls_lead: [
    'requests.read',
    'requests.write',
    'planning.read',
    'planning.write',
    'electrical.read',
    'selection.read',
    'selection.write',
    'comms.write',
    // Gained when onboarding stopped riding on `requests.read`. A lead ran the
    // onboarding screen before and still does; this is the same access under
    // its own name.
    'onboarding.read',
    'onboarding.write',
    'finance.read',
    // The two counter screens, read-only — the reach a lead already had when
    // both were gated on `requests.read`.
    'checkin.read',
    'equipment.read',
    'config.read',
    'refunds.write',
    // Reads the log. Sensitive, like finance.read, and for the same reason.
    'audit.read',
    // Files any of the five requester forms on somebody's behalf.
    'filing.request',
    'filing.bank',
    'filing.fssai',
    'filing.staff',
    'filing.claim',
  ],
  // 🔴 NARROWED, on purpose. Was `['requests.read', 'checkin.write']` — the
  // read was there only because the check-in LIST was gated on it, so staffing
  // a gate meant handing over every requester's full application. The two
  // screens a volunteer works have their own codes now.
  stalls_volunteer: ['checkin.write', 'equipment.write'],
  stalls_finance: ['requests.read', 'finance.read', 'finance.write', 'onboarding.read'],
  stalls_electrical: ['electrical.read'],
  stalls_local_welfare: [
    'requests.read',
    'requests.write',
    'selection.read',
    'finance.read',
    // Reading, not sending: this team chases its own villages' stalls and
    // should see what has gone out without being able to email the edition.
    'comms.read',
    'onboarding.read',
    'checkin.read',
    'equipment.read',
    // Files for its own villages. Never the bank form — a local welfare stall
    // is not asked for bank details.
    'filing.request',
    'filing.fssai',
    'filing.staff',
    'filing.claim',
  ],
};

describe('what the shipped roles hold', () => {
  test.each(SEED_ROLES.map((r) => [r.roleKey, r] as const))(
    '%s holds exactly what the frozen table says',
    (roleKey, role) => {
      const held: HeldRole = {
        roleKey,
        allPrivileges: role.allPrivileges,
        privileges: role.privileges,
        requestTypeScope: role.requestTypeScope,
      };
      const resolved = unionPrivileges([held], STALL_PRIVILEGES);
      expect(resolved.sort()).toEqual([...(SHIPPED_HOLDINGS[roleKey] ?? [])].sort());
    },
  );
});

/** A held role built from the seed, the way the API will read one back. */
function held(roleKey: string): HeldRole {
  const role = SEED_ROLES.find((r) => r.roleKey === roleKey);
  if (!role) throw new Error(`no such seeded role: ${roleKey}`);
  return {
    roleKey,
    allPrivileges: role.allPrivileges,
    privileges: role.privileges,
    requestTypeScope: role.requestTypeScope,
  };
}

const privilegesFor = (...keys: string[]) => unionPrivileges(keys.map(held), STALL_PRIVILEGES);

describe('unionPrivileges', () => {
  test('admin can do everything, including configuring the module', () => {
    const admin = privilegesFor('stalls_admin');
    expect(can(admin, 'config.write')).toBe(true);
    expect(can(admin, 'selection.write')).toBe(true);
    expect(can(admin, 'checkin.write')).toBe(true);
  });

  // The flag is what makes a privilege added in a later release reach Admin
  // with no seed edit. A role resolved from its own join rows alone would get
  // nothing at all, because a role carrying the flag has none.
  test('the all-privileges flag expands against the live list, not stored rows', () => {
    const future = [...STALL_PRIVILEGES, 'reports.export'];
    const resolved = unionPrivileges([held('stalls_admin')], future);
    expect(resolved).toContain('reports.export');
  });

  test('lead runs planning and selection but cannot change configuration', () => {
    const lead = privilegesFor('stalls_lead');
    expect(can(lead, 'planning.write')).toBe(true);
    expect(can(lead, 'selection.write')).toBe(true);
    expect(can(lead, 'config.write')).toBe(false);
  });

  test('volunteer is check-in and chairs only, and cannot see money', () => {
    const volunteer = privilegesFor('stalls_volunteer');
    expect(can(volunteer, 'checkin.write')).toBe(true);
    expect(can(volunteer, 'selection.write')).toBe(false);
    expect(can(volunteer, 'finance.read')).toBe(false);
  });

  test('finance reads requests and owns payment confirmation', () => {
    const finance = privilegesFor('stalls_finance');
    expect(can(finance, 'finance.write')).toBe(true);
    expect(can(finance, 'requests.read')).toBe(true);
    expect(can(finance, 'selection.write')).toBe(false);
  });

  // The requirement is to SHARE the sheet with a team that is not the stalls
  // team. Everything else stays shut.
  test('the electrical role reaches the sheet and nothing else', () => {
    const electrical = privilegesFor('stalls_electrical');
    expect(can(electrical, 'electrical.read')).toBe(true);
    expect(can(electrical, 'planning.read')).toBe(false);
    expect(can(electrical, 'requests.read')).toBe(false);
    expect(can(electrical, 'finance.read')).toBe(false);
  });

  test('holding several roles grants the union', () => {
    const both = privilegesFor('stalls_volunteer', 'stalls_finance');
    expect(can(both, 'finance.write')).toBe(true);
    expect(can(both, 'checkin.write')).toBe(true);
  });

  test('no roles grants nothing', () => {
    expect(can(unionPrivileges([], STALL_PRIVILEGES), 'requests.read')).toBe(false);
  });
});

describe('unionRequestTypeScope', () => {
  test('an unscoped role reaches every requester type', () => {
    expect(unionRequestTypeScope([held('stalls_lead')])).toBeNull();
  });

  test('a scoped role reaches only its own', () => {
    expect(unionRequestTypeScope([held('stalls_local_welfare')])).toEqual(['LOCAL_WELFARE']);
  });

  // A narrow role can never take access away from a broad one. Someone holding
  // both is a lead who also files local welfare stalls, not a lead confined to
  // them.
  test('a broad role beside a narrow one widens, never narrows', () => {
    const scope = unionRequestTypeScope([held('stalls_lead'), held('stalls_local_welfare')]);
    expect(scope).toBeNull();
  });

  test('two narrow roles union their types', () => {
    const scope = unionRequestTypeScope([
      { roleKey: 'a', allPrivileges: false, privileges: [], requestTypeScope: ['ASHRAM'] },
      { roleKey: 'b', allPrivileges: false, privileges: [], requestTypeScope: ['LOCAL_WELFARE'] },
    ]);
    expect(scope?.sort()).toEqual(['ASHRAM', 'LOCAL_WELFARE']);
  });

  // Holding no role must reach nothing. Returning null here would hand a person
  // with no grant at all every request in the module.
  test('no roles reaches nothing, which is not the same as reaching everything', () => {
    expect(unionRequestTypeScope([])).toEqual([]);
  });

  test('canReachRequestType reads the resolved scope', () => {
    expect(canReachRequestType(null, 'VENDOR')).toBe(true);
    expect(canReachRequestType(['LOCAL_WELFARE'], 'LOCAL_WELFARE')).toBe(true);
    expect(canReachRequestType(['LOCAL_WELFARE'], 'VENDOR')).toBe(false);
    expect(canReachRequestType([], 'VENDOR')).toBe(false);
  });
});

/** The seeded tree, as the API reads it back. */
const TREE: RoleNode[] = SEED_ROLES.map((r) => ({
  roleKey: r.roleKey,
  parentKey: r.parentKey,
  canAssignSameLevel: r.canAssignSameLevel,
}));

describe('assignableRoleKeys', () => {
  test('an admin may hand out every role, including another admin', () => {
    const assignable = assignableRoleKeys(TREE, ['stalls_admin']);
    for (const role of SEED_ROLES) expect(assignable).toContain(role.roleKey);
  });

  test('a lead may staff their own team but may not mint an admin or another lead', () => {
    const assignable = assignableRoleKeys(TREE, ['stalls_lead']);
    expect(assignable).toContain('stalls_volunteer');
    expect(assignable).toContain('stalls_finance');
    expect(assignable).toContain('stalls_local_welfare');
    expect(assignable).toContain('stalls_electrical');
    expect(assignable).not.toContain('stalls_admin');
    expect(assignable).not.toContain('stalls_lead');
  });

  test('a leaf role may hand out nothing', () => {
    expect(assignableRoleKeys(TREE, ['stalls_volunteer']).size).toBe(0);
  });

  test('holding nothing may hand out nothing', () => {
    expect(assignableRoleKeys(TREE, []).size).toBe(0);
  });

  // Two roles drawn level on a chart report to different people, so one team
  // lead must never be able to backoffice another's team.
  test('never a sibling', () => {
    const assignable = assignableRoleKeys(TREE, ['stalls_finance']);
    expect(assignable).not.toContain('stalls_volunteer');
    expect(assignable).not.toContain('stalls_local_welfare');
  });

  test('the same-level flag is read from the grantor own role, not the target', () => {
    const tree: RoleNode[] = [
      { roleKey: 'top', parentKey: null, canAssignSameLevel: false },
      { roleKey: 'mid', parentKey: 'top', canAssignSameLevel: true },
    ];
    expect(assignableRoleKeys(tree, ['mid'])).toContain('mid');
    expect(assignableRoleKeys(tree, ['top'])).not.toContain('top');
  });

  test('reach is transitive, not just one level down', () => {
    const tree: RoleNode[] = [
      { roleKey: 'a', parentKey: null, canAssignSameLevel: false },
      { roleKey: 'b', parentKey: 'a', canAssignSameLevel: false },
      { roleKey: 'c', parentKey: 'b', canAssignSameLevel: false },
    ];
    const assignable = assignableRoleKeys(tree, ['a']);
    expect(assignable).toContain('b');
    expect(assignable).toContain('c');
  });

  // A tree an admin has tangled must not hang the request that would let them
  // untangle it.
  test('a cycle terminates instead of hanging', () => {
    const tree: RoleNode[] = [
      { roleKey: 'a', parentKey: 'b', canAssignSameLevel: false },
      { roleKey: 'b', parentKey: 'a', canAssignSameLevel: false },
    ];
    expect(assignableRoleKeys(tree, ['a']).has('b')).toBe(true);
  });

  test('several held roles union their reach', () => {
    const assignable = assignableRoleKeys(TREE, ['stalls_finance', 'stalls_lead']);
    expect(assignable).toContain('stalls_volunteer');
  });
});

describe('editableRoleKeys', () => {
  // The assignable set alone would leave the top of a branch unable to fix
  // anything about itself, including its own account.
  test('adds the roles you hold, so you can edit a peer and yourself', () => {
    const editable = editableRoleKeys(TREE, ['stalls_lead']);
    expect(editable).toContain('stalls_lead');
    expect(editable).not.toContain('stalls_admin');
  });

  test('is always a superset of what you may assign', () => {
    for (const role of SEED_ROLES) {
      const assignable = assignableRoleKeys(TREE, [role.roleKey]);
      const editable = editableRoleKeys(TREE, [role.roleKey]);
      for (const key of assignable) expect(editable).toContain(key);
    }
  });

  test('a leaf role may still edit its own holders', () => {
    expect([...editableRoleKeys(TREE, ['stalls_volunteer'])]).toEqual(['stalls_volunteer']);
  });
});

describe('the grant-level scopes', () => {
  const grant = (editionScope: string[] | null, zoneScope: string[] | null = null): HeldRole => ({
    roleKey: 'r',
    allPrivileges: false,
    privileges: [],
    requestTypeScope: null,
    editionScope,
    zoneScope,
  });

  test('an unrestricted grant reaches every edition and every bay', () => {
    expect(unionEditionScope([grant(null)])).toBeNull();
    expect(unionZoneScope([grant(null, null)])).toBeNull();
  });

  test('a single-edition grant reaches only its own', () => {
    expect(unionEditionScope([grant(['e-2026'])])).toEqual(['e-2026']);
  });

  // The same widening rule as the requester types: a narrow grant can never
  // take reach away from a broad one.
  test('a broad grant beside a narrow one widens, never narrows', () => {
    expect(unionEditionScope([grant(['e-2026']), grant(null)])).toBeNull();
    expect(unionZoneScope([grant(null, ['A1']), grant(null, null)])).toBeNull();
  });

  test('two narrow grants union', () => {
    expect(unionZoneScope([grant(null, ['A1']), grant(null, ['B2'])])?.sort()).toEqual([
      'A1',
      'B2',
    ]);
  });

  // Holding nothing must reach nothing — `null` there would hand somebody with
  // no grant the whole module.
  test('no grants reaches nothing', () => {
    expect(unionEditionScope([])).toEqual([]);
    expect(unionZoneScope([])).toEqual([]);
  });

  test('canReach reads a resolved scope the same way everywhere', () => {
    expect(canReach(null, 'anything')).toBe(true);
    expect(canReach(['A1'], 'A1')).toBe(true);
    expect(canReach(['A1'], 'B2')).toBe(false);
    expect(canReach([], 'A1')).toBe(false);
  });
});

describe('zoneOfRequest', () => {
  test('the agreed bay once the team has settled one', () => {
    expect(zoneOfRequest({ agreedZoneCode: 'B2', preferredZoneCode: 'A1' })).toBe('B2');
  });

  // A request nobody has placed yet would otherwise fall outside every
  // bay-scoped person's reach, so the marshal about to receive it could not see
  // it coming.
  test('and the requested bay until then', () => {
    expect(zoneOfRequest({ agreedZoneCode: null, preferredZoneCode: 'A1' })).toBe('A1');
  });

  test('null when there is neither', () => {
    expect(zoneOfRequest({})).toBeNull();
  });
});

describe('the refusals', () => {
  test('naming the role, for the grant that was refused', () => {
    expect(cannotAssign('Admin')).toContain('Admin');
    expect(cannotAssign('Admin')).toContain('above you in the role hierarchy');
  });

  // The admin can see the person and cannot see the tree, so the refusal names
  // the role that puts them out of reach.
  test('naming both the person and the role, for the account that is out of reach', () => {
    const message = cannotEdit('Deepa Ramanathan', 'Admin');
    expect(message).toContain('Deepa Ramanathan');
    expect(message).toContain('Admin');
  });
});

/**
 * The catalogue stores a category KEY; the screens draw a name.
 *
 * ⚠️ One resolver rather than a map in each screen. The role editor and the
 * privilege table group by the same field, and two copies of "finance means
 * Finance" is how they drift apart.
 */
describe('naming a privilege category', () => {
  test('resolves the key the table stores to the name a reader sees', () => {
    expect(privilegeCategoryName('finance')).toBe('Finance');
  });

  // A category retired from the code is still a category rows carry. The key
  // is ugly but true; a blank heading would lose the rows underneath it.
  test('falls back to the key when the code no longer names it', () => {
    expect(privilegeCategoryName('legacy_exports')).toBe('legacy_exports');
  });
});

/**
 * The reads were split out of the writes so a role could hold one without the
 * other. These are the tests that the split did not leave anybody holding a
 * button they cannot see the screen for.
 */
describe('a write implies its read', () => {
  test.each([
    ['requests.write', 'requests.read'],
    ['planning.write', 'planning.read'],
    ['selection.write', 'selection.read'],
    ['comms.write', 'comms.read'],
    ['onboarding.write', 'onboarding.read'],
    ['finance.write', 'finance.read'],
    ['checkin.write', 'checkin.read'],
    ['equipment.write', 'equipment.read'],
    ['config.write', 'config.read'],
  ] as const)('%s reaches %s', (write, read) => {
    expect(can([write], read)).toBe(true);
  });

  /** ⚠️ Preparing a refund means reading the bank account it is paid into, and
   *  `finance.read` is `sensitive`. The one implication that widens into a
   *  sensitive read, and it is deliberate. */
  test('refunds.write reaches finance.read', () => {
    expect(can(['refunds.write'], 'finance.read')).toBe(true);
  });

  /** ⚠️ One direction only — the entire point of separating them. */
  test('a read never implies its write', () => {
    expect(can(['comms.read'], 'comms.write')).toBe(false);
    expect(can(['checkin.read'], 'checkin.write')).toBe(false);
    expect(can(['config.read'], 'config.write')).toBe(false);
  });

  /** And it does not leak sideways: holding one area's write says nothing
   *  about another area's read. */
  test('an implication stays inside its own area', () => {
    expect(can(['checkin.write'], 'equipment.read')).toBe(false);
    expect(can(['comms.write'], 'requests.read')).toBe(false);
    expect(can(['equipment.write'], 'finance.read')).toBe(false);
  });

  test('every implied read is a real privilege, and no write implies itself', () => {
    for (const [write, read] of Object.entries(IMPLIED_READ_FOR_TEST)) {
      expect(STALL_PRIVILEGES).toContain(write);
      expect(STALL_PRIVILEGES).toContain(read);
      expect(write).not.toBe(read);
      expect(write.endsWith('.write')).toBe(true);
      expect(read.endsWith('.read')).toBe(true);
    }
  });
});

/** The table `can` resolves against, re-declared here rather than exported from
 *  `rbac.ts`: it is an implementation detail of one function, and a test that
 *  reads the real one could only ever assert that it equals itself. Every pair
 *  is also checked behaviourally above. */
const IMPLIED_READ_FOR_TEST: Record<string, string> = {
  'requests.write': 'requests.read',
  'planning.write': 'planning.read',
  'selection.write': 'selection.read',
  'comms.write': 'comms.read',
  'onboarding.write': 'onboarding.read',
  'finance.write': 'finance.read',
  'refunds.write': 'finance.read',
  'checkin.write': 'checkin.read',
  'equipment.write': 'equipment.read',
  'config.write': 'config.read',
};

describe('the volunteer role, after the split', () => {
  const privileges = [...seeded('stalls_volunteer').privileges];

  /** 🔴 The point of the whole exercise: staffing a gate for an evening used to
   *  mean being handed every requester's full application, because the check-in
   *  list was gated on `requests.read`. */
  test('can work both counters without reading a single application', () => {
    expect(can(privileges, 'checkin.read')).toBe(true);
    expect(can(privileges, 'checkin.write')).toBe(true);
    expect(can(privileges, 'equipment.read')).toBe(true);
    expect(can(privileges, 'equipment.write')).toBe(true);

    expect(can(privileges, 'requests.read')).toBe(false);
    expect(can(privileges, 'finance.read')).toBe(false);
    expect(can(privileges, 'onboarding.read')).toBe(false);
  });
});

describe('the reads that used to be gated on a write', () => {
  const welfare = [...seeded('stalls_local_welfare').privileges];

  /** 🔴 "Let me see which letters have gone out" could only be answered by
   *  handing somebody the button that emails every vendor in the edition. */
  test('local welfare can see what was sent without being able to send it', () => {
    expect(can(welfare, 'comms.read')).toBe(true);
    expect(can(welfare, 'comms.write')).toBe(false);
  });
});

/** A shipped role by key, or a failure that names the key rather than throwing
 *  `undefined is not an object` three assertions later. */
function seeded(roleKey: string) {
  const role = SEED_ROLES.find((r) => r.roleKey === roleKey);
  if (!role) throw new Error(`no seeded role ${roleKey}`);
  return role;
}

test('the filing privileges are a category of their own, and Local Welfare never files a bank form', () => {
  const filing = PRIVILEGE_CATEGORIES.find((c) => c.key === 'filing');
  expect(filing?.items.map((i) => i.code).sort()).toEqual([
    'filing.bank',
    'filing.claim',
    'filing.fssai',
    'filing.request',
    'filing.staff',
  ]);
  const lw = SEED_ROLES.find((r) => r.roleKey === 'stalls_local_welfare');
  expect(lw?.privileges).not.toContain('filing.bank');
  expect(lw?.privileges).toContain('filing.request');
});
