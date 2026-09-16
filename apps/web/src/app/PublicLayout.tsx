// SHELL — the chrome around the public forms. Discarded at migration.
//
// ⚠️ Deliberately NOT the backoffice shell. There is no sidebar, no account chip and
// no theme control: the reader is a vendor with a link from an email, on a
// phone, filling in one form once. Every control that is not the form is a
// thing to get wrong. What it does share is the token scope — `Frame` is the
// same, so the card, the type and the palette are the product's, not a second
// look grown for the public side.
import { Link, Outlet, useNavigate } from 'react-router';
import { RequesterProvider, useRequester } from '@/modules/stalls';
import { logoutRequester } from '@/modules/stalls/api';
import { Frame, Icon, ToastProvider, useIsMobile } from '@/modules/stalls/ui';
import { useTheme } from '@/modules/stalls/use-theme';

/** ⚠️ The requester provider wraps the whole public tree, not just the apply
 *  page. The header's "signed in as" reads it, and so does the gate on
 *  `FormPicker` and on `RequestForm` — one fetch for the lot rather than one
 *  per screen.
 *
 *  ⚠️ `ToastProvider` sits OUTSIDE it, the same way round as the backoffice
 *  shell and for the same reason: the gate on `MyRequests` swaps its whole
 *  subtree once the session lands, and a toast host inside it would unmount on
 *  that transition and drop what it was holding. The public side needs one at
 *  all because `MyRequests`, `StaffRegistration`, `BankForm` and `FssaiForm`
 *  each call `useToast()`, which THROWS outside a provider — and the shell is
 *  the only thing above all four. */
export function PublicLayout() {
  return (
    <ToastProvider>
      <RequesterProvider>
        <PublicChrome />
      </RequesterProvider>
    </ToastProvider>
  );
}

function PublicChrome() {
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
                  Stalls
                </span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--mfg)' }}>
                  Isha Stall Team
                </span>
              </span>
            </Link>
            <div style={{ flex: 1 }} />
            <SignedInAs />
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

/** Who is signed in, and the way out.
 *
 *  Nothing at all when signed out — the shell's whole point is that a vendor
 *  with a link from an email meets no chrome they have to understand, and a
 *  "Log in" button in the header would put a second, competing entry point
 *  beside the gate on the page itself. */
function SignedInAs() {
  const { requester, reload } = useRequester();
  const nav = useNavigate();
  const mobile = useIsMobile();

  if (!requester) return null;

  const signOut = async () => {
    try {
      await logoutRequester();
    } catch {
      // Nothing useful to say. The cookie is cleared server-side or it is not,
      // and `reload()` below settles what the page shows either way.
    }
    reload();
    nav('/stalls/apply');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {!mobile && (
        <span
          style={{
            fontSize: 12,
            color: 'var(--mfg)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 180,
          }}
        >
          {requester.displayName}
        </span>
      )}
      <button
        type='button'
        onClick={() => void signOut()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 30,
          padding: '0 10px',
          borderRadius: 'var(--r2)',
          border: '1px solid var(--bd)',
          background: 'var(--card)',
          color: 'var(--mfg)',
          fontSize: 12,
          cursor: 'pointer',
          flex: 'none',
        }}
      >
        <Icon name='log-out' size={14} />
        Log Out
      </button>
    </div>
  );
}
