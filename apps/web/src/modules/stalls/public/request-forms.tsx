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
  { type: 'VENDOR', slug: 'vendor' },
  { type: 'LOCAL_WELFARE', slug: 'local-welfare' },
  { type: 'ASHRAM', slug: 'ashram' },
];

export const TYPE_SLUG: Record<StallRequestType, string> = Object.fromEntries(
  REQUEST_FORMS.map((f) => [f.type, f.slug]),
) as Record<StallRequestType, string>;

/** The route objects a host mounts, relative to whatever public prefix it
 *  serves the module under. */
export const REQUEST_FORM_ROUTES: RouteObject[] = REQUEST_FORMS.map((f) => ({
  path: `apply/${f.slug}`,
  element: <RequestForm type={f.type} />,
}));
