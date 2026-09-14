import { useMemo, useState, type ReactNode } from 'react';
import { inputStyle } from './Dialog';

/**
 * Search box over a popover list.
 *
 * Holds the query itself and hands the surviving items to `children`, so each
 * popover keeps rendering its own row shape — ticks, counts, accordions.
 */
export function SearchList<T>({
  items,
  match,
  placeholder = 'Search…',
  children,
}: {
  items: T[];
  match: (item: T, query: string) => boolean;
  placeholder?: string;
  children: (filtered: T[]) => ReactNode;
}) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((i) => match(i, q)) : items;
  }, [items, query, match]);

  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, padding: '7px 10px', fontSize: 12.5, marginBottom: 6 }}
      />
      {shown.length === 0 ? (
        <div style={{ padding: '8px 6px', fontSize: 11.5, color: 'var(--mfg)' }}>No Matches</div>
      ) : (
        children(shown)
      )}
    </>
  );
}

/** Case-insensitive substring over an item's label. */
export const matchLabel = (i: { label: string }, q: string) => i.label.toLowerCase().includes(q);
