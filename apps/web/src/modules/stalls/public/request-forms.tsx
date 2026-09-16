import type { StallRequestType } from '@stalls/core';
import type { RouteObject } from 'react-router';
import { RequestForm } from './RequestForm';

/**
 * The application forms, one route each.
 *
 * 🔴 There WAS one route, `apply/:type`, which looked the slug up in a record
 * and redirected when it found nothing. Three things were wrong with that. The
 * route list did not say which forms exist, so adding or retiring one meant
 * editing a lookup table in a page component. A slug with no form behind it
 * rendered a component that then redirected, which is a 404 the router could
 * have answered on its own. And the page read its subject out of the URL, so
 * the same form could not be mounted at a second path — which is exactly what
 * the host router will want to do when this module moves under its own public
 * prefix.
 *
 * ⚠️ The URLs are UNCHANGED. `/stalls/apply/vendor` is the same address it has
 * always been; only the declaration moved. Every bookmark, every link in a
 * confirmation email and every path in `Documentation.tsx` still resolves.
 */
export interface RequestFormRoute {
  type: StallRequestType;
  /** The last path segment. Also what `FormPicker` links to. */
  slug: string;
  /** Who the form is for, in the words the picker and the registration screen
   *  both show. 🔴 ONE copy: the tile a requester chooses their account type
   *  from and the tile they later open the form from have to describe the same
   *  three populations, or an ashram department registers as a vendor because
   *  the two screens worded it differently. */
  who: string;
  whoTa: string | null;
  /** A name from the shared icon registry — see `ui/icons.tsx`. */
  glyph: string;
  /**
   * The plate the glyph sits on.
   *
   * ⚠️ The `--<tone>-t` tint family, not the `--av*` avatar plates. A tone tint
   * is light in the light theme and dark in the dark one, so the glyph on it
   * takes `--fg` and stays readable in both — the rule `NavTileCard`'s header
   * spells out. An `--av*` plate is dark in BOTH and would need white.
   */
  tint: string;
}

/**
 * ⚠️ The ORDER the picker draws them in: external vendors first, then local
 * welfare, then the ashram's own departments. Most readers are the first, and
 * the list is short enough that a reader who is not should not have to scroll.
 *
 * 🔴 `ashram-food` is absent, and that is the merge. The two ashram forms asked
 * the same questions and differed by whether the stall sells food — which the
 * one form now ASKS, rather than making a department declare it by choosing a
 * page before being asked anything. The old slug redirects here; see
 * `stallsPublicRoutes`.
 */
export const REQUEST_FORMS: readonly RequestFormRoute[] = [
  {
    type: 'VENDOR',
    slug: 'vendor',
    who: 'External food and retail vendors',
    whoTa: 'வெளி விற்பனையாளர்கள்',
    glyph: 'ticket',
    tint: 'var(--pri-t)',
  },
  {
    type: 'LOCAL_WELFARE',
    slug: 'local-welfare',
    who: 'Local welfare and community stalls',
    whoTa: null,
    glyph: 'users',
    tint: 'var(--teal-t)',
  },
  // 🔴 ONE ashram entry, where there were two — "display and sales" and "food
  // stalls". A department had to know which of them it was before being asked a
  // question, and picking wrong meant a request of the wrong type. The form
  // asks it instead.
  {
    type: 'ASHRAM',
    slug: 'ashram',
    who: 'Ashram departments — display, sales and food',
    whoTa: null,
    glyph: 'layout-grid',
    tint: 'var(--violet-t)',
  },
];

/** One form's description, by type. ⚠️ Derived from the list above rather than
 *  written beside it, so a form added to the routes is described everywhere it
 *  is offered. */
export const REQUEST_FORM_BY_TYPE = Object.fromEntries(
  REQUEST_FORMS.map((f) => [f.type, f]),
) as Record<StallRequestType, RequestFormRoute>;

export const TYPE_SLUG: Record<StallRequestType, string> = Object.fromEntries(
  REQUEST_FORMS.map((f) => [f.type, f.slug]),
) as Record<StallRequestType, string>;

/** The route objects a host mounts, relative to whatever public prefix it
 *  serves the module under. */
export const REQUEST_FORM_ROUTES: RouteObject[] = REQUEST_FORMS.map((f) => ({
  path: `apply/${f.slug}`,
  element: <RequestForm type={f.type} />,
}));
