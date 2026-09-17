import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installFetch, ME_ADMIN, renderAt } from '../test-utils';
import { CallFormBuilder } from './CallFormBuilder';

beforeEach(() => vi.unstubAllGlobals());

const routes = [{ path: '/m/stalls/admin', element: <CallFormBuilder writable={true} /> }];
const render = () => renderAt('/m/stalls/admin', routes, { me: true });

/** One question on the wire, with whatever a test wants to vary. */
const question = (over: Record<string, unknown> = {}) => ({
  id: 'q-picked',
  ordinal: 1,
  label: 'Did they pick up?',
  help: null,
  fieldType: 'select',
  isRequired: true,
  isActive: true,
  options: [
    { value: 'YES', label: 'Yes', labelTa: null },
    { value: 'NO', label: 'No', labelTa: null },
  ],
  min: null,
  max: null,
  minLen: null,
  maxLen: null,
  decimals: null,
  pattern: null,
  patternHint: null,
  window: null,
  showIfQuestionId: null,
  showIfValue: null,
  showOnOutcomes: [],
  answerCount: 0,
  ...over,
});

const forms = (bank: ReturnType<typeof question>[] = []) => ({
  forms: [
    { kind: 'BANK', script: 'Namaskaram…', scriptUpdatedAt: null, questions: bank },
    { kind: 'PAYMENT', script: '', scriptUpdatedAt: null, questions: [] },
  ],
});

const base = (
  body: ReturnType<typeof forms>,
  extra: ReadonlyArray<readonly [string, RegExp, () => unknown]> = [],
) =>
  installFetch([
    ['GET', /\/me$/, () => ME_ADMIN],
    ['GET', /\/config\/call-forms/, () => body],
    ...extra,
  ]);

describe('the call log form builder', () => {
  test('a question is added to the kind being looked at', async () => {
    const fetch = base(forms(), [
      ['POST', /\/config\/call-forms\/PAYMENT\/questions$/, () => ({ id: 'q-new' })],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Pending Payment' }));
    await user.click(screen.getByRole('button', { name: /Add question/ }));
    await user.type(screen.getByLabelText('Question'), 'Did they make the transfer?');
    // ⚠️ Scoped to the dialog: the panel's own "Add question" is still on the
    // page behind it, and the two would otherwise be one ambiguous match.
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Add question/ }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.url).toContain('/call-forms/PAYMENT/questions');
      expect(post?.body).toMatchObject({
        label: 'Did they make the transfer?',
        fieldType: 'text',
        isRequired: false,
        // Empty is the DEFAULT set, not "never" — the API reads it that way.
        showOnOutcomes: [],
        showIfQuestionId: null,
      });
    });
  });

  /** 🔴 The same rule the API refuses the write with, run before the round
   *  trip — a branch the dialog lets through is one the server accepts. */
  test('the branch picker offers only the earlier choice questions’ own options', async () => {
    base(
      forms([
        question(),
        question({ id: 'q-free', ordinal: 2, fieldType: 'text', label: 'Anything else?' }),
      ]),
    );
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Edit Did they pick up?'));
    // Nothing is earlier than the first question, so it can only be "always".
    const picker = screen.getByLabelText('Ask Only If');
    expect(picker).toHaveTextContent('Always');
    expect(screen.getByText(/Nothing to hang this on yet/)).toBeInTheDocument();
  });

  /** 🔴 A call answer exists nowhere else, so an answered question is switched
   *  off rather than removed — and the builder must offer the control that
   *  actually works. */
  test('an answered question offers switch-off instead of delete', async () => {
    const fetch = base(forms([question({ answerCount: 3 })]), [
      ['PATCH', /\/config\/call-questions\/q-picked$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    expect(await screen.findByText(/Answered on 3 calls/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove Did they pick up?')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Stop asking Did they pick up?'));
    await waitFor(() => {
      const patch = fetch.calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toEqual({ isActive: false });
    });
  });

  test('an unanswered question can be removed outright', async () => {
    const fetch = base(forms([question()]), [
      ['DELETE', /\/config\/call-questions\/q-picked$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Remove Did they pick up?'));
    await waitFor(() => {
      expect(fetch.calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });

  test('the script is held until Save, and saved against its own kind', async () => {
    const fetch = base(forms(), [
      ['PUT', /\/config\/call-forms\/BANK\/script$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    // 🔴 Nothing is written while it is being typed: a script is read ALOUD,
    // and a half-typed sentence reaching a caller mid-shift is the one failure
    // this screen can cause on the phone.
    const box = await screen.findByLabelText('What to say');
    expect(screen.getByRole('button', { name: /Save script/ })).toBeDisabled();
    await user.type(box, ' about your bank details.');
    expect(fetch.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /Save script/ }));
    await waitFor(() => {
      const put = fetch.calls.find((c) => c.method === 'PUT');
      expect(put?.body).toEqual({ script: 'Namaskaram… about your bank details.' });
    });
  });

  test('moving a question sends the position it lands on, one step at a time', async () => {
    const fetch = base(
      forms([question(), question({ id: 'q-two', ordinal: 2, label: 'Second' })]),
      [['PATCH', /\/config\/call-questions\/q-two$/, () => [204, null]]],
    );
    render();
    const user = userEvent.setup();

    // The first has no Up and the last has no Down — there is nowhere to go.
    expect(await screen.findByLabelText('Move Did they pick up? up')).toBeDisabled();
    expect(screen.getByLabelText('Move Second down')).toBeDisabled();

    await user.click(screen.getByLabelText('Move Second up'));
    await waitFor(() => {
      const patch = fetch.calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toEqual({ ordinal: 1 });
    });
  });
});
