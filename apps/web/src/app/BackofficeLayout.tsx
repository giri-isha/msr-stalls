// SHELL — the backoffice chrome, and the sign-in gate.
//
// Discarded at migration: the host has its own shell, its own nav and Isha SSO.
// What survives is what this wraps — `MeProvider`, `ToastProvider` and the
// screens.
//
// ⚠️ The chrome is a near-copy of the MSR Volunteering module's `ModuleApp`
// shell: a 256px sidebar that collapses to a 64px rail on desktop and becomes a
// slide-over drawer below 1024, a 52px topbar, and a breadcrumb strip above the
// content. Same measurements, same tokens, same behaviour — see
// `modules/stalls/ui/frame.tsx` for the provenance of the whole system.
//
// ⚠️ What is NOT copied is the module switcher and the notification bell. There
// is one module here and no notification feed; a tile that bounces off a picker
// and a bell that never rings are controls that appear to do something and do
// not, which is the defect the volunteering shell's own notes spend three
// paragraphs on. When this lands in the host, that chrome comes from the host.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { apiFetch } from '@/modules/stalls/api-client';
import { useTheme } from '@/modules/stalls/use-theme';
import type { ResolvedNavGroup } from '@stalls/core';
import { MeProvider, useMe } from '@/modules/stalls';
import { RefreshProvider, useRefresh } from '@/modules/stalls/refresh';
import { InstallPrompt } from './UpdateToast';
import {
  Frame,
  Icon,
  Loading,
  scrim,
  ToastProvider,
  useEscape,
  useIsMobile,
  useIsNarrow,
  useLockScroll,
  useSidebarRail,
  titleCase,
} from '@/modules/stalls/ui';
import { DevSignIn } from './DevSignIn';

/**
 * Nav items kept OUT OF THE SIDEBAR, and out of it only.
 *
 * ⚠️ Hidden here in the chrome rather than removed from `NAV_ITEMS`, because
 * the registry entry is doing three other jobs: it is what the API resolves the
 * caller's `onboarding.read` against, it is the row Configs › Sidebar offers an
 * admin, and it is what `nav` below matches the path against to title the
 * breadcrumb. Deleting it would take the screen's own crumb away and leave it
 * reading "Home".
 *
 * Vendor Onboarding is reached from the Home page instead — its Onboarding
 * Progress card links there, and the Quick Links card still lists it as a tile,
 * which is why the filter is applied to `<Sidebar groups>` and NOT to `nav`.
 */
const SIDEBAR_HIDDEN = new Set(['onboarding']);

/** The mark, in the sidebar head and on the sign-in screen. */
const APP_NAME = 'Stall Management';
const APP_SUB = 'Requests, selection and operations';

function Sidebar({
  rail,
  narrow,
  open,
  groups,
  onToggleRail,
  onNavigate,
}: {
  rail: boolean;
  narrow: boolean;
  open: boolean;
  /** Already resolved — see `useMe().nav`. This component filters nothing. */
  groups: ResolvedNavGroup[];
  onToggleRail: () => void;
  onNavigate: () => void;
}) {
  return (
    // ⚠️ A `<nav>`, where the module this chrome was copied from uses `<aside>`.
    // The look is identical; the role is not. An `<aside>` is `complementary` —
    // "related but separable content" — so a reader jumping by landmark finds
    // the primary navigation of the app filed next to a pull quote, and
    // `role="navigation"` never appears on the page at all. The one place the
    // copy is deliberately not followed.
    <nav
      aria-label='Main Navigation'
      style={{
        width: rail ? 64 : 256,
        flex: 'none',
        background: 'var(--card)',
        borderRight: '1px solid var(--bd)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        ...(narrow
          ? {
              position: 'fixed',
              top: 0,
              bottom: 0,
              left: 0,
              zIndex: 201,
              height: '100dvh',
              transform: open ? 'translateX(0)' : 'translateX(-100%)',
              boxShadow: open ? 'var(--sh)' : 'none',
              // Off-canvas it must also leave the tab order and the
              // accessibility tree — `visibility` does both, where a bare
              // transform would leave every nav item Tab-reachable behind the
              // page. Hiding waits for the slide to finish; showing does not.
              visibility: open ? 'visible' : 'hidden',
              transition: open
                ? 'transform .22s cubic-bezier(.32,.72,0,1)'
                : 'transform .22s cubic-bezier(.32,.72,0,1), visibility 0s linear .22s',
            }
          : // `alignSelf` stops the aside stretching the flex row; `sticky`
            // keeps it in view down a long pipeline. It resolves against the
            // viewport rather than a scrollport because `tokens.css` clips the
            // module on one axis with `clip` rather than `hidden` — see the note
            // there, it is the difference between a sidebar that sticks and one
            // that scrolls away.
            { position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: '100svh' }),
      }}
    >
      {/* The mark, the app's name, and the control that takes the name away.
          On a rail the row becomes a column: 64px has room for the mark or the
          toggle beside it, not both. */}
      <div
        style={{
          display: 'flex',
          flexDirection: rail ? 'column' : 'row',
          alignItems: 'center',
          gap: rail ? 8 : 10,
          padding: rail ? '16px 0 12px' : '18px 14px 16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
            flex: rail ? 'none' : 1,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--r3)',
              background: 'var(--pri)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--pfg)',
              flex: 'none',
            }}
          >
            {/* The brand mark, and the same one `tools/make-icons.py` draws into the
                installed icon. Change it here and the icons are stale until that
                script is re-run and its PNGs committed. */}
            <Icon name='store' size={17} />
          </div>
          {!rail && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-.2px' }}>
                {APP_NAME}
              </div>
              <div style={{ color: 'var(--mfg)', fontSize: 10.5 }}>{APP_SUB}</div>
            </div>
          )}
        </div>
        {/* ⚠️ Not rendered below 1024, where the sidebar is a drawer: there is
            nothing to collapse, and the control would offer a width the shell
            then refuses to apply. The drawer's own way out is the scrim,
            Escape, or picking a destination. */}
        {!narrow && (
          <button
            type='button'
            onClick={onToggleRail}
            style={railBtn}
            title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!rail}
          >
            <Icon name={rail ? 'chevrons-right' : 'chevrons-left'} size={15} />
          </button>
        )}
      </div>

      {groups.map((group) => {
        const items = group.items;
        if (items.length === 0) return null;
        return (
          <div key={group.title} style={{ padding: '0 12px 14px' }}>
            {/* ⚠️ The heading becomes a RULE on a rail, not nothing. Glyphs in
                one unbroken column lose the grouping, and the grouping is how
                people find the one they want — a line keeps it at a width that
                cannot hold the word. The ungrouped items at the top get
                neither. */}
            {group.title &&
              (rail ? (
                <div style={{ height: 1, background: 'var(--line)', margin: '0 6px 9px' }} />
              ) : (
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.9px',
                    color: 'var(--mfg)',
                    textTransform: 'uppercase',
                    padding: '0 8px 7px',
                  }}
                >
                  {group.title}
                </div>
              ))}
            {items.map((n) => (
              <NavLink
                key={n.key}
                to={n.to}
                end={n.end}
                onClick={onNavigate}
                // ⚠️ The name, always — not only on a rail. Collapsed it is the
                // ONLY way to find out what a glyph means; expanded it costs
                // nothing and names the items whose label is clipped.
                title={n.label}
                style={({ isActive }) => navItemStyle(isActive, rail)}
              >
                <span style={iconSlot}>
                  <Icon name={n.glyph} size={16} />
                </span>
                {!rail && <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>{n.label}</span>}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Topbar({
  onMenu,
  onBack,
  crumb,
  title,
}: {
  /** Opens the nav drawer. Null on desktop, where the sidebar is always shown. */
  onMenu: (() => void) | null;
  /** One step back. Null on the dashboard, which is where back would leave. */
  onBack: (() => void) | null;
  crumb: string;
  title: string;
}) {
  const { me, reload } = useMe();
  const mobile = useIsMobile();
  const { theme, toggle: toggleTheme } = useTheme();
  const { refreshing, refresh } = useRefresh();
  const [menuOpen, setMenuOpen] = useState(false);

  // The screens refetch off the token in `useRefresh`; `/me` is the one thing
  // no screen loads, so the button reloads it too. A role granted or a sidebar
  // rearranged while somebody had the tab open lands with the rest, instead of
  // waiting for them to think of a hard reload.
  const refreshAll = () => {
    refresh();
    reload();
  };

  const signOut = async () => {
    await apiFetch('/api/dev/signout', { method: 'POST' });
    reload();
  };

  const roles = me?.roleKeys.map((r) => titleCase(r.replace('stalls_', ''))).join(', ');
  // `filter(Boolean)` has already dropped the empty segments a double space
  // leaves, so every word here has a first character — but that is a fact about
  // the line above rather than something the type says, so it is read with
  // `charAt`, which returns '' instead of asserting.
  const initials = (me?.displayName ?? '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: mobile ? '0 10px' : '0 18px',
          height: 52,
          borderBottom: '1px solid var(--bd)',
          background: 'var(--card)',
          position: 'relative',
        }}
      >
        {onMenu && (
          <button
            type='button'
            onClick={onMenu}
            style={topBtn}
            title='Menu'
            aria-label='Open Navigation'
          >
            <Icon name='menu' size={17} />
          </button>
        )}
        {onBack && (
          <button type='button' onClick={onBack} style={topBtn} title='Back' aria-label='Back'>
            <Icon name='chevron-left' size={16} />
          </button>
        )}
        <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-.2px' }}>{APP_NAME}</div>

        <div style={{ flex: 1 }} />

        {/* The role, as a reading rather than a control — this module has no
            roles screen to send anybody to. Sheds on a phone with the rest of
            the row; the account menu carries it there. */}
        {!mobile && roles && (
          <div style={{ fontSize: 12, color: 'var(--mfg)' }}>{roles || 'no stalls role'}</div>
        )}

        {/* Re-run whatever this screen is loading — see `refresh.tsx`. NOT a
            page reload: the filters, the scroll position, the expanded rows and
            anything half-typed all survive it, which is the difference between
            a control people use to check for something new and one they learn
            to avoid. Kept on a phone, where a stale list is most likely to be
            the thing being looked at. */}
        <button
          type='button'
          onClick={refreshAll}
          disabled={refreshing}
          style={{ ...topBtn, cursor: refreshing ? 'default' : 'pointer' }}
          title='Refresh'
          aria-label='Refresh'
        >
          <span
            className={refreshing ? 'stalls-spin' : undefined}
            style={{ display: 'flex' }}
            aria-hidden
          >
            <Icon name='refresh' size={15} />
          </span>
        </button>

        {/* The theme, in the bar rather than inside the account menu. It used
            to be a row in that menu, which put a control people reach for
            daily two clicks deep and behind a chip labelled with somebody's
            initials. Same button, same style and same position as the public
            shell's, so the one control both shells share sits in the same
            place in each. */}
        <button
          type='button'
          onClick={toggleTheme}
          style={topBtn}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        </button>

        <div style={{ position: 'relative', flex: 'none' }}>
          <button
            type='button'
            onClick={() => setMenuOpen((o) => !o)}
            aria-label='Account Menu'
            aria-expanded={menuOpen}
            style={{ ...avatarChip, border: 0, padding: 0, cursor: 'pointer' }}
          >
            {initials}
          </button>

          {menuOpen && (
            <>
              {/* Tapping anywhere else closes it. A full-screen catcher is
                  simpler and more reliable on touch than a document listener
                  racing the tap that opened the menu. */}
              <button
                type='button'
                aria-label='Close Menu'
                onClick={() => setMenuOpen(false)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 69,
                  border: 0,
                  background: 'transparent',
                  cursor: 'default',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  zIndex: 70,
                  width: 220,
                  background: 'var(--pop)',
                  border: '1px solid var(--bd)',
                  borderRadius: 'var(--r4)',
                  boxShadow: 'var(--sh-3)',
                  padding: 8,
                }}
              >
                <div
                  style={{
                    padding: '6px 10px 8px',
                    borderBottom: '1px solid var(--line)',
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {me?.displayName}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
                    {roles || 'no stalls role'}
                  </div>
                </div>
                <MenuItem
                  icon='log-out'
                  label='Sign Out'
                  onClick={() => {
                    setMenuOpen(false);
                    void signOut();
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* The trail and the title. On a phone only the title survives — a
          breadcrumb and a heading competing for 360px gives two clipped lines
          instead of one readable one. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          padding: mobile ? '11px 14px' : '13px 26px',
          borderBottom: '1px solid var(--bd)',
          background: 'var(--card)',
        }}
      >
        {!mobile && <div style={{ fontSize: 11.5, color: 'var(--mfg)' }}>{crumb} ›</div>}
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '-.3px',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </div>
      </div>
    </>
  );
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '11px 10px',
        borderRadius: 'var(--r2)',
        border: 0,
        background: 'none',
        color: 'var(--fg)',
        cursor: 'pointer',
        fontSize: 13.5,
        textAlign: 'left',
      }}
    >
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
}

function Gate() {
  const { me, status, reload, nav } = useMe();
  const { pathname } = useLocation();
  const narrow = useIsNarrow();
  const mobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The collapsed/expanded choice, remembered per browser.
  //
  // ⚠️ GATED ON THE BREAKPOINT. Below 1024 the sidebar is a slide-over, which
  // is already collapsed in the only sense that matters — a 64px rail over the
  // content would be a third state nobody asked for. So the preference is kept
  // and simply not applied there.
  const { rail: railWanted, toggle: toggleRail } = useSidebarRail();

  // A group emptied by the filter is dropped with it — a heading with nothing
  // under it is a rule across the rail and nothing else.
  const sidebarGroups = useMemo(
    () =>
      nav
        .map((g) => ({ ...g, items: g.items.filter((i) => !SIDEBAR_HIDDEN.has(i.key)) }))
        .filter((g) => g.items.length > 0),
    [nav],
  );
  const rail = railWanted && !narrow;
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useEscape(closeDrawer, narrow && drawerOpen);
  useLockScroll(narrow && drawerOpen);

  // Navigating is the whole reason the drawer was opened. The nav items close
  // it on click too; this catches the routes reached another way — a back
  // gesture, or a link inside a screen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the path is the trigger
  useEffect(() => closeDrawer(), [pathname, closeDrawer]);

  // ⚠️ `&& !me` — the FIRST load only. `reload()` puts the provider back into
  // `loading`, and without this guard the refresh button would replace the
  // whole backoffice with a spinner every time it was pressed. Same shape the
  // screens use for the same reason: keep what you have while you refetch it.
  if (status === 'loading' && !me) {
    return (
      <Frame>
        <Loading />
      </Frame>
    );
  }
  if (!me) {
    return (
      <Frame>
        <DevSignIn onSignedIn={reload} />
      </Frame>
    );
  }

  // Which nav row the current path belongs to — for the breadcrumb and the
  // title. Read from the RESOLVED nav, so the trail names the heading this
  // caller's sidebar actually puts the screen under rather than the one the
  // registry ships. A route with no row (a request record, a report) keeps its
  // parent's crumb, which is the honest answer: it is inside that screen.
  const current = nav
    .flatMap((g) => g.items.map((item) => ({ item, title: g.title })))
    .filter((n) => (n.item.end ? n.item.to === pathname : pathname.startsWith(n.item.to)))
    // The longest match wins: `/m/stalls` prefixes every path in the module, and
    // without this every screen would read "Home".
    .sort((a, b) => b.item.to.length - a.item.to.length)[0];

  return (
    <Frame>
      {/* ⚠️ `minHeight: 100svh` so the sidebar column runs the height of the
          page rather than stopping at the content and leaving the canvas showing
          below it. `svh`, not `vh`: on a phone `vh` is the TALLEST viewport, so
          the bottom of the column sits under the browser's own bar until it is
          scrolled. */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: '100svh',
          minWidth: 0,
          background: 'var(--bg)',
        }}
      >
        {narrow && drawerOpen && (
          <button
            type='button'
            aria-label='Close Navigation'
            onClick={closeDrawer}
            style={{ ...scrim, border: 0, padding: 0 }}
          />
        )}

        <Sidebar
          rail={rail}
          narrow={narrow}
          open={drawerOpen}
          groups={sidebarGroups}
          onToggleRail={toggleRail}
          onNavigate={closeDrawer}
        />

        <main style={{ flex: 1, minWidth: 0 }}>
          <Topbar
            onMenu={narrow ? () => setDrawerOpen(true) : null}
            // ⚠️ Gated on not already being home. `history.back()` from the
            // dashboard walks out of the module, under a chevron that looks
            // like it moves you within it.
            onBack={pathname === '/m/stalls' ? null : () => history.back()}
            crumb={current?.title ?? 'Stalls'}
            title={current?.item.label ?? 'Stalls'}
          />
          {/* ⚠️ The backoffice only. An installed app is installed by the team
              who work it every day; a vendor fills one form once, from a link in
              an email, and would be offered an icon for a screen they will
              never open again. */}
          <InstallPrompt />
          <div style={{ padding: mobile ? '14px 14px 72px' : '22px 26px 60px' }}>
            <Outlet />
          </div>
        </main>
      </div>
    </Frame>
  );
}

export function BackofficeLayout() {
  return (
    // ⚠️ `ToastProvider` sits OUTSIDE `MeProvider`, not inside, and the order is
    // the decision: the gate swaps its whole subtree between the sign-in screen
    // and the app, and inside it the toast host would unmount on that
    // transition and drop whatever it was holding.
    <ToastProvider>
      {/* Outside `MeProvider` for the same reason `ToastProvider` is: the gate
          swaps its whole subtree at sign-in, and a provider inside it would be
          rebuilt on that transition. */}
      <RefreshProvider>
        <MeProvider>
          <Gate />
        </MeProvider>
      </RefreshProvider>
    </ToastProvider>
  );
}

const iconSlot: React.CSSProperties = {
  width: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
};

/** The collapse control in the sidebar's head. Sized like the topbar's buttons
 *  but drawn on the sidebar's own plate. */
const railBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--r2)',
  border: '1px solid var(--bd)',
  background: 'var(--card)',
  color: 'var(--mfg)',
  cursor: 'pointer',
  padding: 0,
};

const navItemStyle = (active: boolean, rail: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: rail ? 'center' : undefined,
  gap: 10,
  padding: rail ? '9px 0' : '8px 10px',
  borderRadius: 'var(--r3)',
  cursor: 'pointer',
  marginBottom: 2,
  background: active ? 'var(--pri-t)' : 'transparent',
  color: active ? 'var(--pri)' : 'var(--fg)',
  fontWeight: active ? 700 : 400,
  fontSize: 13,
  textDecoration: 'none',
});

const avatarChip: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 'var(--r2)',
  // ⚠️ An `--av*` plate, which is dark in BOTH themes, so the text is
  // `--on-solid` and not `--pfg`. `--pfg` flips dark for the filled button and
  // would blank these initials in the dark theme.
  background: 'var(--av1)',
  color: 'var(--on-solid)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 700,
  flex: 'none',
};

const topBtn: React.CSSProperties = {
  position: 'relative',
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
};
