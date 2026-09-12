import { ZONE_CODES, type ZoneCode } from './zones';

const ZONE_SET = new Set<string>(ZONE_CODES);

export function formatStallNumber(zone: ZoneCode, n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError('stall index must be a positive integer');
  }
  return `${zone}-${n}`;
}

/** Returns null rather than throwing: this parses values that came from a
 *  spreadsheet column or a 2025 import, where a hand-typed oddity is expected.
 *  An import of several hundred rows should mark one cell unparsed, not abort.
 *
 *  Note this deliberately does NOT accept the 2025 legacy shapes (`A-12`,
 *  `F-03`) that appear in a handful of ashram rows. Those predate zone codes;
 *  they are carried as free text on the stall record and are not generated. */
export function parseStallNumber(s: string): { zone: ZoneCode; n: number } | null {
  const match = /^([A-Z][0-9])-([1-9]\d*)$/.exec(s);
  if (!match || !ZONE_SET.has(match[1])) return null;
  return { zone: match[1] as ZoneCode, n: Number(match[2]) };
}

export function generateStallNumbers(zone: ZoneCode, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => formatStallNumber(zone, i + 1));
}
