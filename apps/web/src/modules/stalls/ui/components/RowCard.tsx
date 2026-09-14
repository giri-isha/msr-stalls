import type { ReactNode } from 'react';

/**
 * What a table row becomes below 720px.
 *
 * A twelve-column grid has no narrow form. Shrinking it produces columns too
 * thin to read; scrolling it sideways hides the identity column that tells you
 * whose row you are looking at. So the row is re-drawn as a card: who it is on
 * top, the visible columns as label/value pairs beneath, actions at the foot.
 *
 * The `fields` a caller passes are the columns the Columns popover left
 * showing, so hiding a column hides it in both layouts and the two never
 * disagree about what the screen displays.
 */
export function RowCard({
  lead,
  title,
  sub,
  fields,
  actions,
  onOpen,
  tone,
}: {
  /** Avatar or initials tile. */
  lead?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** Column label → cell. Values that are null or '—' are dropped, because a
   *  column of em-dashes is the fastest way to make a card unreadable. */
  fields: { label: string; value: ReactNode }[];
  actions?: ReactNode;
  onOpen?: () => void;
  /** Highlight, e.g. for a selected row. */
  tone?: string;
}) {
  const shown = fields.filter(
    (f) => f.value !== null && f.value !== undefined && f.value !== '—' && f.value !== '',
  );

  return (
    <div style={{ padding: '13px 14px', borderBottom: '1px solid var(--line)', background: tone }}>
      <div
        onClick={onOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: onOpen ? 'pointer' : undefined,
        }}
      >
        {lead}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </div>
          {sub && (
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--mfg)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {sub}
            </div>
          )}
        </div>
      </div>

      {shown.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '5px 12px',
            marginTop: 10,
            fontSize: 12.5,
          }}
        >
          {shown.map((f) => (
            <RowCardField key={f.label} label={f.label}>
              {f.value}
            </RowCardField>
          ))}
        </div>
      )}

      {actions && <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>{actions}</div>}
    </div>
  );
}

function RowCardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '.5px',
          textTransform: 'uppercase',
          color: 'var(--mfg)',
          paddingTop: 2,
        }}
      >
        {label}
      </div>
      <div style={{ minWidth: 0, color: 'var(--fg)' }}>{children}</div>
    </>
  );
}

/**
 * A full-width action button for the foot of a card. Icon-only buttons are a
 * 30px target sat next to another 30px target; on touch they get a label and
 * room to be hit.
 */
export function RowCardAction({
  children,
  onClick,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        minHeight: 40,
        padding: '0 12px',
        borderRadius: 'var(--r3)',
        border: '1px solid var(--bd)',
        background: 'var(--card)',
        color: disabled ? 'var(--mfg)' : 'var(--fg)',
        fontSize: 12.5,
        fontWeight: 600,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}
