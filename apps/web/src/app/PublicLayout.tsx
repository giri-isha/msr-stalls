// SHELL — a plain header around the public pages. Discarded at migration.
import { Link, Outlet } from 'react-router';
import { Frame, ToastProvider } from '@/modules/stalls';

export function PublicLayout() {
  return (
    <Frame>
      <ToastProvider>
        <header style={{ borderBottom: '1px solid var(--bd)', background: 'var(--card)' }}>
          <div
            style={{
              maxWidth: 760,
              margin: '0 auto',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Link
              to='/stalls/apply'
              style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--fg)', letterSpacing: '-.3px' }}
            >
              Maha Shivratri — Stalls
            </Link>
            <span style={{ fontSize: 12, color: 'var(--mfg)' }}>Isha Stall Team</span>
          </div>
        </header>
        <main style={{ maxWidth: 760, width: '100%', margin: '0 auto', padding: '22px 16px 40px', boxSizing: 'border-box' }}>
          <Outlet />
        </main>
      </ToastProvider>
    </Frame>
  );
}
