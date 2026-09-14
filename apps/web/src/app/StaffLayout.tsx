// SHELL — the sidebar chrome around the staff screens, and the sign-in gate.
// Discarded at migration: the host has its own shell, nav and Isha SSO. What
// survives is what this wraps — the module's Frame, ToastProvider, MeProvider
// and screens. Styled with the module's own tokens so it looks like the
// module it hosts.
import { NavLink, Outlet } from 'react-router';
import { Frame, Icon, MeProvider, STALLS_NAV, ToastProvider, useMe } from '@/modules/stalls';
import { apiFetch } from '@/modules/stalls/api-client';
import { Btn, Loading } from '@/modules/stalls/ui/ui';
import { useIsNarrow } from '@/modules/stalls/ui/useBreakpoint';
import { DevSignIn } from './DevSignIn';

function Sidebar() {
  const { me, reload } = useMe();
  const narrow = useIsNarrow();
  const items = STALLS_NAV.filter((n) => !n.requires || me?.actions.includes(n.requires));
  const groups = [...new Set(items.map((n) => n.group))];
  const signOut = async () => {
    await apiFetch('/api/dev/signout', { method: 'POST' });
    reload();
  };

  const link = (n: (typeof items)[number]) => (
    <NavLink
      key={n.to}
      to={n.to}
      end={n.end}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: narrow ? '7px 10px' : '7px 10px',
        borderRadius: 'var(--r2)',
        fontSize: 13,
        fontWeight: isActive ? 700 : 500,
        color: isActive ? 'var(--pri)' : 'var(--fg)',
        background: isActive ? 'var(--pri-t)' : 'transparent',
        whiteSpace: 'nowrap',
        textDecoration: 'none',
      })}
    >
      <Icon name={n.icon} size={15} />
      {n.label}
    </NavLink>
  );

  if (narrow) {
    return (
      <div style={{ borderBottom: '1px solid var(--bd)', background: 'var(--card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, flex: 1 }}>MSR Stalls</div>
          <span style={{ fontSize: 12, color: 'var(--mfg)' }}>{me?.displayName}</span>
          <Btn onClick={signOut}>Sign out</Btn>
        </div>
        <nav style={{ display: 'flex', gap: 4, overflowX: 'auto', padding: '0 10px 10px' }}>{items.map(link)}</nav>
      </div>
    );
  }

  return (
    <aside
      style={{
        width: 236,
        flex: 'none',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid var(--bd)',
        background: 'var(--card)',
      }}
    >
      <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.7px', textTransform: 'uppercase', color: 'var(--mfg)' }}>
          Sahayaka
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, letterSpacing: '-.3px', marginTop: 2 }}>
          MSR Stalls
        </div>
      </div>
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
        {groups.map((group) => (
          <div key={group ?? 'root'} style={{ marginBottom: 14 }}>
            {group && (
              <div style={{ padding: '4px 10px 4px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--mfg)' }}>
                {group}
              </div>
            )}
            <div style={{ display: 'grid', gap: 2 }}>{items.filter((n) => n.group === group).map(link)}</div>
          </div>
        ))}
      </nav>
      <div style={{ padding: 14, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {me?.displayName}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mfg)', marginBottom: 8 }}>
          {me?.roleKeys.map((r) => r.replace('stalls_', '')).join(', ') || 'no stalls role'}
        </div>
        <Btn onClick={signOut}>Sign out</Btn>
      </div>
    </aside>
  );
}

function Gate() {
  const { me, status, reload } = useMe();
  const narrow = useIsNarrow();
  if (status === 'loading') return <Loading />;
  if (!me) return <DevSignIn onSignedIn={reload} />;
  return (
    <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, padding: narrow ? 14 : 26 }}>
        <Outlet />
      </main>
    </div>
  );
}

export function StaffLayout() {
  return (
    <Frame>
      <ToastProvider>
        <MeProvider>
          <Gate />
        </MeProvider>
      </ToastProvider>
    </Frame>
  );
}
