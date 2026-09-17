// The registry and the router, checked against each other.
//
// 🔴 The nav moved OUT of this module into `@stalls/core`, so that the API can
// resolve each caller's sidebar against what an admin arranged. The cost of that
// move is that the list of links and the list of screens are now in two
// packages, and nothing but this file stops them drifting: a link to a route
// that does not exist is a dead end somebody's sidebar offers them, and a route
// no link reaches is a screen only a typed URL can open.
import { CONFIG_TABS, NAV_ITEMS } from '@stalls/core';
import { describe, expect, it } from 'vitest';
import { stallsBackofficeRoutes } from './index';
import { CONFIG_TAB_BODIES } from './backoffice/Configs';

/** The paths the host mounts, absolute, the way a nav item spells them. */
const MOUNTED = '/m/stalls';
const paths = stallsBackofficeRoutes.map((r) =>
  'index' in r && r.index ? MOUNTED : `${MOUNTED}/${(r as { path: string }).path}`,
);

describe('every link goes somewhere', () => {
  it('routes each nav item, exactly', () => {
    for (const item of NAV_ITEMS) {
      expect(paths, item.key).toContain(item.to);
    }
  });

  /** ⚠️ Not every route needs a link — a request record, a report and the two
   *  kept redirects are reached from inside a screen. What must not happen is a
   *  top-level SCREEN with no way to it, so this names the exceptions rather
   *  than asserting a bare equality nobody could maintain. */
  it('leaves only the routes that are reached from inside another screen unlinked', () => {
    const linked = new Set(NAV_ITEMS.map((i) => i.to));
    const unlinked = paths.filter((p) => !linked.has(p) && !p.includes(':'));
    expect(unlinked.sort()).toEqual(
      [
        // Kept alive for bookmarks — `/admin` is Configs now, `/all` is the
        // request list.
        `${MOUNTED}/admin`,
        `${MOUNTED}/all`,
        // Filing on somebody's behalf, from the request list's own toolbar.
        `${MOUNTED}/requests/new`,
      ].sort(),
    );
  });
});

describe('every Configs tab has a body', () => {
  it('draws something for each tab in the registry', () => {
    for (const tab of CONFIG_TABS) {
      expect(CONFIG_TAB_BODIES, tab.key).toContain(tab.key);
    }
  });

  it('draws nothing for a tab the registry does not have', () => {
    const known = new Set(CONFIG_TABS.map((t) => t.key));
    expect(CONFIG_TAB_BODIES.filter((k) => !known.has(k))).toEqual([]);
  });
});
