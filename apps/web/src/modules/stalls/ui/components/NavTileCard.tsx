import { Icon } from '../icons';
import { Card } from '../ui';

/**
 * One navigation tile: a tinted glyph, a label and a count or a hint.
 *
 * 🔴 This markup existed TWICE, byte for byte — once in `Hub.tsx` for the
 * calling / allocation / arrivals hubs and once in `HomeWidgets.tsx` for the
 * home page's quick links — and both copies carried the same defect:
 * `<div onClick role='button'>` with no `tabIndex` and no key handler. So the
 * module's first screen had a primary navigation that only a mouse could
 * operate, and fixing one copy would have left the other.
 *
 * Built on `Card`'s actionable form, which owns the role, the tab stop, the
 * Enter/Space handling, the hover lift and the focus ring together.
 *
 * ⚠️ The name is `NavTileCard`, not `NavTile`, because `NavTile` is already an
 * exported *type* in `HomeWidgets.tsx` — the shape the API sends. Renaming a
 * payload contract to free up a component name is churn with no reader; the
 * two names sitting beside each other is the smaller cost.
 */
export interface NavTileItem {
  key: string;
  label: string;
  glyph: string;
  /** A per-item plate from the API — one of the `--av*` avatar tints. */
  tint: string;
  meta: string;
  count: number | null;
}

export function NavTileCard({ item, onGo }: { item: NavTileItem; onGo: (key: string) => void }) {
  return (
    <Card
      pad={15}
      onAct={() => onGo(item.key)}
      label={item.label}
      style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          // Was a raw `11`. The icon well is the ramp's chip step, so it now
          // follows a retune instead of drifting away from the card around it.
          borderRadius: 'var(--r3)',
          background: item.tint,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // ⚠️ The PAGE foreground, and this is not the same as `Avatar`'s rule.
          // Avatar's tints are the `--av*` plates, which are dark in both themes
          // and need light text. A nav tile's tint comes from the nav registry
          // and is a TONE TINT — `--pri-t`, `--ok-t`, `--gold-t` and so on —
          // which is light in the light theme and dark in the dark one. `--fg`
          // therefore flips with it and stays readable in both, where
          // `--on-solid` (white) would leave a near-invisible glyph on a pale
          // plate in light mode. Copying Avatar's comment here was a bug.
          color: 'var(--fg)',
        }}
      >
        <Icon name={item.glyph} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{item.label}</div>
        <div style={{ fontSize: 12, color: 'var(--mfg)', marginTop: 3 }}>
          {item.count !== null ? `${item.count.toLocaleString()} records` : item.meta}
        </div>
      </div>
    </Card>
  );
}
