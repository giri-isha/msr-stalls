import { addGst } from './money';
import type { StallRequestType } from './reference';

/** The charge configuration a bill needs. A subset of `StallChargeConfig`,
 *  named here so the calculation is testable without Prisma. */
export interface BillingCharges {
  chairRatePaise: number;
  tableRatePaise: number;
  lwChairRatePaise: number;
  lwTableRatePaise: number;
  vendorChairRatePaise: number;
  vendorTableRatePaise: number;
  vendorDepositPaise: number;
  localWelfareDepositPaise: number;
  plug5aRatePaise: number;
  plug15aRatePaise: number;
  gstPercent: number;
  eventDays: number;
}

export interface BillableRequest {
  requestType: StallRequestType;
  numStallsRequested: number;
  plugs5a: number;
  plugs15a: number;
  chairsNeeded: number;
  tablesNeeded: number;
}

export interface BillLine {
  label: string;
  amountPaise: number;
}

export interface Bill {
  stallFeePaise: number;
  plugPointsFeePaise: number;
  furnitureFeePaise: number;
  netPaise: number;
  gstPercent: number;
  gstPaise: number;
  grossPaise: number;
  stallDepositPaise: number;
  furnitureDepositPaise: number;
  depositTotalPaise: number;
  totalPayablePaise: number;
  lines: BillLine[];
}

/** Chair and table rates by who is asking. The three 2025 forms quote three
 *  different pairs; this is the one place that chooses. */
export function furnitureRates(
  type: StallRequestType,
  c: BillingCharges,
): { chairPaise: number; tablePaise: number } {
  switch (type) {
    case 'VENDOR':
      return { chairPaise: c.vendorChairRatePaise, tablePaise: c.vendorTableRatePaise };
    case 'LOCAL_WELFARE':
      return { chairPaise: c.lwChairRatePaise, tablePaise: c.lwTableRatePaise };
    default:
      return { chairPaise: c.chairRatePaise, tablePaise: c.tableRatePaise };
  }
}

/**
 * The bill for one request. Mirrors the 2025 "Rent Final" and "Advance - Final"
 * sheets column for column, in integer paise.
 *
 *  - Stall fee: rent × stalls. Zero for ashram (no rent) and local welfare
 *    (deposit only, as the 2025 form says).
 *  - Plug points: one 5 A point per stall is included ("One 5 AMP plug comes
 *    with the stall"); extras and every 15 A point are charged.
 *  - Furniture: chairs and tables at the requester type's daily rate, for the
 *    edition's event days.
 *  - GST applies to the three fees. Deposits are not taxed.
 *  - Deposits: the type's security deposit, plus a furniture advance equal to
 *    the furniture fee — the challan's "Rent | Advance" pair.
 *
 * `rentPaise` is null for a zone that quotes no rent (closed to vendors); a
 * vendor request there bills a zero stall fee rather than failing, and the
 * onboarding screen shows the zero so a person notices.
 */
export function computeBill(r: BillableRequest, c: BillingCharges, rentPaise: number | null): Bill {
  const stalls = Math.max(1, r.numStallsRequested);
  const paysRent = r.requestType === 'VENDOR';
  const stallFeePaise = paysRent ? (rentPaise ?? 0) * stalls : 0;

  const extra5a = Math.max(0, r.plugs5a - stalls);
  const plugPointsFeePaise = extra5a * c.plug5aRatePaise + r.plugs15a * c.plug15aRatePaise;

  const { chairPaise, tablePaise } = furnitureRates(r.requestType, c);
  const days = Math.max(1, c.eventDays);
  const furnitureFeePaise = (r.chairsNeeded * chairPaise + r.tablesNeeded * tablePaise) * days;

  const netPaise = stallFeePaise + plugPointsFeePaise + furnitureFeePaise;
  const { gst: gstPaise, gross: grossPaise } = addGst(netPaise, c.gstPercent);

  const stallDepositPaise =
    r.requestType === 'VENDOR'
      ? c.vendorDepositPaise
      : r.requestType === 'LOCAL_WELFARE'
        ? c.localWelfareDepositPaise
        : 0;
  const furnitureDepositPaise = furnitureFeePaise;
  const depositTotalPaise = stallDepositPaise + furnitureDepositPaise;

  const lines: BillLine[] = [];
  if (stallFeePaise) lines.push({ label: `Stall rent × ${stalls}`, amountPaise: stallFeePaise });
  if (extra5a)
    lines.push({
      label: `Extra 5 A plug points × ${extra5a}`,
      amountPaise: extra5a * c.plug5aRatePaise,
    });
  if (r.plugs15a)
    lines.push({
      label: `15 A plug points × ${r.plugs15a}`,
      amountPaise: r.plugs15a * c.plug15aRatePaise,
    });
  if (r.chairsNeeded)
    lines.push({
      label: `Chairs × ${r.chairsNeeded} × ${days} day${days > 1 ? 's' : ''}`,
      amountPaise: r.chairsNeeded * chairPaise * days,
    });
  if (r.tablesNeeded)
    lines.push({
      label: `Tables × ${r.tablesNeeded} × ${days} day${days > 1 ? 's' : ''}`,
      amountPaise: r.tablesNeeded * tablePaise * days,
    });
  if (gstPaise) lines.push({ label: `GST ${c.gstPercent}%`, amountPaise: gstPaise });
  if (stallDepositPaise)
    lines.push({ label: 'Security deposit (refundable)', amountPaise: stallDepositPaise });
  if (furnitureDepositPaise)
    lines.push({
      label: 'Chairs & tables advance (refundable)',
      amountPaise: furnitureDepositPaise,
    });

  return {
    stallFeePaise,
    plugPointsFeePaise,
    furnitureFeePaise,
    netPaise,
    gstPercent: c.gstPercent,
    gstPaise,
    grossPaise,
    stallDepositPaise,
    furnitureDepositPaise,
    depositTotalPaise,
    totalPayablePaise: grossPaise + depositTotalPaise,
    lines,
  };
}
