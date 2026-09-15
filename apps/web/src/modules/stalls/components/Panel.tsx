import type * as React from 'react';
import { Card } from '../ui';

/**
 * A titled panel.
 *
 * The reference system has no Card header component — its screens draw their
 * own — so this is that pattern, once, rather than eight times down Admin.
 *
 * ⚠️ Its own file rather than Admin's, because the Users directory moved out
 * into `backoffice/Users.tsx` and needs the same panel. Admin importing Users while
 * Users imported Panel from Admin is a cycle, which the boundary guard forbids
 * and is right to.
 */
export function Panel({
  title,
  note,
  children,
  footer,
  actions,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * What the panel does as a whole — in practice the "Add …" that opens the
   * creation dialog.
   *
   * ⚠️ In the HEADER, not the footer. The footer is where a form's Save lives,
   * and the panels that have both would otherwise put "Add a bay" next to
   * "Save settings" as though the two were the same kind of thing. Add makes a
   * new record; Save commits the one already open.
   */
  actions?: React.ReactNode;
}) {
  return (
    <Card pad={0} style={{ overflow: 'hidden' }}>
      <div
        style={{
          padding: '15px 18px 13px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          // Wraps rather than shrinks: on a phone the action drops under the
          // title instead of squeezing it to one word per line.
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          {note && (
            <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 3, lineHeight: 1.55 }}>
              {note}
            </div>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flex: 'none' }}>{actions}</div>}
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
