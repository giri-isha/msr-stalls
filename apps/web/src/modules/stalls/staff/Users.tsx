import { useState } from 'react';
import {
  type DirectoryUser,
  type DirectoryView,
  type SignInState,
  type RoleSummary,
  isPlaceholderEmail,
} from '@msr/stalls';
import * as api from '../api';
import { Panel } from '../components/Panel';
import { useDebounced, useLoad } from '../hooks';
import {
  Avatar,
  Btn,
  Checkbox,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  Icon,
  IconBtn,
  Input,
  Loading,
  OptionRow,
  Pager,
  PopHeader,
  Popover,
  RowCard,
  Search,
  Select,
  StatTiles,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tag,
  Toolbar,
  type Tone,
  useIsMobile,
  usePageSize,
  useToast,
} from '../ui';

/**
 * Everyone who can reach this module, in one directory.
 *
 * ⚠️ **Two populations, one table, and the difference is not cosmetic.** Staff
 * are Foundation people holding this module's roles; requesters are accounts a
 * public form created. They are kept in separate tables precisely so a vendor
 * can never be granted `config.write` — a requester row has no role at all —
 * appear in one list here changes nothing about that: a requester row has no
 * role to grant and no control that would grant one.
 *
 * ⚠️ **The tiles ARE the view filter.** Their labels are the values the server
 * understands, passed back verbatim by `StatTiles`, so the strings in
 * `DIRECTORY_VIEWS` are a contract and not copy. The counts beside them are
 * narrowed by the search and the Filter popover but never by the active view —
 * the server's doing, and the reason is written where it happens.
 */
/**
 * One axis of a grant's reach.
 *
 * ⚠️ Nothing ticked means EVERYTHING, which is the opposite of how a filter
 * usually reads — so the empty state says so in words rather than leaving the
 * blank row to be guessed at.
 */
function ScopePicker({
  label,
  all,
  options,
  chosen,
  onChange,
}: {
  label: string;
  all: string;
  options: Array<{ value: string; label: string }>;
  chosen: string[];
  onChange: (next: string[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--mfg)' }}>{label}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
        {options.map((o) => (
          <label
            key={o.value}
            htmlFor={`scope-${label}-${o.value}`}
            style={{ display: 'flex', gap: 5 }}
          >
            <Checkbox
              id={`scope-${label}-${o.value}`}
              checked={chosen.includes(o.value)}
              onChange={() =>
                onChange(
                  chosen.includes(o.value)
                    ? chosen.filter((v) => v !== o.value)
                    : [...chosen, o.value],
                )
              }
            />
            <span style={{ fontSize: 12 }}>{o.label}</span>
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 3 }}>
        {chosen.length === 0 ? all : `Limited to ${chosen.length}`}
      </div>
    </div>
  );
}

/**
 * The roles, from the server.
 *
 * ⚠️ This screen used to render its pickers from the `ROLES` constant. That
 * stopped being the truth when roles became data: a role an admin creates is on
 * no list this bundle ships, so a compiled-in copy is not merely stale — it
 * cannot know. Each row also carries `assignable`, computed for THIS caller
 * against the role hierarchy, so a picker never offers a role the grant route
 * is about to refuse.
 */
function useRoles() {
  const { data } = useLoad(() => api.listRoles(), []);
  const roles = data?.roles ?? [];
  return { roles, assignable: roles.filter((r) => r.assignable) };
}

/** The role's name as an admin reads it, falling back to the key.
 *
 *  A grant can name a role this list has not loaded yet, and a half-drawn table
 *  showing a key is better than one showing a blank. */
function roleName(roles: RoleSummary[], roleKey: string): string {
  return roles.find((r) => r.roleKey === roleKey)?.name ?? roleKey;
}

export function Users({ writable }: { writable: boolean }) {
  const toast = useToast();
  const mobile = useIsMobile();
  const { roles } = useRoles();

  const [view, setView] = useState<DirectoryView>('All');
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed);
  const [roleKey, setRoleKey] = useState('');
  const [signInState, setSignInState] = useState<SignInState | ''>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = usePageSize('users');
  const [shown, setShown] = useState<Set<ColKey>>(() => new Set(DEFAULT_COLUMNS));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DirectoryUser | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);

  const query = {
    view,
    q: q || undefined,
    roleKey: roleKey || undefined,
    signInState: signInState || undefined,
    page,
    pageSize,
  };
  const key = JSON.stringify(query);
  const dir = useLoad(() => api.listUsers(query), [key]);

  /** Every narrowing returns to page one. A filter applied on page four
   *  otherwise shows an empty table under a working filter, which reads as
   *  lost rows rather than as a paging slip — the same trap `Pager` documents
   *  for the size select. */
  const narrow = (f: () => void) => {
    f();
    setPage(0);
  };

  const runAsk = async () => {
    if (!ask) return;
    try {
      await ask.run();
      toast.ok(ask.done);
      setAsk(null);
      dir.reload();
    } catch (e) {
      toast.fail(e);
      setAsk(null);
    }
  };

  const filterCount = (roleKey ? 1 : 0) + (signInState ? 1 : 0);
  const cols = COLUMNS.filter((c) => shown.has(c.key));

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Panel
        title='Roles'
        note='What each role may do. Declared by the module, not by the platform. A requester holds none of these — they are not staff, and the directory below shows them with no role for that reason.'
      >
        <Table>
          <THead>
            <TR>
              <TH>Role</TH>
              <TH>Access</TH>
            </TR>
          </THead>
          <TBody>
            {roles.map((r) => (
              <TR key={r.roleKey}>
                <TD style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</TD>
                <TD muted>{r.description}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Panel>

      <StatTiles
        tiles={dir.data?.counts ?? []}
        noun='user'
        active={view}
        onPick={(label) => narrow(() => setView(label as DirectoryView))}
      />

      <Toolbar>
        <Search
          label='Search users'
          value={typed}
          onChange={(v) => narrow(() => setTyped(v))}
          placeholder='Search name, email, phone…'
        />

        <Popover icon='sliders' label='Filter' badge={filterCount}>
          {() => (
            <>
              <PopHeader
                title='Role'
                action={roleKey ? 'Clear' : undefined}
                onAction={() => narrow(() => setRoleKey(''))}
              />
              {roles.map((r) => (
                <OptionRow
                  key={r.roleKey}
                  ticked={roleKey === r.roleKey}
                  label={r.name}
                  onClick={() => narrow(() => setRoleKey(roleKey === r.roleKey ? '' : r.roleKey))}
                />
              ))}
              <div style={{ height: 10 }} />
              <PopHeader
                title='Sign-in'
                action={signInState ? 'Clear' : undefined}
                onAction={() => narrow(() => setSignInState(''))}
              />
              {/* The tiles flatten these into two coarse readings; this is how
                  one of them is asked for on its own. */}
              {SIGN_IN_STATES.map((s) => (
                <OptionRow
                  key={s}
                  ticked={signInState === s}
                  label={STATE_LABEL[s]}
                  onClick={() => narrow(() => setSignInState(signInState === s ? '' : s))}
                />
              ))}
            </>
          )}
        </Popover>

        <Popover icon='check-square' label='Columns'>
          {() => (
            <>
              <PopHeader title='Columns' />
              {/* Name is absent on purpose: it is the column that says whose
                  row this is, and a directory that can hide it is a list of
                  email addresses. */}
              {COLUMNS.map((c) => (
                <OptionRow
                  key={c.key}
                  ticked={shown.has(c.key)}
                  label={c.label}
                  onClick={() =>
                    setShown((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(c.key)) next.add(c.key);
                      return next;
                    })
                  }
                />
              ))}
            </>
          )}
        </Popover>

        {writable && (
          <div style={{ marginLeft: 'auto' }}>
            <Btn kind='primary' onClick={() => setAdding(true)}>
              <Icon name='user-plus' size={14} /> Add a staff member
            </Btn>
          </div>
        )}
      </Toolbar>

      <Panel title='Directory'>
        {dir.error ? (
          <ErrorBox>{dir.error.message}</ErrorBox>
        ) : dir.data === null ? (
          <Loading />
        ) : dir.data.users.length === 0 ? (
          <Empty>
            {q || filterCount
              ? 'No user matches that.'
              : 'Nobody holds a stalls role and nobody has applied yet.'}
          </Empty>
        ) : mobile ? (
          <div>
            {dir.data.users.map((u) => (
              <RowCard
                key={`${u.kind}:${u.id}`}
                lead={<Avatar name={u.displayName} size={34} />}
                title={u.displayName}
                sub={u.email}
                fields={cols
                  .filter((c) => c.key !== 'email')
                  .map((c) => ({
                    label: c.label,
                    value: cell(c.key, u, roles),
                  }))}
                actions={
                  <Actions user={u} writable={writable} onAsk={setAsk} onEdit={setEditing} />
                }
              />
            ))}
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                {cols.map((c) => (
                  <TH key={c.key} align={c.align}>
                    {c.label}
                  </TH>
                ))}
                <TH align='right'>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {dir.data.users.map((u) => (
                <TR key={`${u.kind}:${u.id}`}>
                  <TD style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                      <Avatar name={u.displayName} size={28} />
                      {u.displayName}
                    </span>
                  </TD>
                  {cols.map((c) => (
                    <TD key={c.key} align={c.align} muted={c.muted}>
                      {cell(c.key, u, roles)}
                    </TD>
                  ))}
                  <TD align='right'>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Actions user={u} writable={writable} onAsk={setAsk} onEdit={setEditing} />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        {dir.data && dir.data.total > 0 && (
          <Pager
            page={dir.data.page}
            pages={Math.max(1, Math.ceil(dir.data.total / dir.data.pageSize))}
            total={dir.data.total}
            size={dir.data.pageSize}
            noun='user'
            onPage={setPage}
            onSize={setPageSize}
          />
        )}
      </Panel>

      {adding && (
        <AddStaff
          onClose={() => setAdding(false)}
          onGranted={() => {
            setAdding(false);
            dir.reload();
          }}
        />
      )}

      {editing?.kind === 'REQUESTER' && (
        <EditRequester
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            dir.reload();
          }}
        />
      )}

      {editing?.kind === 'STAFF' && (
        <EditRoles
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            dir.reload();
          }}
          onChanged={dir.reload}
        />
      )}

      {ask && (
        <Dialog
          title={ask.title}
          note={ask.note}
          onClose={() => setAsk(null)}
          footer={
            <>
              <Btn onClick={() => setAsk(null)}>Cancel</Btn>
              <Btn kind='primary' onClick={runAsk}>
                {ask.confirm}
              </Btn>
            </>
          }
        >
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>{ask.body}</div>
        </Dialog>
      )}
    </div>
  );
}

// ── Row actions ─────────────────────────────────────────────────────────────

/** What the confirm dialog needs to ask, and what to do on yes. */
interface Ask {
  title: string;
  note?: string;
  body: string;
  confirm: string;
  done: string;
  run: () => Promise<void>;
}

/**
 * What can be done to one row.
 *
 * ⚠️ `IconBtn` rather than an overflow menu, and deliberately: it already
 * carries the 44px touch target and the `stopPropagation` a row action needs,
 * and at most three of these are ever shown at once — Unlock appears only on a
 * locked row, Resend only on an unconfirmed one. A menu would be a click in
 * front of every one of them to hide a crowd that does not form.
 *
 * ⚠️ Both mail actions ask first. They put a letter in a vendor's inbox, and a
 * mis-click on a dense row should not be able to do that.
 *
 * ⚠️ **Edit means a different thing per population, and that is not a
 * shortcut.** A requester's name, address and number are this module's own
 * (`StallAccount`), so they are edited here. A staff member's are the
 * Foundation's, which a module reads and never writes — so their Edit opens
 * the roles this module DID grant, and nothing else.
 */
function Actions({
  user,
  writable,
  onAsk,
  onEdit,
}: {
  user: DirectoryUser;
  writable: boolean;
  onAsk: (ask: Ask) => void;
  onEdit: (user: DirectoryUser) => void;
}) {
  if (!writable) return null;

  const edit = (
    <IconBtn label={`Edit ${user.displayName}`} glyph='pencil' onClick={() => onEdit(user)} />
  );

  if (user.kind === 'STAFF') return edit;

  // An account registered on a number carries an address nothing delivers to.
  // Naming it on the confirm dialog would promise a letter that never arrives.
  const where = isPlaceholderEmail(user.email) && user.phone ? user.phone : user.email;

  return (
    <>
      {edit}
      {user.signInState === 'LOCKED' && (
        <IconBtn
          label={`Unlock ${user.displayName}`}
          glyph='lock-open'
          onClick={() =>
            onAsk({
              title: 'Unlock this login?',
              body: `${user.displayName} was locked out by repeated wrong passwords. Unlocking lets them try again straight away. Their password is unchanged.`,
              confirm: 'Unlock',
              done: 'Unlocked',
              run: () => api.unlockAccount(user.id),
            })
          }
        />
      )}
      {user.signInState === 'UNCONFIRMED' && (
        <IconBtn
          label={`Resend confirmation to ${user.displayName}`}
          glyph='refresh'
          onClick={() =>
            onAsk({
              title: 'Resend the confirmation?',
              note: `Goes to ${where}`,
              body: `${user.displayName} registered but never followed the confirmation link, so they cannot sign in yet. This sends a fresh one to the contact they registered under — not to anything typed here.`,
              confirm: 'Resend',
              done: 'Confirmation sent',
              run: () => api.resendConfirmation(user.id),
            })
          }
        />
      )}
      <IconBtn
        label={`Send ${user.displayName} their access link`}
        glyph='mail'
        onClick={() =>
          onAsk({
            title: 'Send the access link?',
            note: `Goes to ${where}`,
            body: `This mails ${user.displayName} a fresh link to their own stall requests. It needs no password, which makes it the way back in for a requester who never registered one. The link goes to the address on their account and is never shown here.`,
            confirm: 'Send link',
            done: 'Link sent',
            run: () => api.sendAccessLinkTo(user.id),
          })
        }
      />
    </>
  );
}

// ── Columns ─────────────────────────────────────────────────────────────────

type ColKey = 'email' | 'type' | 'roles' | 'phone' | 'requests' | 'signIn';

/**
 * Every column but Name, which is not optional.
 *
 * ⚠️ Conditional `<th>`s and `<td>`s, as `components/Table.tsx` says a column
 * picker on these screens must be done — NOT a port of the reference system's
 * CSS grid. The suite reaches these rows through `getByRole`, and a grid of
 * divs has no row or cell role to reach.
 */
const COLUMNS: Array<{ key: ColKey; label: string; align?: 'left' | 'right'; muted?: boolean }> = [
  { key: 'email', label: 'Email', muted: true },
  { key: 'type', label: 'Type' },
  { key: 'roles', label: 'Roles' },
  { key: 'phone', label: 'Phone', muted: true },
  { key: 'requests', label: 'Requests', align: 'right' },
  { key: 'signIn', label: 'Sign-in' },
];

/** Phone is off by default: it is blank for every staff row, and a column that
 *  is empty for half the directory costs more width than it returns. */
const DEFAULT_COLUMNS: ColKey[] = ['email', 'type', 'roles', 'requests', 'signIn'];

function cell(key: ColKey, u: DirectoryUser, roles: RoleSummary[]): React.ReactNode {
  switch (key) {
    case 'email':
      return u.email;
    case 'type':
      return (
        <Tag tone={u.kind === 'STAFF' ? 'violet' : 'teal'} size='sm'>
          {u.kind === 'STAFF' ? 'Staff' : 'Requester'}
        </Tag>
      );
    case 'roles':
      return u.roleKeys.length === 0 ? (
        <span style={{ color: 'var(--mfg)' }}>—</span>
      ) : (
        /* 🔴 These carried an × each, which made revoking a role a single
           unconfirmed click on a dense row — the narrowest control on the
           screen doing the least reversible thing on it. Roles are changed
           from the row's Edit now, where every role is visible at once and
           the change is reviewed before it is sent. */
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {u.roleKeys.map((rk) => (
            <Tag key={rk} tone='violet' size='sm'>
              {roleName(roles, rk)}
            </Tag>
          ))}
        </div>
      );
    case 'phone':
      return u.phone ?? '—';
    case 'requests':
      return u.requestCount === null ? '—' : u.requestCount.toLocaleString('en-IN');
    case 'signIn':
      return (
        <Tag tone={STATE_TONE[u.signInState]} size='sm'>
          {u.kind === 'STAFF' && u.signInState === 'OK' ? 'Active' : STATE_LABEL[u.signInState]}
        </Tag>
      );
  }
}

const SIGN_IN_STATES: SignInState[] = ['OK', 'LINK_ONLY', 'UNCONFIRMED', 'LOCKED', 'DISABLED'];

/** ⚠️ "Link only" reads as a plain fact, not a warning, and wears the neutral
 *  tone — a requester who never set a password has lost nothing. Colouring it
 *  amber would mark most of the directory as broken. */
const STATE_LABEL: Record<SignInState, string> = {
  OK: 'Registered',
  LINK_ONLY: 'Link only',
  UNCONFIRMED: 'Unconfirmed',
  LOCKED: 'Locked',
  DISABLED: 'Disabled',
};

const STATE_TONE: Record<SignInState, Tone> = {
  OK: 'ok',
  LINK_ONLY: 'neutral',
  UNCONFIRMED: 'warn',
  LOCKED: 'des',
  DISABLED: 'neutral',
};

// ── Editing a row ───────────────────────────────────────────────────────────

/**
 * A requester's own details, corrected.
 *
 * ⚠️ **The note under the address is the point of the dialog, not decoration.**
 * Moving the address moves where every access link is sent and which account
 * the next submission merges into — but NOT the password a vendor already
 * registered, which lives on its own row with its own unique login value. A
 * desk that does not know this corrects an address, sees "Registered" in the
 * Sign-in column, and cannot explain why the vendor still cannot get in. The
 * answer, then, is the access link in the same row of actions.
 *
 * ⚠️ Save stays enabled only while something has actually changed. The server
 * writes nothing for an unchanged save, so a live button would promise a
 * change the trail would not record.
 */
function EditRequester({
  user,
  onClose,
  onSaved,
}: {
  user: DirectoryUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    displayName !== user.displayName || email !== user.email || phone !== (user.phone ?? '');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.updateAccount(user.id, { displayName, email, phone });
      toast.ok('Saved');
      onSaved();
    } catch (e) {
      // Shown in the dialog rather than only as a toast: the commonest failure
      // is an address another account holds, and the answer to it is to edit
      // the field that is still on screen.
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title='Edit this requester'
      note='Their own details, as this module holds them.'
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={save} disabled={!dirty || saving}>
            Save
          </Btn>
        </>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      {/* ⚠️ `aria-label` on each input, as the Role select above does:
          `Field` draws its caption as a styled div rather than a `<label>`,
          so the caption names the field for a reader and nothing else. */}
      <Field label='Name'>
        <Input
          aria-label='Name'
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field label='Email'>
        <Input aria-label='Email' value={email} onChange={(e) => setEmail(e.target.value)} />
        <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 5, lineHeight: 1.5 }}>
          Access links and new submissions follow this address. A password they already registered
          does not — they go on signing in with the old one.
        </div>
      </Field>
      <Field label='Phone'>
        <Input aria-label='Phone' value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
    </Dialog>
  );
}

/**
 * Which of this module's roles a staff member holds.
 *
 * ⚠️ **Roles only.** Their name and address are the Foundation's, and a module
 * reads that directory without ever writing it — see `staff.ts`. Showing them
 * here as fields would offer an edit this application cannot make.
 *
 * ⚠️ **Saves the difference, not the ticks.** Each grant and each revoke is
 * its own audited call, so re-sending every ticked role would write a row per
 * role per visit into the trail that answers "who gave this person finance".
 *
 * ⚠️ **Not atomic, and says so by what it does on failure.** The calls go one
 * at a time; a refusal — the last-admin guard is the one that bites — leaves
 * the earlier ones applied. So the dialog stops at the failure, reports it,
 * reloads the row behind it and stays open on the truth, rather than claiming
 * a rollback that never happened.
 */
function EditRoles({
  user,
  onClose,
  onSaved,
  onChanged,
}: {
  user: DirectoryUser;
  onClose: () => void;
  onSaved: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { roles } = useRoles();
  /**
   * Every role this person holds, plus every role the caller may hand out.
   *
   * ⚠️ A role they hold that the caller may NOT assign is listed and disabled
   * rather than hidden. Hiding it would draw an account that is missing a role
   * it actually has — and the first thing an admin would do is tick the boxes
   * they can see and press Save, believing they had described the person. The
   * server refuses the change either way; this is about the dialog telling the
   * truth about who it is editing.
   */
  const shown = roles.filter((r) => r.assignable || user.roleKeys.includes(r.roleKey));
  const [held, setHeld] = useState<string[]>(user.roleKeys);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(user.roleKeys));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const granting = [...ticked].filter((rk) => !held.includes(rk));
  const revoking = held.filter((rk) => !ticked.has(rk));
  const dirty = granting.length > 0 || revoking.length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    const granted: string[] = [];
    const revoked: string[] = [];
    try {
      for (const rk of granting) {
        await api.grantRole(user.id, rk);
        granted.push(rk);
      }
      for (const rk of revoking) {
        await api.revokeRole(user.id, rk);
        revoked.push(rk);
      }
      toast.ok('Saved');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // What actually stuck, so the ticks and the Save button describe the row
      // as it now is rather than as it was asked to be — and so a second Save
      // asks only for what is left. Re-sending a revoke that already succeeded
      // would write to the trail that a role was taken away twice.
      setHeld((prev) => [...new Set([...prev, ...granted])].filter((rk) => !revoked.includes(rk)));
      setSaving(false);
      onChanged();
    }
  };

  return (
    <Dialog
      title={`Roles for ${user.displayName}`}
      note='What this module has granted them. Their name and address belong to the Foundation directory.'
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={save} disabled={!dirty || saving}>
            Save
          </Btn>
        </>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div style={{ display: 'grid', gap: 2 }}>
        {shown.map((r) => (
          <label
            key={r.roleKey}
            htmlFor={`role-${r.roleKey}`}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '9px 4px',
              cursor: 'pointer',
            }}
          >
            <Checkbox
              id={`role-${r.roleKey}`}
              /* The label holds the role's description too, so the tick is
                 named explicitly rather than by everything beside it. */
              aria-label={r.name}
              checked={ticked.has(r.roleKey)}
              onChange={() =>
                setTicked((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(r.roleKey)) next.add(r.roleKey);
                  return next;
                })
              }
              style={{ marginTop: 2 }}
            />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--mfg)' }}>
                {r.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}

// ── Adding a staff member ───────────────────────────────────────────────────

/**
 * The Foundation directory, searched, and a role to grant.
 *
 * ⚠️ A dialog rather than the block that used to sit permanently under the
 * table. Granting a role is something you go and do a handful of times a
 * season; leaving its search box, its Search button and its role select open
 * beneath every visit made the table look like a footnote to a form.
 */
function AddStaff({ onClose, onGranted }: { onClose: () => void; onGranted: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Array<{
    personId: string;
    email: string;
    displayName: string;
  }> | null>(null);
  const { assignable } = useRoles();
  /**
   * The bays and seasons a grant can be narrowed to.
   *
   * ⚠️ Both default to EVERYTHING, and that is the safe direction here rather
   * than the permissive one: an empty list means "every season", so a person
   * given the whole event does not lose next year the moment somebody creates
   * it, with nothing watching. A seasonal helper gets an explicit list instead.
   *
   * Loaded best-effort. `/zones` needs one of the request or planning reads and
   * `/editions` needs `config.read`; somebody holding `users.write` and neither
   * simply grants unscoped, which is what they could do before this existed.
   */
  const zones = useLoad(() => api.listZones().catch(() => []), []);
  const editions = useLoad(() => api.listEditions().catch(() => []), []);
  const [zoneScope, setZoneScope] = useState<string[]>([]);
  const [editionScope, setEditionScope] = useState<string[]>([]);
  /**
   * Deliberately NO default role.
   *
   * ⚠️ This used to open on `ROLES[1]` — Lead — a fixed index that skipped
   * Admin on purpose. That index cannot survive roles becoming data: the list
   * is now the caller's assignable set, ordered by the tree, so position 0 is
   * the MOST privileged role they hold and any positional default makes Admin
   * the thing granted by an admin who never touched the dropdown.
   *
   * There is no honest default left to pick — the app cannot know which role is
   * meant — so Grant stays disabled until somebody chooses one.
   */
  const [roleKey, setRoleKey] = useState('');

  const search = async () => {
    if (!q.trim()) return setFound(null);
    try {
      setFound(await api.searchPeople(q.trim()));
    } catch (e) {
      toast.fail(e);
    }
  };

  const grant = async (personId: string) => {
    try {
      await api.grantRole(personId, roleKey, { editionScope, zoneScope });
      toast.ok('Granted');
      onGranted();
    } catch (e) {
      toast.fail(e);
    }
  };

  return (
    <Dialog
      title='Add a staff member'
      note='Somebody already in the Foundation directory. This module grants the role; it never creates the person.'
      onClose={onClose}
      width={520}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Search
          label='Search people'
          value={q}
          onChange={setQ}
          placeholder='Search name or email…'
        />
        <Btn onClick={search}>
          <Icon name='search' size={14} /> Search
        </Btn>
        <Select
          aria-label='Role'
          value={roleKey}
          onChange={(e) => setRoleKey(e.target.value)}
          style={{ width: 'auto', minWidth: 200 }}
        >
          <option value=''>Choose a role…</option>
          {assignable.map((r) => (
            <option key={r.roleKey} value={r.roleKey}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>

      {/* Ticking nothing is "everything", so an admin who ignores these two
          rows grants exactly what they granted before grant scope existed. */}
      <ScopePicker
        label='Bays'
        all='Every bay'
        options={(zones.data ?? []).map((z) => ({ value: z.code, label: `${z.code} — ${z.name}` }))}
        chosen={zoneScope}
        onChange={setZoneScope}
      />
      <ScopePicker
        label='Seasons'
        all='Every season, including ones created later'
        options={(editions.data ?? []).map((e) => ({ value: e.id, label: String(e.year) }))}
        chosen={editionScope}
        onChange={setEditionScope}
      />

      <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
        {found !== null && found.length === 0 && (
          <Empty>Nobody in the directory matches that.</Empty>
        )}
        {(found ?? []).map((p) => (
          <div
            key={p.personId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 'var(--r2)',
              background: 'var(--mut)',
              fontSize: 12.5,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              {p.displayName} <span style={{ color: 'var(--mfg)' }}>· {p.email}</span>
            </span>
            <Btn kind='primary' disabled={!roleKey} onClick={() => grant(p.personId)}>
              Grant
            </Btn>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
