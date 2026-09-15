// Amending a request, and the bay that amendment settles.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ME_LEAD, ZONES, detail, installFetch, renderAt, summary } from '../test-utils';
import { RequestDetail } from './RequestDetail';
import { Requests } from './Requests';

afterEach(() => vi.unstubAllGlobals());

const routes = [
  { path: '/m/stalls/requests', element: <Requests /> },
  { path: '/m/stalls/requests/:id', element: <RequestDetail /> },
];

const stubs = (over: Record<string, unknown> = {}) =>
  [
    ['GET', /\/me$/, () => ME_LEAD],
    ['GET', /\/zones$/, () => ZONES],
    ['GET', /\/requests$/, () => ({ items: [summary()], nextCursor: null })],
    ['GET', /\/requests\/[^/]+$/, () => detail(over)],
    ['PATCH', /\/requests\/[^/]+$/, () => detail(over)],
  ] as Array<[string, RegExp, (url: URL) => unknown]>;

const openDetail = async () => {
  renderAt('/m/stalls/requests', routes, { me: true });
  await userEvent.click(await screen.findByText('Green Leaf Organics'));
  return screen.findByRole('region', { name: 'Request detail' });
};

describe('the agreed bay on the record', () => {
  test('is shown apart from the bay that was asked for, and says so when they differ', async () => {
    installFetch(stubs({ agreedZoneCode: 'A4' }));
    await openDetail();
    expect(await screen.findByText('Bay requested')).toBeInTheDocument();
    expect(screen.getByText('Bay agreed')).toBeInTheDocument();
    // The vendor asked for C1 and was given A4 — the row has to say that, or
    // the rent on the payment letter looks wrong to whoever reads it.
    expect(screen.getByText('moved from C1')).toBeInTheDocument();
  });

  test('is absent until the conversation has happened', async () => {
    installFetch(stubs());
    await openDetail();
    await screen.findByText('Bay requested');
    expect(screen.queryByText('Bay agreed')).not.toBeInTheDocument();
  });
});

describe('the amend dialog', () => {
  test('sends only what changed', async () => {
    const fx = installFetch(stubs());
    await openDetail();
    await userEvent.click(await screen.findByRole('button', { name: /Amend/ }));

    const contact = await screen.findByLabelText('Contact number');
    await userEvent.clear(contact);
    await userEvent.type(contact, '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fx.calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = fx.calls.filter((c) => c.method === 'PATCH').at(-1);
    // Not the whole record: a patch carrying every field overwrites a
    // colleague's edit on fields nobody here touched.
    expect(patch?.body).toEqual({ contactNumber: '9876543210' });
  });

  test('offers the edition’s own bays, and records the one agreed', async () => {
    const fx = installFetch(stubs());
    await openDetail();
    await userEvent.click(await screen.findByRole('button', { name: /Amend/ }));

    const agreed = await screen.findByLabelText('Bay agreed');
    // The bays come from the edition, so a bay added in Admin this year is
    // offered without a code change.
    expect(agreed).toHaveTextContent('A4 — Snake side');
    await userEvent.selectOptions(agreed, 'A4');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fx.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(fx.calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({
      agreedZoneCode: 'A4',
    });
  });

  test('an unchanged form writes nothing', async () => {
    const fx = installFetch(stubs());
    await openDetail();
    await userEvent.click(await screen.findByRole('button', { name: /Amend/ }));
    await screen.findByLabelText('Contact number');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByText('Save changes')).not.toBeInTheDocument());
    expect(fx.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  test('clearing the agreed bay sends null, not an empty string', async () => {
    const fx = installFetch(stubs({ agreedZoneCode: 'A4' }));
    await openDetail();
    await userEvent.click(await screen.findByRole('button', { name: /Amend/ }));

    await userEvent.selectOptions(await screen.findByLabelText('Bay agreed'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fx.calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(fx.calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({
      agreedZoneCode: null,
    });
  });
});
