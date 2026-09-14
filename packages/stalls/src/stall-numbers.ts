import { isZoneCode, type ZoneCode } from './zones';

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
 *  they are carried as free text on the stall record and are not generated.
 *
 *  ⚠️ This checks the SHAPE of the zone code, not that the zone exists. Which
 *  zones exist is per-edition data an admin edits, so only a database lookup
 *  can answer it — `selectRequest` does exactly that, and a code that parses
 *  here but names no zone fails there as an unknown stall. Validating against a
 *  baked-in list instead would reject every bay added after this file
 *  shipped. */
export function parseStallNumber(s: string): { zone: ZoneCode; n: number } | null {
  const match = /^([A-Z]{1,2}\d{0,2})-([1-9]\d*)$/.exec(s);
  if (!match || !isZoneCode(match[1])) return null;
  return { zone: match[1], n: Number(match[2]) };
}

export function generateStallNumbers(zone: ZoneCode, count: number): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => formatStallNumber(zone, i + 1));
}
