// SHELL — the chrome around the public forms. Discarded at migration.
//
// ⚠️ Deliberately NOT the backoffice shell. There is no sidebar and no account
// menu: the reader is a requester filling in one form, often on a phone, and
// every control that is not the form is a thing to get wrong. What it does
// share is the token scope — `Frame` is the same, so the card, the type and the
// palette are the product's, not a second look grown for the public side.
//
// 🔴 FLUID, and with a button where there was a nav. The public side ran in a
// 1060px column with a two-tab rail — Request a Stall, My Requests — and the
// first of those is an action, not a place. With the requests page as the
// portal there is nothing left to tab between: the way to a new request is a
// primary button at the top right, and the page takes the width it is given.
import { canFileMore } from '@stalls/core';
import { Link, Outlet, useNavigate } from 'react-router';
import { RequesterProvider, useRequester } from '@/modules/stalls';
import { logoutRequester } from '@/modules/stalls/api';
import { Btn, Frame, Icon, ToastProvider, useIsMobile } from '@/modules/stalls/ui';
import { useTheme } from '@/modules/stalls/use-theme';

/** ⚠️ The requester provider wraps the whole public tree, not just the apply
 *  page. The header's button and "signed in as" read it, and so does the gate
 *  on `FormPicker` and on `RequestForm` — one fetch for the lot rather than one
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
  const { requester } = useRequester();

  return (
    <Frame>
      <div style={{ minHeight: '100svh', background: 'var(--bg)' }}>
        <header
          style={{
            borderBottom: '1px solid var(--bd)',
            background: 'var(--card)',
            // Sticky: the requests page is long and the way to a new request
            // should not have scrolled away by the time somebody wants it.
            position: 'sticky',
            top: 0,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: mobile ? 8 : 12,
            padding: mobile ? '10px 14px' : '12px 28px',
          }}
        >
          <Link
            // Signed in, the mark goes home to the portal; signed out there is
            // no portal to go to, and the forms are the front door.
            to={requester ? '/stalls/requests' : '/stalls/apply'}
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
          <div style={{ flex: 1 }} />
          <RequestStallButton />
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
        </header>
        <main style={{ padding: mobile ? '16px 14px 72px' : '26px 28px 64px' }}>
          <Outlet />
        </main>
      </div>
    </Frame>
  );
}

/**
 * The way to a new request — a primary button, because it is the one thing a
 * signed-in requester DOES from here rather than a place they go.
 *
 * ⚠️ NOTHING at all when signed out, which is the rule the rest of this shell
 * follows: a vendor holding a bank-form link from an email meets no chrome they
 * have to understand, and a button that would bounce them to a login is chrome
 * at its worst.
 *
 * 🔴 And nothing once the account has spent the edition's cap. The button is an
 * offer, and an offer the post would refuse is worse than no offer: it costs a
 * requester a whole form to find out. `canFileMore` is the same reading the
 * apply page makes of the same number, and the number is counted by the
 * function that enforces the cap on the write.
 *
 * ⚠️ Labelled whatever it draws. On a phone it is the glyph alone — the label
 * beside a name beside two more buttons does not fit — and an unlabelled icon
 * button is a button a screen reader cannot name.
 */
function RequestStallButton() {
  const { requester } = useRequester();
  const mobile = useIsMobile();
  if (!requester) return null;
  // ⚠️ `allowance` is undefined on a page served ahead of an API that does not
  // send it yet; `canFileMore` reads null as "not capped", so deploy skew keeps
  // the button rather than hiding it.
  if (!canFileMore(requester.allowance ?? null)) return null;

  return (
    <Link
      to='/stalls/apply'
      aria-label='New Request'
      title='New Request'
      style={{ color: 'inherit' }}
    >
      <Btn kind='primary'>
        <Icon name='plus' size={14} />
        {mobile ? '' : 'New Request'}
      </Btn>
    </Link>
  );
}

/** Who is signed in, and the way out.
 *
 *  Nothing at all when signed out — see the note on `RequestStallButton`. */
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
