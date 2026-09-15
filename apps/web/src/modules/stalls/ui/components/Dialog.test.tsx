import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { Dialog } from './Dialog';

/** A record that opens as a dialog, with an edit box that opens over it — the
 *  shape Onboarding's coupon capacity takes, and the one that used to lose both
 *  boxes to a single Escape. */
function Nested({ onOuterClose }: { onOuterClose: () => void }) {
  const [inner, setInner] = useState(false);
  return (
    <Dialog title='Record' onClose={onOuterClose}>
      <button type='button' onClick={() => setInner(true)}>
        Edit the number
      </button>
      {inner && (
        <Dialog title='The number' onClose={() => setInner(false)}>
          <input aria-label='Number' defaultValue='8' />
        </Dialog>
      )}
    </Dialog>
  );
}

describe('Dialog, stacked', () => {
  test('Escape closes the top box and leaves the one underneath', async () => {
    let outerClosed = false;
    render(<Nested onOuterClose={() => (outerClosed = true)} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit the number' }));
    expect(await screen.findByRole('dialog', { name: 'The number' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'The number' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Record' })).toBeInTheDocument();
    // 🔴 The bug this guards: `useEscape` binds to `document`, so before the
    // overlays kept a stack BOTH handlers fired and correcting a number and
    // changing your mind about it threw away the record behind it too.
    expect(outerClosed).toBe(false);
  });

  test('and once the top box is gone, Escape reaches the one underneath again', async () => {
    let outerClosed = false;
    render(<Nested onOuterClose={() => (outerClosed = true)} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit the number' }));
    await screen.findByRole('dialog', { name: 'The number' });
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');

    expect(outerClosed).toBe(true);
  });

  test('a lone dialog still closes on Escape', async () => {
    let closed = false;
    render(
      <Dialog title='Alone' onClose={() => (closed = true)}>
        <p>Nothing over me.</p>
      </Dialog>,
    );
    await userEvent.setup().keyboard('{Escape}');
    expect(closed).toBe(true);
  });
});
