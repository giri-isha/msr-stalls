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

  test('rejects an unknown zone', () => {
    expect(parseStallNumber('Z9-1')).toBeNull();
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
