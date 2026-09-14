import type { FieldOption, PublicZone } from '@msr/stalls';
import { formatInr } from '@msr/stalls';
import { RadioList } from './FormControls';

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
    <RadioList
      name={name}
      value={value}
      onChange={onChange}
      invalid={invalid}
      options={options.map((o) => {
        const z = byCode.get(o.value);
        const rent = z ? (isFood ? z.rentFoodPaise : z.rentNonFoodPaise) : null;
        const unavailable = showRent && z !== undefined && (z.isClosedToVendors || rent === null);
        return {
          value: o.value,
          label: o.label,
          labelTa: o.labelTa,
          disabled: unavailable,
          hint: showRent
            ? unavailable
              ? 'Not available to vendors this year'
              : rent !== null
                ? `${formatInr(rent)} + GST`
                : undefined
            : undefined,
        };
      })}
    />
  );
}
