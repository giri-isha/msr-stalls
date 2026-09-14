import { useState } from 'react';
import { Icon } from '../icons';
import { Tag } from '../ui';

/**
 * A collapsible titled block, and the fact grid that usually fills it.
 *
 * Shared by the check-in record and the volunteer detail card, which drew the
 * same block two different ways until this file existed.
 */
export function Section({
  icon,
  title,
  note,
  count,
  last,
  children,
}: {
  icon?: string;
  title: string;
  /** A line under the title saying what the block is for. */
  note?: string;
  count?: number;
  /** Suppresses the divider, for the last block inside a shared card. */
  last?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{ padding: '14px 16px', ...(last ? {} : { borderBottom: '1px solid var(--line)' }) }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          cursor: 'pointer',
          marginBottom: open ? 13 : 0,
        }}
      >
        {icon && <Icon name={icon} size={15} color='var(--pri)' />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
          {note && <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 1 }}>{note}</div>}
        </div>
        {count !== undefined && <Tag size='sm'>{count}</Tag>}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color='var(--mfg)' />
      </div>
      {open && children}
    </div>
  );
}

/**
 * Facts as a grid of cells, label over value.
 *
 * Label above rather than beside: a value only as long as "Volunteer" should
 * not sit alone on a full-width line, and a long one should not wrap into a
 * narrow column beside its label.
 */
export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
        gap: '14px 20px',
      }}
    >
      {items.map(([k, val]) => (
        <div key={k} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginBottom: 3 }}>{k}</div>
          <div style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>
            {val}
          </div>
        </div>
      ))}
    </div>
  );
}
