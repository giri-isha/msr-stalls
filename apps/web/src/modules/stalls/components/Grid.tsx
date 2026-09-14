import type { CSSProperties, ReactNode } from 'react';
import { Card, Empty, gridMinWidth } from '../ui/ui';
import { RowCard } from '../ui/components/RowCard';
import { useIsMobile } from '../ui/useBreakpoint';

export interface GridColumn<T> {
  key: string;
  header: ReactNode;
  /** A CSS grid track — `1.4fr`, `120px`, `minmax(90px, 1fr)`. */
  width: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
  /** On a phone the row becomes a card and this column becomes a label/value
   *  pair — unless it is the title, the subtitle, or hidden. */
  mobile?: 'title' | 'sub' | 'field' | 'hide';
}

/**
 * The volunteering module's table: a CSS grid with a header rail, rows that
 * highlight when selected, and a card per row below 720px. Carries table
 * roles so assistive tech and the tests read it as a table.
 */
export function Grid<T>({
  columns,
  rows,
  rowKey,
  onRow,
  selectedKey,
  empty = 'Nothing here.',
  actions,
  footer,
}: {
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
  selectedKey?: string | null;
  empty?: ReactNode;
  /** Row actions, rendered in a trailing column on desktop and at the foot of
   *  the card on a phone. */
  actions?: (row: T) => ReactNode;
  footer?: ReactNode;
}) {
  const mobile = useIsMobile();
  const shown = columns.filter((c) => c.mobile !== 'hide' || !mobile);

  if (rows.length === 0) {
    return (
      <Card>
        <Empty>{empty}</Empty>
      </Card>
    );
  }

  if (mobile) {
    const title = columns.find((c) => c.mobile === 'title') ?? columns[0]!;
    const sub = columns.find((c) => c.mobile === 'sub');
    const fields = columns.filter((c) => c !== title && c !== sub && c.mobile !== 'hide');
    return (
      <Card pad={0} style={{ overflow: 'hidden' }}>
        {rows.map((r) => (
          <RowCard
            key={rowKey(r)}
            title={title.render(r)}
            sub={sub?.render(r)}
            fields={fields.map((c) => ({ label: String(c.header), value: c.render(r) }))}
            actions={actions?.(r)}
            onOpen={onRow ? () => onRow(r) : undefined}
            tone={selectedKey === rowKey(r) ? 'var(--pri-t)' : undefined}
          />
        ))}
        {footer}
      </Card>
    );
  }

  const template = [...shown.map((c) => c.width), ...(actions ? ['auto'] : [])].join(' ');
  const cell = (c: GridColumn<T>): CSSProperties => ({
    minWidth: 0,
    textAlign: c.align ?? 'left',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  return (
    <Card pad={0} style={{ overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <div role='table' style={{ minWidth: gridMinWidth(template) }}>
          <div
            role='row'
            style={{
              display: 'grid',
              gridTemplateColumns: template,
              gap: 10,
              padding: '10px 16px',
              borderBottom: '1px solid var(--line)',
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '.6px',
              textTransform: 'uppercase',
              color: 'var(--rail-fg)',
              background: 'var(--rail)',
            }}
          >
            {shown.map((c) => (
              <div key={c.key} role='columnheader' style={cell(c)}>
                {c.header}
              </div>
            ))}
            {actions && (
              <div role='columnheader' style={{ textAlign: 'right' }}>
                Actions
              </div>
            )}
          </div>
          {rows.map((r) => {
            const k = rowKey(r);
            const on = selectedKey === k;
            return (
              <div
                key={k}
                role='row'
                aria-selected={onRow ? on : undefined}
                onClick={onRow ? () => onRow(r) : undefined}
                onKeyDown={
                  onRow
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRow(r);
                        }
                      }
                    : undefined
                }
                tabIndex={onRow ? 0 : undefined}
                className={onRow ? 'msrs-row' : undefined}
                style={{
                  display: 'grid',
                  gridTemplateColumns: template,
                  gap: 10,
                  padding: '11px 16px',
                  borderBottom: '1px solid var(--line)',
                  alignItems: 'center',
                  fontSize: 12.5,
                  color: 'var(--fg)',
                  cursor: onRow ? 'pointer' : undefined,
                  background: on ? 'var(--pri-t)' : undefined,
                }}
              >
                {shown.map((c) => (
                  <div key={c.key} role='cell' style={cell(c)}>
                    {c.render(r)}
                  </div>
                ))}
                {actions && (
                  <div role='cell' style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {actions(r)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {footer}
    </Card>
  );
}

/** A muted secondary line inside a cell. */
export function Sub({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 1 }}>{children}</div>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: 'ui-monospace, "Geist Mono", monospace', fontSize: 12 }}>{children}</span>;
}
