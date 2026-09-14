import { screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { installFetch, renderAt } from '../test-utils';
import { StatusPage } from './StatusPage';

afterEach(() => vi.unstubAllGlobals());

const routes = [{ path: '/stalls/status/:token', element: <StatusPage /> }];

describe('StatusPage', () => {
  test("shows the vendor's requests, and the stall number only once selected", async () => {
    installFetch([
      [
        'GET',
        /\/public\/status\//,
        () => ({
          displayName: 'Priya Venkat',
          requests: [
            {
              reference: 'VEN-2026-0002',
              requestType: 'VENDOR',
              stallName: 'Second Stall',
              status: 'SHORTLISTED',
              stage: 'NEW',
              submittedAt: '2026-09-02T10:00:00.000Z',
              allocatedStalls: [],
              steps: [],
              bankFormUrl: null,
              fssaiUploadUrl: null,
              staffUrl: null,
              paymentDuePaise: null,
              paymentDue: null,
            },
            {
              reference: 'VEN-2026-0001',
              requestType: 'VENDOR',
              stallName: 'Green Leaf Organics',
              status: 'SELECTED',
              stage: 'BANK_FORM_SENT',
              submittedAt: '2026-09-01T10:00:00.000Z',
              allocatedStalls: ['A4-5'],
              steps: [
                { stage: 'BANK_FORM_SENT', label: 'Bank Form Sent', state: 'current' },
                { stage: 'PAYMENT_SENT', label: 'Payment Sent', state: 'todo' },
              ],
              bankFormUrl: 'http://web.example/stalls/bank/tok',
              fssaiUploadUrl: null,
              staffUrl: null,
              paymentDuePaise: null,
              paymentDue: null,
            },
          ],
        }),
      ],
    ]);
    renderAt(`/stalls/status/${'t'.repeat(43)}`, routes);
    expect(await screen.findByText('Priya Venkat')).toBeInTheDocument();
    expect(screen.getByText('Green Leaf Organics')).toBeInTheDocument();
    expect(screen.getByText('Second Stall')).toBeInTheDocument();
    expect(screen.getByText('A4-5')).toBeInTheDocument();
    expect(screen.getByText('Selected')).toBeInTheDocument();
    expect(screen.getByText('Shortlisted')).toBeInTheDocument();
  });

  test('a 404 renders a plain "not valid" page with no detail', async () => {
    installFetch([['GET', /\/public\/status\//, () => [404, { error: 'this link is not valid' }]]]);
    renderAt('/stalls/status/wrong-token-wrong-token', routes);
    expect(await screen.findByText('This link is not valid')).toBeInTheDocument();
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument();
  });

  test('sends the token from the URL, encoded', async () => {
    const fx = installFetch([
      ['GET', /\/public\/status\//, () => ({ displayName: 'x', requests: [] })],
    ]);
    renderAt('/stalls/status/abc-DEF_123', routes);
    await screen.findByText('x');
    expect(fx.last().url).toBe('/api/m/stalls/public/status/abc-DEF_123');
  });
});
