import { Btn, Icon, IconBtn, Input, useIsMobile } from '../ui';

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
  const mobile = useIsMobile();
  const update = (i: number, patch: Partial<ApplianceRow>) =>
    onChange(value.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const add = () => onChange([...value, { name: '', watts: '' }]);

  // ⚠️ The wattage column collapses below the name on a phone rather than
  // sitting beside it. A 128px number field next to a name field inside 360px
  // of form leaves the name eight characters wide, and "Deep freezer" is not
  // eight characters.
  const grid = mobile ? '1fr 28px' : '1fr 8rem 28px';

  return (
    <div style={{ display: 'grid', gap: 8 }} id={id}>
      {value.length > 0 && !mobile && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: grid,
            gap: 8,
            fontSize: 11,
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
        <div key={i} style={{ display: 'grid', gridTemplateColumns: grid, gap: 8, rowGap: 6 }}>
          <Input
            aria-label={`Appliance ${i + 1} name`}
            placeholder='e.g. Deep freezer'
            value={row.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          {mobile && <span />}
          <Input
            aria-label={`Appliance ${i + 1} wattage`}
            type='number'
            min={0}
            placeholder='Watts'
            value={row.watts}
            onChange={(e) => update(i, { watts: e.target.value })}
          />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <IconBtn
              label={`Remove appliance ${i + 1}`}
              glyph='trash'
              tone='var(--des)'
              onClick={() => remove(i)}
            />
          </div>
        </div>
      ))}
      <div>
        <Btn onClick={add} disabled={value.length >= max}>
          <Icon name='plus' size={14} /> Add appliance
        </Btn>
      </div>
    </div>
  );
}
