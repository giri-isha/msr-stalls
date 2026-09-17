// Configs › Home Page — which cards each role lands on, and in what order.
//
// A role is edited as one ordered list, because the home page IS one ordered
// list: the cards pack into rows in the order they are given, so moving a card
// up is the whole of "put this higher".
//
// ⚠️ Cards the role has no privilege for are not in the list at all — the server
// omits them, so the screen never offers a toggle that could not work.
import { useEffect, useMemo, useState } from 'react';
import type { HomeConfigWidget } from '@stalls/core';
import * as api from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import { Btn, Card, Empty, ErrorBox, IconBtn, Loading, Select, Tag, useToast } from '../ui';
import { RoleBar, layoutRow, moveAt, SavedMark } from './layout-config-parts';

export function HomeConfig() {
  const { can } = useMe();
  const writable = can('config.write');
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(api.getHomeConfig);

  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<HomeConfigWidget[]>([]);
  const [busy, setBusy] = useState(false);

  const roles = data?.roles ?? [];
  const role = useMemo(
    () => roles.find((r) => r.roleKey === roleKey) ?? roles[0] ?? null,
    [roles, roleKey],
  );

  // The draft follows the selected role and is replaced outright on every
  // switch — carrying half of one role's ordering onto another would be a quiet
  // way to save the wrong thing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seeds on identity change; the autofix would re-seed on every keystroke
  useEffect(() => {
    setDraft(role ? role.items.map((i) => ({ ...i })) : []);
  }, [role?.roleKey, data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;
  if (!role) return <Empty>There are no roles you can configure.</Empty>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(role.items);
  const shown = draft.filter((w) => w.shown).length;

  const save = async () => {
    setBusy(true);
    try {
      await api.saveHomeLayout(role.roleKey, {
        widgets: draft.map((w) => ({ key: w.key, shown: w.shown })),
      });
      toast.ok(`${role.name}'s home page saved`);
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <RoleBar
        roles={roles}
        active={role.roleKey}
        onPick={setRoleKey}
        // ⚠️ Says whether this is a CHOICE or a default. A role with no rows
        // opens with everything on, which looks identical to somebody having
        // ticked everything — and an admin who cannot tell them apart will
        // "fix" a home page that was never arranged.
        note={
          role.configured
            ? `${shown} of ${draft.length} cards shown`
            : `Not arranged — showing all ${draft.length} cards this role can read`
        }
        actions={
          <>
            {dirty && <SavedMark />}
            <Btn kind='primary' onClick={save} disabled={!writable || !dirty || busy}>
              Save
            </Btn>
          </>
        }
      />

      {draft.length === 0 ? (
        <Empty>This role's privileges do not reach any home card.</Empty>
      ) : (
        <Card pad={0}>
          {draft.map((w, i) => (
            <div key={w.key} style={layoutRow(i === 0)}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{w.label}</span>
                  <Tag tone='neutral' size='sm'>
                    {w.span}
                  </Tag>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>
                  {w.description}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                <IconBtn
                  glyph='chevron-up'
                  label={`Move ${w.label} up`}
                  disabled={!writable || i === 0}
                  onClick={() => setDraft((d) => moveAt(d, i, -1))}
                />
                <IconBtn
                  glyph='chevron-down'
                  label={`Move ${w.label} down`}
                  disabled={!writable || i === draft.length - 1}
                  onClick={() => setDraft((d) => moveAt(d, i, 1))}
                />
                {/* A select rather than a checkbox: "Shown" and "Hidden" are
                    the two states in words, and a bare tick in a list of nine
                    rows needs its own column heading to mean anything. */}
                <Select
                  value={w.shown ? 'shown' : 'hidden'}
                  onChange={(v) =>
                    setDraft((d) =>
                      d.map((x) => (x.key === w.key ? { ...x, shown: v === 'shown' } : x)),
                    )
                  }
                  disabled={!writable}
                  style={{ width: 'auto', minWidth: 104 }}
                  aria-label={`${w.label} visibility`}
                >
                  <option value='shown'>Shown</option>
                  <option value='hidden'>Hidden</option>
                </Select>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
