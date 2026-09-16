import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { FormField } from './Form';
import { Select } from './Select';

/** A field as the forms build one: a real label over the control, options
 *  written as `<option>` children — half of them from a `.map()`, which is the
 *  shape the walk in `Select` has to see through. */
function Bays({ onPick }: { onPick?: (v: string) => void }) {
  const [value, setValue] = useState('C1');
  return (
    <FormField id='bay' label='Bay Agreed'>
      <Select
        id='bay'
        value={value}
        onChange={(v) => {
          setValue(v);
          onPick?.(v);
        }}
      >
        <option value=''>Not Agreed Yet</option>
        {[
          ['A4', 'A4 — Snake side'],
          ['C1', 'C1 — Moon side'],
        ].map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

describe('the module’s own dropdown', () => {
  test('is named by its label and shows what is chosen', () => {
    render(<Bays />);
    expect(screen.getByLabelText('Bay Agreed')).toHaveTextContent('C1 — Moon side');
  });

  test('offers every option, including the ones a map produced', async () => {
    render(<Bays />);
    await userEvent.setup().click(screen.getByLabelText('Bay Agreed'));

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Not Agreed Yet',
      'A4 — Snake side',
      'C1 — Moon side',
    ]);
  });

  test('reports the value of the row pressed, and closes', async () => {
    let picked: string | undefined;
    render(<Bays onPick={(v) => (picked = v)} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Bay Agreed'));
    await user.click(screen.getByRole('option', { name: 'A4 — Snake side' }));

    expect(picked).toBe('A4');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bay Agreed')).toHaveTextContent('A4 — Snake side');
  });

  /** ⚠️ The empty value is a real choice here — "not agreed yet" — and an
   *  `onChange` that treated it as "nothing was picked" would make the one
   *  option that clears the field the one option that does nothing. */
  test('a blank option still reports its value', async () => {
    let picked: string | undefined = 'untouched';
    render(<Bays onPick={(v) => (picked = v)} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Bay Agreed'));
    await user.click(screen.getByRole('option', { name: 'Not Agreed Yet' }));

    expect(picked).toBe('');
  });

  test('opens on the keyboard, walks with the arrows and picks with Enter', async () => {
    let picked: string | undefined;
    render(<Bays onPick={(v) => (picked = v)} />);
    const user = userEvent.setup();

    screen.getByLabelText('Bay Agreed').focus();
    // Opens on the CURRENT value, so one step up is the option above it.
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');

    expect(picked).toBe('A4');
  });

  /** A native select jumps to what you type, and a drawn one that did not
   *  would be slower than the control it replaced on every long list. */
  test('typing a letter jumps to the option that starts with it', async () => {
    let picked: string | undefined;
    render(<Bays onPick={(v) => (picked = v)} />);
    const user = userEvent.setup();

    screen.getByLabelText('Bay Agreed').focus();
    await user.keyboard('n{Enter}');

    expect(picked).toBe('');
  });

  test('Escape closes the list and leaves the value alone', async () => {
    let picked: string | undefined;
    render(<Bays onPick={(v) => (picked = v)} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Bay Agreed'));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(picked).toBeUndefined();
  });

  test('a disabled dropdown does not open', async () => {
    render(
      <Select id='frozen' aria-label='Form' value='VENDOR' disabled onChange={() => {}}>
        <option value='VENDOR'>Vendor</option>
      </Select>,
    );
    await userEvent.setup().click(screen.getByLabelText('Form'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
