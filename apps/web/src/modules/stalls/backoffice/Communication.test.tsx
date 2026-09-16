import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_TEMPLATES, TEMPLATE_PLACEHOLDERS } from '@stalls/core';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { choose, installFetch, ME_ADMIN, recipient, renderAt } from '../test-utils';
import { Communication } from './Communication';

const routes = [{ path: '/m/stalls/communication', element: <Communication /> }];
const render = () => renderAt('/m/stalls/communication', routes, { me: true });

const TEMPLATES = {
  templates: DEFAULT_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    subject: t.subject,
    body: t.body,
    // The selection letter goes out on both channels and the two are not the
    // same text. A fixture that left this off is how the screen came to drop it.
    whatsappBody: t.whatsappBody,
    appliesTo: [...t.appliesTo],
    updatedAt: null,
    attachment: null,
  })),
  placeholders: TEMPLATE_PLACEHOLDERS,
};

let recipients: ReturnType<typeof recipient>[];
let sendResult: { sent: string[]; skipped: Array<{ requestId: string; reason: string }> };

function stub() {
  return installFetch([
    ['GET', /\/me$/, () => ME_ADMIN],
    ['GET', /\/comms\/recipients$/, () => recipients],
    ['GET', /\/comms\/templates$/, () => TEMPLATES],
    ['GET', /\/comms\/reminders/, () => []],
    ['POST', /\/comms\/send$/, () => sendResult],
    ['PUT', /\/comms\/templates\//, () => [204, null]],
  ]);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  recipients = [recipient()];
  sendResult = { sent: [recipient().id], skipped: [] };
});

describe('sending the selection letter', () => {
  test('ticking a vendor and sending posts exactly that one', async () => {
    const fetch = stub();
    render();
    const user = userEvent.setup();

    await screen.findByText('Green Leaf Organics');
    await user.click(await screen.findByLabelText('Select Green Leaf Organics'));
    await user.click(screen.getByRole('button', { name: 'Send 1 selected' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toEqual({
        templateKey: 'SELECTION_VENDOR',
        requestIds: [recipient().id],
      });
    });
  });

  test('a vendor who already has the letter cannot be ticked again', async () => {
    recipients = [
      recipient({
        sentAt: '2026-01-05T10:00:00.000Z',
        sentTemplates: [{ key: 'SELECTION_VENDOR', sentAt: '2026-01-05T10:00:00.000Z' }],
      }),
    ];
    stub();
    render();

    expect(await screen.findByLabelText('Select Green Leaf Organics')).toBeDisabled();
    expect(screen.getByText(/^Sent /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow Re-Send' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  test('"select all" skips the rows that have already had it', async () => {
    recipients = [
      recipient(),
      recipient({
        id: 'other-id',
        stallName: 'Coastal Spice',
        sentTemplates: [{ key: 'SELECTION_VENDOR', sentAt: '2026-01-05T10:00:00.000Z' }],
      }),
    ];
    const fetch = stub();
    render();
    const user = userEvent.setup();

    await screen.findByText('Coastal Spice');
    await user.click(screen.getByRole('button', { name: /Select All \(1\)/ }));
    await user.click(screen.getByRole('button', { name: 'Send 1 selected' }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST');
      expect(post?.body).toMatchObject({ requestIds: [recipient().id] });
    });
  });

  test('a skipped row is reported rather than silently dropped', async () => {
    sendResult = {
      sent: [],
      skipped: [{ requestId: recipient().id, reason: 'this letter is not for a ashram request' }],
    };
    stub();
    render();
    const user = userEvent.setup();

    await screen.findByText('Green Leaf Organics');
    await user.click(await screen.findByLabelText('Select Green Leaf Organics'));
    await user.click(screen.getByRole('button', { name: 'Send 1 selected' }));

    expect(
      await screen.findByText(/not for a ashram request/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  test('switching the letter clears what was ticked', async () => {
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByLabelText('Select Green Leaf Organics'));
    expect(screen.getByRole('button', { name: 'Send 1 selected' })).toBeEnabled();

    await choose(user, screen.getByLabelText('Letter'), 'PAYMENT_DETAILS');
    expect(screen.getByRole('button', { name: 'Send selected' })).toBeDisabled();
  });
});

describe('the template editor', () => {
  test('saves the edited wording', async () => {
    const fetch = stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Templates' }));
    const subject = await screen.findByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Confirmed');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => {
      const put = fetch.calls.find((c) => c.method === 'PUT');
      expect(put?.url).toContain('/comms/templates/SELECTION_VENDOR');
      expect(put?.body).toMatchObject({ subject: 'Confirmed' });
    });
  });

  test('an edit to the email keeps the WhatsApp wording', async () => {
    // ⚠️ The contract defaults `whatsappBody` to the empty string, and empty
    // means "email only" to the send path — so a save that omitted it switched
    // the WhatsApp message off every time somebody fixed a typo in the email.
    const fetch = stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Templates' }));
    const subject = await screen.findByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Confirmed');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => {
      const put = fetch.calls.find((c) => c.method === 'PUT');
      expect(put?.body).toMatchObject({ whatsappBody: TEMPLATES.templates[0].whatsappBody });
    });
  });

  test('the WhatsApp wording is edited beside the email, not instead of it', async () => {
    const fetch = stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Templates' }));
    const wa = await screen.findByLabelText('WhatsApp message');
    await user.clear(wa);
    await user.type(wa, 'You have been selected. Details by email.');
    await user.click(screen.getByRole('button', { name: 'Save Template' }));

    await waitFor(() => {
      const put = fetch.calls.find((c) => c.method === 'PUT');
      expect(put?.body).toMatchObject({
        whatsappBody: 'You have been selected. Details by email.',
        subject: TEMPLATES.templates[0].subject,
      });
    });
  });

  test('warns about a placeholder the module cannot fill', async () => {
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Templates' }));
    const body = await screen.findByLabelText('Body');
    // `fireEvent`, not `user.type`: userEvent reads `{{` as an escape for a
    // literal brace, and a placeholder is the one thing this field is for.
    fireEvent.change(body, { target: { value: 'Hello {{requestorName}}' } });

    expect(await screen.findByText(/Unknown placeholder/)).toHaveTextContent('requestorName');
  });

  test('Save is disabled until something is actually changed', async () => {
    stub();
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Templates' }));
    expect(await screen.findByRole('button', { name: 'Save Template' })).toBeDisabled();
  });
});

describe('reminder calls', () => {
  test('logs a call against the vendor', async () => {
    const fetch = installFetch([
      ['GET', /\/me$/, () => ME_ADMIN],
      ['GET', /\/comms\/recipients$/, () => recipients],
      ['GET', /\/comms\/templates$/, () => TEMPLATES],
      [
        'GET',
        /\/comms\/reminders/,
        () => [
          {
            requestId: recipient().id,
            reference: 'VEN-2026-0001',
            stallName: 'Green Leaf Organics',
            requesterName: 'Priya Venkat',
            contactNumber: '9840012345',
            email: 'priya@greenleaf.example',
            kind: 'BANK',
            callCount: 1,
            lastCalledAt: '2026-01-06T10:00:00.000Z',
          },
        ],
      ],
      ['POST', /\/requests\/.+\/reminders$/, () => [204, null]],
    ]);
    render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('tab', { name: 'Reminder calls' }));
    await user.click(await screen.findByRole('button', { name: /Log Call/ }));

    await waitFor(() => {
      const post = fetch.calls.find((c) => c.method === 'POST' && c.url.includes('/reminders'));
      expect(post?.body).toEqual({ kind: 'BANK', note: undefined });
    });
  });
});
