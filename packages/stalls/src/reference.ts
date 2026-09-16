/** A request's human-facing handle. Backoffice read these aloud on the phone and
 *  write them on paper challans, so the prefix has to say what kind of request
 *  it is without a lookup. */
/** ⚠️ A TUPLE, and the type is derived from it rather than written twice. A
 *  `z.enum` needs the tuple — `RequesterTypeValue` in `access.ts` is built from
 *  this list, so the three forms an account may be registered against cannot
 *  drift from the three references that can be minted. */
export const STALL_REQUEST_TYPES = ['ASHRAM', 'LOCAL_WELFARE', 'VENDOR'] as const;

export type StallRequestType = (typeof STALL_REQUEST_TYPES)[number];

const PREFIX: Record<StallRequestType, string> = {
  ASHRAM: 'ASH',
  LOCAL_WELFARE: 'LWS',
  VENDOR: 'VEN',
};

/**
 * Prefixes no form issues any more, and what they meant.
 *
 * 🔴 `AFD` was `ASHRAM_FOOD`, which is not a request type since the two ashram
 * forms became one and the stall's food-ness became a question on it. The
 * references it already handed out did not change — they are printed on
 * challans and read down the phone — so a coordinator pasting `AFD-2026-0007`
 * into a search box has to land on that request rather than on "no match".
 *
 * ⚠️ Read by `parseReference` only. `formatReference` cannot reach it, which is
 * the point: an old prefix is understood, never minted again.
 */
const RETIRED_PREFIX: Record<string, StallRequestType> = {
  AFD: 'ASHRAM',
};

const BY_PREFIX = new Map<string, StallRequestType>([
  ...Object.entries(RETIRED_PREFIX),
  ...Object.entries(PREFIX).map(([type, prefix]): [string, StallRequestType] => [
    prefix,
    type as StallRequestType,
  ]),
]);

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

/**
 * Every form an edition serves, request and otherwise.
 *
 * 🔴 A superset of `StallRequestType`, and the distinction is real: a request
 * type is what somebody APPLIED as, and it names a row in `stall_request`. A
 * form type is a page that asks questions — the three application forms plus
 * the bank details form, the FSSAI upload and staff registration, none of which
 * is an application and all of which ask somebody to agree to something.
 *
 * ⚠️ The three shared names are deliberately identical strings. A declaration
 * scoped to `VENDOR` means the vendor application form, and the migration that
 * widened `stall_declaration` relies on every existing value mapping to itself.
 */
export type StallFormType = StallRequestType | 'BANK' | 'FSSAI' | 'STAFF';

export const STALL_FORM_TYPES: readonly StallFormType[] = [
  ...STALL_REQUEST_TYPES,
  'BANK',
  'FSSAI',
  'STAFF',
];
