import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ME_LEAD, auditEvent, installFetch, renderAt } from '../test-utils';
import { AuditLog } from './AuditLog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const routes = [{ path: '/m/stalls/audit', element: <AuditLog /> }];

const rows = [
  auditEvent(),
  auditEvent({
    id: 'a2222222-2222-4222-8222-222222222222',
    action: 'stall_email.failed',
    label: 'Email Failed',
    family: 'outbound',
    glyph: 'mail',
    tone: 'des',
    actorKind: 'SYSTEM',
    actorRef: '00000000-0000-0000-0000-000000000000',
    actorName: 'System',
    channel: 'SYSTEM',
    changes: null,
    detail: { to: 'v@example.org', subject: 'Hello', error: 'smtp down' },
    outcome: 'FAILED',
  }),
  auditEvent({
    id: 'a3333333-3333-4333-8333-333333333333',
    action: 'stall_request.filed',
    label: 'Request Filed',
    family: 'request',
    glyph: 'clipboard-list',
    tone: 'info',
    actorName: 'Gopal Krishnan',
    onBehalfOf: { accountId: 'acc-1', displayName: 'Kumar Stores' },
    changes: null,
    detail: { reference: 'LWS-2026-0004' },
  }),
];

const base = () =>
  [
    ['GET', /\/me$/, () => ME_LEAD],
    [
      'GET',
      /\/audit$/,
      (url: URL) => {
        const kind = url.searchParams.get('actorKind');
        const items = kind ? rows.filter((r) => r.actorKind === kind) : rows;
        return { items, total: items.length, page: 0, pageSize: 50 };
      },
    ],
  ] as Array<[string, RegExp, (url: URL) => unknown]>;

describe('AuditLog', () => {
  test('lists events with their label, actor, entity and channel', async () => {
    installFetch(base());
    renderAt('/m/stalls/audit', routes, { me: true });
    // Scoped to the table throughout: the Event Type filter lists every
    // label as an <option>, and the pager counts the rows as well.
    const table = within(await screen.findByRole('table'));
    expect(table.getByText('Request Amended')).toBeInTheDocument();
    expect(table.getByText('Deepa Ramanathan')).toBeInTheDocument();
    expect(table.getAllByText('VEN-2026-0001').length).toBeGreaterThan(0);
    expect(table.getByText('Failed')).toBeInTheDocument();
    expect(screen.getAllByText(/3 events/).length).toBeGreaterThan(0);
  });

  test('an on-behalf row says who it was for', async () => {
    installFetch(base());
    renderAt('/m/stalls/audit', routes, { me: true });
    expect(await screen.findByText(/for Kumar Stores/)).toBeInTheDocument();
  });

  test('expanding a row shows the change set with the old value struck through', async () => {
    installFetch(base());
    renderAt('/m/stalls/audit', routes, { me: true });
    await screen.findByRole('table');
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Show Details' })[0]);
    expect(screen.getByText('chairsNeeded')).toBeInTheDocument();
    const before = screen.getByText('2');
    expect(before.tagName).toBe('S');
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  test('the actor-kind chips filter through the API and the URL', async () => {
    const fx = installFetch(base());
    const { router } = renderAt('/m/stalls/audit', routes, { me: true });
    await screen.findByRole('table');
    await userEvent.setup().click(screen.getByRole('button', { name: 'System' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).queryByText('Request Amended'),
      ).not.toBeInTheDocument(),
    );
    expect(within(screen.getByRole('table')).getByText('Email Failed')).toBeInTheDocument();
    expect(router.state.location.search).toContain('actorKind=SYSTEM');
    expect(fx.calls.some((c) => c.url.includes('actorKind=SYSTEM'))).toBe(true);
  });

  test('the search box asks the server', async () => {
    const fx = installFetch(base());
    renderAt('/m/stalls/audit', routes, { me: true });
    await screen.findByRole('table');
    await userEvent.setup().type(screen.getByLabelText('Search'), 'VEN-2026');
    await waitFor(() => expect(fx.calls.some((c) => c.url.includes('q=VEN-2026'))).toBe(true));
  });
});
