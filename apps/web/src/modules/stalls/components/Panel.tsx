import type * as React from 'react';
import { Card } from '../ui';

/**
 * A titled panel.
 *
 * The reference system has no Card header component — its screens draw their
 * own — so this is that pattern, once, rather than eight times down Admin.
 *
 * ⚠️ Its own file rather than Admin's, because the Users directory moved out
 * into `staff/Users.tsx` and needs the same panel. Admin importing Users while
 * Users imported Panel from Admin is a cycle, which the boundary guard forbids
 * and is right to.
 */
export function Panel({
  title,
  note,
  children,
  footer,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card pad={0} style={{ overflow: 'hidden' }}>
      <div style={{ padding: '15px 18px 13px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        {note && (
          <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 3, lineHeight: 1.55 }}>
            {note}
          </div>
        )}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
      {footer && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '13px 18px',
            borderTop: '1px solid var(--line)',
            background: 'var(--rail)',
          }}
        >
          {footer}
        </div>
      )}
    </Card>
  );
}
