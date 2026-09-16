import type { AvailableStall } from '@stalls/core';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Empty, Loading, Select, titleCase } from '../ui';

/** The grid of free stalls, grouped by bay, with the bay filter above it.
 *
 *  ⚠️ Shared by the two dialogs that hand out a stall number — the first
 *  selection and a later correction of it. They are the same act seen twice,
 *  and the thing a coordinator is aiming at has to be the same size, in the
 *  same grouping, with the same "N available" count in both; the tap target
 *  note below is the reason that matters more here than in most grids.
 *
 *  `picked` is a list rather than a value because selection takes several
 *  stalls at once and a move takes exactly one. The caller decides which by
 *  what it does in `onPick`. */
export function StallPicker({
  stalls,
  zones,
  zone,
  onZone,
  loading,
  picked,
  onPick,
  atCap = false,
  empty,
}: {
  stalls: AvailableStall[];
  zones: Array<{ code: string; name: string }>;
  zone: string;
  onZone: (code: string) => void;
  loading: boolean;
  picked: string[];
  onPick: (stallNumber: string) => void;
  /** No more may be taken — everything unpicked goes flat and unclickable. */
  atCap?: boolean;
  /** What to say when this bay has nothing free. The reason differs by caller,
   *  so the sentence is theirs. */
  empty: ReactNode;
}) {
  const byZone = useMemo(() => {
    const m = new Map<string, AvailableStall[]>();
    for (const s of stalls) m.set(s.zoneCode, [...(m.get(s.zoneCode) ?? []), s]);
    return m;
  }, [stalls]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Select
          aria-label='Zone'
          value={zone}
          onChange={(v) => onZone(v)}
          style={{ width: 'auto', minWidth: 150 }}
        >
          <option value=''>All Zones</option>
          {zones.map((z) => (
            <option key={z.code} value={z.code}>
              {z.code}
            </option>
          ))}
        </Select>
        <span style={{ fontSize: 11.5, color: 'var(--mfg)' }}>
          {loading ? 'Loading…' : `${stalls.length} available`}
        </span>
      </div>

      {loading && stalls.length === 0 ? (
        <Loading />
      ) : stalls.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {[...byZone.entries()].map(([z, list]) => (
            <div key={z}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '.7px',
                  textTransform: 'uppercase',
                  color: 'var(--mfg)',
                  marginBottom: 7,
                }}
              >
                Zone {z}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {list.map((s) => {
                  const on = picked.includes(s.number);
                  const full = !on && atCap;
                  return (
                    <button
                      type='button'
                      key={s.id}
                      onClick={() => onPick(s.number)}
                      aria-pressed={on}
                      disabled={full}
                      title={titleCase(s.category)}
                      style={{
                        // ⚠️ 34px tall, not the 26px a dense chip wants. These
                        // are the tap targets on the one screen that assigns a
                        // physical stall to a paying vendor, and they sit six to
                        // a row — a mis-tap here is a wrong allocation somebody
                        // has to release.
                        minWidth: 58,
                        height: 34,
                        padding: '0 10px',
                        borderRadius: 'var(--r2)',
                        border: `1px solid ${on ? 'transparent' : 'var(--bd)'}`,
                        background: on ? 'var(--pri)' : 'var(--card)',
                        color: on ? 'var(--pfg)' : 'var(--fg)',
                        boxShadow: on ? 'var(--sh-pri)' : undefined,
                        fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: full ? 'not-allowed' : 'pointer',
                        opacity: full ? 0.4 : 1,
                      }}
                    >
                      {s.number}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
