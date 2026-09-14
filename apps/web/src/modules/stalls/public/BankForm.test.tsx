import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installFetch, renderAt } from '../test-utils';
import { BankForm } from './BankForm';

afterEach(() => vi.unstubAllGlobals());

const routes = [{ path: '/stalls/bank/:token', element: <BankForm /> }];
const TOKEN = 't'.repeat(43);

const view = {
  reference: 'VEN-2026-0001',
  stallName: 'Green Leaf Organics',
  requestType: 'VENDOR',
  stallNumbers: ['C1-1'],
  editionName: 'MSR 2026',
  termsUrl: 'https://example.org/terms',
  depositPaise: 400_000,
  submitted: null,
  prefill: {
    plugs5a: 2,
    plugs15a: 1,
    gasStoves: 0,
    tablesNeeded: 1,
    chairsNeeded: 2,
    passes2w: 0,
    passes4w: 0,
    passesStaff: 3,
    appliances: [{ name: 'Deep freezer', watts: 900 }],
    mobile: '9840012345',
    address: '12 Mettupalayam Road',
  },
};

describe('BankForm', () => {
  test('renders the 2025 form with its Tamil labels and prefills what the vendor already told us', async () => {
    installFetch([['GET', /\/public\/bank\//, () => view]]);
    renderAt(`/stalls/bank/${TOKEN}`, routes);
    expect(await screen.findByText('வங்கி கணக்கு வைத்திருப்பவரின் பெயர்')).toBeInTheDocument();
    expect(screen.getByText('ஜிஎஸ்டி எண்')).toBeInTheDocument();
    expect(screen.getByText(/Refundable deposit for this stall/)).toHaveTextContent('₹4,000');
    expect(screen.getByLabelText(/Mobile Number/)).toHaveValue('9840012345');
    expect(screen.getByLabelText(/Do you need Chairs/)).toHaveValue('2');
    expect(screen.getByLabelText('Appliance 1 name')).toHaveValue('Deep freezer');
  });

  test('a wrong token is a plain not-valid page', async () => {
    installFetch([['GET', /\/public\/bank\//, () => [404, { error: 'this link is not valid' }]]]);
    renderAt('/stalls/bank/wrong-token-wrong-token', routes);
    expect(await screen.findByText(/This link is not valid/)).toBeInTheDocument();
  });

  test('refuses to post an incomplete form and marks the fields', async () => {
    const fx = installFetch([['GET', /\/public\/bank\//, () => view]]);
    renderAt(`/stalls/bank/${TOKEN}`, routes);
    const user = userEvent.setup();
    await screen.findByText('ஜிஎஸ்டி எண்');
    await user.click(screen.getByRole('button', { name: /submit details/i }));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(3);
    expect(fx.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  test('posts a complete form, normalising IFSC and PAN, and shows the receipt', async () => {
    const fx = installFetch([
      ['GET', /\/public\/bank\//, () => view],
      ['POST', /\/public\/bank\//, () => ({ reference: 'VEN-2026-0001' })],
    ]);
    renderAt(`/stalls/bank/${TOKEN}`, routes);
    const user = userEvent.setup();
    await screen.findByText('ஜிஎஸ்டி எண்');
    await user.type(screen.getByLabelText(/Name as required on Invoice/), 'Green Leaf Organics LLP');
    await user.type(screen.getByLabelText(/Name of the Bank Account holder/), 'Green Leaf Organics LLP');
    await user.type(screen.getByLabelText(/^Pincode/), '641002');
    await user.type(screen.getByLabelText(/^Bank Name/), 'HDFC Bank');
    await user.type(screen.getByLabelText(/^Bank Branch/), 'RS Puram');
    await user.type(screen.getByLabelText(/^Account Number/), '50100123456789');
    await user.type(screen.getByLabelText(/^IFSC Code/), 'hdfc0001234');
    await user.type(screen.getByLabelText(/^PAN Card Number/), 'aaccc1234d');
    await user.type(screen.getByLabelText(/^GST Number/), 'NONE');
    await user.click(screen.getByLabelText(/Please return the caution deposit/));
    await user.click(screen.getByLabelText(/I agree\./));
    await user.click(screen.getByLabelText(/I have read and understood the T&C/));
    // No cheque attached: the upload is optional on the form (the store may be
    // unavailable) and the API treats the key as optional too.
    await user.click(screen.getByRole('button', { name: /submit details/i }));

    await waitFor(() => expect(fx.calls.some((c) => c.method === 'POST')).toBe(true), { timeout: 3000 });
    const post = fx.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
    expect(post).toMatchObject({ ifsc: 'HDFC0001234', panNumber: 'AACCC1234D', gstNumber: 'NONE', chairsNeeded: 2, plugs15a: 1 });
    expect(await screen.findByText('Details received')).toBeInTheDocument();
  });
});
