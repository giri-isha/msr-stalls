import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../icons';
import { toolBtnStyle } from '../ui';
import { Dialog, inputStyle } from './Dialog';

/** Dates travel as `YYYY-MM-DD`, the same shape a native date input uses. */
export type Iso = string;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const parse = (s: Iso | null | undefined) => {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return y && m && d ? { y, m: m - 1, d } : null;
};

/** "9 Feb 2026". Year is dropped only where the caller asks for the short form. */
export const fmtDate = (s: Iso | null | undefined, withYear = true) => {
  const p = parse(s);
  if (!p) return '—';
  return `${p.d} ${SHORT[p.m]}${withYear ? ` ${p.y}` : ''}`;
};

export const daysBetween = (a: Iso, b: Iso) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

/** Monday-first grid, with leading/trailing days from the neighbouring months. */
function monthGrid(y: number, m: number) {
  const first = new Date(Date.UTC(y, m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Sunday(0) → 6
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const prev = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells: { d: number; inMonth: boolean; iso: Iso }[] = [];
  for (let i = lead; i > 0; i--) {
    cells.push({
      d: prev - i + 1,
      inMonth: false,
      iso: iso(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, prev - i + 1),
    });
  }
  for (let d = 1; d <= days; d++) cells.push({ d, inMonth: true, iso: iso(y, m, d) });
  while (cells.length % 7) {
    const d = cells.length - lead - days + 1;
    cells.push({ d, inMonth: false, iso: iso(m === 11 ? y + 1 : y, m === 11 ? 0 : m + 1, d) });
  }
  return cells;
}

/* ─────────────────────────────── Calendar ─────────────────────────────── */

function Calendar({
  from,
  to,
  range,
  onPick,
  minDate,
  maxDate,
}: {
  from: Iso | null;
  to: Iso | null;
  range: boolean;
  onPick: (d: Iso) => void;
  minDate?: string | null;
  maxDate?: string | null;
}) {
  const anchor = parse(from) ?? parse(to);
  const [view, setView] = useState(() =>
    anchor
      ? { y: anchor.y, m: anchor.m }
      : { y: new Date().getUTCFullYear(), m: new Date().getUTCMonth() },
  );

  const cells = useMemo(() => monthGrid(view.y, view.m), [view]);
  const step = (n: number) =>
    setView(({ y, m }) => {
      const t = m + n;
      return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
    });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button type='button' onClick={() => step(-1)} style={navBtn} aria-label='Previous Month'>
          <Icon name='chevron-left' size={15} />
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 14.5, fontWeight: 700 }}>
          {MONTHS[view.m]} {view.y}
        </div>
        <button type='button' onClick={() => step(1)} style={navBtn} aria-label='Next Month'>
          <Icon name='chevron-right' size={15} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
        {DOW.map((d) => (
          <div
            key={d}
            style={{
              textAlign: 'center',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.6px',
              textTransform: 'uppercase',
              color: 'var(--mfg)',
              paddingBottom: 6,
            }}
          >
            {d}
          </div>
        ))}

        {cells.map((c) => {
          const isFrom = c.iso === from;
          const isTo = c.iso === to;
          const inRange = range && from && to && c.iso > from && c.iso < to;
          const end = isFrom || isTo;
          const outOfBounds = !!((minDate && c.iso < minDate) || (maxDate && c.iso > maxDate));
          return (
            // ⚠️ Keyed on the ISO date alone. The standalone key was
            // `${c.iso}-${i}`, and the index was redundant: the grid is built
            // as leading days from the previous month, this month's days, then
            // trailing days from the next, so every cell's ISO date is already
            // distinct. Carrying the index made this trip `noArrayIndexKey` for
            // no benefit.
            <button
              type='button'
              key={c.iso}
              onClick={() => {
                if (!outOfBounds) onPick(c.iso);
              }}
              disabled={outOfBounds}
              style={{
                height: 38,
                border: 0,
                cursor: outOfBounds ? 'not-allowed' : 'pointer',
                fontSize: 13,
                borderRadius: inRange ? 0 : 10,
                fontWeight: end ? 700 : 500,
                background: end ? 'var(--pri)' : inRange ? 'var(--pri-t)' : 'transparent',
                color: outOfBounds
                  ? 'var(--des)'
                  : end
                    ? 'var(--pfg)'
                    : c.inMonth
                      ? 'var(--fg)'
                      : 'var(--mfg)',
                opacity: outOfBounds ? 0.25 : c.inMonth ? 1 : 0.45,
              }}
            >
              {c.d}
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ──────────────────────────── Range field ──────────────────────────────── */

/**
 * A start→end window, opened from a read-only field.
 *
 * Picking sets the start and clears the end; picking again closes the range,
 * and a second date before the first swaps them rather than rejecting the click.
 */
export function DateRangeField({
  from,
  to,
  onChange,
  title = 'Select a Window',
  note,
  placeholder = 'Pick dates…',
  minDate,
  maxDate,
}: {
  from: Iso | null;
  to: Iso | null;
  onChange: (from: Iso | null, to: Iso | null) => void;
  title?: string;
  note?: string;
  placeholder?: string;
  minDate?: string | null;
  maxDate?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<Iso | null>(from);
  const [b, setB] = useState<Iso | null>(to);

  // ⚠️ Seeds the local editing state FROM the props when the panel opens, so
  // `open` is the whole dependency by design. Adding the value props would
  // re-seed mid-edit and discard whatever the person had picked. This carried a
  // dead `eslint-disable react-hooks/exhaustive-deps` from the standalone app,
  // which proves the omission was deliberate — restated so the reason survives,
  // since there is no eslint in this repo to read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds local edit state on open; re-seeding mid-edit would discard the person's input
  useEffect(() => {
    if (open) {
      setA(from);
      setB(to);
    }
  }, [open]);

  const pick = (d: Iso) => {
    if (!a || (a && b)) {
      setA(d);
      setB(null);
      return;
    }
    if (d < a) {
      setB(a);
      setA(d);
      return;
    }
    setB(d);
  };

  const label = from && to ? `${fmtDate(from, false)} → ${fmtDate(to, false)}` : placeholder;

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        style={{
          ...inputStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, color: from && to ? 'var(--fg)' : 'var(--mfg)', fontWeight: 500 }}>
          {label}
        </span>
        <Icon name='calendar' size={15} color='var(--mfg)' />
      </button>

      {open && (
        <Dialog
          width={420}
          title={title}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button
                type='button'
                onClick={() => {
                  setA(null);
                  setB(null);
                }}
                style={{ ...pickerGhost, border: 0, marginRight: 'auto' }}
              >
                Clear
              </button>
              <button type='button' onClick={() => setOpen(false)} style={pickerGhost}>
                Cancel
              </button>
              <button
                type='button'
                onClick={() => {
                  onChange(a, b);
                  setOpen(false);
                }}
                disabled={!!a && !b}
                style={{
                  ...pickerPrimary,
                  opacity: a && !b ? 0.5 : 1,
                  cursor: a && !b ? 'not-allowed' : 'pointer',
                }}
              >
                Apply
              </button>
            </>
          }
        >
          <Calendar from={a} to={b} range onPick={pick} minDate={minDate} maxDate={maxDate} />
          <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, fontWeight: 700 }}>
            {a && b
              ? `${fmtDate(a, false)} → ${fmtDate(b, false)} · ${daysBetween(a, b)} days`
              : a
                ? `${fmtDate(a, false)} → pick an end date`
                : 'Pick a start date'}
          </div>
          {note && (
            <div
              style={{
                textAlign: 'center',
                marginTop: 6,
                fontSize: 11.5,
                color: 'var(--mfg)',
                lineHeight: 1.55,
              }}
            >
              {note}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

/* ──────────────────────────── Single date field ────────────────────────── */

/**
 * One date, optionally with a time — the same calendar the range field uses,
 * so `date` and `datetime` questions read identically.
 *
 * `value` is `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when `withTime` is set.
 */
export function DateField({
  value,
  onChange,
  withTime = false,
  title,
  placeholder = 'Pick a date…',
  minDate,
  maxDate,
  compact,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  withTime?: boolean;
  title?: string;
  placeholder?: string;
  minDate?: string | null;
  maxDate?: string | null;
  /**
   * Renders the trigger as a TOOLBAR control rather than a form field — the
   * same shape as the Filter and Group By buttons beside it. The panel is
   * identical; only the thing you press changes. A form-field-width date box on
   * a row of icon buttons is what made the attendance toolbar look unlike every
   * other screen's.
   */
  compact?: boolean;
  /** Accessible name for the compact trigger, whose date reads as its value. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Iso | null>(null);
  const [time, setTime] = useState('09:00');

  // ⚠️ Seeds the local editing state FROM the props when the panel opens, so
  // `open` is the whole dependency by design. Adding the value props would
  // re-seed mid-edit and discard whatever the person had picked. This carried a
  // dead `eslint-disable react-hooks/exhaustive-deps` from the standalone app,
  // which proves the omission was deliberate — restated so the reason survives,
  // since there is no eslint in this repo to read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seeds local edit state on open; re-seeding mid-edit would discard the person's input
  useEffect(() => {
    if (!open) return;
    setDay(value ? value.slice(0, 10) : null);
    setTime(withTime && value.length >= 16 ? value.slice(11, 16) : '09:00');
  }, [open]);

  const shown = value
    ? `${fmtDate(value.slice(0, 10))}${withTime && value.length >= 16 ? ` · ${value.slice(11, 16)}` : ''}`
    : placeholder;

  return (
    <>
      {compact ? (
        <button
          type='button'
          onClick={() => setOpen(true)}
          aria-label={label ?? title ?? 'Pick a date'}
          style={toolBtnStyle()}
        >
          <Icon name='calendar' size={14} />
          <span style={{ color: value ? 'var(--fg)' : 'var(--mfg)' }}>{shown}</span>
        </button>
      ) : (
        <button
          type='button'
          onClick={() => setOpen(true)}
          style={{
            ...inputStyle,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <span style={{ flex: 1, color: value ? 'var(--fg)' : 'var(--mfg)', fontWeight: 500 }}>
            {shown}
          </span>
          <Icon name='calendar' size={15} color='var(--mfg)' />
        </button>
      )}

      {open && (
        <Dialog
          width={420}
          title={title ?? (withTime ? 'Pick a date and time' : 'Pick a date')}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button
                type='button'
                onClick={() => setDay(null)}
                style={{ ...pickerGhost, border: 0, marginRight: 'auto' }}
              >
                Clear
              </button>
              <button type='button' onClick={() => setOpen(false)} style={pickerGhost}>
                Cancel
              </button>
              <button
                type='button'
                onClick={() => {
                  onChange(day ? (withTime ? `${day}T${time}` : day) : '');
                  setOpen(false);
                }}
                style={pickerPrimary}
              >
                Apply
              </button>
            </>
          }
        >
          <Calendar
            from={day}
            to={null}
            range={false}
            onPick={setDay}
            minDate={minDate}
            maxDate={maxDate}
          />

          {withTime && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '.6px',
                  textTransform: 'uppercase',
                  color: 'var(--mfg)',
                }}
              >
                Time
              </span>
              <input
                type='time'
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={{ ...inputStyle, width: 130 }}
              />
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, fontWeight: 700 }}>
            {day ? `${fmtDate(day)}${withTime ? ` · ${time}` : ''}` : 'No date picked'}
          </div>
        </Dialog>
      )}
    </>
  );
}

const navBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  borderRadius: 'var(--r2)',
  border: '1px solid var(--bd)',
  background: 'var(--card)',
  color: 'var(--mfg)',
  cursor: 'pointer',
  flex: 'none',
};
const pickerGhost: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--r2)',
  border: '1px solid var(--bd)',
  background: 'var(--card)',
  color: 'var(--mfg)',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};
const pickerPrimary: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--r2)',
  border: 0,
  background: 'var(--pri)',
  color: 'var(--pfg)',
  fontSize: 12.5,
  fontWeight: 700,
  cursor: 'pointer',
};
