import type { AvailableStall, RequestDetail } from '@msr/stalls';
import { useMemo, useState } from 'react';
import { ApiError } from '../api-client';
import { availableStalls, listZones, select } from '../api';
import { useLoad } from '../hooks';
import { Btn, Dialog, Empty, Icon, Loading, Select, titleCase, useToast } from '../ui';

/** Pick free stalls for a request. Shows only AVAILABLE stalls, opens on the
 *  vendor's preferred zone, and caps the pick at what the request asked for
 *  minus what it already holds. A 409 means someone took a stall between the
 *  list loading and the click — the list reloads and the toast says so.
 *
 *  🔴 The bay is the other half of this dialog, and on most selections it is
 *  the ONLY half: "the side will be decided, but the stall number may not be
 *  still put at the time of the payment". The bay is what the rent is read
 *  from, so a vendor moved from the bay they asked for has to be recorded as
 *  agreed to the new one before the payment letter goes out — months before
 *  any number exists. Confirm is therefore enabled by either choice. */
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
  const { data: zones } = useLoad(() => listZones(), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [agreedZone, setAgreedZone] = useState<string>(
    r.agreedZoneCode ?? r.preferredZoneCode ?? '',
  );
  const [busy, setBusy] = useState(false);

  const bays = zones ?? [];
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
      const out = await select(r.id, picked, agreedZone || undefined);
      toast.ok(
        out.allocated.length > 0
          ? `Allocated ${out.allocated.join(', ')}`
          : `Selected for ${agreedZone} — stall number to follow`,
      );
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
          <Btn
            kind='primary'
            disabled={busy || (picked.length === 0 && !agreedZone)}
            onClick={confirm}
          >
            <Icon name='check' size={14} />
            {busy ? 'Selecting…' : picked.length > 0 ? `Allocate ${picked.length}` : 'Select'}
          </Btn>
        </>
      }
    >
      <div
        style={{
          display: 'grid',
          gap: 4,
          padding: '10px 12px',
          marginBottom: 14,
          border: '1px solid var(--line)',
          borderRadius: 8,
        }}
      >
        <label htmlFor='agreed-bay' style={{ fontSize: 11, fontWeight: 700, color: 'var(--mfg)' }}>
          Bay Agreed with the Requester
        </label>
        <Select
          id='agreed-bay'
          value={agreedZone}
          onChange={(e) => setAgreedZone(e.target.value)}
          style={{ width: 'auto', minWidth: 220 }}
        >
          <option value=''>Not Agreed Yet</option>
          {bays.map((z) => (
            <option key={z.code} value={z.code}>
              {z.code} — {z.name}
            </option>
          ))}
        </Select>
        <span style={{ fontSize: 11, color: 'var(--mfg)' }}>
          This is what the stall is priced at. They asked for {r.preferredZoneCode}.
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Select
          aria-label='Zone'
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          style={{ width: 'auto', minWidth: 150 }}
        >
          <option value=''>All Zones</option>
          {bays.map((z) => (
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
        <Empty>
          No available stalls{zone ? ` in ${zone}` : ''}. You can still select on the agreed bay
          alone and give the number later.
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
    </Dialog>
  );
}
