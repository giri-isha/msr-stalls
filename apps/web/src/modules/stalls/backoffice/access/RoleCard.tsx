import type { RoleSummary } from '@msr/stalls';
import { Icon, IconBtn, Tag, card } from '../../ui';
import { scopeLabel } from './catalogue';

/** `1 user`, `2 users` — the count and the noun agreeing, because a card that
 *  says "1 users" is a card nobody proofread. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One role, as a card in the grid.
 *
 * ⚠️ Every number here comes off the ROW the list route sent. The grid draws
 * every role at once, so a card that fetched its own counts on mount would be a
 * request per role for four lines of text.
 */
export function RoleCard({
  role,
  parentName,
  writable,
  onEdit,
  onDelete,
}: {
  role: RoleSummary;
  /** The name of the role above it, resolved by the grid — a card should not
   *  have to know the whole tree to draw one chip. */
  parentName: string | null;
  writable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      // The card's contents are a layout, not a name. Without this the grid
      // announces a dozen unlabelled regions.
      aria-label={role.name}
      style={{ ...card, padding: 16, display: 'grid', gap: 10, alignContent: 'start' }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          aria-hidden
          style={{
            width: 32,
            height: 32,
            flex: 'none',
            borderRadius: 'var(--r2)',
            background: 'var(--mut)',
            color: 'var(--mfg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name='shield' size={16} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{role.name}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            <Tag size='sm' tone={role.requestTypeScope.length === 0 ? 'ok' : 'warn'}>
              {scopeLabel(role.requestTypeScope)}
            </Tag>
            {/* ⚠️ Not a count. The flag resolves against the live table, so the
                role holds no join rows at all and "16 privileges" would be a
                number that goes stale the next time one is added. */}
            {role.allPrivileges && (
              <Tag size='sm' tone='violet'>
                Carries Every Privilege
              </Tag>
            )}
            {role.isSystem && (
              <Tag size='sm' tone='neutral'>
                Ships with the Module
              </Tag>
            )}
            {!role.assignable && (
              <Tag size='sm' tone='warn'>
                Above You
              </Tag>
            )}
          </div>
        </div>

        {writable && (
          <div style={{ display: 'flex', gap: 6 }}>
            <IconBtn
              label={`Edit ${role.name}`}
              glyph='pencil'
              onClick={onEdit}
              disabled={!role.assignable}
            />
            {/* A shipped role has no delete at all — the seed would put it
                straight back — and one people still hold is refused, which the
                disabled button says before it is pressed rather than after. */}
            {!role.isSystem && (
              <IconBtn
                label={`Delete ${role.name}`}
                glyph='trash'
                tone='var(--des)'
                onClick={onDelete}
                disabled={!role.assignable || role.grantCount > 0}
              />
            )}
          </div>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--mfg)', lineHeight: 1.55 }}>
        {role.description}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
          paddingTop: 10,
          borderTop: '1px solid var(--bd)',
          fontSize: 12,
          color: 'var(--mfg)',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name='key' size={13} />
          {plural(role.privilegeCount, 'privilege')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon name='users' size={13} />
          {plural(role.grantCount, 'user')}
        </span>
        <span>Level {role.level}</span>
      </div>

      {parentName && (
        <div>
          <Tag size='sm' tone='neutral' title={`Sits under ${parentName}`}>
            <span aria-hidden>↑ </span>
            <span>{parentName}</span>
          </Tag>
        </div>
      )}
    </article>
  );
}
