import type { RequestStatus } from '@msr/stalls';
import { Badge, type BadgeProps } from '../../../components/ui/badge';

const STATUS_TONE: Record<RequestStatus, NonNullable<BadgeProps['tone']>> = {
  SUBMITTED: 'neutral',
  SHORTLISTED: 'info',
  SELECTED: 'good',
  BACKUP: 'warn',
  REJECTED: 'bad',
  CANCELLED: 'bad',
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  SHORTLISTED: 'Shortlisted',
  SELECTED: 'Selected',
  BACKUP: 'Backup',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export function StatusPill({ status }: { status: RequestStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export const TYPE_LABEL: Record<string, string> = {
  ASHRAM: 'Ashram',
  ASHRAM_FOOD: 'Ashram Food',
  LOCAL_WELFARE: 'Local Welfare',
  VENDOR: 'Vendor',
};

export function TypeBadge({ type }: { type: string }) {
  return <Badge tone='accent'>{TYPE_LABEL[type] ?? type}</Badge>;
}
