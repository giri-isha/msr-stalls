// SHELL — sidebar chrome around the staff screens, plus the sign-in gate.
// Discarded at migration: the host has its own shell, its own nav and Isha
// SSO. What survives is what this wraps — `MeProvider` and the screens.
import { LogOut } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { MeProvider, STALLS_NAV, useMe } from '@/modules/stalls';
import { DevSignIn } from './DevSignIn';

function Sidebar() {
  const { me, reload } = useMe();
  const groups = [...new Set(STALLS_NAV.map((n) => n.group))];
  const signOut = async () => {
    await apiFetch('/api/dev/signout', { method: 'POST' });
    reload();
  };
  return (
    <aside className='flex w-60 shrink-0 flex-col border-r border-line bg-surface'>
      <div className='border-b border-line px-5 py-4'>
        <div className='text-xs font-semibold uppercase tracking-wider text-ink-3'>Sahayaka</div>
        <div className='mt-0.5 text-base font-bold'>MSR Stalls</div>
      </div>
      <nav className='flex-1 overflow-y-auto px-3 py-3'>
        {groups.map((group) => (
          <div key={group ?? 'root'} className='mb-4'>
            {group && (
              <div className='px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3'>
                {group}
              </div>
            )}
            {STALLS_NAV.filter((n) => n.group === group)
              .filter((n) => !n.requires || me?.actions.includes(n.requires))
              .map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-2 py-1.5 text-sm',
                      isActive
                        ? 'bg-accent-soft font-semibold text-accent'
                        : 'text-ink hover:bg-surface-2',
                    )
                  }
                >
                  {n.label}
                </NavLink>
              ))}
          </div>
        ))}
      </nav>
      <div className='border-t border-line px-4 py-3'>
        <div className='truncate text-sm font-medium'>{me?.displayName}</div>
        <div className='truncate text-xs text-ink-2'>
          {me?.roleKeys.map((r) => r.replace('stalls_', '')).join(', ') || 'no stalls role'}
        </div>
        <Button variant='ghost' size='sm' className='mt-2 w-full justify-start' onClick={signOut}>
          <LogOut className='h-3.5 w-3.5' /> Sign out
        </Button>
      </div>
    </aside>
  );
}

function Gate() {
  const { me, status, reload } = useMe();
  if (status === 'loading') {
    return <div className='p-10 text-sm text-ink-2'>Loading…</div>;
  }
  if (!me) return <DevSignIn onSignedIn={reload} />;
  return (
    <div className='flex min-h-screen'>
      <Sidebar />
      <main className='min-w-0 flex-1 overflow-auto p-7'>
        <Outlet />
      </main>
    </div>
  );
}

export function StaffLayout() {
  return (
    <MeProvider>
      <Gate />
    </MeProvider>
  );
}
