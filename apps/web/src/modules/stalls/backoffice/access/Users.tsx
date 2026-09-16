import { useState } from 'react';
import {
  type DirectoryGrant,
  type DirectoryUser,
  type DirectoryView,
  type PersonMatch,
  type SignInState,
  type RoleSummary,
  MIN_PASSWORD_LENGTH,
  isPlaceholderEmail,
} from '@msr/stalls';
import * as api from '../../api';
import { Panel } from '../../components/Panel';
import { useDebounced, useLoad } from '../../hooks';
import { useMe } from '../../me';
import {
  Avatar,
  Btn,
  Checkbox,
  Dialog,
  Empty,
  ErrorBox,
  Field,
  FormField,
  Icon,
  IconBtn,
  Input,
  Loading,
  MultiSelect,
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
} from '../../ui';

/**
 * Everyone who can reach this module, in one directory.
 *
 * ⚠️ **Two populations, one table, and the difference is not cosmetic.** Backoffice
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
function ScopeField({
  label,
  all,
  options,
  chosen,
  onChange,
  forName,
}: {
  label: string;
  /** What an EMPTY list means, shown as the control's own placeholder. */
  all: string;
  options: Array<{ value: string; label: string }>;
  chosen: string[];
  onChange: (next: string[]) => void;
  /**
   * The role these bays or editions belong to.
   *
   * ⚠️ Not decoration. The dialog draws one of these per axis UNDER EVERY ROLE
   * a person holds, so "Bays" alone names four different controls on one
   * screen — to a screen reader and to the suite alike.
   */
  forName?: string;
}) {
  if (options.length === 0) return null;
  const id = `scope-${forName ?? ''}-${label}`;
  return (
    <FormField id={id} label={label}>
      <MultiSelect
        label={forName ? `${label} for ${forName}` : label}
        values={chosen}
        onChange={onChange}
        options={options}
        // ⚠️ The placeholder IS the explanation. Empty means EVERY bay and
        // EVERY edition — the opposite of how a picker usually reads — so the
        // control says so while empty rather than sitting blank under a
        // sentence somebody has to find.
        placeholder={all}
      />
    </FormField>
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

/**
 * What one grant reaches, in a few words — the chip's tooltip.
 *
 * ⚠️ Empty is EVERYTHING on both axes, which is the opposite of how a filter
 * reads, so it is spelled out rather than left blank.
 */
function scopeSummary(g: DirectoryGrant): string {
  const bays = g.zoneScope.length === 0 ? 'every bay' : g.zoneScope.join(', ');
  const editions =
    g.editionScope.length === 0 ? 'every edition' : `${g.editionScope.length} editions`;
  return `Reaches ${bays}, ${editions}`;
}

/** The role's name as an admin reads it, falling back to the key.
 *
 *  A grant can name a role this list has not loaded yet, and a half-drawn table
 *  showing a key is better than one showing a blank. */
function roleName(roles: RoleSummary[], roleKey: string): string {
  return roles.find((r) => r.roleKey === roleKey)?.name ?? roleKey;
}

export function Users() {
  const { can } = useMe();
  const writable = can('users.write');
  /** ⚠️ Its own privilege, deliberately separate from `users.write`: every other
   *  row action sends a vendor their own way in, this one hands one over. A
   *  support desk can hold all of those and none of this. */
  const canSetPassword = can('passwords.write');
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
  const [settingPassword, setSettingPassword] = useState<DirectoryUser | null>(null);

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
      {/* ⚠️ The read-only table of role descriptions that used to sit here is
          gone. Roles & Privileges is a screen of its own now, and a second
          rendering of the same list is a second thing to keep in step — this
          one had no counts, no hierarchy and no way to reach the editor. */}
      <StatTiles
        tiles={dir.data?.counts ?? []}
        noun='user'
        active={view}
        onPick={(label) => narrow(() => setView(label as DirectoryView))}
      />

      <Toolbar>
        <Search
          label='Search Users'
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
                title='Sign-In'
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
              <Icon name='user-plus' size={14} />
              Add User
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
                  <Actions
                    user={u}
                    writable={writable}
                    canSetPassword={canSetPassword}
                    onAsk={setAsk}
                    onEdit={setEditing}
                    onSetPassword={setSettingPassword}
                  />
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
                      <Actions
                        user={u}
                        writable={writable}
                        canSetPassword={canSetPassword}
                        onAsk={setAsk}
                        onEdit={setEditing}
                        onSetPassword={setSettingPassword}
                      />
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
        <AssignDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            dir.reload();
          }}
          onChanged={dir.reload}
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

      {editing?.kind === 'BACKOFFICE' && (
        <AssignDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            dir.reload();
          }}
          onChanged={dir.reload}
        />
      )}

      {settingPassword && (
        <SetPassword
          user={settingPassword}
          onClose={() => setSettingPassword(null)}
          onSaved={() => {
            setSettingPassword(null);
            dir.reload();
          }}
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
                <Icon name='check' size={14} />
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
 * locked row, and the key only for a caller holding `passwords.write`. A menu
 * would be a click in front of every one of them to hide a crowd that does not
 * form.
 *
 * ⚠️ The access-link action asks first. It puts a letter in a vendor's inbox,
 * and a mis-click on a dense row should not be able to do that.
 *
 * ⚠️ **Edit means a different thing per population, and that is not a
 * shortcut.** A requester's name, address and number are this module's own
 * (`StallAccount`); a backoffice member's belong to the Foundation directory
 * and travel on a different route. Both dialogs now offer the same three
 * fields — see `AssignDialog` for why this module writes that directory at all
 * — but which one opens, and which route it saves through, is decided by the
 * row's `kind` and never by trying one and falling back to the other.
 */
function Actions({
  user,
  writable,
  canSetPassword,
  onAsk,
  onEdit,
  onSetPassword,
}: {
  user: DirectoryUser;
  writable: boolean;
  /** `passwords.write`, which is not `users.write` — see the Users screen. */
  canSetPassword: boolean;
  onAsk: (ask: Ask) => void;
  onEdit: (user: DirectoryUser) => void;
  onSetPassword: (user: DirectoryUser) => void;
}) {
  // ⚠️ Two privileges, not one. Somebody may hold `passwords.write` alone, and
  // returning early on `writable` would leave their rows with no controls at
  // all — every one of which they are allowed to press.
  if (!writable && !canSetPassword) return null;

  const edit = writable ? (
    <IconBtn label={`Edit ${user.displayName}`} glyph='pencil' onClick={() => onEdit(user)} />
  ) : null;

  // A backoffice member holds no password here — they sign in through the
  // Foundation — so the key never appears on their row.
  if (user.kind === 'BACKOFFICE') return edit;

  // An account registered on a number carries an address nothing delivers to.
  // Naming it on the confirm dialog would promise a letter that never arrives.
  const where = isPlaceholderEmail(user.email) && user.phone ? user.phone : user.email;

  return (
    <>
      {edit}
      {canSetPassword && (
        <IconBtn
          label={`Set a password for ${user.displayName}`}
          glyph='key'
          onClick={() => onSetPassword(user)}
        />
      )}
      {writable && user.signInState === 'LOCKED' && (
        <IconBtn
          label={`Unlock ${user.displayName}`}
          glyph='lock-open'
          onClick={() =>
            onAsk({
              title: 'Unlock This Login?',
              body: `${user.displayName} was locked out by repeated wrong passwords. Unlocking lets them try again straight away. Their password is unchanged.`,
              confirm: 'Unlock',
              done: 'Unlocked',
              run: () => api.unlockAccount(user.id),
            })
          }
        />
      )}
      {writable && (
        <IconBtn
          label={`Send ${user.displayName} their access link`}
          glyph='mail'
          onClick={() =>
            onAsk({
              title: 'Send the Access Link?',
              note: `Goes to ${where}`,
              body: `This mails ${user.displayName} a fresh link to their own stall requests. It needs no password, which makes it the way back in for a requester who never registered one. The link goes to the address on their account and is never shown here.`,
              confirm: 'Send link',
              done: 'Link sent',
              run: () => api.sendAccessLinkTo(user.id),
            })
          }
        />
      )}
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
  { key: 'signIn', label: 'Sign-In' },
];

/** Phone is off by default: it is blank for every backoffice row, and a column that
 *  is empty for half the directory costs more width than it returns. */
const DEFAULT_COLUMNS: ColKey[] = ['email', 'type', 'roles', 'requests', 'signIn'];

function cell(key: ColKey, u: DirectoryUser, roles: RoleSummary[]): React.ReactNode {
  switch (key) {
    case 'email':
      return u.email;
    case 'type':
      return (
        <Tag tone={u.kind === 'BACKOFFICE' ? 'violet' : 'teal'} size='sm'>
          {u.kind === 'BACKOFFICE' ? 'Backoffice' : 'Requester'}
        </Tag>
      );
    case 'roles':
      return u.grants.length === 0 ? (
        <span style={{ color: 'var(--mfg)' }}>—</span>
      ) : (
        /* 🔴 These carried an × each, which made revoking a role a single
           unconfirmed click on a dense row — the narrowest control on the
           screen doing the least reversible thing on it. Roles are changed
           from the row's Edit now, where every role is visible at once and
           the change is reviewed before it is sent. */
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {u.grants.map((g) => (
            <Tag key={g.roleKey} tone='violet' size='sm' title={scopeSummary(g)}>
              {roleName(roles, g.roleKey)}
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
          {u.kind === 'BACKOFFICE' && u.signInState === 'OK'
            ? 'Active'
            : STATE_LABEL[u.signInState]}
        </Tag>
      );
  }
}

const SIGN_IN_STATES: SignInState[] = ['OK', 'INVITED', 'LINK_ONLY', 'LOCKED', 'DISABLED'];

/** ⚠️ "Link only" and "Not signed in" read as plain facts, not warnings, and
 *  wear the neutral tone — a requester who never set a password has lost
 *  nothing, and neither has a coordinator added an hour ago. Colouring either
 *  amber would mark most of the directory as broken. */
const STATE_LABEL: Record<SignInState, string> = {
  OK: 'Registered',
  INVITED: 'Not Signed In',
  LINK_ONLY: 'Link Only',
  LOCKED: 'Locked',
  DISABLED: 'Disabled',
};

const STATE_TONE: Record<SignInState, Tone> = {
  OK: 'ok',
  INVITED: 'neutral',
  LINK_ONLY: 'neutral',
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
      title='Edit This Requester'
      note='Their own details, as this module holds them.'
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={save} disabled={!dirty || saving}>
            <Icon name='check' size={14} />
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

// ── Setting a password ──────────────────────────────────────────────────────

/**
 * A password chosen at a desk for a requester who cannot get in.
 *
 * 🔴 **TEMPORARY, and the only screen in the module that hands over a way in.**
 * Everything else here causes a vendor to receive their own link; this one puts
 * a working password in front of whoever is on the phone to them. It is why
 * `passwords.write` exists as a separate privilege, and it is the first thing
 * deleted when the host's Isha SSO signs requesters in — at which point no
 * password in this module is anyone's to set.
 *
 * ⚠️ **The field is not masked, and that is the design.** The desk is reading
 * this aloud down a phone line to somebody writing it on the back of a
 * receipt. Dots would hide it from the one person who has to say it correctly,
 * and hide nothing from anyone else — the vendor is being told it either way.
 * A second "confirm" box, which exists to catch what masking hides, buys
 * nothing once the first box is legible.
 */
function SetPassword({
  user,
  onClose,
  onSaved,
}: {
  user: DirectoryUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.setRequesterPassword(user.id, password);
      toast.ok('Password set');
      onSaved();
    } catch (e) {
      // In the dialog, not only as a toast: the two failures — no contact to
      // register a login against, and a contact another account already signs
      // in with — are both answered on this screen, and the message says which.
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Dialog
      title='Set a Password'
      note={`${user.displayName} signs in with ${isPlaceholderEmail(user.email) && user.phone ? user.phone : user.email}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn
            kind='primary'
            onClick={save}
            disabled={password.length < MIN_PASSWORD_LENGTH || saving}
          >
            <Icon name='key' size={14} />
            Set Password
          </Btn>
        </>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <Field label='New Password'>
        {/* `type='text'`: see the note on this component. */}
        <Input
          aria-label='New Password'
          type='text'
          autoComplete='off'
          spellCheck={false}
          value={password}
          invalid={tooShort}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 5, lineHeight: 1.5 }}>
          {tooShort
            ? `At least ${MIN_PASSWORD_LENGTH} characters.`
            : `At least ${MIN_PASSWORD_LENGTH} characters. Read it to them and tell them to change it. It works straight away, it is never emailed, and this is the only time anyone here can see it.`}
        </div>
      </Field>
      <div style={{ fontSize: 11.5, color: 'var(--mfg)', lineHeight: 1.6 }}>
        Any session they already have open is signed out. If they never registered, this creates
        their login.
      </div>
    </Dialog>
  );
}

// ── Assigning roles ─────────────────────────────────────────────────────────

/** A button that reads as a link.
 *
 *  ⚠️ Not a `Btn` variant: the two that use it do not submit the dialog or act
 *  on a row — they change what the form in front of you is FOR, from searching
 *  the directory to adding to it. Giving that a button's weight beside Assign
 *  would make it read as the other half of a choice about the same thing. */
const linkBtn: React.CSSProperties = {
  border: 0,
  background: 'none',
  padding: 0,
  color: 'var(--pri)',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  textDecoration: 'underline',
};

/** One role a person holds, as the dialog is editing it. */
interface Draft {
  roleKey: string;
  editionScope: string[];
  zoneScope: string[];
}

const sameScope = (a: Draft, b: DirectoryGrant): boolean =>
  [...a.editionScope].sort().join() === [...b.editionScope].sort().join() &&
  [...a.zoneScope].sort().join() === [...b.zoneScope].sort().join();

/**
 * Granting and revoking, in one dialog.
 *
 * 🔴 **One, because two disagreed.** Adding a backoffice member offered editions and
 * bays; editing an existing person's roles called `grantRole` with no scope at
 * all. Empty means EVERY edition and EVERY bay, so the more-used of the two
 * silently handed out the widest grant the module can express, with nothing on
 * screen saying so. A single dialog cannot drift from itself.
 *
 * ⚠️ **Roles AND the person's own details**, which it did not use to be. The
 * dialog was roles only because a module reads the Foundation directory and
 * never writes it — a rule this screen now breaks twice, deliberately and
 * narrowly: it can put somebody into that directory (the person step below),
 * and having done so it can mend the address it typed. `backoffice.ts` carries
 * the argument; what matters here is that the two are one dialog, because
 * "correct their number and make them a bay marshal" is one errand.
 *
 * ⚠️ **Details are saved BEFORE the roles.** The refusal that actually happens
 * is an address another person already holds, and it should land before
 * anything has been granted — leaving the role picture exactly as the admin
 * found it, rather than half-changed under a message about an email.
 *
 * ⚠️ **Saves the difference, not the ticks.** Each grant and each revoke is its
 * own audited call, so re-sending every ticked role would write a row per role
 * per visit into the trail that answers "who gave this person finance". A role
 * whose SCOPE changed does travel, because a re-grant resets scope on the
 * server — the whole grant is the unit, not the ticked box.
 *
 * ⚠️ **Not atomic, and says so by what it does on failure.** The calls go one
 * at a time; a refusal — the last-admin guard is the one that bites — leaves
 * the earlier ones applied. So the dialog stops at the failure, reports it,
 * reloads the row behind it and stays open on the truth, rather than claiming a
 * rollback that never happened.
 */
function AssignDialog({
  user,
  onClose,
  onSaved,
  onChanged,
}: {
  /** The person being edited. Absent means the directory is searched first. */
  user?: DirectoryUser;
  onClose: () => void;
  onSaved: () => void;
  /** Something was written but the dialog stayed open — the row behind it is
   *  now out of date. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const { roles, assignable } = useRoles();

  /**
   * The bays and editions a grant can be narrowed to.
   *
   * Loaded best-effort. `/zones` needs one of the request or planning reads and
   * `/editions` needs `config.read`; somebody holding `users.write` and neither
   * simply grants unscoped, which is what they could do before scope existed.
   */
  const zones = useLoad(() => api.listZones().catch(() => []), []);
  const editions = useLoad(() => api.listEditions().catch(() => []), []);
  const zoneOptions = (zones.data ?? []).map((z) => ({
    value: z.code,
    label: `${z.code} — ${z.name}`,
  }));
  const editionOptions = (editions.data ?? []).map((e) => ({
    value: e.id,
    label: String(e.year),
  }));

  // ── Add mode: who, then which role ────────────────────────────────────────
  const [q, setQ] = useState('');
  const [found, setFound] = useState<PersonMatch[] | null>(null);
  const [picked, setPicked] = useState<{ personId: string; displayName: string } | null>(null);
  /**
   * The admin searched, did not find them, and is adding them from scratch.
   *
   * 🔴 **Search first, stage second, and the order is the guard.** A
   * well-formed but wrong address stages a role for whoever really owns it —
   * their first sign-in claims the row by email — so "add them" is the answer to
   * a search that found nothing, never the first thing the dialog offers.
   */
  const [staging, setStaging] = useState(false);
  const [draft, setDraft] = useState({ displayName: '', email: '', phone: '' });
  /**
   * Deliberately NO default role.
   *
   * ⚠️ This used to open on `ROLES[1]` — a fixed index that skipped Admin on
   * purpose. That index cannot survive roles becoming data: the list is now the
   * caller's assignable set, ordered by the tree, so position 0 is the MOST
   * privileged role they hold and any positional default makes Admin the thing
   * granted by an admin who never touched the dropdown. There is no honest
   * default left, so Assign stays disabled until somebody chooses.
   */
  const [newRole, setNewRole] = useState('');
  const [newScope, setNewScope] = useState<{ editionScope: string[]; zoneScope: string[] }>({
    editionScope: [],
    zoneScope: [],
  });

  // ── Edit mode: the ONE role this person holds ─────────────────────────────
  //
  // 🔴 One, not a set. A person in this module holds exactly one role, so the
  // list below is a choice rather than a basket: picking another REPLACES what
  // they hold. `held` is still a list because the table can hand us a person
  // who somehow has two — an older grant, or a write made outside this screen —
  // and the save has to be able to clear all of them.
  const [held, setHeld] = useState<DirectoryGrant[]>(user?.grants ?? []);
  const [chosen, setChosen] = useState<Draft | null>(
    user?.grants[0] ? { ...user.grants[0] } : null,
  );
  /**
   * Their own details, and what they were when this dialog last agreed with the
   * server.
   *
   * ⚠️ `was` is state rather than `user`, for the reason `held` is: the details
   * can commit and the roles beneath them fail, and the dialog stays open on
   * what actually stuck. Comparing against the prop would then offer to save a
   * change that is already saved.
   */
  const [details, setDetails] = useState({
    displayName: user?.displayName ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
  });
  const [was, setWas] = useState(details);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!q.trim()) return setFound(null);
    try {
      setFound(await api.searchPeople(q.trim()));
    } catch (e) {
      toast.fail(e);
    }
  };

  /** Who the grant is for: the row that was picked, or the person being added.
   *  `null` while neither is answered, which is what disables Assign. */
  const who = staging
    ? draft.displayName.trim() && draft.email.trim()
      ? { newPerson: draft }
      : null
    : picked
      ? { personRef: picked.personId }
      : null;

  const grantOne = async (target: { personRef: string } | { newPerson: typeof draft }) => {
    setSaving(true);
    setError(null);
    try {
      await api.grantRole(target, newRole, newScope);
      // Different words for the two arms, because they are different events: one
      // gave somebody who was already here a job, the other put a human into the
      // Foundation's directory who was not in it this morning.
      toast.ok('newPerson' in target ? 'Added and assigned' : 'Assigned');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  /**
   * A role this person holds that the CALLER may not hand out is listed and
   * disabled rather than hidden.
   *
   * ⚠️ Hiding it would draw an account missing a role it actually has — and the
   * first thing an admin would do is tick what they can see and press Save,
   * believing they had described the person. The server refuses either way;
   * this is about the dialog telling the truth about who it is editing.
   */
  const shown = roles.filter((r) => r.assignable || held.some((g) => g.roleKey === r.roleKey));

  const setScope = (patch: Partial<Draft>) =>
    setChosen((prev) => (prev ? { ...prev, ...patch } : prev));

  /** A newly chosen role starts unscoped — every edition and every bay, which is
   *  what it would have been granted as before scope existed, and what the two
   *  placeholders beneath it say. Re-picking the role they already hold brings
   *  its existing scope back rather than clearing it. */
  const choose = (roleKey: string) => {
    const before = held.find((g) => g.roleKey === roleKey);
    setChosen(before ? { ...before } : { roleKey, editionScope: [], zoneScope: [] });
  };

  // What has to travel: the chosen role if it is new or its scope moved, and
  // every OTHER role they still hold.
  const granting = (() => {
    if (!chosen) return null;
    const before = held.find((g) => g.roleKey === chosen.roleKey);
    return !before || !sameScope(chosen, before) ? chosen : null;
  })();
  const revoking = held.filter((g) => g.roleKey !== chosen?.roleKey);
  const renaming =
    details.displayName !== was.displayName ||
    details.email !== was.email ||
    details.phone !== was.phone;
  const dirty = renaming || Boolean(granting) || revoking.length > 0;

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    let granted: Draft | null = null;
    const gone: string[] = [];
    try {
      // FIRST, and before anything about roles — see this dialog's own note.
      // The refusal that actually happens here is an address another person
      // holds, and it should land on a screen whose roles are still as the
      // admin found them.
      if (renaming) {
        await api.updatePerson(user.id, details);
        setWas(details);
      }
      // ⚠️ Grant BEFORE revoke. The calls are not atomic, so the order decides
      // what a refusal leaves behind — this way a failure leaves them holding
      // both roles, which an admin can see and fix, rather than holding none.
      if (granting) {
        await api.grantRole({ personRef: user.id }, granting.roleKey, {
          editionScope: granting.editionScope,
          zoneScope: granting.zoneScope,
        });
        granted = granting;
      }
      for (const g of revoking) {
        await api.revokeRole(user.id, g.roleKey);
        gone.push(g.roleKey);
      }
      toast.ok('Saved');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // What actually stuck, so the list and the Save button describe the row
      // as it now is rather than as it was asked to be — and so a second Save
      // asks only for what is left. Re-sending a grant that already succeeded
      // would write to the trail that a role was given twice.
      setHeld((prev) =>
        [
          ...prev.filter((g) => !gone.includes(g.roleKey) && g.roleKey !== granted?.roleKey),
          ...(granted ? [{ ...granted }] : []),
        ].sort((a, b) => a.roleKey.localeCompare(b.roleKey)),
      );
      setSaving(false);
      onChanged();
    }
  };

  /** The two axes the chosen role can be narrowed to, side by side beneath it. */
  const scopeFor = (draft: Draft, roleLabel: string) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))',
        gap: 10,
        margin: '2px 0 4px 26px',
        padding: 10,
        borderRadius: 'var(--r2)',
        background: 'var(--mut)',
      }}
    >
      <ScopeField
        label='Bays'
        forName={roleLabel}
        all='Every bay'
        options={zoneOptions}
        chosen={draft.zoneScope}
        onChange={(zoneScope) => setScope({ zoneScope })}
      />
      <ScopeField
        label='Editions'
        forName={roleLabel}
        all='Every edition, including ones created later'
        options={editionOptions}
        chosen={draft.editionScope}
        onChange={(editionScope) => setScope({ editionScope })}
      />
    </div>
  );

  // ── Adding somebody who is not in the list yet ────────────────────────────
  if (!user) {
    return (
      <Dialog
        title='Add User'
        note={
          staging
            ? 'Adding somebody the directory does not have yet, and giving them a role.'
            : 'Somebody in the Foundation directory. If they are not in it, you can add them.'
        }
        onClose={onClose}
        width={520}
        footer={
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn
              kind='primary'
              disabled={!who || !newRole || saving}
              onClick={() => who && grantOne(who)}
            >
              <Icon name='user-plus' size={14} />
              {staging ? 'Add and assign' : 'Assign'}
            </Btn>
          </>
        }
      >
        {error && <ErrorBox>{error}</ErrorBox>}

        <div style={{ display: 'grid', gap: 14 }}>
          {staging ? (
            <FormField
              /* A caption over three fields rather than a label for one of
                 them, as the search variant below is — each input names itself
                 with `aria-label`, because `Field` draws its own caption as a
                 styled div and not a `<label>`. */
              id='new-person'
              label='Person'
              help='They can sign in and pick this account up — the address below is what matches them to it, so it has to be the one they use.'
            >
              <div style={{ display: 'grid', gap: 10 }}>
                <Field label='Name'>
                  <Input
                    aria-label='Name'
                    value={draft.displayName}
                    onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                  />
                </Field>
                <Field label='Email'>
                  <Input
                    aria-label='Email'
                    type='email'
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </Field>
                {/* Optional, and said so on the caption rather than left to be
                    discovered by pressing Assign: most of the directory has no
                    number, and refusing to add somebody over one would put an
                    admin back where this dialog exists to get them out of. */}
                <Field label='Phone (Optional)'>
                  <Input
                    aria-label='Phone'
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </Field>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 8, lineHeight: 1.5 }}>
                <button type='button' onClick={() => setStaging(false)} style={linkBtn}>
                  Search the Directory Instead
                </button>
              </div>
            </FormField>
          ) : (
            <FormField
              id='person-search'
              label='Person'
              help='Searched in the Foundation directory. Somebody who is not there can be added from here.'
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <Search
                  label='Search People'
                  value={q}
                  onChange={setQ}
                  placeholder='Search name or email…'
                />
                <Btn onClick={search}>
                  <Icon name='search' size={14} />
                  Search
                </Btn>
              </div>

              {found !== null && (
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  {found.length === 0 && <Empty>Nobody in the directory matches that.</Empty>}
                  {found.map((p) => (
                    <label
                      key={p.personId}
                      htmlFor={`person-${p.personId}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 'var(--r2)',
                        border: `1px solid ${
                          picked?.personId === p.personId ? 'var(--pri)' : 'var(--bd)'
                        }`,
                        background:
                          picked?.personId === p.personId ? 'var(--pri-t)' : 'var(--card)',
                        fontSize: 12.5,
                        cursor: 'pointer',
                      }}
                    >
                      <Checkbox
                        id={`person-${p.personId}`}
                        type='radio'
                        name='person'
                        aria-label={p.displayName}
                        checked={picked?.personId === p.personId}
                        onChange={() =>
                          setPicked({ personId: p.personId, displayName: p.displayName })
                        }
                      />
                      <Avatar name={p.displayName} size={26} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }}>{p.displayName}</span>
                        <span style={{ display: 'block', color: 'var(--mfg)' }}>{p.email}</span>
                      </span>
                      {/* Marked, not hidden. Somebody added last week and still
                          waiting on their first sign-in is exactly the row to
                          reuse — and a search that looked like a miss is what
                          produces a second person on the same address. */}
                      {p.staged && (
                        <Tag tone='neutral' size='sm'>
                          Not Signed in Yet
                        </Tag>
                      )}
                    </label>
                  ))}
                </div>
              )}

              {/* Offered only AFTER a search has run, and that is the guard, not
                  a layout choice — see `staging`. */}
              {found !== null && (
                <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 8, lineHeight: 1.5 }}>
                  Not in the directory?{' '}
                  <button
                    type='button'
                    onClick={() => {
                      setPicked(null);
                      setStaging(true);
                    }}
                    style={linkBtn}
                  >
                    Add Them
                  </button>
                </div>
              )}
            </FormField>
          )}

          <FormField id='new-role' label='Role'>
            <Select
              id='new-role'
              aria-label='Role'
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            >
              <option value=''>Choose a Role…</option>
              {assignable.map((r) => (
                <option key={r.roleKey} value={r.roleKey}>
                  {r.name}
                </option>
              ))}
            </Select>
          </FormField>

          {/* Only once a role is chosen: scope belongs to a GRANT, and there is
              no grant to narrow until then. Leaving both empty grants exactly
              what was granted before scope existed, which is what the two
              placeholders say. */}
          {newRole && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))',
                gap: 10,
              }}
            >
              <ScopeField
                label='Bays'
                all='Every bay'
                options={zoneOptions}
                chosen={newScope.zoneScope}
                onChange={(zoneScope) => setNewScope((prev) => ({ ...prev, zoneScope }))}
              />
              <ScopeField
                label='Editions'
                all='Every edition, including ones created later'
                options={editionOptions}
                chosen={newScope.editionScope}
                onChange={(editionScope) => setNewScope((prev) => ({ ...prev, editionScope }))}
              />
            </div>
          )}
        </div>
      </Dialog>
    );
  }

  // ── Editing somebody already in the list ──────────────────────────────────
  return (
    <Dialog
      title={`Edit ${user.displayName}`}
      note='Their details in the Foundation directory, and the role this module has granted them.'
      onClose={onClose}
      width={560}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' onClick={save} disabled={!dirty || saving}>
            <Icon name='check' size={14} />
            Save
          </Btn>
        </>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* ⚠️ `aria-label` on each input, as the fields on the requester dialog
          do: `Field` draws its caption as a styled div rather than a `<label>`,
          so the caption names the field for a reader and nothing else. */}
      <Field label='Name'>
        <Input
          aria-label='Name'
          value={details.displayName}
          onChange={(e) => setDetails({ ...details, displayName: e.target.value })}
        />
      </Field>
      <Field label='Email'>
        <Input
          aria-label='Email'
          value={details.email}
          onChange={(e) => setDetails({ ...details, email: e.target.value })}
        />
        {/* ⚠️ The note is the point of the field, not decoration. For somebody
            who has not signed in yet this address is what their first sign-in
            matches them by — correcting a typo is what makes them reachable,
            and a wrong correction hands their role to whoever really owns it.
            For everybody else it is a local copy of what the Foundation holds. */}
        <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginTop: 5, lineHeight: 1.5 }}>
          {user.signInState === 'INVITED'
            ? 'They have not signed in yet. This is the address that will match them to this account, so it has to be the one they use.'
            : 'The Foundation directory holds this address too — their next sign-in refreshes it from there.'}
        </div>
      </Field>
      <Field label='Phone'>
        <Input
          aria-label='Phone'
          value={details.phone}
          onChange={(e) => setDetails({ ...details, phone: e.target.value })}
        />
      </Field>

      {/* ⚠️ Said in words, not left to be inferred from the shape of the
          controls: these are radios because a person holds exactly one role,
          and picking another takes the old one away. */}
      <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 4, marginBottom: 8 }}>
        One role at a time — choosing another replaces the one they hold.
      </div>

      <div role='radiogroup' aria-label='Role' style={{ display: 'grid', gap: 4 }}>
        {shown.map((r) => {
          const on = chosen?.roleKey === r.roleKey;
          return (
            <div key={r.roleKey} style={{ padding: '4px 0' }}>
              <label
                htmlFor={`role-${r.roleKey}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '5px 4px',
                  cursor: r.assignable ? 'pointer' : 'not-allowed',
                }}
              >
                <Checkbox
                  id={`role-${r.roleKey}`}
                  type='radio'
                  name='held-role'
                  /* The label holds the role's description too, so the choice is
                     named explicitly rather than by everything beside it. */
                  aria-label={r.name}
                  checked={on}
                  disabled={!r.assignable}
                  onChange={() => choose(r.roleKey)}
                  style={{ marginTop: 2 }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--mfg)' }}>
                    {r.description}
                  </span>
                </span>
              </label>
              {on && chosen && scopeFor(chosen, r.name)}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
