import { Btn } from '../ui/ui';
import { IconBtn } from '../ui/components/IconBtn';
import { NumberInput, TextInput } from './FormControls';

export interface ApplianceRow {
  name: string;
  watts: string;
}

/** The 2025 form had four fixed "Appliance N + wattage" pairs. The 2025 data
 *  shows stalls listing more, so this is a growable list — the API stores child
 *  rows and the electrical sheet sums them. */
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
    <div id={id} style={{ display: 'grid', gap: 8 }}>
      {value.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 7rem 28px',
            gap: 8,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '.5px',
            textTransform: 'uppercase',
            color: 'var(--mfg)',
          }}
        >
          <span>Appliance name</span>
          <span>Wattage</span>
          <span />
        </div>
      )}
      {value.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 7rem 28px', gap: 8, alignItems: 'center' }}>
          <TextInput
            aria-label={`Appliance ${i + 1} name`}
            placeholder='e.g. Deep freezer'
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <NumberInput
            aria-label={`Appliance ${i + 1} wattage`}
            placeholder='W'
            value={row.watts}
            onChange={(e) => update(i, { watts: e.target.value })}
          />
          <IconBtn label={`Remove appliance ${i + 1}`} glyph='trash' tone='var(--des)' onClick={() => remove(i)} />
        </div>
      ))}
      <div>
        <Btn onClick={add} disabled={value.length >= max}>
          + Add appliance
        </Btn>
      </div>
    </div>
  );
}
