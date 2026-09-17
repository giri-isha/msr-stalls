import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ME_LEAD, PUBLIC_CONFIG, installFetch, renderAt } from '../test-utils';
import { FileRequest } from './FileRequest';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = [
  { path: '/m/stalls/requests/new', element: <FileRequest /> },
  { path: '/m/stalls/requests/:id', element: <div>the record</div> },
];

/** A member who files only for their own villages. */
const ME_LW = {
  ...ME_LEAD,
  privileges: ['requests.read', 'filing.request', 'filing.staff'],
  requestTypeScope: ['LOCAL_WELFARE'],
};

const base = (me: unknown = ME_LEAD) =>
  [
    ['GET', /\/me$/, () => me],
    ['GET', /\/public\/config$/, () => PUBLIC_CONFIG],
    [
      'GET',
      /\/requests\/file\/lookup$/,
      (url: URL) =>
        url.searchParams.get('contact') === '9840012345'
          ? {
              match: {
                accountId: 'acc-1',
                displayName: 'Kumar Stores',
                email: '',
                phone: '9840012345',
                requesterType: 'LOCAL_WELFARE',
                requestCount: 2,
              },
            }
          : { match: null },
    ],
    [
      'POST',
      /\/requests\/file$/,
      () => [
        201,
        {
          requestId: '22222222-2222-4222-8222-222222222222',
          reference: 'LWS-2026-0009',
          accountId: 'acc-1',
          accountCreated: false,
        },
      ],
    ],
  ] as Array<[string, RegExp, (url: URL) => unknown]>;

describe('FileRequest', () => {
  test('offers only the forms inside the caller’s scope', async () => {
    installFetch(base(ME_LW));
    renderAt('/m/stalls/requests/new', routes, { me: true });
    expect(
      await screen.findByRole('button', { name: /Local welfare and community stalls/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /External food and retail vendors/ }),
    ).not.toBeInTheDocument();
  });

  test('a known contact names the account and its requests before the form opens', async () => {
    installFetch(base(ME_LW));
    const user = userEvent.setup();
    renderAt('/m/stalls/requests/new', routes, { me: true });
    await user.click(
      await screen.findByRole('button', { name: /Local welfare and community stalls/ }),
    );
    await user.type(screen.getByLabelText(/Mobile Number/), '9840012345');
    expect(await screen.findByText(/Kumar Stores/)).toBeInTheDocument();
    expect(screen.getByText(/2 requests this edition/)).toBeInTheDocument();
  });

  test('a new contact needs a name, and the form then says who it is for', async () => {
    installFetch(base());
    const user = userEvent.setup();
    renderAt('/m/stalls/requests/new', routes, { me: true });
    await user.click(
      await screen.findByRole('button', { name: /External food and retail vendors/ }),
    );
    const next = screen.getByRole('button', { name: /Open the Form/ });
    expect(next).toBeDisabled();
    await user.type(screen.getByLabelText(/Requester Name/), 'Priya Venkat');
    await user.type(screen.getByLabelText(/^Email/), 'priya@example.org');
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    expect(await screen.findByText(/Filing for Priya Venkat/)).toBeInTheDocument();
    expect(screen.getByLabelText(/I read these declarations/)).toBeInTheDocument();
  });

  test('a role without the privilege is told so rather than shown the tiles', async () => {
    installFetch(base({ ...ME_LEAD, privileges: ['requests.read'], requestTypeScope: null }));
    renderAt('/m/stalls/requests/new', routes, { me: true });
    expect(await screen.findByText(/does not file requests/)).toBeInTheDocument();
  });
});
