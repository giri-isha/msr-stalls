// SHELL — the install and update chrome. Discarded at migration: the host has
// its own service worker and its own manifest, and two workers on one origin is
// one worker, whichever registered last.
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Btn, Icon } from '@/modules/stalls/ui';

/**
 * "A new version is ready" — and nothing more until somebody says so.
 *
 * 🔴 The worker is registered with `registerType: 'prompt'`, so an update
 * downloads, installs, and WAITS. That is the whole reason this component
 * exists: `autoUpdate` reloads the page the moment a deploy lands, and this app
 * is used on a phone at a counter with a half-filled form open. Losing that to
 * a deploy nobody asked about is worse than running yesterday's build for
 * another ten minutes.
 *
 * ⚠️ Deliberately NOT dismissible-forever. Dismissing hides it until the next
 * page load, where it comes back — a version that is installed and never
 * activated is a device permanently a release behind, and the only symptom is a
 * bug that was fixed weeks ago.
 */
export function UpdateToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      // Registration failing is not worth an error screen: the app works
      // without a worker, it simply does not work offline. Logged so it is
      // findable, swallowed so it is not fatal.
      console.error('Service worker registration failed', err);
    },
  });
  const [busy, setBusy] = useState(false);

  if (!needRefresh) return null;

  return (
    <div
      role='status'
      style={{
        position: 'fixed',
        // ⚠️ Above the phone's home indicator, not merely at the bottom.
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        left: 16,
        right: 16,
        // Over the nav drawer's scrim, which is 200.
        zIndex: 300,
        margin: '0 auto',
        maxWidth: 420,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 'var(--r3)',
        background: 'var(--card)',
        border: '1px solid var(--bd)',
        boxShadow: 'var(--sh-3)',
      }}
    >
      <span style={{ color: 'var(--pri)', flex: 'none' }}>
        <Icon name='refresh' size={17} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
        A new version is ready.
        <span style={{ display: 'block', color: 'var(--mfg)', fontSize: 11.5 }}>
          It will be used the next time this page loads.
        </span>
      </span>
      <Btn
        kind='primary'
        disabled={busy}
        onClick={() => {
          setBusy(true);
          // Activates the waiting worker and reloads. The promise does not
          // settle before the reload, so there is no success path to write.
          void updateServiceWorker(true);
        }}
      >
        <Icon name='refresh' size={14} />
        Reload
      </Btn>
    </div>
  );
}

/**
 * "Install this on your phone" — once, and only where it means something.
 *
 * ⚠️ Shown only after the browser has fired `beforeinstallprompt`, which is the
 * only reliable signal that installing is POSSIBLE. Drawing a button that opens
 * nothing is worse than drawing none, and every other way of guessing — user
 * agent sniffing, `display-mode` checks — is wrong on some device somebody will
 * be holding.
 *
 * ⚠️ Nothing at all on iOS, where the event does not exist and installing is a
 * Share-sheet gesture Safari does not let a page trigger. A banner explaining
 * that gesture is a banner that appears on every desktop Safari too.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('msr-stalls.install-dismissed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Chrome shows its own mini-infobar unless this is called, and two
      // install prompts for one app is one too many.
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!event || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem('msr-stalls.install-dismissed', '1');
    } catch {
      // A preference that cannot be saved still holds for this session.
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        // The sentence is the part that should wrap, not the button — a 140px
        // floor on it keeps the Install and the dismiss together on the right
        // until there is genuinely no room, and then drops them as a pair.
        flexWrap: 'wrap',
        gap: 10,
        padding: '10px 14px',
        background: 'var(--pri-t)',
        borderBottom: '1px solid var(--bd)',
        fontSize: 12.5,
      }}
    >
      <span style={{ color: 'var(--pri)', flex: 'none' }}>
        <Icon name='download' size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 140 }}>
        Install MSR Stalls for the counter — it opens full screen and works with no signal.
      </span>
      <Btn
        kind='primary'
        onClick={async () => {
          await event.prompt();
          // ⚠️ The event is single-use whatever the person chose. Keeping it
          // would show a button whose second press does nothing at all.
          setEvent(null);
        }}
      >
        <Icon name='download' size={14} />
        Install
      </Btn>
      <button
        type='button'
        onClick={dismiss}
        aria-label='Not now'
        title='Not now'
        style={{
          background: 'none',
          border: 0,
          color: 'var(--mfg)',
          cursor: 'pointer',
          display: 'flex',
          padding: 4,
        }}
      >
        <Icon name='x' size={15} />
      </button>
    </div>
  );
}

/** The event Chrome fires, which TypeScript's DOM library does not declare. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
