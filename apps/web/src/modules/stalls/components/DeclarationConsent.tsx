import type { Declaration } from '@stalls/core';
import { Checkbox, ChoicePlate, FieldError } from '../ui';
import { DeclarationText } from './DeclarationText';

/**
 * The consents a form asks for, drawn immediately above its Submit button.
 *
 * 🔴 The wording used to sit at the TOP of the request form behind an ℹ️ icon,
 * and the tick consenting to it sat thirty questions below, labelled just
 * "I Agree". By the time the tick was in reach the words had been off screen
 * for minutes, and nothing on the page connected them. Consent and wording are
 * one thing and they belong together at the point of signature — which is what
 * every paper form already does.
 *
 * 🔴 ONE TICK PER DECLARATION, never one tick covering all of them.
 * `recordConsent` writes a row per declaration, so a single tick over three
 * would log three agreements from one gesture — a record claiming more than the
 * reader did. The bank form makes it concrete: its NEFT terms and its terms and
 * conditions are two different things, and a vendor may reasonably accept one
 * while wanting to read the other twice.
 *
 * ⚠️ Shared by all four public forms rather than inlined in `RequestForm`. The
 * bank, FSSAI and staff forms have no `renderForm` machinery to hang a field
 * off, and three copies of a consent block would be three places for these
 * rules to drift apart.
 */
export function DeclarationConsent({
  declarations,
  ticked,
  onToggle,
  error,
}: {
  declarations: readonly Declaration[];
  ticked: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
  error?: string | null;
}) {
  // ⚠️ A form with nothing to agree to draws NOTHING — not an empty plate,
  // which reads as something that failed to load. This is the FSSAI and staff
  // case until the team authors wording for them.
  if (declarations.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
      {declarations.map((d) => {
        const id = `declaration-${d.id}`;
        const on = ticked.has(d.id);
        return (
          <ChoicePlate key={d.id} htmlFor={id} selected={on}>
            <Checkbox
              id={id}
              checked={on}
              onChange={(e) => onToggle(d.id, e.target.checked)}
              aria-invalid={error ? true : undefined}
              style={{ marginTop: 1 }}
            />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.65 }}>
              {/* ⚠️ Nodes, never markup. This text is authored by somebody
                  pasting from a Word document, onto the page that records what
                  they agreed to — see `DeclarationText` for why the markers are
                  parsed rather than the text being sanitised. */}
              <DeclarationText body={d.body} />
              {d.bodyTa && (
                <span className='stalls-tamil' lang='ta' style={{ display: 'block', marginTop: 7 }}>
                  <DeclarationText body={d.bodyTa} />
                </span>
              )}
            </span>
          </ChoicePlate>
        );
      })}
      <FieldError of={error ?? undefined} />
    </div>
  );
}

/** Whether Submit may proceed.
 *
 *  ⚠️ Vacuously true when a form asks for none, which is what keeps the FSSAI
 *  and staff buttons behaving exactly as they do today. */
export function allTicked(
  declarations: readonly Declaration[],
  ticked: ReadonlySet<string>,
): boolean {
  return declarations.every((d) => ticked.has(d.id));
}
