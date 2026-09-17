import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, installFetch, renderAt } from '../test-utils';
import { Dashboards } from './Dashboards';
import { Report } from './Report';

beforeEach(() => vi.unstubAllGlobals());

const ME = ['GET', /\/m\/stalls\/me$/, () => ME_ADMIN] as const;
const DASH = [
  'GET',
  /\/m\/stalls\/dashboard$/,
  () => ({
    total: 3,
    byType: { VENDOR: 2, LOCAL_WELFARE: 1, ASHRAM: 0 },
    byStatus: { SUBMITTED: 3 },
    stallsPlanned: 10,
    stallsAllocated: 1,
    flagged: 0,
  }),
] as const;

const CATALOG = [
  'GET',
  /\/m\/stalls\/reports$/,
  () => ({
    reports: [
      {
        key: 'requests_by_status',
        title: 'Requests by Status',
        note: 'Every status against every requester type.',
        group: 'Requests & Selection',
        glyph: 'clipboard-list',
      },
      {
        key: 'collections',
        title: 'Collections & Dues',
        note: 'Quoted, confirmed and outstanding.',
        group: 'Onboarding & Money',
        glyph: 'rupee',
      },
    ],
  }),
] as const;

const VIEW = {
  key: 'collections',
  title: 'Collections & Dues',
  note: 'Quoted, confirmed and outstanding.',
  editionLabel: 'Stalls 2026',
  columns: [
    { key: 'type', label: 'Requester Type', kind: 'text' },
    { key: 'quoted', label: 'Quoted', kind: 'money' },
    { key: 'n', label: 'Stalls', kind: 'number' },
  ],
  rows: [{ type: 'Vendor', quoted: 250000, n: 4 }],
  total: { type: 'Total', quoted: 250000, n: 4 },
};

describe('the hub', () => {
  test('carries the headline counts and the reports this caller may open', async () => {
    installFetch([ME, DASH, CATALOG]);
    renderAt('/m/stalls/dashboards', [{ path: '/m/stalls/dashboards', element: <Dashboards /> }], {
      me: true,
    });

    // The KPI strip — the old Dashboard screen, where it belongs.
    expect(await screen.findByText('Total Requests')).toBeInTheDocument();
    // And the catalog under it, grouped as the catalog groups it.
    expect(await screen.findByText('Requests by Status')).toBeInTheDocument();
    expect(screen.getByText('Onboarding & Money')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Collections & Dues/ })).toHaveAttribute(
      'href',
      '/m/stalls/dashboards/collections',
    );
  });

  /** A finance officer may open reports and not the pipeline. The catalog is
   *  still theirs; the counts above it are not, and the screen says which. */
  test('keeps the catalog for a caller who cannot read the pipeline', async () => {
    const noRequests = {
      ...ME_ADMIN,
      privileges: ME_ADMIN.privileges.filter(
        (p) => p !== 'requests.read' && p !== 'requests.write',
      ),
    };
    installFetch([['GET', /\/m\/stalls\/me$/, () => noRequests], CATALOG]);
    renderAt('/m/stalls/dashboards', [{ path: '/m/stalls/dashboards', element: <Dashboards /> }], {
      me: true,
    });

    expect(await screen.findByText(/your role does not open/i)).toBeInTheDocument();
    expect(await screen.findByText('Collections & Dues')).toBeInTheDocument();
    expect(screen.queryByText('Total Requests')).not.toBeInTheDocument();
  });
});

describe('one report', () => {
  const renderReport = () =>
    renderAt(
      '/m/stalls/dashboards/collections',
      [{ path: '/m/stalls/dashboards/:key', element: <Report /> }],
      { me: true },
    );

  test('draws the table it was sent, with money in rupees and a total under it', async () => {
    installFetch([ME, ['GET', /\/m\/stalls\/reports\/collections$/, () => VIEW]]);
    renderReport();

    expect(await screen.findByText('Collections & Dues')).toBeInTheDocument();
    const table = screen.getByRole('table');
    // ⚠️ 250000 PAISE is ₹2,500. A table showing the paise figure under a
    // heading that says rupees is the defect this assertion exists for.
    expect(within(table).getAllByText('₹2,500')).toHaveLength(2);
    expect(within(table).getByText('Total')).toBeInTheDocument();
  });

  test('offers the export, and nothing to export when the table is empty', async () => {
    installFetch([ME, ['GET', /\/m\/stalls\/reports\/collections$/, () => VIEW]]);
    renderReport();
    expect(await screen.findByRole('button', { name: /export csv/i })).toBeEnabled();
  });

  test('says there is nothing yet rather than drawing an empty table', async () => {
    installFetch([
      ME,
      [
        'GET',
        /\/m\/stalls\/reports\/collections$/,
        () => ({ ...VIEW, rows: [], total: undefined }),
      ],
    ]);
    renderReport();

    expect(await screen.findByText(/nothing to report for this edition/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export csv/i })).toBeDisabled();
  });

  /** A report the caller may not open is a 403 from the API — the viewer has to
   *  say so and offer the way back, not render an empty page. */
  test('shows the refusal and a way back when the API says no', async () => {
    installFetch([
      ME,
      ['GET', /\/m\/stalls\/reports\/collections$/, () => [403, { error: 'not for you' }]],
    ]);
    renderReport();

    expect(await screen.findByText(/not for you/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to reports/i })).toBeInTheDocument();
  });
});
