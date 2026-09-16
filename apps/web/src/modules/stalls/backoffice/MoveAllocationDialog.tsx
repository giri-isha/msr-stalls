import { useState } from 'react';
import { ApiError } from '../api-client';
import { availableStalls, listZones, moveAllocation } from '../api';
import { useLoad } from '../hooks';
import { Btn, Dialog, Icon, titleCase, useToast } from '../ui';
import { StallPicker } from './StallPicker';

/** The one stall a request already holds, moved onto a different pitch.
 *
 *  🔴 Release-then-select was the only way to correct a number, and it is not
 *  the same act: it gives the stall back to the pool, where another
 *  coordinator can take it before the second half of the correction lands, and
 *  it leaves the request holding one stall fewer in between. This is one call.
 *
 *  The current stall is shown but not offered — the list is what is AVAILABLE,
 *  and a stall this request is standing on is not. */
export function MoveAllocationDialog({
  allocation,
  stallName,
  onClose,
  onDone,
}: {
  allocation: { id: string; stallNumber: string; zoneCode: string; category: string };
  stallName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [zone, setZone] = useState<string>(allocation.zoneCode);
  const { data, loading, reload } = useLoad(() => availableStalls(zone || undefined), [zone]);
  const { data: zones } = useLoad(() => listZones(), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const move = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await moveAllocation(allocation.id, picked);
      toast.ok(`${allocation.stallNumber} → ${picked}`);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.fail(new Error(`${e.message}. The list has been refreshed.`));
        setPicked(null);
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
      title={`Move ${allocation.stallNumber}`}
      note={`${stallName} stands on ${allocation.stallNumber} (${titleCase(allocation.category)}). Pick the stall it moves to — the old one goes back to the pool in the same step.`}
      onClose={onClose}
      width={640}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind='primary' disabled={busy || !picked} onClick={move}>
            <Icon name='arrow-left-right' size={14} />
            {busy ? 'Moving…' : picked ? `Move to ${picked}` : 'Move'}
          </Btn>
        </>
      }
    >
      <StallPicker
        stalls={data ?? []}
        zones={zones ?? []}
        zone={zone}
        onZone={setZone}
        loading={loading}
        picked={picked ? [picked] : []}
        // One stall moves to one stall: picking a second replaces the first
        // rather than being refused, which is what a single-choice grid has to
        // do or the reader has to un-pick before they can change their mind.
        onPick={(n) => setPicked((p) => (p === n ? null : n))}
        empty={
          <>
            No available stalls{zone ? ` in ${zone}` : ''}. Try another bay, or release this
            allocation if the stall is simply being given up.
          </>
        }
      />
    </Dialog>
  );
}
