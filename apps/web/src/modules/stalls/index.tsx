// The module's public surface for a host router: two route trees. The host
// mounts `stallsBackofficeRoutes` under its /m/stalls and `stallsPublicRoutes`
// wherever it serves public pages. Nothing here knows which shell it is inside.
//
// ⚠️ The NAV used to be here too — a `STALLS_NAV` literal this file exported.
// It is in `@stalls/core` now (`NAV_ITEMS`), because the API resolves each
// caller's sidebar against what an admin arranged and cannot import a React
// module to do it. The route list and the registry are checked against each
// other by a test, so a screen can never be routed without a way to reach it.
import { Navigate, type RouteObject, useLocation, useParams } from 'react-router';
import { AccessLink } from './public/AccessLink';
import { BankForm } from './public/BankForm';
import { FormPicker } from './public/FormPicker';
import { FssaiForm } from './public/FssaiForm';
import { Login } from './public/Login';
import { MyRequests } from './public/MyRequests';
import { Register } from './public/Register';
import { REQUEST_FORM_ROUTES } from './public/request-forms';
import { ResetPassword } from './public/ResetPassword';
import { StaffRegistration } from './public/StaffRegistration';
import { StatusPage } from './public/StatusPage';
import { Submitted } from './public/Submitted';
import { AuditLog } from './backoffice/AuditLog';
import { RolesPrivileges } from './backoffice/access/RolesPrivileges';
import { Users } from './backoffice/access/Users';
import { CheckIn } from './backoffice/CheckIn';
import { Communication } from './backoffice/Communication';
import { Dashboards } from './backoffice/Dashboards';
import { Home } from './backoffice/Home';
import { Report } from './backoffice/Report';
import { Configs } from './backoffice/Configs';
import { FileRequest } from './backoffice/FileRequest';
import { Documentation } from './backoffice/Documentation';
import { Electrical } from './backoffice/Electrical';
import { Equipment } from './backoffice/Equipment';
import { Finance } from './backoffice/Finance';
import { Onboarding } from './backoffice/Onboarding';
import { Planning } from './backoffice/planning';
import { RequestDetail } from './backoffice/RequestDetail';
import { Requests } from './backoffice/Requests';

export const stallsPublicRoutes: RouteObject[] = [
  { index: true, element: <Navigate to='apply' replace /> },
  { path: 'apply', element: <FormPicker /> },
  // 🔴 ONE ROUTE PER FORM, where there was a single `apply/:type` that looked a
  // slug up in a table. The URLs are the same ones; what changed is that this
  // list now SAYS which forms exist, so a form is added or retired here rather
  // than by editing a record two files away — and a slug with no form behind it
  // is a 404 the router can see, not a component that renders and redirects.
  //
  // ⚠️ Each element names its own type. `RequestForm` no longer reads the URL:
  // a page that takes its subject from `useParams` cannot be mounted twice, and
  // the host router is free to hang these wherever it serves public pages.
  ...REQUEST_FORM_ROUTES,
  // The ashram food form's own URL, kept alive. It was the fourth application
  // form until the two ashram forms became one; the link is in inboxes and on
  // at least one printed sheet, and it now means the ashram form.
  { path: 'apply/ashram-food', element: <Navigate to='/stalls/apply/ashram' replace /> },
  { path: 'submitted', element: <Submitted /> },
  // Behind the session: the requester's own requests. ⚠️ This one does NOT go
  // when SSO lands — the OIDC callback mints the same session the password
  // login mints today, and this page never knew which it was.
  { path: 'requests', element: <MyRequests /> },
  // The temporary password login. ⚠️ These four paths go when the host's Isha
  // OIDC lands; `reset/:token` must keep matching `passwordResetUrl` in the
  // API's deps until then.
  { path: 'login', element: <Login /> },
  { path: 'register', element: <Register /> },
  { path: 'forgot', element: <ResetPassword /> },
  { path: 'reset/:token', element: <ResetPassword /> },
  // No token: the "I lost my link" page. With one: the vendor's own portal.
  { path: 'status', element: <AccessLink /> },
  { path: 'status/:token', element: <StatusPage /> },
  // Phase 2 and 3. Each is reached only from a link or a coupon in an email —
  // the token in the path is the whole credential, which is why none of these
  // takes a request id.
  { path: 'bank/:token', element: <BankForm /> },
  { path: 'fssai/:token', element: <FssaiForm /> },
  { path: 'staff', element: <StaffRegistration /> },
  { path: 'staff/:code', element: <StaffRegistration /> },
];

export const stallsBackofficeRoutes: RouteObject[] = [
  { index: true, element: <Landing /> },
  { path: 'requests', element: <Requests /> },
  // Before `requests/:id`, so the static segment is never read as an id.
  { path: 'requests/new', element: <FileRequest /> },
  // One record, one page, hanging one segment under the list — so the back
  // link is the pathname with the id taken off, and the URL is something a
  // coordinator can paste to a colleague.
  { path: 'requests/:id', element: <RequestDetail /> },
  // ⚠️ `/all` WAS the second of two request lists — the triage screen and the
  // pipeline screen, reading the same rows through different presets. They are
  // one screen now, and this is what keeps a bookmark, a pasted link and every
  // `?status=` deep link the Dashboard has ever emitted working.
  { path: 'all', element: <RedirectKeepingQuery to='/m/stalls/requests' /> },
  { path: 'all/:id', element: <RedirectRecord /> },
  { path: 'planning', element: <Planning /> },
  { path: 'communication', element: <Communication /> },
  { path: 'onboarding', element: <Onboarding /> },
  { path: 'electrical', element: <Electrical /> },
  { path: 'checkin', element: <CheckIn /> },
  { path: 'equipment', element: <Equipment /> },
  { path: 'finance', element: <Finance /> },
  // Reports & Dashboards: the hub, and one viewer for any report in the
  // catalog. ⚠️ The viewer takes the key from the URL deliberately — a report is
  // a bookmark somebody sends a colleague, and a screen per report would be
  // eight components that differ only in a string.
  { path: 'dashboards', element: <Dashboards /> },
  { path: 'dashboards/:key', element: <Report /> },
  // Configs: seven tabs, one screen. ⚠️ `/admin` was five of those seven and is
  // in bookmarks and at least one email, so it redirects onto the tab it used to
  // open rather than 404ing.
  { path: 'config', element: <Configs /> },
  { path: 'admin', element: <Navigate to='/m/stalls/config?tab=forms' replace /> },
  // Access: who may reach the module, and what each role may do. Two screens
  // rather than two tabs inside Admin — each is a full page with its own
  // toolbar, and Admin's strip had grown to ten items.
  { path: 'access/roles', element: <RolesPrivileges /> },
  { path: 'access/users', element: <Users /> },
  { path: 'audit', element: <AuditLog /> },
  { path: 'docs', element: <Documentation /> },
];

/**
 * Where a signed-in member lands.
 *
 * 🔴 It is HOME, for everybody. It used to be the Dashboard for anybody holding
 * `requests.read` and the first reachable nav item for everybody else — a
 * fallback that existed because the Dashboard was one fixed screen the API
 * would refuse to fill for a check-in volunteer. Home has no such problem: its
 * cards are resolved per role and each gates itself, so the landing is the same
 * route for every member and the screen itself says what it has for them.
 *
 * ⚠️ Which is why there is no redirect here any more. A caller whose privileges
 * reach no card gets a sentence on Home saying their access was set up with
 * nothing in it — an answer, where a redirect to "the first thing you can open"
 * would have bounced them somewhere arbitrary and told them nothing.
 */
function Landing() {
  return <Home />;
}

/** A permanent move that keeps the query string.
 *
 *  ⚠️ `<Navigate to='/x' />` does NOT carry `?status=SHORTLISTED` across, and
 *  every filter on the request list lives in the query string. A bare Navigate
 *  would land each of the Dashboard's deep links on the unfiltered pipeline —
 *  a redirect that works and silently loses the point of the link. */
function RedirectKeepingQuery({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={{ pathname: to, search }} replace />;
}

/** The same move for one record: `/m/stalls/all/:id` → `/m/stalls/requests/:id`. */
function RedirectRecord() {
  const { id } = useParams();
  return <RedirectKeepingQuery to={`/m/stalls/requests/${id}`} />;
}

export { MeProvider, useMe } from './me';
export { RequesterProvider, useRequester } from './requester';
