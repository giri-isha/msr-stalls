import { ListAuditQuery, ListRequestsQuery, ListUsersQuery } from '@stalls/core';
import { describe, expect, test } from 'vitest';
import { clampPageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PAGE_SIZES, rangeLabel } from './paging';

describe('the sizes a footer offers', () => {
  test('opens on 25 and runs to 500', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(25);
    expect(PAGE_SIZES[0]).toBe(25);
    expect(MAX_PAGE_SIZE).toBe(500);
  });

  test('the ceiling IS the largest size on offer', () => {
    expect(Math.max(...PAGE_SIZES)).toBe(MAX_PAGE_SIZE);
  });

  /**
   * ⚠️ The failure this guards is silent. When the audit log's schema capped at
   * 200 while the footer named 500, choosing 500 fetched two hundred rows and
   * the screen drew a pager confidently counting pages that were never asked
   * for — no error, no empty state, just a list that ends early.
   */
  test('every paged endpoint accepts the largest size the footer offers', () => {
    for (const [name, schema] of [
      ['audit', ListAuditQuery],
      ['users', ListUsersQuery],
    ] as const) {
      const parsed = schema.parse({ pageSize: MAX_PAGE_SIZE });
      expect(parsed.pageSize, name).toBe(MAX_PAGE_SIZE);
    }
    // The pipeline counts the same rows under a different name.
    expect(ListRequestsQuery.parse({ limit: MAX_PAGE_SIZE }).limit).toBe(MAX_PAGE_SIZE);
  });

  test('and opens on the same size the footer does', () => {
    expect(ListAuditQuery.parse({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(ListUsersQuery.parse({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(ListRequestsQuery.parse({}).limit).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('clampPageSize', () => {
  test('takes a size the select could never name, because a caller is not the select', () => {
    expect(clampPageSize(37)).toBe(37);
  });

  test('refuses a size that cannot describe a page', () => {
    expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(-5)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize('')).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize('nonsense')).toBe(DEFAULT_PAGE_SIZE);
  });

  test('never hands back more than the ceiling', () => {
    expect(clampPageSize(10_000)).toBe(MAX_PAGE_SIZE);
  });
});

describe('rangeLabel', () => {
  test('a list that fits on one page is a plain count', () => {
    expect(rangeLabel({ page: 0, size: 25, total: 9, noun: 'stall' })).toBe('9 stalls');
    expect(rangeLabel({ page: 0, size: 25, total: 1, noun: 'stall' })).toBe('1 stall');
  });

  test('a longer list says where in it you are', () => {
    expect(rangeLabel({ page: 0, size: 25, total: 30, noun: 'stall' })).toBe('1–25 of 30 stalls');
    expect(rangeLabel({ page: 1, size: 25, total: 30, noun: 'stall' })).toBe('26–30 of 30 stalls');
  });
});
