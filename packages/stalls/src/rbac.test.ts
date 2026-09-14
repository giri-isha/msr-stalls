import { describe, expect, test } from 'vitest';
import { MODULE_KEY, ROLES, can } from './rbac';

describe('MODULE_KEY', () => {
  test('is the key the host module registry will store', () => {
    expect(MODULE_KEY).toBe('stalls');
  });
});

describe('ROLES', () => {
  test('declares the staff roles from the requirements', () => {
    expect(ROLES.map((r) => r.roleKey).sort()).toEqual([
      'stalls_admin',
      'stalls_finance',
      'stalls_lead',
      'stalls_local_welfare',
      'stalls_volunteer',
    ]);
  });

  // The local welfare team files requests inside this application, because the
  // traders they file for mostly have no email address. That makes them staff —
  // it does not give them a commercial vendor's bank details.
  test('only the local welfare role is scoped, and only to its own requests', () => {
    const scoped = ROLES.filter((r) => r.requestTypeScope !== null);
    expect(scoped.map((r) => r.roleKey)).toEqual(['stalls_local_welfare']);
    expect(scoped[0].requestTypeScope).toEqual(['LOCAL_WELFARE']);
  });

  test('every role carries a human label for the admin screen', () => {
    for (const role of ROLES) expect(role.name.length).toBeGreaterThan(0);
  });
});

describe('can', () => {
  test('admin can do everything, including configuring the module', () => {
    expect(can(['stalls_admin'], 'config:write')).toBe(true);
    expect(can(['stalls_admin'], 'selection:write')).toBe(true);
    expect(can(['stalls_admin'], 'checkin:write')).toBe(true);
  });

  test('lead runs planning and selection but cannot change configuration', () => {
    expect(can(['stalls_lead'], 'planning:write')).toBe(true);
    expect(can(['stalls_lead'], 'selection:write')).toBe(true);
    expect(can(['stalls_lead'], 'config:write')).toBe(false);
  });

  test('volunteer is check-in and chairs only, and cannot see money', () => {
    expect(can(['stalls_volunteer'], 'checkin:write')).toBe(true);
    expect(can(['stalls_volunteer'], 'selection:write')).toBe(false);
    expect(can(['stalls_volunteer'], 'finance:read')).toBe(false);
  });

  test('finance reads requests and owns payment confirmation', () => {
    expect(can(['stalls_finance'], 'finance:write')).toBe(true);
    expect(can(['stalls_finance'], 'requests:read')).toBe(true);
    expect(can(['stalls_finance'], 'selection:write')).toBe(false);
  });

  test('holding several roles grants the union', () => {
    expect(can(['stalls_volunteer', 'stalls_finance'], 'finance:write')).toBe(true);
  });

  test('no roles grants nothing, and an unknown role is not an error', () => {
    expect(can([], 'requests:read')).toBe(false);
    expect(can(['not_a_role'], 'requests:read')).toBe(false);
  });
});
