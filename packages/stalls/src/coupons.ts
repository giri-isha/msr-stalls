/** The staff-registration coupon.
 *
 *  From the requirements: "The staff registration has to be made by secure
 *  coupon basis so that registration is done by only the vendor using a key."
 *  So the coupon is a CREDENTIAL, not a label — anyone holding it can add a
 *  person to a stall's staff list and that person can collect a pass.
 *
 *  It is therefore built from two halves that do different jobs:
 *
 *    GLO-2026-K7Q4M2X9
 *    └┬┘ └┬─┘ └───┬───┘
 *     │   │       └── 40 bits of randomness. This is the whole of the security.
 *     │   └────────── the edition, so a 2025 coupon cannot work in 2026.
 *     └────────────── three letters of the stall name, so a volunteer reading
 *                     one down the phone can tell whose it is.
 *
 *  The prefix is a convenience and must never be treated as identifying: two
 *  stalls can share it, and it is guessable. The lookup is on the whole string.
 */

/** How many people one coupon may register, before anybody raises it.
 *
 *  🔴 Eight is the team's own default — "as a default we raise the coupon code
 *  with eight staff members for each stall" — and it is a number the back
 *  office then moves case by case: "if they want more staff members, in the
 *  back end we raise that capacity to 10, 12".
 *
 *  ⚠️ It is a property of the COUPON, not of the request, and it deliberately
 *  does not read the vendor's own "staff passes" answer. That answer is what
 *  the vendor asked for on a form months earlier; this is what the stall team
 *  has agreed to let through the gate, and the second is the one the counter
 *  has to enforce. A capacity taken from the vendor's own number would also be
 *  zero for every local welfare stall, whose form never asks — and a cap of
 *  zero, read as "no limit", is how a stall with eight passes registers
 *  eighty. */
export const DEFAULT_STAFF_COUPON_CAPACITY = 8;

/** Nobody's stall needs more than this, and a typo in the capacity box should
 *  not be able to open one. */
export const MAX_STAFF_COUPON_CAPACITY = 200;

/** Crockford-style: no I, L, O, U — the characters a person misreads or
 *  mistypes when copying a code off a screen onto a paper list. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 8 characters of a 32-symbol alphabet — 40 bits. Enough that guessing one
 *  among a few hundred live coupons is not worth attempting, and short enough
 *  to be read aloud. */
export const COUPON_RANDOM_LENGTH = 8;

/** Three letters from the stall name, uppercase, padded when the name is
 *  shorter. Non-letters are dropped so "R.B. Foods" gives RBF, not "R.B". */
export function couponPrefix(stallName: string): string {
  const letters = stallName.toUpperCase().replace(/[^A-Z]/g, '');
  return (letters.slice(0, 3) || 'STL').padEnd(3, 'X');
}

/** Pure: the caller supplies the randomness. The API passes
 *  `randomBytes(...)`; a test passes a fixed buffer and gets a fixed coupon.
 *  Generating the bytes in here would make every test that touches a coupon
 *  non-deterministic for no gain. */
export function formatCouponCode(stallName: string, year: number, random: Uint8Array): string {
  if (random.length < COUPON_RANDOM_LENGTH) {
    throw new RangeError(`coupon needs at least ${COUPON_RANDOM_LENGTH} random bytes`);
  }
  let tail = '';
  for (let i = 0; i < COUPON_RANDOM_LENGTH; i++) {
    tail += ALPHABET[random[i] % ALPHABET.length];
  }
  return `${couponPrefix(stallName)}-${year}-${tail}`;
}

const COUPON_SHAPE = new RegExp(`^[A-Z]{3}-\\d{4}-[${ALPHABET}]{${COUPON_RANDOM_LENGTH}}$`);

/** Normalises what a person typed — lowercase, stray spaces, a missing hyphen
 *  — before it is looked up. Returns null when the shape is wrong, so the
 *  route answers "no such coupon" without a database round trip for obvious
 *  junk. */
export function normalizeCouponCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  const withHyphens = /-/.test(cleaned)
    ? cleaned
    : cleaned.replace(
        new RegExp(`^([A-Z]{3})(\\d{4})([${ALPHABET}]{${COUPON_RANDOM_LENGTH}})$`),
        '$1-$2-$3',
      );
  return COUPON_SHAPE.test(withHyphens) ? withHyphens : null;
}
