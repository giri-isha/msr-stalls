/** The key a vendor types into the external Sewadhar registration so only that
 *  vendor's staff register against that stall. Read aloud over the phone and
 *  typed on a phone keyboard, so the random part avoids 0/O and 1/I/L. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCouponPart(length = 4, rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

/** `MSR26-C1-1-K7Q2`: event and year, the stall, then the secret part. The
 *  stall is in the code so a coordinator can see at a glance which stall a
 *  coupon belongs to without a lookup; the secret part is what makes it a key. */
export function newCouponCode(
  year: number,
  stallNumber: string,
  rand: () => number = Math.random,
): string {
  return `MSR${String(year).slice(-2)}-${stallNumber}-${randomCouponPart(4, rand)}`;
}

export function normalizeCouponCode(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '');
}

export function isCouponCode(s: string): boolean {
  return /^MSR\d{2}-[A-Z][0-9]-[1-9]\d*-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4,8}$/.test(
    normalizeCouponCode(s),
  );
}
