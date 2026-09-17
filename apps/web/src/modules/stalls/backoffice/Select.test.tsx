// The fee agreed at selection.
//
// "For A3 the cost is 10,000 — for the coconut wala, probably we will give that
// stall at 5,000." That is settled in the same phone call as the bay and the
// number of stalls, and until it was on this dialog the only way to record it
// was to go to Finance afterwards — which meant it was usually not recorded.
//
// ⚠️ The SAME writer Finance uses. Two paths each writing the payment plan
// would be two figures that can disagree about what a trader owes.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { detail, installFetch, ME_ADMIN, ME_LEAD, renderAt, summary, ZONES } from '../test-utils';
import { RequestDetail } from './RequestDetail';
import { Requests } from './Requests';

afterEach(() => vi.unstubAllGlobals());

const routes = [
  { path: '/m/stalls/requests', element: <Requests /> },
  { path: '/m/stalls/requests/:id', element: <RequestDetail /> },
];

/** ⚠️ An ADMIN, not the lead the other selection tests use. The concession
 *  route requires `finance.write`, which the Lead role does not hold — so the
 *  field is drawn only for somebody who can actually save it. Showing a control
 *  that 403s on submit is worse than not showing it. */
const stubs = (over: Record<string, unknown> = {}) =>
  [
    ['GET', /\/me$/, () => ME_ADMIN],
    ['GET', /\/zones$/, () => ZONES],
    ['GET', /\/requests$/, () => ({ items: [summary()], nextCursor: null })],
    ['GET', /\/requests\/[^/]+$/, () => detail(over)],
    ['GET', /\/stalls\/available/, () => []],
    ['PATCH', /\/requests\/[^/]+$/, () => detail(over)],
    ['POST', /\/requests\/[^/]+\/select$/, () => ({ allocated: [] })],
    ['PUT', /\/discretionary-fee$/, () => [204, null]],
  ] as Array<[string, RegExp, (url: URL) => unknown]>;

const openSelect = async (user: ReturnType<typeof userEvent.setup>) => {
  renderAt('/m/stalls/requests', routes, { me: true });
  await user.click(await screen.findByText('Green Leaf Organics'));
  await screen.findByRole('region', { name: 'Request Detail' });
  await user.click(await screen.findByRole('button', { name: /^select/i }));
  // ⚠️ Scoped to the dialog. The button that OPENED it is also called Select,
  // and the one that confirms is inside.
  return within(await screen.findByRole('dialog'));
};

describe('agreeing a fee while selecting', () => {
  test('records it through the same writer Finance uses', async () => {
    const fx = installFetch(stubs());
    const user = userEvent.setup();
    const dlg = await openSelect(user);

    await user.type(dlg.getByLabelText(/fee agreed with the requester/i), '5000');
    await user.type(dlg.getByLabelText(/why the fee was reduced/i), 'Local welfare');
    await user.click(dlg.getByRole('button', { name: /^select$/i }));

    const put = await waitFor(() => {
      const hit = fx.calls.find((c) => c.url.includes('/discretionary-fee'));
      expect(hit).toBeTruthy();
      return hit;
    });
    expect(put?.body).toEqual({ discretionaryFeePaise: 500_000, reason: 'Local welfare' });

    // 🔴 AFTER the select. The plan is built from the live quote, which reads
    // the agreed bay and the stall count this dialog writes — conceding first
    // would discount a figure the selection is about to change.
    const order = fx.calls.map((c) => c.url);
    expect(order.findIndex((u) => u.includes('/select'))).toBeLessThan(
      order.findIndex((u) => u.includes('/discretionary-fee')),
    );
  });

  test('left blank, it writes nothing — the card rate stands', async () => {
    const fx = installFetch(stubs());
    const user = userEvent.setup();
    const dlg = await openSelect(user);

    dlg.getByLabelText(/fee agreed with the requester/i);
    await user.click(dlg.getByRole('button', { name: /^select$/i }));

    await waitFor(() => expect(fx.calls.some((c) => c.url.includes('/select'))).toBe(true));
    expect(fx.calls.some((c) => c.url.includes('/discretionary-fee'))).toBe(false);
  });

  test('a figure without a reason cannot be saved', async () => {
    installFetch(stubs());
    const user = userEvent.setup();
    const dlg = await openSelect(user);

    await user.type(dlg.getByLabelText(/fee agreed with the requester/i), '5000');
    // A figure below the card rate with nothing beside it is indistinguishable
    // from a typo six months later.
    expect(dlg.getByText(/say why the amount was reduced/i)).toBeTruthy();
    expect(dlg.getByRole('button', { name: /^select$/i })).toBeDisabled();
  });
});

describe('who may agree a fee', () => {
  test('a lead selects as before and is not offered the field', async () => {
    // ⚠️ `finance.write` is not a Lead privilege — the concession route refuses
    // it, so the dialog does not offer a control that cannot be saved.
    installFetch(
      stubs().map((r) =>
        r[1].source.includes('me') ? (['GET', /\/me$/, () => ME_LEAD] as const) : r,
      ) as Array<[string, RegExp, (url: URL) => unknown]>,
    );
    const user = userEvent.setup();
    const dlg = await openSelect(user);

    dlg.getByLabelText(/bay agreed with the requester/i);
    expect(dlg.queryByLabelText(/fee agreed with the requester/i)).toBeNull();
  });
});
