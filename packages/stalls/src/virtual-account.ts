/** The virtual account a payment is made into.
 *
 *  ── Why this exists ────────────────────────────────────────────────────────
 *  No money moves through this application. Finance issues a PREFIX for the
 *  season and the account for one requester is that prefix followed by their
 *  mobile number — so the bank statement comes back carrying, in the account
 *  column, the one field that identifies who paid. That string is the entire
 *  link between a credit on a statement and a request in this system: "without
 *  this cross reference we will not be able to map a vendor to the payment".
 *
 *  🔴 Rent and the refundable advance go to DIFFERENT accounts. They are two
 *  prefixes, not one — in 2025 they differed by a single character — and they
 *  have to, because the advance comes back at the end of the season and the
 *  rent does not. A vendor who pays both into the rent account leaves Finance
 *  reconciling two credits that look identical.
 *
 *  ⚠️ Both prefixes are edition configuration, not constants. Finance mints a
 *  new pair each season and the old one stops working; hard-coding either would
 *  quietly send a 2027 vendor's money at a 2026 account.
 */

/** Neither prefix is known until Finance issues it, so both are nullable on the
 *  edition and every consumer has to cope with "not set yet". */
export interface VirtualAccountPrefixes {
  rentPrefix: string | null;
  depositPrefix: string | null;
}

export type VirtualAccountPurpose = 'RENT' | 'DEPOSIT';

/** Letters and digits only, 2–12 of them. Finance hands these over as a short
 *  code (2025's was three letters); anything with a space or a separator in it
 *  would not survive the round trip through a bank's account field. */
export const VIRTUAL_ACCOUNT_PREFIX_PATTERN = /^[A-Z0-9]{2,12}$/;

export function isVirtualAccountPrefix(s: string): boolean {
  return VIRTUAL_ACCOUNT_PREFIX_PATTERN.test(s);
}

/** `null` when the prefix for that purpose has not been issued, or the mobile
 *  number is not the bare ten digits `IndianMobile` normalises to.
 *
 *  Returning null rather than a half-built string is deliberate: a partial
 *  account number printed on a payment letter is worse than an absent one,
 *  because a vendor will try to pay into it. */
export function virtualAccountFor(
  prefixes: VirtualAccountPrefixes,
  mobile: string,
  purpose: VirtualAccountPurpose,
): string | null {
  const prefix = purpose === 'RENT' ? prefixes.rentPrefix : prefixes.depositPrefix;
  if (!prefix || !isVirtualAccountPrefix(prefix)) return null;
  const digits = mobile.replace(/\s/g, '');
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `${prefix}${digits}`;
}
