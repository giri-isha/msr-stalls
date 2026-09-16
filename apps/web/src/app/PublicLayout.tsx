// SHELL — the chrome around the public forms. Discarded at migration.
//
// ⚠️ Deliberately NOT the backoffice shell. There is no sidebar and no account
// menu: the reader is a requester filling in one form, often on a phone, and
// every control that is not the form is a thing to get wrong. What it does
// share is the token scope — `Frame` is the same, so the card, the type and the
// palette are the product's, not a second look grown for the public side.
//
// 🔴 It is WIDE now, and it has a nav. The forms are forty-odd questions and
// the requests page reads a whole application back; both were drawn in a 760px
// column, which on a laptop left two thirds of the screen empty and turned
// every form into a mile of scrolling. The column is 1060, the form lays its
// short answers two-up (see `RequestForm`), and the two places a signed-in
// requester goes — the forms, and their own requests — are tabs at the top
// rather than a sentence with a link in it.
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { RequesterProvider, useRequester } from '@/modules/stalls';
import { logoutRequester } from '@/modules/stalls/api';
import { Frame, Icon, ToastProvider, useIsMobile } from '@/modules/stalls/ui';
import { useTheme } from '@/modules/stalls/use-theme';

/** How wide the public side runs. One number, read by the header and the
 *  route slot, so the nav and the page it sits over cannot drift apart. */
const WIDTH = 1060;

/** ⚠️ The requester provider wraps the whole public tree, not just the apply
 *  page. The header's nav and "signed in as" read it, and so does the gate on
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
            // Sticky, because the nav is now the way between the two public
            // screens and both of them are long: a tab strip that has scrolled
            // away is a tab strip that is not there.
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <div
            style={{
              margin: '0 auto',
              maxWidth: WIDTH,
              display: 'flex',
              alignItems: 'center',
              gap: mobile ? 10 : 18,
              padding: mobile ? '10px 14px' : '12px 22px',
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
                  width: 32,
                  height: 32,
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
            {/* On a laptop the tabs sit beside the mark; on a phone they get
                their own rail below, where they are thumb-width. */}
            {!mobile && <Nav />}
            <div style={{ flex: 1 }} />
            <SignedInAs />
            {/* The one control that stays whoever is reading. A form filled in
                at night on a phone is the case dark mode exists for. */}
            <button
              type='button'
              onClick={toggle}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
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
          {mobile && (
            <div
              style={{
                margin: '0 auto',
                maxWidth: WIDTH,
                padding: '0 8px',
                borderTop: '1px solid var(--line)',
              }}
            >
              <Nav />
            </div>
          )}
        </header>
        <main
          style={{
            margin: '0 auto',
            maxWidth: WIDTH,
            padding: mobile ? '16px 14px 72px' : '26px 22px 64px',
          }}
        >
          <Outlet />
        </main>
      </div>
    </Frame>
  );
}

/**
 * Where a signed-in requester can go: the forms, and their own requests.
 *
 * 🔴 "My Requests" was a sentence with a link in it, halfway down the apply
 * page. A requester coming back to check on a request they filed in June was
 * landing on the form they had already filled and having to read their way to
 * the link — so the two destinations are a rail at the top, and the one you are
 * on is underlined.
 *
 * ⚠️ NOTHING at all when signed out, which is the rule the rest of this shell
 * follows: a vendor holding a bank-form link from an email meets no chrome they
 * have to understand, and a nav offering pages that would bounce them to a
 * login is chrome at its worst. `ui/components/Tabs.tsx` is deliberately not
 * used — that one is a state-driven strip inside a page, and these are two
 * routes, which have to be real links a reader can middle-click and a screen
 * reader can announce as navigation.
 */
function Nav() {
  const { requester } = useRequester();
  const { pathname } = useLocation();
  if (!requester) return null;

  const items = [
    { to: '/stalls/apply', label: 'Request a Stall', glyph: 'ticket' },
    { to: '/stalls/requests', label: 'My Requests', glyph: 'list-view' },
  ];

  return (
    <nav
      aria-label='Stalls'
      style={{ display: 'flex', gap: 2, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}
    >
      {items.map((item) => {
        // ⚠️ `startsWith`, so `/stalls/apply/vendor` keeps the Request tab lit
        // while the form is open. A requester filling one in has not left the
        // section, and an unlit rail would say they had.
        const on = pathname === item.to || pathname.startsWith(`${item.to}/`);
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={on ? 'page' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 12px',
              // The underline sits on the header's own bottom border, so the
              // rail reads as an edge of the page rather than a row of pills.
              borderBottom: `2px solid ${on ? 'var(--pri)' : 'transparent'}`,
              marginBottom: -1,
              fontSize: 12.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: on ? 'var(--pri)' : 'var(--mfg)',
            }}
          >
            <Icon name={item.glyph} size={14} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Who is signed in, and the way out.
 *
 *  Nothing at all when signed out — see the note on `Nav`. */
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
        // ⚠️ Labelled whatever it draws. On a phone it is the glyph alone —
        // "Log Out" beside a name beside a theme toggle does not fit — and an
        // unlabelled icon button is a button a screen reader cannot name.
        aria-label='Log Out'
        title='Log Out'
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 32,
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
        {mobile ? '' : 'Log Out'}
      </button>
    </div>
  );
}
