import type { AvailableStall, RequestDetail } from '@msr/stalls';
import { useMemo, useState } from 'react';
import { ApiError } from '../../../lib/api-client';
import { availableStalls, select } from '../api';
import { useLoad } from '../hooks';
import { Btn, Dialog, Empty, Loading, Select, useToast } from '../ui';

const ZONES = ['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2'];

/** Pick free stalls for a request. Shows only AVAILABLE stalls, opens on the
 *  vendor's preferred zone, and caps the pick at what the request asked for
 *  minus what it already holds. A 409 means someone took a stall between the
 *  list loading and the click — the list reloads and the toast says so. */
export function SelectDialog({
  request: r,
  onClose,
  onDone,
}: {
  request: RequestDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [zone, setZone] = useState<string>(r.preferredZoneCode);
  const { data, loading, reload } = useLoad(() => availableStalls(zone || undefined), [zone]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const remaining = Math.max(0, r.numStallsRequested - r.allocations.length);
  const stalls = data ?? [];
  const byZone = useMemo(() => {
    const m = new Map<string, AvailableStall[]>();
    for (const s of stalls) m.set(s.zoneCode, [...(m.get(s.zoneCode) ?? []), s]);
    return m;
  }, [stalls]);

  const toggle = (n: string) =>
    setPicked((p) =>
      p.includes(n) ? p.filter((x) => x !== n) : p.length < remaining ? [...p, n] : p,
    );

  const confirm = async () => {
    setBusy(true);
    try {
      const out = await select(r.id, picked);
      toast.ok(`Allocated ${out.allocated.join(', ')}`);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.fail(new Error(`${e.message}. The list has been refreshed.`));
        setPicked([]);
        reload();
      } else {
        toast.fail(e instanceof ApiError ? e : new Error('Something went wrong'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Select ${r.stallName}`}
      note={
        remaining === 0
          ? 'This request already holds every stall it asked for. Release one to change it.'
          : `Pick up to ${remaining} stall${remaining > 1 ? 's' : ''} — the request asked for ${r.numStallsRequested}, preferred ${r.preferredZoneCode}.`
      }
      onClose={onClose}
      width={640}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' disabled={busy || picked.length === 0} onClick={confirm}>
            {busy ? 'Allocating…' : `Allocate ${picked.length || ''}`.trim()}
          </Btn>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Select
          aria-label='Zone'
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          style={{ width: 'auto', minWidth: 150 }}
        >
          <option value=''>All zones</option>
          {ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
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
        <Empty>
          No available stalls{zone ? ` in ${zone}` : ''}. Apply a plan under Planning &amp; Zones.
        </Empty>
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
                  const full = !on && picked.length >= remaining;
                  return (
                    <button
                      type='button'
                      key={s.id}
                      onClick={() => toggle(s.number)}
                      aria-pressed={on}
                      disabled={full}
                      title={s.category.replace(/_/g, ' ').toLowerCase()}
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
    </Dialog>
  );
}
