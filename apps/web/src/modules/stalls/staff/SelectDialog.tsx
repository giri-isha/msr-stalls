import type { AvailableStall, RequestDetail } from '@msr/stalls';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Dialog } from '../../../components/ui/dialog';
import { Select } from '../../../components/ui/input';
import { ApiError } from '../../../lib/api-client';
import { cn } from '../../../lib/cn';
import { availableStalls, select } from '../api';
import { useLoad } from '../hooks';

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
      toast.success(`Allocated ${out.allocated.join(', ')}`);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(`${e.message}. The list has been refreshed.`);
        setPicked([]);
        reload();
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Select ${r.stallName}`}
      description={
        remaining === 0
          ? 'This request already holds every stall it asked for. Release one to change it.'
          : `Pick up to ${remaining} stall${remaining > 1 ? 's' : ''} — the request asked for ${r.numStallsRequested}, preferred ${r.preferredZoneCode}.`
      }
      className='max-w-2xl'
      footer={
        <>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || picked.length === 0} onClick={confirm}>
            {busy ? 'Allocating…' : `Allocate ${picked.length || ''}`.trim()}
          </Button>
        </>
      }
    >
      <div className='mb-3 flex items-center gap-2'>
        <Select
          aria-label='Zone'
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          className='w-40'
        >
          <option value=''>All zones</option>
          {['A3', 'A4', 'B2', 'B3', 'B4', 'C1', 'C2'].map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
        <span className='text-xs text-ink-2'>
          {loading ? 'Loading…' : `${stalls.length} available`}
        </span>
      </div>
      <div className='max-h-80 space-y-3 overflow-y-auto'>
        {[...byZone.entries()].map(([z, list]) => (
          <div key={z}>
            <div className='mb-1 text-xs font-semibold text-ink-2'>Zone {z}</div>
            <div className='flex flex-wrap gap-1.5'>
              {list.map((s) => {
                const on = picked.includes(s.number);
                return (
                  <button
                    type='button'
                    key={s.id}
                    onClick={() => toggle(s.number)}
                    aria-pressed={on}
                    disabled={!on && picked.length >= remaining}
                    title={s.category.replace(/_/g, ' ').toLowerCase()}
                    className={cn(
                      'rounded-md border px-2 py-1 font-mono text-xs',
                      on
                        ? 'border-accent bg-accent text-white'
                        : 'border-line bg-surface hover:border-accent',
                      'disabled:opacity-40',
                    )}
                  >
                    {s.number}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!loading && stalls.length === 0 && (
          <p className='py-6 text-center text-sm text-ink-2'>
            No available stalls{zone ? ` in ${zone}` : ''}. Apply a plan under Planning &amp; Zones.
          </p>
        )}
      </div>
    </Dialog>
  );
}
