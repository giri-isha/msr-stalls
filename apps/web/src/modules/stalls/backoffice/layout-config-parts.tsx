// The pieces Configs › Home Page and Configs › Sidebar Layout both use.
//
// Two screens, the same shape: pick a role, reorder a list, say whether each row
// shows, save the lot. Rather than one component with a `kind` prop branching
// nine times — the two lists differ in what a row IS and in whether rows are
// grouped, which is most of each screen — what is shared is the chrome and the
// two-line list algebra, and each screen draws its own rows.
import type { ReactNode } from 'react';
import { Icon, Select, Tag } from '../ui';

/** Moves one item by one place. Returns a NEW array — both screens hold their
 *  draft in state, and mutating it in place would not re-render. */
export function moveAt<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const out = [...list];
  const [item] = out.splice(index, 1);
  // `index` is in range — the bounds check above covers `to`, and a caller only
  // ever passes an index it drew a row for.
  if (item === undefined) return list;
  out.splice(to, 0, item);
  return out;
}

/** The role being arranged, what state its layout is in, and the Save button.
 *
 *  ⚠️ The roles offered are the ones the CALLER MAY EDIT — the server filters
 *  them by the same hierarchy the Users and Roles screens use. An admin who
 *  cannot edit a role has no business deciding what its holders open on. */
export function RoleBar({
  roles,
  active,
  onPick,
  note,
  actions,
}: {
  roles: Array<{ roleKey: string; name: string; level: number; configured: boolean }>;
  active: string;
  onPick: (roleKey: string) => void;
  note: string;
  actions: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        margin: '4px 0 14px',
      }}
    >
      <label htmlFor='layout-role' style={{ fontSize: 12.5, color: 'var(--mfg)' }}>
        Role
      </label>
      <Select
        id='layout-role'
        value={active}
        onChange={onPick}
        style={{ width: 'auto', minWidth: 210 }}
      >
        {roles.map((r) => (
          <option key={r.roleKey} value={r.roleKey}>
            {r.name}
            {r.configured ? '' : ' — not arranged'}
          </option>
        ))}
      </Select>

      <span style={{ fontSize: 12, color: 'var(--mfg)' }}>{note}</span>

      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>
    </div>
  );
}

/** "You have not saved this yet."
 *
 *  ⚠️ Words, not a coloured dot. Both screens are arranged by moving rows around,
 *  which looks like it took effect the moment it moved — the one thing an admin
 *  needs told here is that it has not. */
export function SavedMark() {
  return (
    <Tag tone='warn' size='sm'>
      <Icon name='alert-triangle' size={12} /> Unsaved
    </Tag>
  );
}

/** One row of either list. `first` drops the top rule so the card's own edge
 *  does not read as a doubled line. */
export const layoutRow = (first: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '11px 14px',
  borderTop: first ? undefined : '1px solid var(--line)',
  minWidth: 0,
});
