import type { FieldOption, PublicZone } from '@msr/stalls';
import { formatInr } from '@msr/stalls';
import { cn } from '../../../lib/cn';

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
    <div className='space-y-2' role='radiogroup' aria-invalid={invalid || undefined}>
      {options.map((o) => {
        const z = byCode.get(o.value);
        const rent = z ? (isFood ? z.rentFoodPaise : z.rentNonFoodPaise) : null;
        const unavailable = showRent && z !== undefined && (z.isClosedToVendors || rent === null);
        const id = `${name}-${o.value}`;
        return (
          <label
            key={o.value}
            htmlFor={id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm',
              value === o.value && 'border-accent bg-accent-soft/40',
              unavailable && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              id={id}
              type='radio'
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={unavailable}
              onChange={() => onChange(o.value)}
              className='mt-1 accent-accent'
            />
            <span className='flex-1'>
              <span className='font-medium'>{o.label}</span>
              {showRent && (
                <span className='block text-xs text-ink-2'>
                  {unavailable
                    ? 'Not available to vendors this year'
                    : rent !== null
                      ? `${formatInr(rent)} + GST`
                      : ''}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}
