import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, ME_LEAD, choose, installFetch, renderAt } from '../test-utils';
import { Configs } from './Configs';

beforeEach(() => vi.unstubAllGlobals());

const NAV_CONFIG = {
  categories: [
    { key: 'c_overview', label: 'Overview', ordinal: 0, builtIn: true },
    { key: 'c_requests', label: 'Requests & Selection', ordinal: 1, builtIn: true },
    { key: 'c_mine', label: 'Mine', ordinal: 9, builtIn: false },
  ],
  roles: [
    {
      roleKey: 'stalls_admin',
      name: 'Admin',
      level: 0,
      configured: false,
      shownCount: 2,
      total: 2,
      items: [
        {
          key: 'home',
          label: 'Home',
          glyph: 'home',
          meta: 'Your cards',
          to: '/m/stalls',
          category: 'c_overview',
          shown: true,
        },
        {
          key: 'requests',
          label: 'All Requests',
          glyph: 'list-view',
          meta: 'The whole pipeline',
          to: '/m/stalls/requests',
          category: 'c_requests',
          shown: true,
        },
      ],
    },
    {
      roleKey: 'stalls_volunteer',
      name: 'Volunteer',
      level: 2,
      configured: true,
      shownCount: 1,
      total: 1,
      items: [
        {
          key: 'home',
          label: 'Home',
          glyph: 'home',
          meta: 'Your cards',
          to: '/m/stalls',
          category: 'c_overview',
          shown: true,
        },
      ],
    },
  ],
};

const HOME_CONFIG = {
  roles: [
    {
      roleKey: 'stalls_admin',
      name: 'Admin',
      level: 0,
      configured: false,
      shownCount: 2,
      total: 2,
      items: [
        {
          key: 'requests_summary',
          label: 'Request Pipeline',
          description: 'Total requests filed this edition.',
          glyph: 'clipboard-list',
          span: 'full',
          shown: true,
        },
        {
          key: 'quick_links',
          label: 'Quick Links',
          description: 'The screens this person can open.',
          glyph: 'list-view',
          span: 'full',
          shown: true,
        },
      ],
    },
  ],
};

const stubs = (me: unknown = ME_ADMIN) =>
  installFetch([
    ['GET', /\/m\/stalls\/me$/, () => me],
    ['GET', /\/m\/stalls\/config\/sidebar$/, () => NAV_CONFIG],
    ['GET', /\/m\/stalls\/config\/home$/, () => HOME_CONFIG],
    ['PUT', /\/m\/stalls\/config\/sidebar\/.+$/, () => ({ shown: 1 })],
    ['PUT', /\/m\/stalls\/config\/home\/.+$/, () => ({ shown: 1 })],
    ['POST', /\/m\/stalls\/config\/sidebar-headings$/, () => ({ key: 'c_new' })],
  ]);

const routes = [{ path: '/m/stalls/config', element: <Configs /> }];
const render = (tab: string) => renderAt(`/m/stalls/config?tab=${tab}`, routes, { me: true });

describe('the Configs strip', () => {
  test('carries the two layout tabs beside the five paperwork ones', async () => {
    const api = stubs();
    render('home');

    const strip = await screen.findByRole('tablist', { name: 'Configuration Sections' });
    for (const label of [
      'Home Page',
      'Sidebar Layout',
      'Form Builder',
      'Call Log Form',
      'Declarations',
      'Flow',
      'Editions',
    ]) {
      expect(within(strip).getByRole('tab', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    }
    // ⚠️ Only the active tab is mounted: a strip that mounted all seven would
    // fetch six payloads for nothing.
    expect(api.calls.some((c) => c.url.includes('/config/sidebar'))).toBe(false);
  });

  /** The tab is in the query string, so a bookmark lands where it left off and
   *  the browser's back button walks the tabs. */
  test('opens the tab the URL names, and falls back to the first one', async () => {
    stubs();
    render('sidebar');
    expect(
      await screen.findByText(/which links each role sees, under which heading/i),
    ).toBeInTheDocument();

    stubs();
    renderAt('/m/stalls/config?tab=nonsense', routes, { me: true });
    expect(await screen.findByText(/which cards each role lands on/i)).toBeInTheDocument();
  });
});

describe('Configs › Home Page', () => {
  test('opens on a role, and says whether its layout is a choice or a default', async () => {
    stubs();
    render('home');

    expect(await screen.findByText('Request Pipeline')).toBeInTheDocument();
    // ⚠️ The sentence an admin needs before they "fix" a layout nobody set. It
    // reads twice — once beside the picker and once inside it — which is the
    // point: the role list says which roles have been arranged at all.
    expect(screen.getByText(/Not arranged — showing all 2 cards/i)).toBeInTheDocument();
  });

  test('sends the order and the toggles as one list when it is saved', async () => {
    const api = stubs();
    render('home');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Move Quick Links up' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const put = api.calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/m/stalls/config/home/stalls_admin');
    expect(put?.body).toEqual({
      widgets: [
        { key: 'quick_links', shown: true },
        { key: 'requests_summary', shown: true },
      ],
    });
  });

  test('cannot be saved by somebody who may only read the configuration', async () => {
    // The Lead holds `config.read` and not `config.write`.
    stubs(ME_LEAD);
    render('home');

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('Configs › Sidebar Layout', () => {
  test('groups the links under their headings, and offers the empty ones to move into', async () => {
    stubs();
    render('sidebar');

    expect(await screen.findByText('Home')).toBeInTheDocument();
    // `getAllBy`: every heading is both a block title and an option in each
    // row's "move to" picker.
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
    // A heading nothing is assigned to still lists, so an admin has somewhere
    // to move items TO.
    expect(screen.getAllByText('Mine').length).toBeGreaterThan(0);
    expect(screen.getByText('empty')).toBeInTheDocument();
  });

  test('sends one ordered list, with each item under the heading it now sits in', async () => {
    const api = stubs();
    render('sidebar');
    const user = userEvent.setup();

    await choose(user, await screen.findByLabelText('Heading for Home'), 'c_mine');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const put = api.calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/m/stalls/config/sidebar/stalls_admin');
    expect(put?.body).toEqual({
      items: [
        { key: 'requests', category: 'c_requests', shown: true },
        { key: 'home', category: 'c_mine', shown: true },
      ],
    });
  });

  test('switches a link off without taking it out of the list', async () => {
    const api = stubs();
    render('sidebar');
    const user = userEvent.setup();

    await choose(user, await screen.findByLabelText('Home visibility'), 'hidden');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const put = api.calls.find((c) => c.method === 'PUT');
    expect(put?.body).toMatchObject({
      items: expect.arrayContaining([{ key: 'home', category: 'c_overview', shown: false }]),
    });
  });

  /** ⚠️ The registry would put a built-in straight back on the next read, so
   *  the delete would appear to work and change nothing. */
  test('offers delete only on a heading an admin added', async () => {
    stubs();
    render('sidebar');

    expect(await screen.findByRole('button', { name: 'Delete Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Overview' })).not.toBeInTheDocument();
  });

  test('adds a heading, and says it is shared by every role', async () => {
    const api = stubs();
    render('sidebar');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add Heading' }));
    expect(screen.getByText(/shared by every role/i)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox'), 'Evening');
    await user.click(screen.getByRole('button', { name: /create/i }));

    const post = api.calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ label: 'Evening' });
  });
});
