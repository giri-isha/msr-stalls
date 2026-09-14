import { useCallback, useState } from 'react';

/**
 * Namespaced, like every key this module writes. It shares an origin with the
 * platform and every other module now, so a bare `sidebar` would be as much
 * theirs to claim as ours (`volunteering-shell.test.tsx` asserts this).
 */
const KEY = 'msrs:sidebar-rail';

/**
 * Whether the sidebar was last left as a rail.
 *
 * ⚠️ Read ONCE, at mount, not watched. Two tabs disagreeing about the width of
 * their own sidebar is the correct outcome — it is a per-view preference, not
 * shared state — so there is no `storage` listener here on purpose.
 */
function readStored(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    // Private mode, or storage disabled. A remembered width is a convenience;
    // losing it is not worth a crashed shell.
    return false;
  }
}

/**
 * The sidebar's collapsed/expanded choice, remembered across visits.
 *
 * ⚠️ Expanded is the default, and an unreadable or absent value means expanded
 * rather than rail. Somebody who has never chosen should see the labels: the
 * rail is a choice made by a person who already knows the icons, and a first
 * load that shows eleven unlabelled glyphs is a module nobody can navigate.
 *
 * ⚠️ It says nothing about the DRAWER below 1024px. That width has no room for
 * a column beside the content at all, so the sidebar there is a slide-over and
 * this preference is simply not consulted — `ModuleApp` gates on the
 * breakpoint, not on this value.
 */
export function useSidebarRail(): { rail: boolean; toggle: () => void } {
  const [rail, setRail] = useState(readStored);
  const toggle = useCallback(() => {
    setRail((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        // Same trade as the read: the choice still applies to this visit.
      }
      return next;
    });
  }, []);
  return { rail, toggle };
}
