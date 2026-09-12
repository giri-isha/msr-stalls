/** Money is integer paise everywhere in this module — in the database, over the
 *  wire, and in every calculation. Rupees exist only at the two edges: what a
 *  human types and what a human reads.
 *
 *  This is not fussiness. Stall rent is summed across several hundred requests,
 *  GST is applied, a security deposit is held, fines for an unclean stall and
 *  for missing chairs are deducted, and the remainder is refunded by voucher.
 *  Float rupees accumulate error across exactly that chain, and the error
 *  surfaces as a refund that disagrees with the vendor's own arithmetic.
 */

/** The one place rupees become paise. Rounds, because `19.99 * 100` is
 *  `1998.9999999999998` in IEEE-754 and truncation would lose a paisa on
 *  roughly half of all non-integer amounts. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) throw new RangeError('amount must be finite');
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** `en-IN` gives the 1,50,000 grouping the team reads on every other document.
 *  `minimumFractionDigits: 0` with `maximumFractionDigits: 2` shows paise only
 *  when there are any — stall rents are whole rupees and should not be padded
 *  with a decimal that implies more precision than was entered. */
export function formatInr(paise: number): string {
  return INR.format(paiseToRupees(paise));
}

/** Returns all three figures rather than just the gross, because the vendor's
 *  payment email itemises them and the finance sheet reconciles against the
 *  net. Recomputing the split at each call site is how they drift apart. */
export function addGst(
  netPaise: number,
  ratePercent: number,
): { net: number; gst: number; gross: number } {
  const gst = Math.round((netPaise * ratePercent) / 100);
  return { net: netPaise, gst, gross: netPaise + gst };
}
