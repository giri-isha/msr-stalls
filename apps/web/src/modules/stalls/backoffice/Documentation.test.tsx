import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PRIVILEGE_CATEGORIES } from '@msr/stalls';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ME_ADMIN, installFetch, renderAt } from '../test-utils';
import { Documentation } from './Documentation';

beforeEach(() => vi.unstubAllGlobals());

/** A volunteer — the reader this screen is most for, and the one whose nav is
 *  missing most of what the manual describes.
 *
 *  ⚠️ Holds NEITHER `requests.read` NOR `onboarding.read` — that is the shipped
 *  Volunteer role since the reads were split out of the writes, and it is what
 *  makes this the right fixture for "a screen the caller cannot open". The two
 *  reads it DOES reach, it reaches by implication from the writes. */
const ME_VOLUNTEER = {
  personId: 'p-vol',
  displayName: 'Arun Kumar',
  roleKeys: ['stalls_volunteer'],
  privileges: ['checkin.write', 'equipment.write'],
};

const render = (path = '/m/stalls/docs', me: unknown = ME_ADMIN) => {
  installFetch([['GET', /\/me$/, () => me]]);
  return renderAt(path, [{ path: '/m/stalls/docs', element: <Documentation /> }], { me: true });
};

describe('the documentation screen', () => {
  test('opens on the process, told in the order it happens', async () => {
    render();

    expect(await screen.findByText('1. They apply')).toBeInTheDocument();
    expect(screen.getByText('9. Accounts are settled')).toBeInTheDocument();
    // The rules are the half people otherwise learn by being surprised.
    expect(screen.getByText('A letter goes out once')).toBeInTheDocument();
  });

  test('picking a tab puts it in the URL, so a section can be pointed at', async () => {
    const { router } = render();

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Reference' }));
    expect(router.state.location.search).toBe('?tab=reference');
  });

  test('and a pasted link opens on that tab rather than the overview', async () => {
    render('/m/stalls/docs?tab=reference');

    expect(await screen.findByText('Status — the selection decision')).toBeInTheDocument();
  });

  // Roles are data and cannot be documented from the bundle. The privilege
  // vocabulary is the half that is still code, so it is the half that can be
  // shown without going stale.
  test('the privilege table is the real one, not a retyped copy of it', async () => {
    render('/m/stalls/docs?tab=reference');

    for (const category of PRIVILEGE_CATEGORIES) {
      expect(await screen.findByText(category.name)).toBeInTheDocument();
      for (const item of category.items) {
        expect(screen.getByText(item.code)).toBeInTheDocument();
      }
    }
  });

  test('a screen the caller cannot open is documented, and marked', async () => {
    render('/m/stalls/docs?tab=screens', ME_VOLUNTEER);

    // Check-in is theirs: the block offers a way in.
    await waitFor(() => expect(screen.getAllByText('No Access').length).toBeGreaterThan(0));
    const hrefs = screen.getAllByRole('link', { name: /Open/ }).map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/m/stalls/checkin');

    // Chairs and tables is theirs too, and used to ride on the same privilege.
    expect(hrefs).toContain('/m/stalls/equipment');

    // Finance is not. The block stays — a volunteer still has to know where the
    // deposit they are deducting from goes — but the link does not.
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(hrefs).not.toContain('/m/stalls/finance');

    // 🔴 Nor is the pipeline, and that is the change. Working a gate used to
    // require `requests.read`, which opens every requester's full application.
    expect(hrefs).not.toContain('/m/stalls/requests');
    expect(hrefs).not.toContain('/m/stalls/onboarding');
  });

  test('every screen block links where the nav does', async () => {
    render('/m/stalls/docs?tab=screens');

    // ⚠️ Waited for, not read once: the gated blocks only offer a link after
    // `me` lands, so a single read here would assert on the moment before the
    // caller's actions are known.
    await waitFor(() => {
      const hrefs = screen
        .getAllByRole('link', { name: /Open/ })
        .map((l) => l.getAttribute('href'));
      expect(hrefs).toContain('/m/stalls/requests');
      expect(hrefs).toContain('/m/stalls/finance');
      expect(hrefs).toContain('/m/stalls/admin');
    });
  });

  test('the flow charts cover every stage, and the two derived answers', async () => {
    render('/m/stalls/docs?tab=flows');

    expect(await screen.findByText('Stage 1 — Intake and selection')).toBeInTheDocument();
    expect(screen.getByText('Stage 3 — Money')).toBeInTheDocument();
    expect(screen.getByText('Stage 5 — Settlement')).toBeInTheDocument();
    expect(screen.getByText('Which steps apply to whom')).toBeInTheDocument();
    expect(screen.getByText('How the stage is decided')).toBeInTheDocument();
  });

  test('a chart draws its question and every way out of it', async () => {
    render('/m/stalls/docs?tab=flows');

    // The fork in selection: flag, select, or turn away — all three drawn, so
    // nobody reads the chart as a single happy path.
    expect(await screen.findByText('What does the coordinator decide?')).toBeInTheDocument();
    expect(screen.getByText('Needs a Call First')).toBeInTheDocument();
    expect(screen.getByText('Worth a Stall')).toBeInTheDocument();
    expect(screen.getByText('No Room')).toBeInTheDocument();
    // And the refusal that a reader otherwise meets by surprise.
    expect(screen.getByText('A taken stall is refused')).toBeInTheDocument();
  });

  test('the overview opens with the end-to-end chart', async () => {
    render();

    expect(await screen.findByText('The whole flow at a glance')).toBeInTheDocument();
    expect(screen.getByText('A request is submitted')).toBeInTheDocument();
    expect(screen.getByText('The deposit goes back')).toBeInTheDocument();
  });

  test('the vendor tab walks the public side, paths included', async () => {
    render('/m/stalls/docs?tab=vendor');

    expect(await screen.findByText('Choose a form')).toBeInTheDocument();
    expect(screen.getByText('/stalls/status/:token')).toBeInTheDocument();
    expect(screen.getByText('/stalls/staff/:code')).toBeInTheDocument();
  });

  test('reads nothing from the API but who is asking', async () => {
    const { calls } = installFetch([['GET', /\/me$/, () => ME_ADMIN]]);
    renderAt('/m/stalls/docs', [{ path: '/m/stalls/docs', element: <Documentation /> }], {
      me: true,
    });

    expect(await screen.findByText('What this replaces')).toBeInTheDocument();
    // A manual that needs the database is a manual that is unavailable exactly
    // when something has gone wrong and somebody is looking for it.
    expect(calls.filter((c) => !/\/me$/.test(c.url))).toHaveLength(0);
  });
});
