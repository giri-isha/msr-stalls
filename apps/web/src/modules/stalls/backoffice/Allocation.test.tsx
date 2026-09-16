// Handing out a stall number, correcting one, and knowing when there is
// nothing left to hand out.
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

const FREE = [
  { id: 's-1', number: 'A4-7', zoneCode: 'A4', category: 'VENDOR_FOOD', status: 'AVAILABLE' },
  { id: 's-2', number: 'A4-8', zoneCode: 'A4', category: 'VENDOR_FOOD', status: 'AVAILABLE' },
];

const allocation = (over: Record<string, unknown> = {}) => ({
  id: 'alloc-1',
  stallNumber: 'A4-3',
  zoneCode: 'A4',
  category: 'VENDOR_FOOD',
  allocatedAt: '2026-09-02T10:00:00.000Z',
  ...over,
});

const stubs = (over: Record<string, unknown> = {}) =>
  [
    ['GET', /\/me$/, () => ME_LEAD],
    ['GET', /\/zones$/, () => ZONES],
    ['GET', /\/requests$/, () => ({ items: [summary()], nextCursor: null })],
    ['GET', /\/stalls\/available$/, () => FREE],
    ['GET', /\/requests\/[^/]+$/, () => detail(over)],
    ['GET', /\/onboarding/, () => null],
    ['PATCH', /\/requests\/[^/]+$/, () => detail(over)],
    ['PATCH', /\/allocations\/[^/]+$/, (_u: URL, _i: RequestInit, b: unknown) => b],
    ['POST', /\/select$/, () => ({ allocated: ['A4-7'] })],
  ] as Array<[string, RegExp, (url: URL, init: RequestInit, body: unknown) => unknown]>;

const openDetail = async (over: Record<string, unknown> = {}) => {
  installFetch(stubs(over));
  renderAt('/m/stalls/requests', routes, { me: true });
  await userEvent.click(await screen.findByText('Green Leaf Organics'));
  return screen.findByRole('region', { name: 'Request Detail' });
};

describe('the stall button on the rail', () => {
  test('is gone once the request holds every stall it was given', async () => {
    await openDetail({
      status: 'SELECTED',
      numStallsRequested: 1,
      allocations: [allocation()],
    });
    // The allocation is on the page, so the record has loaded and the absence
    // below is the rail's decision rather than a slow render.
    expect(await screen.findByText('A4-3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add stall/ })).not.toBeInTheDocument();
  });

  test('stays while a stall is still owed', async () => {
    await openDetail({
      status: 'SELECTED',
      numStallsRequested: 2,
      allocations: [allocation()],
    });
    expect(await screen.findByRole('button', { name: /Add stall/ })).toBeInTheDocument();
  });
});

describe('correcting a stall number', () => {
  test('moves the allocation in one call rather than releasing it first', async () => {
    const fx = installFetch(stubs({ status: 'SELECTED', allocations: [allocation()] }));
    renderAt('/m/stalls/requests', routes, { me: true });
    await userEvent.click(await screen.findByText('Green Leaf Organics'));

    await userEvent.click(await screen.findByRole('button', { name: /Edit/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'A4-7' }));
    await userEvent.click(screen.getByRole('button', { name: /Move to A4-7/ }));

    await waitFor(() => expect(fx.calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = fx.calls.filter((c) => c.method === 'PATCH').at(-1);
    expect(patch?.url).toContain('/allocations/alloc-1');
    expect(patch?.body).toEqual({ stallNumber: 'A4-7' });
    // 🔴 Never DELETE then POST: between the two, the stall being moved to is
    // free for anyone else to take.
    expect(fx.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  test('sits beside Release rather than replacing it', async () => {
    await openDetail({ status: 'SELECTED', allocations: [allocation()] });
    expect(await screen.findByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Release/ })).toBeInTheDocument();
  });
});

describe('the number of stalls, asked while selecting', () => {
  const openSelect = async (over: Record<string, unknown> = {}) => {
    const fx = installFetch(stubs({ numStallsRequested: 3, ...over }));
    renderAt('/m/stalls/requests', routes, { me: true });
    await userEvent.click(await screen.findByText('Green Leaf Organics'));
    // The rail says "Select…" on a fresh request and "Add stall" on one that
    // already holds fewer stalls than it is being given. Same dialog.
    await userEvent.click(await screen.findByRole('button', { name: /Select…|Add stall/ }));
    await screen.findByLabelText(/Number of Stalls/);
    return fx;
  };

  test('is offered filled in, and left alone it changes nothing', async () => {
    const fx = await openSelect();
    expect(await screen.findByLabelText(/Number of Stalls/)).toHaveValue(3);

    await userEvent.click(await screen.findByRole('button', { name: 'A4-7' }));
    await userEvent.click(screen.getByRole('button', { name: /Allocate 1/ }));

    await waitFor(() => expect(fx.calls.some((c) => c.url.endsWith('/select'))).toBe(true));
    // Not required, and not a second way to rewrite the record by accident.
    expect(fx.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  test('a number the team agreed is recorded before the stalls are given', async () => {
    const fx = await openSelect();
    const count = screen.getByLabelText(/Number of Stalls/);
    await userEvent.clear(count);
    await userEvent.type(count, '2');

    await userEvent.click(await screen.findByRole('button', { name: 'A4-7' }));
    await userEvent.click(screen.getByRole('button', { name: /Allocate 1/ }));

    await waitFor(() => expect(fx.calls.some((c) => c.url.endsWith('/select'))).toBe(true));
    const patch = fx.calls.filter((c) => c.method === 'PATCH').at(-1);
    expect(patch?.body).toEqual({ numStallsRequested: 2 });
    // ⚠️ Order matters: the API refuses a selection that offers more stalls
    // than the request asked for, so the count has to land first.
    const patchAt = fx.calls.findIndex((c) => c.method === 'PATCH');
    const selectAt = fx.calls.findIndex((c) => c.url.endsWith('/select'));
    expect(patchAt).toBeLessThan(selectAt);
  });

  test('refuses a count below what the request already holds', async () => {
    await openSelect({
      status: 'SELECTED',
      allocations: [allocation(), allocation({ id: 'a-2' })],
    });
    const count = screen.getByLabelText(/Number of Stalls/);
    await userEvent.clear(count);
    await userEvent.type(count, '1');

    expect(await screen.findByText(/already holds 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select/ })).toBeDisabled();
  });
});
