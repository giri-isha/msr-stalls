import { useState } from 'react';
import { PRIVILEGE_CATEGORIES, type RoleDetail, type RoleSummary, RequestType } from '@msr/stalls';
import * as api from '../api';
import { Panel } from '../components/Panel';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Checkbox,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  Icon,
  Input,
  Loading,
  Select,
  Tag,
  Toolbar,
  useToast,
} from '../ui';

/**
 * Admin → Roles. Where "without a deploy" actually arrives.
 *
 * ⚠️ **Two halves, and only one of them is editable here.** The privilege
 * VOCABULARY is code — a privilege means nothing unless a route enforces it, so
 * it ships in `PRIVILEGE_CATEGORIES` and this screen only ever lists it. What is
 * authored is the COMPOSITION: which privileges a role bundles, where it sits in
 * the hierarchy, and which requester types it reaches.
 *
 * ⚠️ **The screen is not the boundary.** A role may not be given a privilege its
 * author does not hold, because whoever composes a role can hand it to
 * themselves. The tick boxes are disabled for those privileges so the rule is
 * visible before Save rather than after — but the guard that enforces it is
 * `assertNoEscalation` on the server, and this is only a courtesy in front of it.
 */
export function Roles({ writable }: { writable: boolean }) {
  const list = useLoad(() => api.listRoles(), []);
  const [editing, setEditing] = useState<RoleDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const open = async (roleKey: string) => {
    try {
      setEditing(await api.getRole(roleKey));
    } catch (e) {
      toast.fail(e);
    }
  };

  const roles = list.data?.roles ?? [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title='Roles'
        note='What each role may do, and who sits under whom. A role you cannot hand out is one you cannot edit.'
      >
        {writable && (
          <Toolbar>
            <Btn kind='primary' onClick={() => setAdding(true)}>
              <Icon name='plus' size={14} /> Add a role
            </Btn>
          </Toolbar>
        )}

        {list.loading && <Loading />}
        {list.error && <ErrorBox>{list.error.message}</ErrorBox>}
        {!list.loading && roles.length === 0 && <Empty>No roles yet.</Empty>}

        <div style={{ display: 'grid', gap: 2, marginTop: 10 }}>
          {roles.map((r) => (
            <RoleRow
              key={r.roleKey}
              role={r}
              // Indented by the depth the server derived from the tree, so the
              // shape of the hierarchy is readable without a second request.
              writable={writable}
              onOpen={() => open(r.roleKey)}
            />
          ))}
        </div>
      </Panel>

      {adding && (
        <RoleDialog
          roles={roles}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      )}

      {editing && (
        <RoleDialog
          roles={roles}
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function RoleRow({
  role,
  writable,
  onOpen,
}: {
  role: RoleSummary;
  writable: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 10px',
        marginLeft: role.depth * 22,
        borderRadius: 'var(--r2)',
        background: 'var(--mut)',
        fontSize: 12.5,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{role.name}</span>
          {role.isSystem && (
            <Tag size='sm' tone='neutral'>
              Ships with the module
            </Tag>
          )}
          {!role.assignable && (
            <Tag size='sm' tone='warn'>
              Above you
            </Tag>
          )}
        </div>
        <div style={{ color: 'var(--mfg)', marginTop: 2 }}>{role.description}</div>
      </div>
      {writable && (
        <Btn onClick={onOpen} disabled={!role.assignable}>
          Edit
        </Btn>
      )}
    </div>
  );
}

/** The line of explanation under a field. `Field` itself carries a label and
 *  nothing else, and these rules need saying where they are being applied. */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 4, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

/** The blank a new role starts from. */
const EMPTY = {
  roleKey: '',
  name: '',
  description: '',
  parentKey: null as string | null,
  privileges: [] as string[],
  allPrivileges: false,
  canAssignSameLevel: false,
  requestTypeScope: [] as string[],
};

function RoleDialog({
  roles,
  existing,
  onClose,
  onSaved,
}: {
  roles: RoleSummary[];
  existing?: RoleDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { can } = useMe();
  const [form, setForm] = useState(existing ? { ...EMPTY, ...existing } : EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggle = (code: string) =>
    set(
      'privileges',
      form.privileges.includes(code)
        ? form.privileges.filter((c) => c !== code)
        : [...form.privileges, code],
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      description: form.description,
      parentKey: form.parentKey,
      privileges: form.privileges,
      allPrivileges: form.allPrivileges,
      canAssignSameLevel: form.canAssignSameLevel,
      requestTypeScope: form.requestTypeScope,
    };
    try {
      if (existing) await api.saveRole(existing.roleKey, body);
      else await api.createRole({ ...body, roleKey: form.roleKey });
      toast.ok('Saved');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteRole(existing.roleKey);
      toast.ok('Deleted');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={existing ? `Edit ${existing.name}` : 'Add a role'}
      note='Privileges are fixed by the module; which of them a role carries is yours to set.'
      onClose={onClose}
      footer={
        <>
          {/* A shipped role cannot go — the seed would put it straight back —
              and neither can one people still hold. */}
          {existing && !existing.isSystem && (
            <Btn kind='danger' onClick={remove} disabled={saving || existing.grantCount > 0}>
              Delete
            </Btn>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={save} disabled={saving || !form.name.trim()}>
            Save
          </Btn>
        </>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}

      <div style={{ display: 'grid', gap: 10 }}>
        {!existing && (
          <Field label='Key'>
            <Input
              value={form.roleKey}
              onChange={(e) => set('roleKey', e.target.value)}
              placeholder='bay_marshal'
            />
            <Hint>Lowercase letters, digits and underscores. Never changes again.</Hint>
          </Field>
        )}

        <Field label='Name'>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>

        <Field label='Description'>
          <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <Field label='Sits under'>
          <Select
            value={form.parentKey ?? ''}
            onChange={(e) => set('parentKey', e.target.value || null)}
          >
            <option value=''>Nobody — a role at the top</option>
            {roles
              .filter((r) => r.roleKey !== existing?.roleKey)
              .map((r) => (
                <option key={r.roleKey} value={r.roleKey}>
                  {'— '.repeat(r.depth)}
                  {r.name}
                </option>
              ))}
          </Select>
          <Hint>Whoever holds the parent role can hand this one out.</Hint>
        </Field>

        <Field label='May hand out its own role'>
          <Checkbox
            id='same-level'
            checked={form.canAssignSameLevel}
            onChange={(e) => set('canAssignSameLevel', e.target.checked)}
          />
          <Hint>A promotion. Off for every role but Admin.</Hint>
        </Field>

        {/* 🔴 Scope UNIONS across the roles a person holds, so a narrow role can
            never take access away from a broad one — it can only be the only
            thing somebody holds. Ticking nothing means every type. */}
        <Field label='Requester types'>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {RequestType.options.map((t) => (
              <label key={t} htmlFor={`type-${t}`} style={{ display: 'flex', gap: 5 }}>
                <Checkbox
                  id={`type-${t}`}
                  checked={form.requestTypeScope.includes(t)}
                  onChange={() =>
                    set(
                      'requestTypeScope',
                      form.requestTypeScope.includes(t)
                        ? form.requestTypeScope.filter((x) => x !== t)
                        : [...form.requestTypeScope, t],
                    )
                  }
                />
                <span style={{ fontSize: 12 }}>{t}</span>
              </label>
            ))}
          </div>
          <Hint>
            Tick none for every type. Somebody holding two roles reaches the union of both.
          </Hint>
        </Field>

        <Field label='Everything, including privileges added later'>
          <Checkbox
            id='all-privileges'
            checked={form.allPrivileges}
            onChange={(e) => set('allPrivileges', e.target.checked)}
          />
          <Hint>Only somebody who already holds every privilege can set this.</Hint>
        </Field>

        {/* A role carrying the flag holds no explicit privileges — the flag
            resolves against the live table, so listing them too would be two
            answers to one question. */}
        {!form.allPrivileges &&
          PRIVILEGE_CATEGORIES.map((category) => (
            <div key={category.key}>
              <div style={{ fontSize: 12.5, fontWeight: 700, margin: '6px 0 4px' }}>
                {category.name}
              </div>
              <div style={{ display: 'grid', gap: 2 }}>
                {category.items.map((item) => (
                  <label
                    key={item.code}
                    htmlFor={`priv-${item.code}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 9,
                      padding: '6px 4px',
                      cursor: 'pointer',
                    }}
                  >
                    {/* 🔴 Disabled, not hidden. A role may not carry a
                        privilege its author does not hold — whoever composes a
                        role can hand it to themselves — and showing the box
                        greyed says why the vocabulary is larger than the reach.
                        The guard that MATTERS is `assertNoEscalation` on the
                        server; this only saves a round trip to be told. */}
                    <Checkbox
                      id={`priv-${item.code}`}
                      checked={form.privileges.includes(item.code)}
                      disabled={!can(item.code)}
                      onChange={() => toggle(item.code)}
                    />
                    <span>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</span>
                      {item.kind === 'sensitive' && (
                        <span style={{ marginLeft: 6 }}>
                          <Tag size='sm' tone='warn'>
                            Sensitive
                          </Tag>
                        </span>
                      )}
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: 'var(--mfg)',
                          marginTop: 1,
                        }}
                      >
                        {item.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
      </div>
    </Dialog>
  );
}
