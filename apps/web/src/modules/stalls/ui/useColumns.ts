import { useCallback, useEffect, useMemo, useState } from 'react';

/** One column a list can show. */
export interface ColumnDef {
  /** Stable across releases — it is what gets written to storage. Renaming one
   *  silently un-hides it for everybody who had hidden it, which is a small
   *  enough cost that it is not worth a migration, but it is not nothing. */
  key: string;
  /** What the picker calls it. Usually the `<TH>`'s own words. */
  label: string;
  /**
   * Never offered for hiding.
   *
   * ⚠️ The column that says WHICH ROW THIS IS. Hide the reference and the stall
   * name from the pipeline and what is left is ten rows of statuses belonging
   * to nobody — a table that cannot be read at all, reachable in two clicks and
   * remembered across visits. Every list locks at least one.
   */
  locked?: boolean;
  /**
   * Off until somebody asks for it.
   *
   * For the columns a list could show and should not show by default — the
   * long tail that makes a table scroll sideways for a fact most readers never
   * want. Being `false` in the default set is not the same as being hidden by
   * the reader, which is why this is a property of the COLUMN and not a seeded
   * entry in storage.
   */
  optional?: boolean;
}

export interface ColumnState {
  /** Whether to draw this column. Unknown keys are shown — a `<TD>` whose key
   *  was left out of the defs is a mistake that should be visible. */
  shown: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Back to the list's own defaults. */
  reset: () => void;
  /** For the toolbar badge: how many the reader has turned off. */
  hiddenCount: number;
  /** Whether anything differs from the defaults, so "Reset" can be offered
   *  only when it would do something. */
  customised: boolean;
  defs: readonly ColumnDef[];
}

/**
 * Which columns a table draws, remembered per screen.
 *
 * ── What gets stored ────────────────────────────────────────────────────────
 * ⚠️ The HIDDEN set, never the shown set. Storing what to show means a column
 * added in a later release is invisible to everybody already using the screen —
 * they would have to be told a new column exists and go and tick it, which
 * nobody will do, so the feature ships to new readers only. Storing what to
 * hide makes the default "show", and a new column simply appears.
 *
 * The `optional` flag is how a column ships hidden anyway. It lives on the
 * definition rather than being written into storage at first run, so changing
 * a column's default later actually changes it for existing readers instead of
 * being frozen by a decision their browser made months ago.
 *
 * ── The other half ──────────────────────────────────────────────────────────
 * `Table` draws a real `<table>`, so hiding a column is a conditional `<TH>`
 * and a conditional `<TD>` per row and nothing more — see the note at the top
 * of `components/Table.tsx`, which called this shape before it was needed.
 */
export function useColumns(key: string, defs: readonly ColumnDef[]): ColumnState {
  const fallback = useMemo(
    () => defs.filter((d) => d.optional && !d.locked).map((d) => d.key),
    [defs],
  );
  const [hidden, setHidden] = useState<string[]>(() => read(key) ?? fallback);

  // The screen can change under one mounted component. Re-reading on `key`
  // keeps the choice attached to the list rather than the component instance.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fallback` is derived from the defs, which are static per screen
  useEffect(() => {
    setHidden(read(key) ?? fallback);
  }, [key]);

  const commit = useCallback(
    (next: string[]) => {
      setHidden(next);
      write(key, next);
    },
    [key],
  );

  const toggle = useCallback(
    (col: string) => {
      // ⚠️ Reads `defs` rather than trusting the caller: a locked column must
      // not be hideable even if something asks, because the only way back is a
      // picker whose rows are in the table that just disappeared.
      if (defs.find((d) => d.key === col)?.locked) return;
      commit(hidden.includes(col) ? hidden.filter((k) => k !== col) : [...hidden, col]);
    },
    [commit, defs, hidden],
  );

  const reset = useCallback(() => {
    clear(key);
    setHidden(fallback);
  }, [key, fallback]);

  const known = useMemo(() => new Set(defs.map((d) => d.key)), [defs]);
  // Columns that left the code still sit in storage; they are ignored rather
  // than cleaned up, so downgrading a deploy does not lose the reader's choice.
  const live = useMemo(() => hidden.filter((k) => known.has(k)), [hidden, known]);

  return {
    shown: useCallback((col: string) => !live.includes(col), [live]),
    toggle,
    reset,
    hiddenCount: live.length,
    customised: live.length !== fallback.length || live.some((k) => !fallback.includes(k)),
    defs,
  };
}

const storageKey = (key: string) => `stalls.columns.${key}`;

/**
 * ⚠️ Every access is wrapped, and a failure means "no preference" rather than
 * an error. `localStorage` THROWS in a Safari private window and wherever site
 * data is blocked, and a table that will not render because a preference could
 * not be read is a worse failure than one showing a column somebody hid.
 */
function read(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((k) => typeof k === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function write(key: string, hidden: string[]): void {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(hidden));
  } catch {
    // Honoured for this session regardless — `hidden` is state, and the write
    // is only what carries it to the next one.
  }
}

function clear(key: string): void {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    // As above.
  }
}
