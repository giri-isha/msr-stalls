import type { FieldOption, PublicZone } from '@stalls/core';
import { Select } from '../ui';

/**
 * The preferred-location question: a dropdown of the bays this form may offer.
 *
 * 🔴 It was a grid of radio plates, each quoting its own rent and refundable
 * advance. Seven plates is a third of the form's height for one question, and
 * the figures on them were the form answering a question nobody had asked yet —
 * a rent is what you are told once a bay is agreed, and the bay a requester
 * ASKED for is not the bay they will be priced at (see `agreedZoneCode`). The
 * quote, the payment letter and the vendor's own payment page are where money
 * is said. This is a list of places.
 *
 * 🔴 A bay this form cannot offer is not drawn at all, where it used to sit
 * there greyed out saying "Not available this year". A choice that cannot be
 * chosen is not a choice, and in a dropdown it is worse than on a plate: the
 * list is read one row at a time, so a dead row is a row somebody arrows onto
 * and has to work out.
 *
 * ⚠️ `showRent` is now the FILTER rather than a figure — whether this asking
 * scope is priced for the bay at all. The ashram forms pass it false and are
 * offered everything: those stalls are billed internally and never quoted, so
 * "no rate for this scope" says nothing about whether the bay is available.
 *
 * ⚠️ `rent === null` is the test, not `isClosedToVendors`. A bay closed to
 * trade is priced for local welfare, and reading the flag instead would hide
 * from a village trader exactly the bays they may have.
 */
export function ZoneSelect({
  id,
  value,
  onChange,
  options,
  zones,
  showRent,
  isFood,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: FieldOption[];
  zones: PublicZone[] | null;
  /** Whether this form's scope is quoted a rent — which is what decides
   *  availability. Named for what it used to draw; see the note above. */
  showRent: boolean;
  isFood: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const byCode = new Map((zones ?? []).map((z) => [z.code, z]));
  const offered = options.filter((o) => {
    if (!showRent) return true;
    const z = byCode.get(o.value);
    // ⚠️ A choice naming no bay at all is still offered. The edition may author
    // this list itself — see `zoneChoices` — and a choice the rate card has
    // never heard of is the admin's to explain, not this control's to swallow.
    if (z === undefined) return true;
    return (isFood ? z.rentFoodPaise : z.rentNonFoodPaise) !== null;
  });

  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      invalid={invalid}
      aria-invalid={invalid}
      aria-describedby={describedBy}
    >
      <option value=''>Choose…</option>
      {offered.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
          {o.labelTa ? ` / ${o.labelTa}` : ''}
        </option>
      ))}
    </Select>
  );
}
