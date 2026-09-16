import type { FieldOption, PublicZone } from '@stalls/core';
import { formatInr } from '@stalls/core';
import { ChoicePlate, Radio } from '../ui';

/** The preferred-location radio list, quoting each bay at the asking form's
 *  own scope.
 *
 *  The rent AND the refundable advance are both per bay, so both belong here
 *  rather than once in the form header: "keep the advance also area wise — it
 *  might be 3000, and for the free area it might be only 2000". A single figure
 *  at the top of the form would have been the wrong figure for most of the
 *  bays under it.
 *
 *  A bay the asking scope does not price reads as unavailable rather than free.
 *  The ashram forms pass `showRent` false — those stalls are billed internally
 *  and never quoted at all. */
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
    // 🔴 A RESPONSIVE grid, not a single stack. Each plate is a bay name and a
    // rent — two short lines — and on the wide public form a stack of them drew
    // seven 1000px-long plates holding a sentence each, which is the one
    // question on the form a requester has to compare options to answer. Two
    // columns put the bays and their rents beside each other; a phone gets one,
    // because `minmax(320px,1fr)` cannot fit two.
    //
    // ⚠️ The DOM order is the order of the options, so arrow-key navigation
    // inside the radiogroup still follows the list the edition set.
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))',
        gap: 8,
      }}
      role='radiogroup'
      aria-invalid={invalid || undefined}
    >
      {options.map((o) => {
        const z = byCode.get(o.value);
        const rent = z ? (isFood ? z.rentFoodPaise : z.rentNonFoodPaise) : null;
        // ⚠️ `rent === null` is the test, not `isClosedToVendors`. A bay closed
        // to trade is priced for local welfare, and reading the flag instead
        // would hide from a village trader exactly the bays they may have.
        const unavailable = showRent && z !== undefined && rent === null;
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
                    ? 'Not available this year'
                    : rent !== null
                      ? `${formatInr(rent)} + GST${
                          z?.depositPaise
                            ? ` · ${formatInr(z.depositPaise)} refundable advance`
                            : ''
                        }`
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
