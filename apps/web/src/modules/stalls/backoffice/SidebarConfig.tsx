// Configs › Sidebar Layout — which links each role sees, under which heading,
// and in what order.
//
// A role is edited as one ordered list per heading, because the sidebar IS one
// ordered list: the headings are blocks inside it, and their order is the order
// their items appear. That is why moving a heading moves its whole block rather
// than writing a separate number somewhere.
//
// ⚠️ Items the role has no privilege for are not in the list at all — the server
// omits them, so the screen never offers a toggle that could not work.
import { useEffect, useMemo, useState } from 'react';
import type { NavConfigItem } from '@stalls/core';
import * as api from '../api';
import { useLoad } from '../hooks';
import { useMe } from '../me';
import {
  Btn,
  Card,
  Dialog,
  DialogButtons,
  Empty,
  ErrorBox,
  Field,
  IconBtn,
  Input,
  Loading,
  Select,
  Tag,
  useToast,
} from '../ui';
import { RoleBar, layoutRow, moveAt, SavedMark } from './layout-config-parts';

type Dlg = { kind: 'add' } | { kind: 'rename'; key: string; label: string };

export function SidebarConfig() {
  const { can } = useMe();
  const writable = can('config.write');
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(api.getNavConfig);

  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<NavConfigItem[]>([]);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const roles = data?.roles ?? [];
  const categories = data?.categories ?? [];
  const role = useMemo(
    () => roles.find((r) => r.roleKey === roleKey) ?? roles[0] ?? null,
    [roles, roleKey],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-seeds on identity change; the autofix would re-seed on every edit
  useEffect(() => {
    setDraft(role ? role.items.map((i) => ({ ...i })) : []);
  }, [role?.roleKey, data]);

  /**
   * The heading blocks, in the order their items appear.
   *
   * Headings nothing is assigned to still list, so an admin has somewhere to
   * move items TO — and so a heading they have just created is visible before it
   * holds anything.
   */
  const blocks = useMemo(() => {
    const order: string[] = [];
    for (const i of draft) if (!order.includes(i.category)) order.push(i.category);
    for (const c of categories) if (!order.includes(c.key)) order.push(c.key);
    return order.map((key) => ({
      key,
      label: categories.find((c) => c.key === key)?.label ?? key,
      builtIn: categories.find((c) => c.key === key)?.builtIn ?? true,
      items: draft.filter((i) => i.category === key),
    }));
  }, [draft, categories]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox>{error.message}</ErrorBox>;
  if (!role) return <Empty>There are no roles you can configure.</Empty>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(role.items);
  const shown = draft.filter((i) => i.shown).length;

  /** Rebuilds the flat draft from the block order, keeping each block together.
   *
   *  🔴 This is the whole reason the draft is flat and the blocks are derived. A
   *  sidebar is ONE ordered list on the wire, and heading order is the order
   *  headings first appear in it — so a second array of heading positions could
   *  contradict the item order, and one of the two would have to lose. */
  const flatten = (order: Array<{ items: NavConfigItem[] }>) =>
    setDraft(order.flatMap((b) => b.items));

  const moveItem = (block: string, index: number, delta: -1 | 1) => {
    const next = blocks.map((b) =>
      b.key === block ? { ...b, items: moveAt(b.items, index, delta) } : b,
    );
    flatten(next);
  };

  /** Moving a block moves it past the next block that HAS items — an empty one
   *  in between would swallow the move and look like nothing happened. */
  const moveBlock = (key: string, delta: -1 | 1) => {
    const filled = blocks.filter((b) => b.items.length > 0);
    const at = filled.findIndex((b) => b.key === key);
    if (at < 0) return;
    flatten(moveAt(filled, at, delta));
  };

  /** Moves one link into another heading.
   *
   *  ⚠️ Re-flattened against the HEADING ORDER ON SCREEN, not against the moved
   *  list's own first-appearance order. Those differ, and the difference is
   *  visible: the naive version put the destination heading wherever the moved
   *  item happened to sit, so dragging the top link into the bottom heading
   *  jumped that whole heading to the top of the sidebar. */
  const setCategory = (itemKey: string, category: string) => {
    const order = blocks.map((b) => b.key);
    setDraft((d) => {
      const moved = d.map((i) => (i.key === itemKey ? { ...i, category } : i));
      return order.flatMap((c) => moved.filter((i) => i.category === c));
    });
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.saveNavLayout(role.roleKey, {
        items: draft.map((i) => ({ key: i.key, category: i.category, shown: i.shown })),
      });
      toast.ok(`${role.name}'s sidebar saved`);
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusy(false);
    }
  };

  const runHeading = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.ok(what);
      setDlg(null);
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
        note={
          role.configured
            ? `${shown} of ${draft.length} links shown`
            : `Not arranged — showing all ${draft.length} links this role can open`
        }
        actions={
          <>
            {dirty && <SavedMark />}
            <Btn
              onClick={() => {
                setLabel('');
                setDlg({ kind: 'add' });
              }}
              disabled={!writable || busy}
            >
              Add Heading
            </Btn>
            <Btn kind='primary' onClick={save} disabled={!writable || !dirty || busy}>
              Save
            </Btn>
          </>
        }
      />

      {draft.length === 0 ? (
        <Empty>This role's privileges do not reach any screen.</Empty>
      ) : (
        blocks.map((block, bi) => (
          <div key={block.key} style={{ marginBottom: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 7,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '.9px',
                  textTransform: 'uppercase',
                  color: 'var(--mfg)',
                }}
              >
                {block.label}
              </span>
              {block.items.length === 0 && (
                <Tag tone='neutral' size='sm'>
                  empty
                </Tag>
              )}
              <div style={{ flex: 1 }} />
              <IconBtn
                glyph='chevron-up'
                label={`Move ${block.label} up`}
                disabled={!writable || bi === 0 || block.items.length === 0}
                onClick={() => moveBlock(block.key, -1)}
              />
              <IconBtn
                glyph='chevron-down'
                label={`Move ${block.label} down`}
                disabled={!writable || block.items.length === 0}
                onClick={() => moveBlock(block.key, 1)}
              />
              <IconBtn
                glyph='pencil'
                label={`Rename ${block.label}`}
                disabled={!writable}
                onClick={() => {
                  setLabel(block.label);
                  setDlg({ kind: 'rename', key: block.key, label: block.label });
                }}
              />
              {/* ⚠️ Only a heading an admin ADDED can be deleted. A built-in is
                  in the registry, which would put it straight back on the next
                  read — the delete would appear to work and change nothing. */}
              {!block.builtIn && (
                <IconBtn
                  glyph='trash'
                  label={`Delete ${block.label}`}
                  tone='var(--des)'
                  disabled={!writable || block.items.length > 0}
                  onClick={() =>
                    runHeading(`${block.label} removed`, () => api.deleteNavHeading(block.key))
                  }
                />
              )}
            </div>

            {block.items.length > 0 && (
              <Card pad={0}>
                {block.items.map((item, i) => (
                  <div key={item.key} style={layoutRow(i === 0)}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{item.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 2 }}>
                        {item.meta}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                      <IconBtn
                        glyph='chevron-up'
                        label={`Move ${item.label} up`}
                        disabled={!writable || i === 0}
                        onClick={() => moveItem(block.key, i, -1)}
                      />
                      <IconBtn
                        glyph='chevron-down'
                        label={`Move ${item.label} down`}
                        disabled={!writable || i === block.items.length - 1}
                        onClick={() => moveItem(block.key, i, 1)}
                      />
                      <Select
                        value={item.category}
                        onChange={(v) => setCategory(item.key, v)}
                        disabled={!writable}
                        style={{ width: 'auto', minWidth: 150 }}
                        aria-label={`Heading for ${item.label}`}
                      >
                        {categories.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                      <Select
                        value={item.shown ? 'shown' : 'hidden'}
                        onChange={(v) =>
                          setDraft((d) =>
                            d.map((x) => (x.key === item.key ? { ...x, shown: v === 'shown' } : x)),
                          )
                        }
                        disabled={!writable}
                        style={{ width: 'auto', minWidth: 104 }}
                        aria-label={`${item.label} visibility`}
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
        ))
      )}

      {dlg && (
        <Dialog
          title={dlg.kind === 'add' ? 'Add a heading' : 'Rename heading'}
          // A heading is the sidebar's own vocabulary, not one role's — every
          // role's rows point at its key, so renaming one renames it everywhere.
          // Said out loud, because the control that opened this box sits under a
          // role picker and the obvious reading is the wrong one.
          note={`Headings are shared by every role, not just ${role.name}.`}
          onClose={() => setDlg(null)}
          footer={
            <DialogButtons
              onClose={() => setDlg(null)}
              save={dlg.kind === 'add' ? 'Create' : 'Save'}
              disabled={busy || label.trim().length === 0}
              onSave={() =>
                runHeading(dlg.kind === 'add' ? 'Heading added' : 'Heading renamed', () =>
                  dlg.kind === 'add'
                    ? api.addNavHeading(label.trim())
                    : api.renameNavHeading(dlg.key, label.trim()),
                )
              }
            />
          }
        >
          <Field label='Heading'>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={40}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the box exists
              // to take one word; anything else is a click the admin has to make
              // before they can type it.
              autoFocus
            />
          </Field>
        </Dialog>
      )}
    </div>
  );
}
