import { describe, expect, test } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_INFO,
  changeSet,
  describeAuditAction,
  isAuditAction,
  ListAuditQuery,
  maskAccountNumber,
} from './audit';

describe('the audit vocabulary', () => {
  test('every action carries a label, a family, a glyph and a tone', () => {
    for (const action of AUDIT_ACTIONS) {
      const info = AUDIT_ACTION_INFO[action];
      expect(info.label.length, action).toBeGreaterThan(0);
      expect(info.family.length, action).toBeGreaterThan(0);
      expect(info.glyph.length, action).toBeGreaterThan(0);
      expect(info.tone.length, action).toBeGreaterThan(0);
    }
  });

  test('every action is noun.verb in snake case', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  test('the status transitions and the equipment actions are all named', () => {
    for (const s of ['submitted', 'shortlisted', 'selected', 'backup', 'rejected', 'cancelled']) {
      expect(isAuditAction(`stall_request.${s}`)).toBe(true);
    }
    for (const a of [
      'distribute',
      'undistribute',
      'collect_extra_payment',
      'collect',
      'uncollect',
    ]) {
      expect(isAuditAction(`stall_equipment.${a}`)).toBe(true);
    }
  });

  test('filing a request is not the same word as the transition back to submitted', () => {
    expect(describeAuditAction('stall_request.filed').label).toBe('Request Filed');
    expect(describeAuditAction('stall_request.submitted').label).toBe('Back to Submitted');
  });

  test('an unknown action still describes itself rather than throwing', () => {
    const info = describeAuditAction('stall_thing.happened');
    expect(info.label).toBe('Stall Thing Happened');
    expect(info.family).toBe('other');
  });
});

describe('changeSet', () => {
  test('lists only the fields that differ, before and after', () => {
    const before = { stallName: 'Old', chairsNeeded: 2, remarks: null };
    const after = { stallName: 'New', chairsNeeded: 2, remarks: 'x' };
    expect(changeSet(before, after)).toEqual([
      { field: 'stallName', before: 'Old', after: 'New' },
      { field: 'remarks', before: null, after: 'x' },
    ]);
  });

  test('a field absent from `after` is untouched, and `fields` narrows the comparison', () => {
    const before = { a: 1, b: 2, c: 3 };
    expect(changeSet(before, { a: 9 })).toEqual([{ field: 'a', before: 1, after: 9 }]);
    expect(changeSet(before, { a: 9, b: 8 }, ['b'])).toEqual([{ field: 'b', before: 2, after: 8 }]);
  });

  test('undefined and null read as the same absence', () => {
    expect(changeSet({ a: undefined }, { a: null })).toEqual([]);
  });

  test('arrays compare by value', () => {
    expect(changeSet({ ap: [{ n: 'x' }] }, { ap: [{ n: 'x' }] })).toEqual([]);
    expect(changeSet({ ap: [] }, { ap: [{ n: 'x' }] })).toHaveLength(1);
  });
});

describe('maskAccountNumber', () => {
  test('keeps the last four digits and nothing else', () => {
    expect(maskAccountNumber('123456789012')).toBe('••••9012');
    expect(maskAccountNumber('1234')).toBe('••••');
    expect(maskAccountNumber('')).toBeNull();
    expect(maskAccountNumber(null)).toBeNull();
  });
});

describe('ListAuditQuery', () => {
  test('defaults the page and refuses a bad date', () => {
    expect(ListAuditQuery.parse({})).toMatchObject({ page: 0, pageSize: 50 });
    expect(ListAuditQuery.safeParse({ from: '17/09/2026' }).success).toBe(false);
    expect(ListAuditQuery.safeParse({ actorKind: 'ROBOT' }).success).toBe(false);
  });
});
