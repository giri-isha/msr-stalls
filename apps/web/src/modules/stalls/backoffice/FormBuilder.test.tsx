import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installFetch, ME_ADMIN, renderAt } from '../test-utils';
import { FormBuilder } from './FormBuilder';

/**
 * 🔴 The preferred-location question's choice list, which the edition may now
 * write for itself.
 *
 * It was the edition's bays and nothing else, resolved at render time, and that
 * held until the year the wording had to differ — a bay named for where it sits
 * rather than for its letter, a bay left off one form for a reason no flag on
 * the zone expresses. What is NOT the edition's is the rent: each choice's
 * value is still a bay code the quote looks up, so a value naming no bay is a
 * choice that prices nothing, and the one thing this screen owes an admin is to
 * say so before they find out at the payment letter.
 */

beforeEach(() => vi.unstubAllGlobals());

const ZONES = [
  { code: 'A4', name: 'Snake side' },
  { code: 'C1', name: 'Moon side' },
];

const render = () =>
  renderAt(
    '/m/stalls/admin',
    [
      {
        path: '/m/stalls/admin',
        element: <FormBuilder writable={true} zones={ZONES} />,
      },
    ],
    { me: true },
  );

/** The preferred-location field as the builder reads it off the wire. */
const zoneField = (options: unknown = null) => ({
  id: 'f-zone',
  name: 'preferredZoneCode',
  label: 'Preferred Location',
  labelTa: null,
  help: null,
  helpTa: null,
  type: 'zone',
  required: true,
  isBuiltIn: true,
  isActive: true,
  sectionId: null,
  sortOrder: 1,
  options,
  mediaKey: null,
  min: null,
  max: null,
  minLen: null,
  maxLen: null,
  decimals: null,
  pattern: null,
  patternHint: null,
  window: null,
});

const forms = (options: unknown = null) => ({
  forms: [
    {
      definitionId: 'd-vendor',
      formType: 'VENDOR',
      title: 'Vendor Stall Request Form',
      titleTa: null,
      sections: [],
      fields: [zoneField(options)],
    },
  ],
});

const base = (
  body: ReturnType<typeof forms>,
  extra: ReadonlyArray<readonly [string, RegExp, () => unknown]> = [],
) =>
  installFetch([
    ['GET', /\/me$/, () => ME_ADMIN],
    ['GET', /\/config\/forms/, () => body],
    ...extra,
  ]);

const openTheQuestion = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Preferred Location' }));
};

describe('the preferred-location choice list', () => {
  /** ⚠️ Left empty it is the bays, which is what every form does today — so the
   *  box a coordinator opens onto is empty, not pre-filled with a copy of them.
   *  Pre-filling would turn "use the bays" into "a snapshot of the bays taken
   *  the day somebody opened this dialog". */
  test('opens empty on a question that has authored none', async () => {
    base(forms());
    render();
    await openTheQuestion();

    expect(await screen.findByLabelText('Choices')).toHaveValue('');
    expect(screen.getByText(/Leave this empty to offer the edition/)).toBeInTheDocument();
  });

  test('reads an authored list back as CODE | Wording, one per line', async () => {
    base(
      forms([
        { value: 'A4', label: 'Category A4 - Snake side', labelTa: null },
        { value: 'C1', label: 'Category C1 - Moon side', labelTa: null },
      ]),
    );
    render();
    await openTheQuestion();

    expect(await screen.findByLabelText('Choices')).toHaveValue(
      'A4 | Category A4 - Snake side\nC1 | Category C1 - Moon side',
    );
  });

  test('saves what was typed, as choices keyed on the bay code', async () => {
    const fetch = base(forms(), [['PATCH', /\/config\/form-fields\/f-zone$/, () => ({})]]);
    render();
    await openTheQuestion();

    await userEvent.type(
      await screen.findByLabelText('Choices'),
      'A4 | Snake side : For Paid Seating',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = fetch.calls.find((c) => c.url.includes('/form-fields/f-zone'));
      expect((patch?.body as { options: unknown } | undefined)?.options).toEqual([
        { value: 'A4', label: 'Snake side : For Paid Seating', labelTa: null },
      ]);
    });
  });

  /** 🔴 The warning is the whole of what this screen owes an admin. Rent and
   *  the refundable advance are looked up by BAY CODE, so a choice whose code
   *  is not a bay prices nothing — and the place that goes wrong is the payment
   *  letter, which is the one place nobody is looking. */
  test('names back any code that is not a bay in this edition', async () => {
    base(forms());
    render();
    await openTheQuestion();

    await userEvent.type(await screen.findByLabelText('Choices'), 'Z9 | Somewhere new');

    const warning = await screen.findByText(/no rent and no refundable advance/);
    expect(warning).toHaveTextContent('Z9');
    expect(warning).toHaveTextContent('is not a bay in this edition');
  });

  test('says nothing when every code is a bay', async () => {
    base(forms([{ value: 'A4', label: 'Snake side', labelTa: null }]));
    render();
    await openTheQuestion();

    await screen.findByLabelText('Choices');
    expect(screen.queryByText(/no rent and no refundable advance/)).not.toBeInTheDocument();
  });

  /** ⚠️ Emptying the box has to mean "back to the bays", not "offer nothing" —
   *  a question with no choices is a form nobody can submit. It travels as
   *  `null`, which is what `zoneChoices` reads as the fallback. */
  test('clearing it goes back to the bays rather than to an empty list', async () => {
    const fetch = base(forms([{ value: 'A4', label: 'Snake side', labelTa: null }]), [
      ['PATCH', /\/config\/form-fields\/f-zone$/, () => ({})],
    ]);
    render();
    await openTheQuestion();

    await userEvent.clear(await screen.findByLabelText('Choices'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const patch = fetch.calls.find((c) => c.url.includes('/form-fields/f-zone'));
      expect((patch?.body as { options: unknown } | undefined)?.options).toBeNull();
    });
  });
});
