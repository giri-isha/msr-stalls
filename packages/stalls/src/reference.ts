/** A request's human-facing handle. Staff read these aloud on the phone and
 *  write them on paper challans, so the prefix has to say what kind of request
 *  it is without a lookup. */
export type StallRequestType = 'ASHRAM' | 'ASHRAM_FOOD' | 'LOCAL_WELFARE' | 'VENDOR';

export const STALL_REQUEST_TYPES: readonly StallRequestType[] = [
  'ASHRAM',
  'ASHRAM_FOOD',
  'LOCAL_WELFARE',
  'VENDOR',
];

const PREFIX: Record<StallRequestType, string> = {
  ASHRAM: 'ASH',
  ASHRAM_FOOD: 'AFD',
  LOCAL_WELFARE: 'LWS',
  VENDOR: 'VEN',
};

const BY_PREFIX = new Map<string, StallRequestType>(
  Object.entries(PREFIX).map(([type, prefix]) => [prefix, type as StallRequestType]),
);

/** `padStart` rather than a fixed-width slice: truncating at four digits would
 *  silently hand a 10,000th request another request's reference, and 2025
 *  already ran to several hundred across the four forms. Growing past the pad
 *  width is fine; overlapping is not. */
export function formatReference(type: StallRequestType, year: number, seq: number): string {
  return `${PREFIX[type]}-${year}-${String(seq).padStart(4, '0')}`;
}

/** Returns null rather than throwing. This parses strings a human typed into a
 *  search box or a spreadsheet column, where junk is the expected case and must
 *  read as "no match", never as a 500. */
export function parseReference(
  ref: string,
): { type: StallRequestType; year: number; seq: number } | null {
  const match = /^([A-Z]{3})-(\d{4})-(\d{4,})$/.exec(ref);
  if (!match) return null;
  const type = BY_PREFIX.get(match[1]);
  if (!type) return null;
  return { type, year: Number(match[2]), seq: Number(match[3]) };
}
