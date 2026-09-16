import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useIsMobile } from './useBreakpoint';

/**
 * The resting card.
 *
 * ⚠️ This wore `--ring` — a 1px hairline — while a two-layer shadow sat unused
 * in the same stylesheet, which is why every surface in the module read flat on
 * the page. `--sh-1` is the resting step of the elevation ramp; the hairline
 * stays as the border, so the card still has a defined edge on a tinted
 * background rather than relying on the shadow alone.
 */
export const card: CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--bd)',
  borderRadius: 'var(--r4)',
  boxShadow: 'var(--sh-1)',
};

export function Card({
  children,
  style,
  pad = 18,
  onAct,
  label,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
  /**
   * Makes the whole card the control. Pass `label` with it — the card's
   * contents are a layout, not an accessible name.
   *
   * 🔴 Without this, a screen wanting a clickable card hand-rolls
   * `<div onClick role='button'>` and forgets the keyboard — which is exactly
   * what the hub tiles and the home widget grid did. Announced as buttons,
   * reachable by nobody using a keyboard, on the module's first screen.
   */
  onAct?: () => void;
  label?: string;
}) {
  const mobile = useIsMobile();
  // 18px of card padding inside 14px of page padding leaves a phone 32px of
  // margin before any content starts. A caller asking for 0 means it.
  const p = mobile && pad > 0 ? Math.min(pad, 13) : pad;
  const base = { ...card, padding: p, ...style };

  // ⚠️ A plain card must stay OUT of the tab order. Every screen here is built
  // out of cards, so a focusable surface would put dozens of dead tab stops on
  // each page and bury the controls that actually do something.
  if (!onAct) return <div style={base}>{children}</div>;

  return (
    <div
      role='button'
      tabIndex={0}
      aria-label={label}
      // The hover lift and the focus ring live in `tokens.css`. Not a
      // preference: this module styles with inline objects and an inline style
      // cannot express `:hover` or `:focus-visible` at all.
      className='stalls-lift'
      style={{ ...base, cursor: 'pointer' }}
      onClick={onAct}
      onKeyDown={(e) => {
        // Both keys. A real <button> gives Enter and Space for free; a div
        // pretending to be one gives neither, and fixing only Enter is how
        // this half-regresses.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAct();
        }
      }}
    >
      {children}
    </div>
  );
}

/**
 * The page heading, and the only place the display face is spent.
 *
 * `icon` and `actions` exist because every screen in this module was
 * hand-rolling the same flex row around this component — a glyph, a title, a
 * subtitle, and controls pushed right. Passing the glyph as a node rather than
 * a name keeps `ui.tsx` free of an import on the icon set.
 *
 * ⚠️ On a phone the actions drop BELOW the title rather than squeezing beside
 * it. A "New Requirement" button competing with a two-line heading in 360px
 * gives a title broken across three lines and a button clipped at the edge.
 */
export function H1({
  children,
  sub,
  icon,
  actions,
}: {
  children: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <div
      style={{
        marginBottom: mobile ? 14 : 18,
        display: 'flex',
        flexDirection: mobile ? 'column' : 'row',
        alignItems: mobile ? 'stretch' : 'center',
        gap: mobile ? 10 : 14,
      }}
    >
      {icon && (
        // The tinted icon chip: the tone's tint behind the tone's accent glyph.
        // Legal under the palette rule because a glyph is an ICON, not text.
        <div
          style={{
            width: mobile ? 34 : 40,
            height: mobile ? 34 : 40,
            borderRadius: 'var(--r3)',
            background: 'var(--pri-t)',
            color: 'var(--pri)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: mobile ? 21 : 26,
            fontWeight: 600,
            letterSpacing: '-.5px',
            lineHeight: 1.15,
          }}
        >
          {children}
        </div>
        {sub && <div style={{ fontSize: 13.5, color: 'var(--mfg)', marginTop: 3 }}>{sub}</div>}
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: 8, flex: 'none', flexWrap: 'wrap' }}>{actions}</div>
      )}
    </div>
  );
}

export function Avatar({
  name,
  tint,
  size = 34,
  src,
}: {
  name: string;
  tint?: string;
  size?: number;
  /** A signed link to this person's photograph. Absent, null or a link that
   *  fails to load all fall back to the initials — the avatar has drawn those
   *  since before anybody had a photograph, and a broken image icon in a
   *  hundred-row directory is worse than a letter. */
  src?: string | null;
}) {
  const ini = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  // Which link failed, rather than a boolean "it failed".
  //
  // ⚠️ Deliberately not `useState(false)` plus an effect that clears it when
  // `src` changes. Storing the failed URL makes the reset DERIVED: a re-signed
  // link for the same person — which is a new URL on every page load, since it
  // carries a signature — no longer inherits the last one's failure, and there
  // is no effect to keep in step with the prop.
  const [failed, setFailed] = useState<string | null>(null);
  const broken = failed !== null && failed === src;

  if (src && !broken) {
    return (
      <img
        src={src}
        alt={name}
        onError={() => setFailed(src)}
        style={{
          width: size,
          height: size,
          // The same rounding as the initials plate, so a directory of both
          // does not read as two different kinds of row.
          borderRadius: size / 3,
          objectFit: 'cover',
          // The stored object is already a square, reduced on upload. This is
          // what keeps a legacy or hand-uploaded rectangle from stretching.
          objectPosition: 'center',
          flex: 'none',
          background: 'var(--mut)',
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 3,
        background: tint ?? 'var(--pri)',
        // ⚠️ Two different surfaces, so two different texts. A `tint` is one of
        // the `--av*` plates, dark in BOTH themes, and needs light text. No tint
        // means the primary fill, which flips light in the dark theme and needs
        // `--pfg` — now dark. One constant here cannot serve both, and `--pfg`
        // alone made every tinted avatar's initials dark-on-dark.
        color: tint ? 'var(--on-solid)' : 'var(--pfg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.36,
        flex: 'none',
      }}
    >
      {ini}
    </div>
  );
}

export function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number | null;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      // 🔴 "Selected" was carried by the FILL alone, so which filters are on was
      // information only a sighted user got. Every call site of this chip is a
      // toggle — the segmented filters on Activity Log, the report catalogue and
      // the report filter bar — so the pressed state is always meaningful here.
      // (The removable filter tag on the list screen is a different, local
      // component and is not this.)
      aria-pressed={!!active}
      // Hover lives in the stylesheet for the same reason it does on Card: an
      // inline style cannot express it.
      className='stalls-lift'
      style={{
        padding: '6px 12px',
        borderRadius: 999,
        cursor: 'pointer',
        fontSize: 12.5,
        fontWeight: 600,
        border: `1px solid ${active ? 'transparent' : 'var(--bd)'}`,
        background: active ? 'var(--pri)' : 'var(--card)',
        color: active ? 'var(--pfg)' : 'var(--mfg)',
      }}
    >
      {label}
      {count !== undefined && count !== null && (
        // 🔴 This rode at `opacity: 0.7`, and opacity is the one thing the
        // contrast guard cannot see — it measures token PAIRS, and a faded
        // token is not a different token. On the active chip that was a 70%
        // label on the solid primary, and `--pri` flips from a dark indigo to a
        // light lavender between themes, so the fade was heading the wrong way
        // in dark. A well instead: measurable, and it reads as a count.
        //
        // ⚠️ The active well INVERTS the chip rather than lightening it with a
        // translucent white. A first attempt used `--on-solid-line` (white at
        // 16%) and the contrast guard refused it — correctly, and for a reason
        // worth keeping: the guard flattens a translucent colour onto `--card`,
        // but this well sits on `--pri`, so it cannot model the pair at all.
        // Inverting uses two OPAQUE tokens instead, and the pair is the button's
        // own — which the suite already proves clears the floor in both themes,
        // and contrast is symmetric, so this needs no second measurement.
        <span
          style={{
            marginLeft: 6,
            padding: '1px 6px',
            borderRadius: 999,
            fontSize: 11.5,
            fontWeight: 700,
            background: active ? 'var(--pfg)' : 'var(--mut)',
            color: active ? 'var(--pri)' : 'var(--mfg)',
          }}
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

/**
 * A pill's three colours, by tone.
 *
 * 🔴 The middle slot is `--<tone>-fg`, NOT `--<tone>`. The accent colours fail the
 * 4.5:1 text floor on their own tints — `--des` measured 4.39:1 in light and 3.94:1
 * in dark — which is why the red pills on the allocate screen could not be read.
 * `tokens.css` carries the measurements and the rule. Accent stays on the border.
 */
export type Tone = 'neutral' | 'ok' | 'des' | 'warn' | 'info' | 'violet' | 'teal';

// [tint, readable text, border]
export const TONE: Record<Tone, [string, string, string]> = {
  neutral: ['var(--mut)', 'var(--mfg)', 'var(--bd)'],
  ok: ['var(--ok-t)', 'var(--ok-fg)', 'var(--ok-b)'],
  des: ['var(--des-t)', 'var(--des-fg)', 'var(--des-b)'],
  warn: ['var(--warn-t)', 'var(--warn-fg)', 'var(--warn-b)'],
  info: ['var(--info-t)', 'var(--info-fg)', 'var(--info-b)'],
  violet: ['var(--violet-t)', 'var(--violet-fg)', 'var(--violet-b)'],
  teal: ['var(--teal-t)', 'var(--teal-fg)', 'var(--teal-b)'],
};

/**
 * Pill metrics, in one place so the whole module moves together.
 *
 * `md` is the default and the size a pill should be: 12.5px at 600 was 10–11.5px at
 * 700 before, which is the other half of why these were unreadable — the contrast
 * fix alone would not have made a 10px label legible. Bold made it worse, not
 * better, because a heavier stroke at that size just fills the counters in.
 *
 * `sm` exists for the genuinely dense places — a count riding inside a control, a
 * marker in a table cell — where `md` would break the row it sits in. It is a
 * deliberate exception, not a free choice: if a person has to READ it, it is `md`.
 */
const SIZE = {
  md: { fontSize: 12.5, padding: '4px 11px' },
  sm: { fontSize: 11.5, padding: '2px 8px' },
} as const;

export type PillSize = keyof typeof SIZE;

/** The shared pill box, for the few places that need the style without the element. */
export function pillStyle(tone: Tone = 'neutral', size: PillSize = 'md'): CSSProperties {
  const [bg, fg, bd] = TONE[tone];
  return {
    ...SIZE[size],
    background: bg,
    color: fg,
    border: `1px solid ${bd}`,
    borderRadius: 999,
    fontWeight: 600,
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    letterSpacing: '0.1px',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
  };
}

/**
 * A free-text pill in one of the tones.
 *
 * Use this for a label whose text is not a known status — a match reason, a
 * conflict, a count, a stamp. `Pill` is for the statuses in `STATUS_TONE`, which
 * pick their own tone from the word.
 */
export function Tag({
  children,
  tone = 'neutral',
  size = 'md',
  title,
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  size?: PillSize;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <span title={title} style={{ ...pillStyle(tone, size), ...style }}>
      {children}
    </span>
  );
}

// Which tone each known status wears.
/**
 * The tone a known status wears, for anything that is not a pill.
 *
 * Exported so a stat tile draws `Confirmed` in the same green the pill beside
 * it does — a second colour vocabulary for the same words is how two parts of
 * one screen come to disagree about what green means.
 */
export function statusTone(label: string): Tone {
  return STATUS_TONE[label] ?? 'neutral';
}

const STATUS_TONE: Record<string, Tone> = {
  // ── Registration / volunteer status ──
  New: 'neutral',
  'In Progress': 'info',
  Confirmed: 'ok',
  'Checked In': 'teal',
  'Checked Out': 'violet',
  Blocked: 'des',
  Cancelled: 'des',
  Withdrawn: 'neutral',

  // ── Calling status ──
  'Not Called': 'neutral',
  Called: 'teal',
  'Call Completed': 'ok',
  'Callback Requested': 'warn',
  'Not Answered': 'warn',
  Declined: 'des',
  Busy: 'warn',
  'No Answer': 'warn',
  'Wrong Number': 'des',
  'Not Reachable': 'des',
  'Requested Not to Call': 'des',
  'Will Not Attend': 'des',
  'Confirmed via Call': 'ok',

  // ── Flag / medical ──
  Medical: 'violet',
  Alert: 'des',

  // ── Requirement status ──
  Open: 'info',
  'Partially Filled': 'warn',
  Filled: 'ok',
  Closed: 'neutral',

  // ── Attendance ──
  Present: 'ok',
  Absent: 'des',
  Leave: 'warn',
  'Not Marked': 'neutral',

  // ── Allocation kind ──
  Primary: 'info',
  Secondary: 'teal',
  'Since removed': 'neutral',

  // ── The users directory ──
  // Its tiles are a population split, not a status ramp: the two kinds of
  // person are told apart by hue rather than ranked, and only the two readings
  // that mean somebody is stuck carry a warning colour.
  Backoffice: 'violet',
  Requesters: 'teal',
  'Cannot sign in': 'warn',
  'Locked out': 'des',

  // ── Announcements ──
  Info: 'info',
  Warning: 'warn',
  Urgent: 'des',
  Active: 'ok',
  Draft: 'neutral',
  Archived: 'neutral',
};

export function Pill({ children, size = 'md' }: { children: string; size?: PillSize }) {
  return (
    <Tag tone={STATUS_TONE[children] ?? 'neutral'} size={size}>
      {children}
    </Tag>
  );
}

export function Btn({
  children,
  onClick,
  kind = 'ghost',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}) {
  const skin =
    kind === 'primary'
      ? {
          background: 'var(--pri)',
          color: 'var(--pfg)',
          border: '1px solid transparent',
          // Only the solid fill gets a coloured lift. On a ghost button, flush
          // with the card behind it, the same shadow reads as a smudge.
          boxShadow: 'var(--sh-pri)',
        }
      : kind === 'danger'
        ? { background: 'var(--des-t)', color: 'var(--des-fg)', border: '1px solid var(--des-b)' }
        : { background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--bd)' };
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      // ⚠️ Conditional, not part of the base style. A disabled control that
      // still answers the pointer reads as clickable and invites the click it
      // will then swallow.
      className={disabled ? undefined : 'stalls-lift'}
      style={{
        ...skin,
        // ⚠️ Added for this module, and it is the one change to this file. In
        // the module this was copied from every caller passes a bare word, so
        // an inline box was enough. Here MOST buttons carry a glyph before the
        // label — see the action convention in `ui/icons.tsx` — and inline
        // layout drops the 14px icon onto the text baseline with no gap, a
        // couple of pixels low. Harmless where there is no icon.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // ⚠️ This `gap` is the ONLY thing between a glyph and its label, and
        // callers must not add a second separator. `<Icon /> Save` writes a
        // literal space into the text node, which lands ON TOP of the gap and
        // makes that button ~4px wider inside than the one beside it. The
        // module had it both ways — 15 buttons spaced, 10 not — and the two
        // are indistinguishable in review and obvious side by side on screen.
        gap: 6,
        // 🔴 A label is one line and is never squeezed. Without these three a
        // button is a flex ITEM like any other: it shrinks to its longest word
        // when the row runs out of room, so "Flag for Follow-Up" breaks across
        // two lines inside a pill sized for one and the second line is cut off
        // by the padding. It showed on the request rail, which is eight
        // buttons wide, and in the allocation row, where the button sits beside
        // a `flex:1` description that takes the space first. `Tag` and
        // `toolBtnStyle` have said `nowrap` all along — this was the outlier.
        // A rail that cannot fit its buttons wraps them, which is what its
        // `flexWrap` is for.
        whiteSpace: 'nowrap',
        flexShrink: 0,
        lineHeight: 1.35,
        padding: '8px 14px',
        // 🔴 Was `calc(var(--r4) - 6px)` — reasonable when the sheet had only
        // two steps and a control had nothing between them to name, but it tied
        // every button in the module to the CARD radius and landed on 12.7px,
        // which is neither step. `--r2` is the control step.
        borderRadius: 'var(--r2)',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

/**
 * Nothing to show, said deliberately.
 *
 * Bare centred grey text mid-page is indistinguishable from a screen that
 * failed to render. The dashed plate is the part that carries the meaning: this
 * is a container, and it is empty.
 *
 * ⚠️ The copy is the caller's and stays SENTENCE case — an empty state is prose,
 * not a label, and is held out of the Title Case rule on purpose.
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '34px 12px',
        textAlign: 'center',
        color: 'var(--mfg)',
        fontSize: 13.5,
        border: '1px dashed var(--bd)',
        borderRadius: 'var(--r4)',
        background: 'var(--mut)',
      }}
    >
      {children}
    </div>
  );
}

/**
 * The waiting state, in the shape of the thing being waited for.
 *
 * 🔴 This used to render the literal text "Loading…", and the shimmer nearly
 * replaced it outright. That would have made a nicer page and told someone who
 * cannot see it NOTHING — the screen would simply go quiet, in all 41 places
 * this is rendered. So the blocks are decoration and `role="status"` carries
 * the announcement; the visible word is gone, the spoken one is not.
 */
export function Loading() {
  return (
    <div role='status' aria-label='Loading' style={{ padding: 28, display: 'grid', gap: 10 }}>
      {/* Three bars of unequal width read as content arriving rather than as a
          progress bar stuck at a third. */}
      {['62%', '86%', '44%'].map((w) => (
        <div key={w} className='stalls-shimmer' style={{ width: w, height: 13 }} />
      ))}
    </div>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 'var(--r2)',
        background: 'var(--des-t)',
        color: 'var(--des-fg)',
        fontSize: 13,
        border: '1px solid var(--des-b)',
      }}
    >
      {children}
    </div>
  );
}

/** Horizontal bar used across the dashboard and area overview. */
export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '9px 0',
        borderTop: '1px solid var(--line)',
        fontSize: 13,
      }}
    >
      <div style={{ width: 160, color: 'var(--mfg)', flex: 'none' }}>{k}</div>
      <div style={{ flex: 1, minWidth: 0 }}>{v}</div>
    </div>
  );
}

/**
 * The look of a control that sits ON a toolbar — Filter, Group By, Columns, the
 * attendance date and its mark-all pair.
 *
 * ⚠️ It exists because there were THREE near-copies of it: the popover trigger
 * at `8px 12px` on `--r2`, the attendance status chips at `8px 11px` on
 * `calc(var(--r4) - 6px)`, and attendance's own `toolBtn` at `7px 12px` and
 * 12px type. Nobody chose three; each was written next to the last. Read side
 * by side on one screen the difference is exactly what "these don't look like
 * the other pages" means, so the look is one function now and the toolbars
 * call it.
 *
 * `active` is the state a filter is IN, not a hover: a chosen option keeps the
 * primary tint so a toolbar says what it is doing without being opened.
 */
export function toolBtnStyle(active = false): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 12px',
    // `--r2` is the control step. The `calc` off the card radius that two of
    // the three copies used is the thing the shape ramp forbids.
    borderRadius: 'var(--r2)',
    cursor: 'pointer',
    fontSize: 12.5,
    fontWeight: 600,
    border: `1px solid ${active ? 'var(--pri)' : 'var(--bd)'}`,
    background: active ? 'var(--pri-t)' : 'var(--card)',
    color: active ? 'var(--pri)' : 'var(--mfg)',
    whiteSpace: 'nowrap',
  };
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}
    >
      {children}
    </div>
  );
}

export function Search({
  value,
  onChange,
  placeholder,
  label = 'Search',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /**
   * The accessible name.
   *
   * ⚠️ Added for this module, and it is the second of two changes to this file.
   * Upstream this input has no label at all — only a placeholder, which is a
   * HINT and not a name: it is announced by some readers and not others, and it
   * disappears the moment anything is typed. Every toolbar in that module has
   * exactly one search box, so nothing broke; here the same box sits above a
   * pipeline a reader navigates by landmark, and the suite reaches it by name.
   *
   * Defaulted rather than required, so it is a name every caller gets for free
   * and only a screen with two search boxes has to think about.
   */
  label?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? 'Search…'}
      aria-label={label}
      style={{
        padding: '8px 12px',
        borderRadius: 'var(--r2)',
        border: '1px solid var(--bd)',
        background: 'var(--card)',
        fontSize: 13,
        minWidth: 220,
        outline: 'none',
        color: 'var(--fg)',
      }}
    />
  );
}

/**
 * The width a table's horizontal scroller must reserve for one grid template.
 *
 * ⚠️ IT EXISTS BECAUSE SIX TABLES GUESSED IT. Each reserved the sum of its
 * column widths plus a round number for the structural ones, and every one of
 * them forgot the 10px gap between columns and the 16px of padding on each
 * side. A grid whose tracks are wider than its box does not shrink them — it
 * overflows, and the overflow lands entirely on the LAST column. That column is
 * always the actions, so on a wide table the icons and their header sat outside
 * the card, past the border, with no row line beneath them: the Primary Area
 * table reserved 1950px for a grid that needed 2066.
 *
 * Reading the template instead of re-adding the numbers is what stops a new
 * column bringing it back. `px` and the floor of a `minmax()` count; `fr` and
 * `auto` count as nothing, because they are the tracks that give way.
 */
export function gridMinWidth(template: string, gap = 10, pad = 32): number {
  const tracks = template.match(/minmax\([^)]*\)|\S+/g) ?? [];
  const fixed = tracks.reduce((w, t) => w + trackFloor(t), 0);
  return fixed + gap * Math.max(0, tracks.length - 1) + pad;
}

/** The narrowest one track can be drawn: its px size, or 0 if it can give way. */
function trackFloor(track: string): number {
  const [, floorOf] = /^minmax\(\s*([^,]+),/.exec(track) ?? [];
  if (floorOf) return trackFloor(floorOf.trim());
  const [, px] = /^([\d.]+)px$/.exec(track) ?? [];
  return px ? Number.parseFloat(px) : 0;
}
