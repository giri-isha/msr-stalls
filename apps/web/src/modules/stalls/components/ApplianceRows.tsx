import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

export interface ApplianceRow {
  name: string;
  watts: string;
}

/** The 2025 form had four fixed "Appliance N + wattage" pairs. The 2025 data
 *  shows stalls listing more, so this is a growable list — the API stores child
 *  rows and Phase 3's load sheet sums them. */
export function ApplianceRows({
  id,
  value,
  onChange,
  max = 20,
}: {
  id: string;
  value: ApplianceRow[];
  onChange: (rows: ApplianceRow[]) => void;
  max?: number;
}) {
  const update = (i: number, patch: Partial<ApplianceRow>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => onChange([...value, { name: '', watts: '' }]);

  return (
    <div className='space-y-2' id={id}>
      {value.length > 0 && (
        <div className='grid grid-cols-[1fr_8rem_2.5rem] gap-2 text-xs text-ink-2'>
          <span>Appliance name</span>
          <span>Wattage</span>
          <span />
        </div>
      )}
      {value.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
        <div key={i} className='grid grid-cols-[1fr_8rem_2.5rem] gap-2'>
          <Input
            aria-label={`Appliance ${i + 1} name`}
            placeholder='e.g. Deep freezer'
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <Input
            aria-label={`Appliance ${i + 1} wattage`}
            type='number'
            min={0}
            placeholder='W'
            value={row.watts}
            onChange={(e) => update(i, { watts: e.target.value })}
          />
          <Button
            variant='ghost'
            size='icon'
            aria-label={`Remove appliance ${i + 1}`}
            onClick={() => remove(i)}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      ))}
      <Button variant='outline' size='sm' onClick={add} disabled={value.length >= max}>
        <Plus className='h-3.5 w-3.5' /> Add appliance
      </Button>
    </div>
  );
}
