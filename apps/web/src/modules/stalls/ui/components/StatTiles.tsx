import { Card, card, statusTone, TONE } from '../ui';
import { Icon } from '../icons';
import { useIsMobile } from '../useBreakpoint';

/**
 * The row of counts above a table.
 *
 * ⚠️ **The numbers are not new.** Every list screen, the users directory,
 * allocations and requirements already computed a count per view — narrowed by
 * the caller's scope, the active filters and the search — and showed them only
 * inside the "Filtered views" popover. This row surfaces what was already
 * there.
 */
export function StatTiles({
  tiles,
  noun,
  allTitle,
  active,
  onPick,
}: {
  tiles: { label: string; count: number }[];
  /** Singular. Titles the "All" tile, which on its own says nothing. */
  noun: string;
  /** Overrides that title where "Total <Nouns>" would be a wrong sentence
   *  rather than a clumsy one — Add from Foundation's total is everybody
   *  OUTSIDE this module, so "Total People" would name the directory and count
   *  a slice of it. */
  allTitle?: string;
  /** The view currently applied, as the server named it. */
  active?: string;
  /**
   * Omit on a screen with no view filter — the tiles are then plain readings
   * rather than dead buttons. A control that does nothing on one screen
   * teaches people the tiles are not clickable on any of them.
   */
  onPick?: (label: string) => void;
}) {
  /**
   * ⚠️ A phone gets a NARROWER strip, never a hidden one. These tiles are the
   * view filter, so the reveal button the read-only strips get (`Readings`)
   * would be a control taken away here, not a number tidied up — and hiding a
   * filter is the mistake the platform's own phone pass already measured and
   * rejected. What changes is the room they take: `minmax(180px,1fr)` puts one
   * tile per row at 393px, so five views cost five full-width cards above a
   * table nobody can see yet. One row that scrolls costs one tile's height
   * however many views a route declares.
   *
   * ⚠️ Read ABOVE the empty-list return, not below it. A hook after an early
   * return is called on some renders and not others, and a route whose counts
   * arrive a beat after the screen does goes from nothing to tiles — which is
   * exactly the render where the hook order would change.
   */
  const isMobile = useIsMobile();
  if (tiles.length === 0) return null;
  /**
   * ⚠️ Only the "All" tile is retitled, and the rest are left verbatim: those
   * labels ARE the filter value the tile selects, so rewriting one here would
   * quietly stop it matching the view it is meant to pick.
   */
  const title = (label: string) =>
    label === 'All'
      ? (allTitle ?? `Total ${noun.charAt(0).toUpperCase()}${noun.slice(1)}s`)
      : label;
  return (
    <div
      style={
        isMobile
          ? {
              display: 'flex',
              // Scrolls rather than wraps: wrapping is what made it a wall.
              overflowX: 'auto',
              gap: 8,
              marginBottom: 12,
              // The row is edge-to-edge and its last tile must not look
              // clipped, so the scroll box keeps a tail of padding.
              paddingBottom: 4,
            }
          : {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
              gap: 12,
              marginBottom: 16,
            }
      }
    >
      {tiles.map((t) => {
        const on = t.label === active;
        const [tint, fg] = TONE[t.label === 'All' ? 'info' : statusTone(t.label)];
        const face = (
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
            <div
              data-testid='stat-icon'
              style={{
                width: isMobile ? 28 : 36,
                height: isMobile ? 28 : 36,
                borderRadius: 'var(--r3)',
                background: tint,
                color: fg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
              }}
            >
              <Icon name={GLYPH[t.label] ?? 'users'} size={isMobile ? 14 : 17} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{ fontSize: isMobile ? 17 : 22, fontWeight: 700, letterSpacing: '-.6px' }}
              >
                {t.count.toLocaleString()}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--mfg)', whiteSpace: 'nowrap' }}>
                {title(t.label)}
              </div>
            </div>
          </div>
        );
        if (!onPick) {
          return (
            <Card
              key={t.label}
              pad={isMobile ? 10 : 14}
              style={isMobile ? { flexShrink: 0 } : undefined}
            >
              {face}
            </Card>
          );
        }
        return (
          <button
            key={t.label}
            type='button'
            // Selection is carried by the border, so it must also be carried
            // by something a screen reader reaches — the same reason `Chip`
            // announces its pressed state.
            aria-pressed={on}
            className='msrs-lift'
            // ⚠️ The RAW label, never the retitled one: "All" is a filter the
            // server understands and "Total Volunteers" is not.
            onClick={() => onPick(t.label)}
            style={{
              ...card,
              padding: isMobile ? 10 : 14,
              // Nothing gives, or the row squeezes instead of scrolling.
              flexShrink: isMobile ? 0 : undefined,
              textAlign: 'left',
              cursor: 'pointer',
              borderColor: on ? 'var(--pri)' : 'var(--bd)',
              boxShadow: on ? '0 0 0 1px var(--pri)' : undefined,
            }}
          >
            {face}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A glyph for the labels the route chips actually use, falling back to the
 * people icon — every one of these tiles counts people or the requests for
 * them, so the default is never nonsense the way a "?" would be.
 */
export const GLYPH: Record<string, string> = {
  All: 'users',
  'In Progress': 'clock',
  Confirmed: 'circle-check',
  'Checked In': 'log-in',
  'Checked Out': 'log-out',
  Blocked: 'ban',
  Cancelled: 'ban',
  Medical: 'alert-triangle',
  'Not Answered': 'phone',
  'Callback Requested': 'phone',
  'Call Completed': 'circle-check',
  Open: 'clipboard-list',
  Filled: 'circle-check',
  'Partially Filled': 'clock',
  Closed: 'ban',
  Primary: 'map-pin',
  Secondary: 'map-pin',
  Present: 'circle-check',
  Absent: 'ban',
  Leave: 'calendar',
  // The stalls users directory.
  Staff: 'shield',
  Requesters: 'ticket',
  'Cannot sign in': 'alert-triangle',
  'Locked out': 'ban',
};
