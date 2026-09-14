// SHELL — the chrome around the public forms. Discarded at migration.
//
// ⚠️ Deliberately NOT the staff shell. There is no sidebar, no account chip and
// no theme control: the reader is a vendor with a link from an email, on a
// phone, filling in one form once. Every control that is not the form is a
// thing to get wrong. What it does share is the token scope — `Frame` is the
// same, so the card, the type and the palette are the product's, not a second
// look grown for the public side.
import { Link, Outlet } from 'react-router';
import { Frame, Icon, useIsMobile } from '@/modules/stalls/ui';
import { useTheme } from '@/lib/use-theme';

export function PublicLayout() {
  const mobile = useIsMobile();
  const { theme, toggle } = useTheme();

  return (
    <Frame>
      <div style={{ minHeight: '100svh', background: 'var(--bg)' }}>
        <header
          style={{
            borderBottom: '1px solid var(--bd)',
            background: 'var(--card)',
          }}
        >
          <div
            style={{
              margin: '0 auto',
              maxWidth: 760,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: mobile ? '11px 14px' : '13px 20px',
            }}
          >
            <Link
              to='/stalls/apply'
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minWidth: 0,
                color: 'var(--fg)',
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 'var(--r3)',
                  background: 'var(--pri)',
                  color: 'var(--pfg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                }}
              >
                <Icon name='ticket' size={16} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontWeight: 700,
                    fontSize: 14,
                    letterSpacing: '-.2px',
                  }}
                >
                  Maha Shivratri — Stalls
                </span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--mfg)' }}>
                  Isha Stall Team
                </span>
              </span>
            </Link>
            <div style={{ flex: 1 }} />
            {/* The one control that stays. A form filled in at night on a
                phone is the case dark mode exists for, and the page has no
                other chrome to put it in. */}
            <button
              type='button'
              onClick={toggle}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                borderRadius: 'var(--r2)',
                border: '1px solid var(--bd)',
                background: 'var(--card)',
                color: 'var(--mfg)',
                cursor: 'pointer',
                flex: 'none',
              }}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
            </button>
          </div>
        </header>
        <main
          style={{
            margin: '0 auto',
            maxWidth: 760,
            padding: mobile ? '16px 14px 72px' : '26px 20px 64px',
          }}
        >
          <Outlet />
        </main>
      </div>
    </Frame>
  );
}
