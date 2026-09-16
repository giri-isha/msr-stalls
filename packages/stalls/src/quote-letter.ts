import { formatInr } from './money';
import type { Quote, QuoteLine } from './quote';

/**
 * The charges, as the payment letter prints them.
 *
 * 🔴 The 2025 letter shows the ARITHMETIC — "15 Amp : 4 × 1000 : ₹4,000.00" —
 * and that is not decoration. A vendor querying their bill asks about the
 * multiplication, not the total; a summed line cannot answer "why four
 * thousand?", so the reader has to take it on trust or ring the office. Every
 * line here carries its count and its unit rate for that reason.
 *
 * ⚠️ Zero rows are DROPPED. A stall that took no chairs should not read a line
 * charging it nothing — that looks like a mistake, and a reader who has to
 * decide whether ₹0.00 is a bug is a reader who rings up. The quote keeps them
 * so the electrical sheet can tell "asked for none" from "not charged".
 *
 * ⚠️ Rendered as ALIGNED TEXT, not a table. This goes into a plain-text email
 * body an admin can edit, and a template that emitted HTML would break the
 * moment somebody pasted a line into it.
 */

/** How wide the label column is. Chosen so the longest indented item — the
 *  fifteen-amp line — still leaves the amounts in one column. */
const LABEL_WIDTH = 34;

function row(label: string, amount: string, indent = 0): string {
  const text = `${' '.repeat(indent)}${label}`;
  return `${text.padEnd(LABEL_WIDTH)}: ${amount.padStart(12)}`;
}

/** "4 × 1000" — the multiplication, without the money formatting that would
 *  make it harder to read than the total beside it. */
function sum(line: QuoteLine): string {
  const each = Math.round(line.unitRatePaise / 100);
  const perDay = line.days !== null && line.days > 1 ? ` × ${line.days} days` : '';
  return `${line.label} : ${line.count} × ${each}${perDay}`;
}

const GROUP_HEADING: Record<QuoteLine['group'], string> = {
  stall: '',
  plugs: 'Cost of additional plug points',
  equipment: 'Rent for chairs and tables',
};

export function chargeLines(quote: Quote): string {
  const out: string[] = [];

  for (const group of ['stall', 'plugs', 'equipment'] as const) {
    const lines = quote.lines.filter((l) => l.group === group && l.amountPaise > 0);
    if (lines.length === 0) continue;

    if (group === 'stall') {
      // The rent stands alone, with no heading and no multiplication unless
      // more than one stall was allocated.
      for (const l of lines) {
        out.push(row(l.count > 1 ? sum(l) : l.label, formatInr(l.amountPaise)));
      }
      continue;
    }

    out.push(GROUP_HEADING[group]);
    for (const l of lines) out.push(row(sum(l), formatInr(l.amountPaise), 4));
  }

  out.push(row('GST', formatInr(quote.gstPaise), 12));
  out.push('');
  out.push(row('Total', formatInr(quote.feeTotalPaise), 21));
  return out.join('\n');
}

/**
 * The caution deposit, split.
 *
 * ⚠️ Two figures and a total, as the 2025 letter has it — the furniture deposit
 * is charged only when furniture is taken, so a vendor who took none must not
 * read a line for it. Never discounted: the deposit comes back in full, so a
 * concession on it would mean refunding money that was never taken.
 */
export function depositLines(quote: Quote): string {
  const out = [row('Caution deposit — stall', formatInr(quote.stallDepositPaise))];
  if (quote.equipmentDepositPaise > 0) {
    out.push(row('Caution deposit — chairs and tables', formatInr(quote.equipmentDepositPaise)));
    out.push('');
    out.push(row('Total caution deposit', formatInr(quote.depositTotalPaise), 8));
  }
  return out.join('\n');
}
