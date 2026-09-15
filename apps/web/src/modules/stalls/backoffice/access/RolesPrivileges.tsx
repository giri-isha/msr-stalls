import { useState } from 'react';
import type { RoleDetail, RoleSummary } from '@msr/stalls';
import * as api from '../../api';
import { useLoad } from '../../hooks';
import { useMe } from '../../me';
import {
  Btn,
  Empty,
  ErrorBox,
  H1,
  Icon,
  Loading,
  Search,
  Tag,
  toolBtnStyle,
  useToast,
} from '../../ui';
import { RoleCard } from './RoleCard';
import { RoleDialog } from './RoleDialog';
import { Privileges } from './Privileges';

const TABS = [
  { label: 'Roles', glyph: 'shield' },
  { label: 'Privileges', glyph: 'key' },
] as const;
type Tab = (typeof TABS)[number]['label'];

/**
 * Access → Roles & Privileges.
 *
 * ⚠️ **Two tabs, and only one of them writes.** Roles are DATA: which
 * privileges one bundles, where it sits in the tree and which requester types it
 * reaches are all authored here, which is what "without a deploy" means. The
 * privilege vocabulary beside it is CODE — a privilege means nothing unless a
 * route enforces it — so that tab only ever lists what exists. The asymmetry is
 * the point of the screen, not an unfinished half of it.
 */
export function RolesPrivileges() {
  const { can } = useMe();
  const toast = useToast();
  const writable = can('roles.write');

  const [tab, setTab] = useState<Tab>('Roles');
  const [q, setQ] = useState('');
  const [tree, setTree] = useState(false);
  const [editing, setEditing] = useState<RoleDetail | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useLoad(() => api.listRoles(), []);
  const catalogue = useLoad(() => api.listPrivileges(), []);

  const roles = list.data?.roles ?? [];
  const privileges = catalogue.data?.privileges ?? [];
  const nameOf = (roleKey: string | null) =>
    roleKey ? (roles.find((r) => r.roleKey === roleKey)?.name ?? roleKey) : null;

  const open = async (roleKey: string) => {
    try {
      setEditing(await api.getRole(roleKey));
    } catch (e) {
      toast.fail(e);
    }
  };

  const remove = async (role: RoleSummary) => {
    try {
      await api.deleteRole(role.roleKey);
      toast.ok(`${role.name} deleted`);
      list.reload();
    } catch (e) {
      toast.fail(e);
    }
  };

  const needle = q.trim().toLowerCase();
  const shown = roles.filter(
    (r) =>
      !needle ||
      r.name.toLowerCase().includes(needle) ||
      r.description.toLowerCase().includes(needle),
  );

  return (
    <div>
      <H1
        icon={<Icon name='shield' size={18} />}
        sub='What each role may do, and who sits under whom. A role you cannot hand out is one you cannot edit.'
      >
        Roles &amp; Privileges
      </H1>

      {/* Tabs on the shared control skin rather than an underlined rail — the
          one look a chosen control wears across the product, as on Admin. */}
      <div
        style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}
        role='tablist'
        aria-label='Access sections'
      >
        {TABS.map((t) => (
          <button
            key={t.label}
            type='button'
            role='tab'
            aria-selected={tab === t.label}
            onClick={() => setTab(t.label)}
            style={toolBtnStyle(tab === t.label)}
          >
            <Icon name={t.glyph} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'Roles' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Search label='Search roles' value={q} onChange={setQ} placeholder='Search roles…' />
            </div>
            <button type='button' onClick={() => setTree(!tree)} style={toolBtnStyle(tree)}>
              <Icon name='layers' size={14} />
              Hierarchy
            </button>
            {writable && (
              <Btn kind='primary' onClick={() => setAdding(true)}>
                <Icon name='plus' size={14} />
                Add role
              </Btn>
            )}
          </div>

          {list.loading && <Loading />}
          {list.error && <ErrorBox>{list.error.message}</ErrorBox>}
          {!list.loading && shown.length === 0 && <Empty>No role matches that.</Empty>}

          {!list.loading &&
            shown.length > 0 &&
            (tree ? (
              <RoleTree roles={shown} />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
                  gap: 14,
                }}
              >
                {shown.map((r) => (
                  <RoleCard
                    key={r.roleKey}
                    role={r}
                    parentName={nameOf(r.parentKey)}
                    writable={writable}
                    onEdit={() => open(r.roleKey)}
                    onDelete={() => remove(r)}
                  />
                ))}
              </div>
            ))}
        </div>
      )}

      {tab === 'Privileges' && (
        <>
          {catalogue.loading && <Loading />}
          {catalogue.error && <ErrorBox>{catalogue.error.message}</ErrorBox>}
          {!catalogue.loading && <Privileges catalogue={privileges} />}
        </>
      )}

      {(adding || editing) && (
        <RoleDialog
          roles={roles}
          catalogue={privileges}
          existing={editing ?? undefined}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

/**
 * The same roles as a tree.
 *
 * ⚠️ Indented by the LEVEL each role carries, which an admin typed. It is a
 * label rather than a walk of the parent chain, so this view shows the ranks
 * somebody meant — including two siblings deliberately ranked apart.
 *
 * ⚠️ A LIST, not `role='tree'`. These rows carry no action: the editor opens
 * from the card grid, and a tree whose items cannot be focused or expanded
 * announces an interaction that is not there. Depth is carried by the visible
 * "Level n" beside each name rather than by the indent alone, so a reader who
 * never sees the margin still gets the shape.
 */
function RoleTree({ roles }: { roles: RoleSummary[] }) {
  return (
    <ul
      aria-label='Role hierarchy'
      style={{ display: 'grid', gap: 2, listStyle: 'none', margin: 0, padding: 0 }}
    >
      {roles.map((r) => (
        <li
          key={r.roleKey}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 10px',
            marginLeft: r.level * 22,
            borderRadius: 'var(--r2)',
            background: 'var(--mut)',
            fontSize: 12.5,
          }}
        >
          <Icon name='shield' size={14} />
          <span style={{ fontWeight: 600 }}>{r.name}</span>
          <span style={{ color: 'var(--mfg)' }}>Level {r.level}</span>
          {!r.assignable && (
            <Tag size='sm' tone='warn'>
              Above you
            </Tag>
          )}
        </li>
      ))}
    </ul>
  );
}
