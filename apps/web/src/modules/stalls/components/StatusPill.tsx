import type { RequestStage, RequestStatus } from '@msr/stalls';
import { Tag, type Tone } from '../ui';

/**
 * What tone each request status wears.
 *
 * ⚠️ Mapped onto the shared `Tone` vocabulary rather than a palette of this
 * module's own — the whole point of the copied design system is that a green
 * here means what a green means anywhere else in the product. `SELECTED` is
 * `ok` and `BACKUP` is `warn` for the same reason `Confirmed` and
 * `Callback Requested` are in the module this came from: one is a decision, the
 * other is a wait.
 *
 * ⚠️ `REJECTED` and `CANCELLED` share `des`, and they are not the same event —
 * one is our decision and the other the requester's. The words differ and the
 * colour does not, because a pill's colour says "this request is not going
 * ahead" and the label says which way it ended.
 */
const STATUS_TONE: Record<RequestStatus, Tone> = {
  SUBMITTED: 'neutral',
  SHORTLISTED: 'info',
  SELECTED: 'ok',
  BACKUP: 'warn',
  REJECTED: 'des',
  CANCELLED: 'des',
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  SHORTLISTED: 'Shortlisted',
  SELECTED: 'Selected',
  BACKUP: 'Backup',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** The tone a status wears, for anything that is not a pill — a stat tile's
 *  plate, a count, a row wash. A second colour vocabulary for the same words is
 *  how two halves of one screen come to disagree about what green means. */
export function requestStatusTone(status: RequestStatus): Tone {
  return STATUS_TONE[status] ?? 'neutral';
}

export function StatusPill({ status }: { status: RequestStatus }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

export const TYPE_LABEL: Record<string, string> = {
  ASHRAM: 'Ashram',
  ASHRAM_FOOD: 'Ashram Food',
  LOCAL_WELFARE: 'Local Welfare',
  VENDOR: 'Vendor',
};

/**
 * The applicant's kind.
 *
 * ⚠️ `violet`, and deliberately none of the tones a STATUS uses. Type and
 * status sit side by side in every row and every card header; drawing the type
 * in `info` or `ok` would put two pills of the same colour next to each other
 * saying unrelated things, which is how a scan of the pipeline stops working.
 */
export function TypeBadge({ type }: { type: string }) {
  return <Tag tone='violet'>{TYPE_LABEL[type] ?? type}</Tag>;
}

/**
 * What tone each onboarding stage wears.
 *
 * ⚠️ The vocabulary is WHOSE COURT THE BALL IS IN, not how far along the row
 * is. `warn` is "we have asked and are waiting on the requester", `info` is
 * "it is back with us", `ok` is "nothing outstanding". A gradient from grey to
 * green would have read as progress and told a coordinator scanning the column
 * nothing about who to chase — which is the only question this column is
 * there to answer.
 *
 * ⚠️ None of these is `violet`: the type badge sits three columns away and
 * owns that tone, for the same reason `STATUS_TONE` avoids it.
 */
const STAGE_TONE: Record<RequestStage, Tone> = {
  NEW: 'neutral',
  BANK_FORM_SENT: 'warn',
  BANK_FORM_FILLED: 'info',
  PAYMENT_SENT: 'warn',
  PAYMENT_CONFIRMED: 'info',
  FSSAI_PENDING: 'warn',
  READY: 'ok',
  CHECKED_IN: 'ok',
};

/**
 * ⚠️ The words the coordinators use on the phone, not the enum tidied up.
 * "Bank form sent" is what went out in an email and what they will say when
 * they ring; `BANK_FORM_SENT` is only how it is stored. The stage filter's
 * options and the column read from this one map, so the word in the dropdown
 * is the word in the row.
 */
export const STAGE_LABEL: Record<RequestStage, string> = {
  NEW: 'New',
  BANK_FORM_SENT: 'Bank Form Sent',
  BANK_FORM_FILLED: 'Bank Form Submitted',
  PAYMENT_SENT: 'Payment Letter Sent',
  PAYMENT_CONFIRMED: 'Payment Confirmed',
  FSSAI_PENDING: 'FSSAI Form Sent',
  READY: 'Ready',
  CHECKED_IN: 'Checked In',
};

export function StagePill({ stage }: { stage: RequestStage }) {
  return <Tag tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Tag>;
}

/**
 * Whether the stage is worth drawing at all.
 *
 * 🔴 A request that has not been selected has no onboarding to be at a stage
 * of, and the derived stage on it is `NEW` because nothing has been sent —
 * not because it is waiting on anything. Drawing "New" on every Submitted row
 * put a pill in a column that a coordinator reads to find who to chase, on
 * rows nobody can chase yet. The column shows an em dash there instead.
 */
export function hasStage(status: RequestStatus): boolean {
  return status === 'SELECTED';
}
