import { describe, expect, test } from 'vitest';
import { formatStallNumber, generateStallNumbers, parseStallNumber } from './stall-numbers';

describe('formatStallNumber', () => {
  test('is zone code, hyphen, one-based index', () => {
    expect(formatStallNumber('A4', 17)).toBe('A4-17');
    expect(formatStallNumber('C2', 1)).toBe('C2-1');
  });

  test('refuses a non-positive index', () => {
    expect(() => formatStallNumber('A4', 0)).toThrow(/positive/i);
    expect(() => formatStallNumber('A4', -1)).toThrow(/positive/i);
  });
});

describe('parseStallNumber', () => {
  test('round-trips a generated number', () => {
    expect(parseStallNumber('A4-17')).toEqual({ zone: 'A4', n: 17 });
  });

  // ⚠️ Shape only. Whether Z9 is a bay this edition actually has is per-edition
  // data, so only a lookup can answer it — `selectRequest` does exactly that,
  // and a code that parses here but names no zone fails there as an unknown
  // stall. Rejecting it on a baked-in list would reject every bay added after
  // this file shipped.
  test('accepts a well-formed code for a bay it has never heard of', () => {
    expect(parseStallNumber('Z9-1')).toEqual({ zone: 'Z9', n: 1 });
  });

  test('rejects junk', () => {
    expect(parseStallNumber('A4')).toBeNull();
    expect(parseStallNumber('')).toBeNull();
    expect(parseStallNumber('A4-0')).toBeNull();
  });
});

describe('generateStallNumbers', () => {
  test('produces a contiguous one-based run', () => {
    expect(generateStallNumbers('B2', 3)).toEqual(['B2-1', 'B2-2', 'B2-3']);
  });

  test('a count of zero produces nothing', () => {
    expect(generateStallNumbers('B2', 0)).toEqual([]);
  });
});
