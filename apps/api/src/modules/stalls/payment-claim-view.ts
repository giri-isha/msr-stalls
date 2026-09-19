import type { StallPaymentPurpose } from '@prisma/client';
import type { PaymentClaimView } from '@stalls/core';

/**
 * How a payment claim is read and shaped for the wire.
 *
 * 🔴 Its own file rather than `payment-claims.ts`. That module writes claims,
 * and writing one reuses `confirmPayment` from `finance.ts` — so the moment
 * `finance.ts` also needed to READ claims, the two imported each other and the
 * boundary guard failed. The reading half depends on nothing, so it moves here
 * and both sides import it.
 */

export const CLAIM_SELECT = {
  id: true,
  purpose: true,
  status: true,
  referenceNo: true,
  amountPaise: true,
  paidOn: true,
  remitterName: true,
  note: true,
  receiptKey: true,
  submittedAt: true,
  reviewedAt: true,
  rejectReason: true,
} as const;

export type ClaimRow = {
  id: string;
  purpose: StallPaymentPurpose;
  status: string;
  referenceNo: string;
  amountPaise: number;
  paidOn: Date;
  remitterName: string | null;
  note: string | null;
  receiptKey: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  rejectReason: string | null;
};

/** ⚠️ `hasReceipt`, not the key itself. The key is a handle on a private file;
 *  the requester only needs to know their upload arrived, and the backoffice
 *  fetches it through the media store with its own authorisation. */
export function toView(c: ClaimRow): PaymentClaimView {
  return {
    id: c.id,
    purpose: c.purpose,
    status: c.status as PaymentClaimView['status'],
    referenceNo: c.referenceNo,
    amountPaise: c.amountPaise,
    // A banking date. `toISOString().slice(0, 10)` rather than the whole
    // instant: there is no time-of-day on a statement line.
    paidOn: c.paidOn.toISOString().slice(0, 10),
    remitterName: c.remitterName,
    note: c.note,
    submittedAt: c.submittedAt.toISOString(),
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
    rejectReason: c.rejectReason,
    hasReceipt: c.receiptKey !== null,
  };
}
