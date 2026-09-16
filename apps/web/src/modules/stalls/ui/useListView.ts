import { useCallback, useEffect, useState } from 'react';
import { useBreakpoint } from './useBreakpoint';

/** A list drawn as rows, or as tiles. */
export type ListView = 'table' | 'cards';

/**
 * Which shape a list opens in.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Rows on a laptop, tiles on a phone. A ten-column table on a 390px screen is
 * a horizontal scroller where every row needs two swipes to read, and a grid
 * of tiles on a 1600px screen is four columns of whitespace with the one
 * column anybody wanted — the price — pushed below the fold. Neither is the
 * "right" shape; the width decides.
 *
 * ── Why it is a DEFAULT and not a rule ──────────────────────────────────────
 * ⚠️ A person who picks the other one gets to keep it. The width is a good
 * guess about what somebody wants, and a good guess is exactly the thing that
 * must yield to being told otherwise — a coordinator scanning references on a
 * phone wants the table, scrolls it sideways, and should not have to re-pick
 * it on every screen they open. `Table` has carried its own horizontal
 * scroller from the start, so that choice is usable rather than broken.
 *
 * The choice is remembered PER SCREEN, under `key`: the request pipeline and
 * the onboarding queue are different lists read for different reasons, and
 * wanting tiles for one says nothing about the other.
 *
 * ⚠️ Until a choice is made, the value FOLLOWS the width — drag a window from
 * wide to narrow and an untouched list re-shapes. Storing the guess on first
 * render would freeze whatever the window happened to be at the moment the
 * screen mounted, which is how a phone ends up remembering a desktop default
 * it never showed anybody.
 */
export function useListView(key: string): [ListView, (v: ListView) => void] {
  const bp = useBreakpoint();
  const byWidth: ListView = bp === 'mobile' ? 'cards' : 'table';

  // `null` is "never chosen", which is a different state from "chose the one
  // the width would have picked anyway" — the first follows a resize and the
  // second does not.
  const [chosen, setChosen] = useState<ListView | null>(() => read(key));

  // The screen can change under one mounted component: `Requests` is one
  // element behind several routes. Re-reading on `key` keeps the remembered
  // choice attached to the list rather than to the component instance.
  useEffect(() => {
    setChosen(read(key));
  }, [key]);

  const choose = useCallback(
    (v: ListView) => {
      setChosen(v);
      write(key, v);
    },
    [key],
  );

  return [chosen ?? byWidth, choose];
}

const storageKey = (key: string) => `stalls.view.${key}`;

/**
 * ⚠️ Every access is wrapped. `localStorage` THROWS rather than returning null
 * in a Safari private window and wherever site data is blocked, and a list
 * that cannot render because a preference could not be read is a worse failure
 * than one that opens in the wrong shape.
 */
function read(key: string): ListView | null {
  try {
    const v = localStorage.getItem(storageKey(key));
    return v === 'table' || v === 'cards' ? v : null;
  } catch {
    return null;
  }
}

function write(key: string, v: ListView): void {
  try {
    localStorage.setItem(storageKey(key), v);
  } catch {
    // A preference that cannot be saved is still honoured for this session:
    // `chosen` is state, and the write is only what carries it to the next one.
  }
}
