import { useState } from 'react';
import {
  ROLES,
  type DirectoryUser,
  type DirectoryView,
  type SignInState,
  isPlaceholderEmail,
} from '@msr/stalls';
import * as api from '../api';
import { Panel } from '../components/Panel';
import { useDebounced, useLoad } from '../hooks';
import {
  Avatar,
  Btn,
  Dialog,
  Empty,
  ErrorBox,
  Icon,
  IconBtn,
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
 * can never be granted `config:write` — see `ROLES` — and the fact that they
 * appear in one list here changes nothing about that: a requester row has no
 * role to grant and no control that would grant one.
 *
 * ⚠️ **The tiles ARE the view filter.** Their labels are the values the server
 * understands, passed back verbatim by `StatTiles`, so the strings in
 * `DIRECTORY_VIEWS` are a contract and not copy. The counts beside them are
 * narrowed by the search and the Filter popover but never by the active view —
 * the server's doing, and the reason is written where it happens.
 */
export function Users({ writable }: { writable: boolean }) {
  const toast = useToast();
  const mobile = useIsMobile();

  const [view, setView] = useState<DirectoryView>('All');
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed);
  const [roleKey, setRoleKey] = useState('');
  const [signInState, setSignInState] = useState<SignInState | ''>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = usePageSize('users');
  const [shown, setShown] = useState<Set<ColKey>>(() => new Set(DEFAULT_COLUMNS));
  const [adding, setAdding] = useState(false);
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

  const revoke = async (personId: string, rk: string) => {
    try {
      await api.revokeRole(personId, rk);
      toast.ok('Revoked');
      dir.reload();
    } catch (e) {
      toast.fail(e);
    }
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
            {ROLES.map((r) => (
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
              {ROLES.map((r) => (
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
                    value: cell(c.key, u, { writable, onRevoke: revoke }),
                  }))}
                actions={<Actions user={u} writable={writable} onAsk={setAsk} />}
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
                      {cell(c.key, u, { writable, onRevoke: revoke })}
                    </TD>
                  ))}
                  <TD align='right'>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Actions user={u} writable={writable} onAsk={setAsk} />
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
 * and at most two of these are ever shown at once — Unlock appears only on a
 * locked row, Resend only on an unconfirmed one. A menu would be a click in
 * front of every one of them to hide a crowd that does not form.
 *
 * ⚠️ Both mail actions ask first. They put a letter in a vendor's inbox, and a
 * mis-click on a dense row should not be able to do that.
 */
function Actions({
  user,
  writable,
  onAsk,
}: {
  user: DirectoryUser;
  writable: boolean;
  onAsk: (ask: Ask) => void;
}) {
  if (!writable) return null;

  if (user.kind === 'STAFF') {
    // A staff member's roles are revoked from the chips in the Roles column,
    // where each × sits beside the role it removes. A second control here
    // would have to ask which one.
    return null;
  }

  // An account registered on a number carries an address nothing delivers to.
  // Naming it on the confirm dialog would promise a letter that never arrives.
  const where = isPlaceholderEmail(user.email) && user.phone ? user.phone : user.email;

  return (
    <>
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

function cell(
  key: ColKey,
  u: DirectoryUser,
  opts: { writable: boolean; onRevoke: (personId: string, roleKey: string) => void },
): React.ReactNode {
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {u.roleKeys.map((rk) => (
            <span key={rk} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Tag tone='violet' size='sm'>
                {ROLES.find((r) => r.roleKey === rk)?.name ?? rk}
              </Tag>
              {/* The × sits beside the role it removes. That is why a staff
                  row has no action at the end of it — a control there would
                  have to ask which role it meant. */}
              {opts.writable && (
                <button
                  type='button'
                  aria-label={`Revoke ${rk} from ${u.displayName}`}
                  onClick={() => opts.onRevoke(u.id, rk)}
                  style={{
                    display: 'flex',
                    border: 0,
                    background: 'none',
                    padding: 2,
                    cursor: 'pointer',
                    color: 'var(--mfg)',
                  }}
                >
                  <Icon name='x' size={13} />
                </button>
              )}
            </span>
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
  const [roleKey, setRoleKey] = useState(ROLES[1].roleKey);

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
      await api.grantRole(personId, roleKey);
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
          {ROLES.map((r) => (
            <option key={r.roleKey} value={r.roleKey}>
              {r.name}
            </option>
          ))}
        </Select>
      </div>

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
            <Btn kind='primary' onClick={() => grant(p.personId)}>
              Grant
            </Btn>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
