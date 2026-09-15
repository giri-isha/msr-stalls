import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type RefObject,
} from 'react';

/**
 * The behaviour every overlay in the app shares — the dialog, the toolbar
 * popovers and the nav drawer.
 *
 * These were three separate half-implementations before: the dialog handled
 * Escape but not focus, the popover handled outside-clicks but not Escape, and
 * neither stopped the page behind them from scrolling. On a phone that last one
 * is the difference between a usable sheet and a sheet that slides the content
 * out from under itself.
 */

/**
 * Which overlay is on top.
 *
 * 🔴 Overlays NEST — the coupon capacity box opens over the onboarding record,
 * which is itself a dialog — and `useEscape` binds to `document`. Two bound
 * handlers means one Escape closes both: the inner box and the record behind
 * it, so correcting a number and changing your mind about it threw away the
 * whole screen. `RequestDetail` already had a hand-rolled gate for exactly this
 * (`reasonFor === null && !selecting && !amending`), which works until somebody
 * adds a fourth overlay and forgets to name it in the condition.
 *
 * So the overlays keep a stack and only the top of it answers the key. The same
 * answer gates the focus trap: two traps fighting over Tab is the same bug in a
 * quieter form.
 *
 * ⚠️ Registration happens in an EFFECT, and React runs a child's effects before
 * its parent's. That is the right order here — a nested dialog mounts in a
 * later commit than the one it opens over, so it registers later and lands on
 * top — but two overlays mounting in the SAME commit would register innermost
 * first and the outer one would win. Nothing in the module does that, and a
 * depth-aware stack is more machinery than the case deserves until something
 * does.
 */
let seq = 0;
const stack: number[] = [];
const subs = new Set<() => void>();
const notify = () => {
  for (const cb of subs) cb();
};

export function useTopmostOverlay(active = true): boolean {
  const [id] = useState(() => ++seq);

  useEffect(() => {
    if (!active) return;
    stack.push(id);
    notify();
    return () => {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      notify();
    };
  }, [id, active]);

  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => !active || stack[stack.length - 1] === id,
    // On the server there is one overlay at most and it is the top of a stack
    // of one.
    () => true,
  );
}

/** Closes on Escape while `active`. */
export function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose, active]);
}

/**
 * Stops the page behind an overlay from scrolling.
 *
 * Overlays nest — a SearchSelect inside a Dialog — so this counts rather than
 * setting and clearing a flag, or closing the inner one would free the outer
 * one's lock.
 */
let locks = 0;
let restore = '';
export function useLockScroll(active = true) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      restore = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = restore;
    };
  }, [active]);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),' +
  'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Moves focus into `ref` and keeps Tab inside it while `active`. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const before = document.activeElement as HTMLElement | null;

    // If React's autoFocus already put focus inside the dialog, leave it there.
    if (!root.contains(before)) {
      // Focus the first real control, not the container, so a screen reader
      // announces something useful and typing goes where the user expects.
      const first = root.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? root).focus({ preventScroll: true });
    }

    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    root.addEventListener('keydown', key);
    return () => {
      root.removeEventListener('keydown', key);
      before?.focus?.({ preventScroll: true });
    };
  }, [ref, active]);
}

/** The dimmed backdrop. Clicking it closes the overlay. */
export const scrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 200,
  // A token, not a literal — see `--scrim` in tokens.css. The dark theme's
  // scrim is heavier, because the page it covers is already dark.
  background: 'var(--scrim)',
  animation: 'msrs-fade .15s ease both',
};

/**
 * A panel anchored to the bottom of the screen, which is what every overlay
 * becomes on a phone: reachable by thumb, full width, and free to be as tall
 * as its content up to most of the viewport.
 */
export const sheet: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 201,
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--card)',
  borderTop: '1px solid var(--bd)',
  borderRadius: 'var(--r4) var(--r4) 0 0',
  boxShadow: 'var(--sh-3)',
  paddingBottom: 'env(safe-area-inset-bottom)',
  animation: 'msrs-sheet-up .22s cubic-bezier(.32,.72,0,1) both',
};

/** The short bar at the top of a sheet that says "this drags down to dismiss". */
export function SheetGrip() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 2px', flex: 'none' }}>
      <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--bd)' }} />
    </div>
  );
}
