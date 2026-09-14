import type { FieldOption, PublicZone } from '@msr/stalls';
import { formatInr } from '@msr/stalls';
import { ChoicePlate, Radio } from '../ui';

/** The preferred-location radio list. For vendors it quotes the rent per zone
 *  from the live rate card and marks closed zones unavailable; for local
 *  welfare and ashram forms it shows the seating description only. */
export function ZoneSelect({
  name,
  value,
  onChange,
  options,
  zones,
  showRent,
  isFood,
  invalid,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: FieldOption[];
  zones: PublicZone[] | null;
  showRent: boolean;
  isFood: boolean;
  invalid?: boolean;
}) {
  const byCode = new Map((zones ?? []).map((z) => [z.code, z]));
  return (
    <div style={{ display: 'grid', gap: 8 }} role='radiogroup' aria-invalid={invalid || undefined}>
      {options.map((o) => {
        const z = byCode.get(o.value);
        const rent = z ? (isFood ? z.rentFoodPaise : z.rentNonFoodPaise) : null;
        const unavailable = showRent && z !== undefined && (z.isClosedToVendors || rent === null);
        const id = `${name}-${o.value}`;
        return (
          <ChoicePlate
            key={o.value}
            htmlFor={id}
            selected={value === o.value}
            disabled={unavailable}
          >
            <Radio
              id={id}
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={unavailable}
              onChange={() => onChange(o.value)}
              style={{ marginTop: 2 }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{o.label}</span>
              {showRent && (
                <span
                  style={{
                    display: 'block',
                    fontSize: 11.5,
                    // ⚠️ `--mfg`, not `--des` — a zone the vendor cannot have is
                    // an absence, not an error they made. Red here would read as
                    // "you picked wrong" on a plate they are not allowed to pick.
                    color: 'var(--mfg)',
                    marginTop: 2,
                  }}
                >
                  {unavailable
                    ? 'Not available to vendors this year'
                    : rent !== null
                      ? `${formatInr(rent)} + GST`
                      : ''}
                </span>
              )}
            </span>
          </ChoicePlate>
        );
      })}
    </div>
  );
}
