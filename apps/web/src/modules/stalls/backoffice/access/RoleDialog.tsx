import { useState } from 'react';
import {
  type PrivilegeCatalogEntry,
  RequestType,
  type RoleDetail,
  type RoleSummary,
  type StallPrivilege,
} from '@stalls/core';
import * as api from '../../api';
import { useMe } from '../../me';
import {
  Btn,
  Checkbox,
  Dialog,
  ErrorBox,
  FormField,
  Icon,
  Input,
  Select,
  useToast,
} from '../../ui';
import { PrivilegeTree } from './PrivilegeTree';
import { requestTypeLabel } from './catalogue';

/** The line of explanation under a field. `FormField` carries a label and a
 *  help line; these rules need saying where they are being applied. */
function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 4, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

/** A titled block inside the dialog, at the rhythm the screenshots use. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 12,
        borderRadius: 'var(--r2)',
        background: 'var(--mut)',
        display: 'grid',
        gap: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.6px',
          textTransform: 'uppercase',
          color: 'var(--mfg)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

const EMPTY = {
  roleKey: '',
  name: '',
  description: '',
  parentKey: null as string | null,
  // Not 0. A new role opening at the top of the tree, beside Admin, is the one
  // default that reads as a claim — 2 is where the shipped operational roles
  // sit and where a new one usually belongs.
  level: 2,
  privileges: [] as string[],
  allPrivileges: false,
  canAssignSameLevel: false,
  requestTypeScope: [] as string[],
};

/**
 * Composing a role.
 *
 * ⚠️ **Two halves, and only one of them is editable here.** The privilege
 * VOCABULARY is code — a privilege means nothing unless a route enforces it —
 * so this screen only ever lists it. What is authored is the COMPOSITION: which
 * privileges a role bundles, where it sits in the hierarchy, and which requester
 * types it reaches.
 *
 * ⚠️ **The level is typed, and the parent is separate.** They can disagree, and
 * that is deliberate: the number is a label the card and the picker draw, while
 * who may hand out which role is decided by `parentKey` alone. So a role
 * labelled 0 under Lead is odd-looking and harmless — it reaches exactly what
 * its parent lets it reach.
 */
export function RoleDialog({
  roles,
  catalogue,
  existing,
  onClose,
  onSaved,
}: {
  roles: RoleSummary[];
  catalogue: readonly PrivilegeCatalogEntry[];
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

  /**
   * 🔴 Codes the role holds that the tree does not offer — a privilege retired
   * since the role was composed.
   *
   * `setPrivileges` on the server writes the SET it is sent, so anything the
   * dialog forgets to mention is silently revoked. The tree lists only ACTIVE
   * privileges, which makes a bundled-but-retired code invisible to it; carried
   * here so that saving an unrelated change does not quietly strip a privilege
   * a route may still be enforcing.
   */
  const active = new Set(catalogue.filter((p) => p.isActive).map((p) => p.code));
  const retainedRetired = (existing?.privileges ?? []).filter((code) => !active.has(code));

  const toggle = (code: string) =>
    set(
      'privileges',
      form.privileges.includes(code)
        ? form.privileges.filter((c) => c !== code)
        : [...form.privileges, code],
    );

  const toggleMany = (codes: string[], on: boolean) =>
    set(
      'privileges',
      on
        ? [...new Set([...form.privileges, ...codes])]
        : form.privileges.filter((c) => !codes.includes(c)),
    );

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      description: form.description,
      parentKey: form.parentKey,
      level: form.level,
      privileges: [...new Set([...form.privileges, ...retainedRetired])],
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
      width={640}
      footer={
        <>
          {existing && !existing.isSystem && (
            <Btn kind='danger' onClick={remove} disabled={saving || existing.grantCount > 0}>
              <Icon name='trash' size={14} />
              Delete
            </Btn>
          )}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={save} disabled={saving || !form.name.trim()}>
            <Icon name='check' size={14} />
            Save
          </Btn>
        </>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}

      <div style={{ display: 'grid', gap: 12 }}>
        {!existing && (
          <FormField id='role-key' label='Key'>
            <Input
              id='role-key'
              value={form.roleKey}
              onChange={(e) => set('roleKey', e.target.value)}
              placeholder='bay_marshal'
            />
            <Hint>Lowercase letters, digits and underscores. Never changes again.</Hint>
          </FormField>
        )}

        <FormField id='role-name' label='Name'>
          <Input id='role-name' value={form.name} onChange={(e) => set('name', e.target.value)} />
        </FormField>

        <FormField id='role-description' label='Description'>
          <Input
            id='role-description'
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </FormField>

        {/* 🔴 Scope UNIONS across the roles a person holds, so a narrow role can
            never take access away from a broad one — it can only be the only
            thing somebody holds. Ticking nothing means every type. */}
        <Block title='Data Scope'>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {RequestType.options.map((t) => (
              <label
                key={t}
                htmlFor={`type-${t}`}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}
              >
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
                {requestTypeLabel(t)}
              </label>
            ))}
          </div>
          <Hint>
            Tick none for every requester type. Somebody holding two roles reaches the union of
            both.
          </Hint>
        </Block>

        <Block title='Hierarchy'>
          <FormField id='role-parent' label='Sits Under'>
            <Select
              id='role-parent'
              value={form.parentKey ?? ''}
              onChange={(e) => set('parentKey', e.target.value || null)}
            >
              <option value=''>Nobody — a Role at the Top</option>
              {roles
                .filter((r) => r.roleKey !== existing?.roleKey)
                .map((r) => (
                  <option key={r.roleKey} value={r.roleKey}>
                    {'— '.repeat(r.level)}
                    {r.name}
                  </option>
                ))}
            </Select>
            <Hint>Whoever holds the parent role can hand this one out.</Hint>
          </FormField>

          <FormField id='role-level' label='Level (0 = Highest)'>
            <Input
              id='role-level'
              type='number'
              min={0}
              max={9}
              value={form.level}
              onChange={(e) => set('level', Math.min(9, Math.max(0, Number(e.target.value) || 0)))}
            />
            <Hint>
              0–9, and a label rather than a rule: what a role may hand out comes from the parent
              above, not from this number.
            </Hint>
          </FormField>

          <label
            htmlFor='same-level'
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5 }}
          >
            <Checkbox
              id='same-level'
              checked={form.canAssignSameLevel}
              onChange={(e) => set('canAssignSameLevel', e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Somebody holding this role may hand it out as well as the roles beneath it
              <Hint>A promotion. Off for every role but Admin.</Hint>
            </span>
          </label>
        </Block>

        <Block title='Privileges'>
          <label
            htmlFor='all-privileges'
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5 }}
          >
            <Checkbox
              id='all-privileges'
              checked={form.allPrivileges}
              onChange={(e) => set('allPrivileges', e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Every privilege, including ones added later
              <Hint>
                Granted on the server against the live table, not a tick of every box below. Only
                somebody who already holds every privilege can set this.
              </Hint>
            </span>
          </label>

          {/* A role carrying the flag holds no explicit privileges — the flag
              resolves against the live table, so listing them too would be two
              answers to one question. */}
          {!form.allPrivileges && (
            <PrivilegeTree
              catalogue={catalogue}
              chosen={form.privileges}
              onToggle={toggle}
              onToggleMany={toggleMany}
              // The catalogue is data and `can` is typed against the compiled-in
              // union, so the cast is where the two meet. A code the bundle does
              // not know simply is not held, which is the safe answer.
              held={(code) => can(code as StallPrivilege)}
            />
          )}
        </Block>
      </div>
    </Dialog>
  );
}
