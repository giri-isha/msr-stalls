import type { RequestStage, RequestStatus } from '@msr/stalls';
import { STAGE_LABEL } from '@msr/stalls';
import { Pill, Tag, type Tone } from '../ui/ui';

export const STATUS_LABEL: Record<RequestStatus, string> = {
  SUBMITTED: 'Submitted',
  SHORTLISTED: 'Shortlisted',
  SELECTED: 'Selected',
  BACKUP: 'Backup',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/** `Pill` picks its tone from the word — the module's `STATUS_TONE` in ui.tsx
 *  carries these labels, so a stat tile and a pill agree about what green means. */
export function StatusPill({ status, size }: { status: RequestStatus; size?: 'md' | 'sm' }) {
  return <Pill size={size}>{STATUS_LABEL[status]}</Pill>;
}

export function StagePill({ stage, size }: { stage: RequestStage; size?: 'md' | 'sm' }) {
  return <Pill size={size}>{STAGE_LABEL[stage]}</Pill>;
}

export const TYPE_LABEL: Record<string, string> = {
  ASHRAM: 'Ashram',
  ASHRAM_FOOD: 'Ashram Food',
  LOCAL_WELFARE: 'Local Welfare',
  VENDOR: 'Vendor',
};

const TYPE_TONE: Record<string, Tone> = {
  VENDOR: 'violet',
  LOCAL_WELFARE: 'teal',
  ASHRAM: 'neutral',
  ASHRAM_FOOD: 'neutral',
};

export function TypeTag({ type, size }: { type: string; size?: 'md' | 'sm' }) {
  return (
    <Tag tone={TYPE_TONE[type] ?? 'neutral'} size={size}>
      {TYPE_LABEL[type] ?? type}
    </Tag>
  );
}

/** Kept for callers written against the Phase 1 name. */
export const TypeBadge = TypeTag;
