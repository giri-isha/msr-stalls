import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as React from 'react';

/** Where a floating panel goes, measured against the viewport. */
export interface PanelBox {
  /** The anchor's top when flipped, its bottom otherwise. */
  top: number;
  left: number;
  /** The anchor's own width, which the panel is never narrower than. */
  width: number;
  /** Opens upward, because there is no room below. */
  flip: boolean;
}

/** How far below the anchor a panel needs before it gives up and flips. */
const PANEL_MAX = 320;

/**
 * Anchors a floating panel to the control that opened it.
 *
 * ⚠️ **Positioned against the VIEWPORT (`position: fixed`), not the offset
 * parent.** Every one of these panels can open inside `Dialog`, whose body sets
 * `overflowY: auto` — which clips an absolutely-positioned child, so a picker
 * near the foot of a dialog would open into a panel with its list cut off.
 *
 * 🔴 There were three copies of this measurement, in `SearchSelect`,
 * `MultiSelect` and the toolbar's own picker, and they had already drifted on
 * the one question that matters once the page moves: SearchSelect CLOSED on
 * scroll and MultiSelect re-measured, so two dropdowns a screen apart behaved
 * differently for a reason nobody chose. They re-measure. A panel that follows
 * its anchor is what a person expects; closing one because the page moved a
 * pixel under a trackpad is the behaviour that has to be explained.
 *
 * ⚠️ A scroll INSIDE the panel is not the page moving, and re-measuring on it
 * would fight the list's own scrolling. The listener captures — it has to, to
 * see a scrolling ancestor at all — so it filters the panel's own events out.
 */
export function useAnchoredPanel({
  open,
  onClose,
  max = PANEL_MAX,
}: {
  open: boolean;
  /** Called on a press outside both the anchor and the panel. */
  onClose: () => void;
  /** The panel's own maximum height, which decides when it flips. */
  max?: number;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<PanelBox | null>(null);

  // ⚠️ Held in a ref so the dismissal listener is bound once per opening. Every
  // caller passes an arrow function, so depending on it directly would tear the
  // listener down and rebuild it on every render of the screen around it.
  const closer = useRef(onClose);
  closer.current = onClose;

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const flip = below < max && r.top > below;
      setBox({ top: flip ? r.top : r.bottom + 4, left: r.left, width: r.width, flip });
    };
    place();
    const moved = (e: Event) => {
      if (panel.current?.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', moved, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', moved, true);
    };
  }, [open, max]);

  useEffect(() => {
    if (!open) return;
    // ⚠️ `mousedown`, not `click`. A click lands after the pressed control has
    // already run its own handler, so a press on a second picker would close
    // this one and open that one in the wrong order.
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !panel.current?.contains(t)) closer.current();
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return { trigger, panel, box };
}

/**
 * The panel's own skin and placement.
 *
 * ⚠️ `grow` is off by default, so a panel is exactly as wide as the control it
 * hangs from — which is what a field-shaped picker wants. A TOOLBAR picker is
 * sized by whatever it is SHOWING ("All Types") while its list holds "Local
 * welfare stall", so that one grows: `maxWidth` is the room actually left to
 * the right of the anchor, so growing to fit can never push it off screen.
 */
export function panelStyle(
  box: PanelBox,
  { grow = false, max = PANEL_MAX }: { grow?: boolean; max?: number } = {},
): React.CSSProperties {
  return {
    position: 'fixed',
    left: box.left,
    ...(grow
      ? {
          width: 'max-content',
          minWidth: box.width,
          maxWidth: Math.max(box.width, window.innerWidth - box.left - 12),
        }
      : { width: box.width }),
    zIndex: 260,
    ...(box.flip ? { bottom: window.innerHeight - box.top + 4 } : { top: box.top }),
    background: 'var(--pop)',
    border: '1px solid var(--bd)',
    borderRadius: 'var(--r4)',
    boxShadow: 'var(--sh)',
    maxHeight: max,
    overflowY: 'auto',
  };
}
