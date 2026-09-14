import type { RequestStatus } from '@msr/stalls';
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
