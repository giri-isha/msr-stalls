import { Icon } from '../icons';
import type { ListView } from '../useListView';

/**
 * Rows or tiles, as one segmented control on the card plate.
 *
 * Paired with `useListView`, which decides what it opens on. This draws the
 * choice and nothing else.
 *
 * ⚠️ `aria-pressed`, not a variant swap. Which shape is showing is carried by
 * the primary tint, and a tint is information only a sighted reader gets —
 * the same reason `Chip` and the Flagged filter announce their state.
 */
export function ViewToggle({
  view,
  onChange,
}: {
  view: ListView;
  onChange: (v: ListView) => void;
}) {
  return (
    <div
      role='group'
      aria-label='List shape'
      style={{
        display: 'flex',
        gap: 2,
        padding: 2,
        borderRadius: 'var(--r2)',
        border: '1px solid var(--bd)',
        background: 'var(--card)',
        flex: 'none',
      }}
    >
      <ViewBtn
        on={view === 'table'}
        label='Table view'
        glyph='list-view'
        onClick={() => onChange('table')}
      />
      <ViewBtn
        on={view === 'cards'}
        label='Card view'
        glyph='layout-grid'
        onClick={() => onChange('cards')}
      />
    </div>
  );
}

function ViewBtn({
  on,
  label,
  glyph,
  onClick,
}: {
  on: boolean;
  label: string;
  glyph: string;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 28,
        borderRadius: 'var(--r)',
        border: 0,
        background: on ? 'var(--pri-t)' : 'transparent',
        color: on ? 'var(--pri)' : 'var(--mfg)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <Icon name={glyph} size={15} />
    </button>
  );
}
