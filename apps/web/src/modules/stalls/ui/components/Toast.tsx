import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from '../icons';
// The tokens this host paints with. `Frame` imports the same sheet and Vite
// emits it once — it is named here as well because this file's host element is
// NOT inside `Frame`, so the stylesheet arriving is a real dependency of this
// module rather than a coincidence of how the chunks fell out.
import '../tokens.css';

type Kind = 'ok' | 'error' | 'info';
type Toast = { id: number; kind: Kind; text: string };

/** How long a success or a notice stays up. Errors never expire — see ToastItem. */
const OK_MS = 4000;
/** Beyond this the stack stops being a notification and becomes a wall. */
const MAX = 3;

let seq = 0;

const Ctx = createContext<{
  push: (kind: Kind, text: string) => void;
  clear: () => void;
} | null>(null);

/**
 * Holds every action result for the whole app.
 *
 * This sits at the root, above the router, on purpose. The old per-screen
 * banner was owned by the screen that fired it, so a dialog's `onSaved` could
 * set a banner on a parent that then reloaded, scrolled, or navigated away —
 * and the confirmation went with it. A toast outlives the screen that caused it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Kind, text: string) => {
    setToasts((prev) => [...prev, { id: ++seq, kind, text }].slice(-MAX));
  }, []);
  const clear = useCallback(() => setToasts([]), []);
  const drop = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ push, clear }), [push, clear]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastHost toasts={toasts} onDrop={drop} />
    </Ctx.Provider>
  );
}

/**
 * The result of an action, reported without moving anything on screen.
 *
 * `fail` takes the thrown value rather than a string so every call site stays
 * `catch (e) { toast.fail(e) }`.
 */
export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  const { push, clear } = ctx;
  return useMemo(
    () => ({
      ok: (text: string) => push('ok', text),
      fail: (e: unknown) => push('error', (e as Error).message),
      /** Neither a success nor a failure — something the person should know.
       *  Grey, because the colour has to stay honest: green means it worked. */
      info: (text: string) => push('info', text),
      clear,
    }),
    [push, clear],
  );
}

function ToastHost({ toasts, onDrop }: { toasts: Toast[]; onDrop: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    // Bottom-centred, matching UpdatePrompt: thumb-reachable on a phone, and
    // clear of the offline banner and the header. Above the dialog layer (201)
    // so a save failure raised from inside a sheet is not hidden behind it.
    //
    // 🔴 `msrv` is on this element, and it is the only reason the coloured
    // plates below resolve to anything. The module's tokens are scoped to
    // `.msrs` (`tokens.css`), which `Frame` puts around the ROUTE — but
    // `ToastProvider` sits ABOVE the router on purpose, so a confirmation
    // outlives the screen that raised it, and that puts this fixed overlay
    // outside `Frame`. Without the class every `var(--ok-s)` / `var(--des-s)` /
    // `var(--on-solid)` below is an undefined custom property: the plate falls
    // back to transparent and the sentence to the page's dark inherited text,
    // so a success, a failure and a notice all render as the same white card.
    // It shipped that way — the solid plates of module ADR 0020 were written
    // correctly and were invisible in the browser from the first load.
    <div
      className='msrs'
      aria-live='polite'
      style={{
        position: 'fixed',
        left: 14,
        right: 14,
        bottom: 'calc(14px + env(safe-area-inset-bottom))',
        zIndex: 300,
        margin: '0 auto',
        maxWidth: 560,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        // The column spans the viewport width; only the cards should catch taps.
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDrop={onDrop} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDrop }: { toast: Toast; onDrop: (id: number) => void }) {
  const { id, kind, text } = toast;

  // A success is a receipt — it can leave on its own. An error is something the
  // user has to read and usually act on, so it waits to be dismissed. A notice
  // behaves like a success: it is not a problem, so it should not need dismissing.
  useEffect(() => {
    if (kind === 'error') return;
    const timer = setTimeout(() => onDrop(id), OK_MS);
    return () => clearTimeout(timer);
  }, [id, kind, onDrop]);

  // 🔴 The plate is SOLID and the sentence is WHITE, and that is the inversion
  // that makes this readable. The old toast tinted the plate and spent the tone
  // on the icon and border only, because the tone colours fail the 4.5:1 text
  // floor on their own tints — the note this replaces measured `--ok` at 3.6:1
  // and that reasoning was correct. It just concluded the wrong way round: it
  // gave up the COLOUR to keep the contrast, so success and failure differed by
  // a faint wash and an 18px glyph. Moving the colour to the background gets
  // both — white on each of these measures 5.5:1 (see `tokens.css`), so the
  // sentence is more readable than before AND green/red/grey carry the meaning
  // from across a room, which is what an operator on a field desk actually has.
  const bg = kind === 'ok' ? 'var(--ok-s)' : kind === 'error' ? 'var(--des-s)' : 'var(--info-s)';
  const icon = kind === 'ok' ? 'check-square' : kind === 'error' ? 'alert-triangle' : 'info';

  return (
    <div
      role={kind === 'error' ? 'alert' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 18px',
        borderRadius: 'var(--r3)',
        background: bg,
        // A hairline of white lifts the plate off a dark canvas without
        // reintroducing a second colour.
        border: '1px solid var(--on-solid-line)',
        boxShadow: 'var(--solid-sh)',
        pointerEvents: 'auto',
        animation: 'msrs-rise .22s ease both',
      }}
    >
      <span style={{ display: 'flex', flex: 'none', color: 'var(--on-solid)' }}>
        <Icon name={icon} size={22} />
      </span>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          color: 'var(--on-solid)',
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1.4,
        }}
      >
        {text}
      </div>
      <button
        type='button'
        onClick={() => onDrop(id)}
        aria-label='Dismiss'
        style={{
          border: 0,
          background: 'none',
          cursor: 'pointer',
          color: 'var(--on-solid)',
          opacity: 0.8,
          display: 'flex',
          flex: 'none',
          padding: 6,
          margin: -6,
        }}
      >
        <Icon name='x' size={18} />
      </button>
    </div>
  );
}
