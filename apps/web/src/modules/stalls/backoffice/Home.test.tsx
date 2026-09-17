import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, installFetch, renderAt } from '../test-utils';
import { Home } from './Home';

beforeEach(() => vi.unstubAllGlobals());

const routes = [{ path: '/m/stalls', element: <Home /> }];
const render = () => renderAt('/m/stalls', routes, { me: true });

const ME = ['GET', /\/m\/stalls\/me$/, () => ME_ADMIN] as const;

const home = (widgets: unknown[]) =>
  installFetch([
    ME,
    ['GET', /\/m\/stalls\/home$/, () => ({ editionLabel: 'Stalls 2026', widgets })],
  ]);

const pipeline = {
  key: 'requests_summary',
  label: 'Request Pipeline',
  glyph: 'clipboard-list',
  span: 'full',
  to: '/m/stalls/requests',
  data: { total: 12, submitted: 5, shortlisted: 3, selected: 2, backup: 1, rejected: 1 },
};

describe('the home page', () => {
  test('draws the cards it was sent, and names the edition they are for', async () => {
    home([pipeline]);
    render();

    expect(await screen.findByText('Request Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Stalls 2026')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Filed')).toBeInTheDocument();
  });

  test("links a card's readings into the list they filter", async () => {
    home([pipeline]);
    render();

    expect(await screen.findByRole('link', { name: /selected/i })).toHaveAttribute(
      'href',
      '/m/stalls/requests?status=SELECTED',
    );
  });

  /** ⚠️ `data: {}` is a card that RAN with nothing to count — Quick Links draws
   *  itself from the caller's own nav. `null` is a loader that failed. The two
   *  must not look the same. */
  test('draws a card that has no figures of its own', async () => {
    home([
      {
        key: 'quick_links',
        label: 'Quick Links',
        glyph: 'list-view',
        span: 'full',
        data: {},
      },
    ]);
    render();

    expect(await screen.findByText('Quick Links')).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument();
  });

  test('says so on a card whose figures could not be read, and keeps the rest', async () => {
    home([
      pipeline,
      { key: 'finance_summary', label: 'Collections', glyph: 'rupee', span: 'half', data: null },
    ]);
    render();

    expect(await screen.findByText('Request Pipeline')).toBeInTheDocument();
    expect(screen.getByText(/could not be read just now/i)).toBeInTheDocument();
  });

  /** 🔴 The whole reason Home replaced the Dashboard: a caller whose privileges
   *  reach nothing gets an answer, not a screen the API refuses. */
  test('tells a caller with no cards what is wrong and who can fix it', async () => {
    home([]);
    render();

    expect(await screen.findByText(/does not reach any of the home cards/i)).toBeInTheDocument();
  });
});
