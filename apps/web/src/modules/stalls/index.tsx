// The module's public surface for a host router: two route trees and a nav
// list. The host mounts `stallsBackofficeRoutes` under its /m/stalls and
// `stallsPublicRoutes` wherever it serves public pages. Nothing here knows
// which shell it is inside.
import type { StallPrivilege } from '@msr/stalls';
import { Navigate, type RouteObject, useLocation, useParams } from 'react-router';
import { AccessLink } from './public/AccessLink';
import { BankForm } from './public/BankForm';
import { FormPicker } from './public/FormPicker';
import { FssaiForm } from './public/FssaiForm';
import { Login } from './public/Login';
import { MyRequests } from './public/MyRequests';
import { Register } from './public/Register';
import { RequestForm } from './public/RequestForm';
import { ResetPassword } from './public/ResetPassword';
import { StaffRegistration } from './public/StaffRegistration';
import { StatusPage } from './public/StatusPage';
import { Submitted } from './public/Submitted';
import { Empty } from './ui';
import { useMe } from './me';
import { Admin } from './backoffice/Admin';
import { RolesPrivileges } from './backoffice/access/RolesPrivileges';
import { Users } from './backoffice/access/Users';
import { CheckIn } from './backoffice/CheckIn';
import { Communication } from './backoffice/Communication';
import { Dashboard } from './backoffice/Dashboard';
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
  { path: 'apply/:type', element: <RequestForm /> },
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
  { path: 'admin', element: <Admin /> },
  // Access: who may reach the module, and what each role may do. Two screens
  // rather than two tabs inside Admin — each is a full page with its own
  // toolbar, and Admin's strip had grown to ten items.
  { path: 'access/roles', element: <RolesPrivileges /> },
  { path: 'access/users', element: <Users /> },
  { path: 'docs', element: <Documentation /> },
];

/**
 * Where a signed-in member lands.
 *
 * 🔴 The Dashboard, for anybody who may read requests — which was everybody,
 * until the check-in and chairs-and-tables volunteer stopped needing
 * `requests.read` to work their own counters. Landing them on a screen the API
 * refuses would make "your access was set up" and "the app is broken"
 * indistinguishable from the first frame.
 *
 * So the landing is the first screen in the nav that this caller can actually
 * open. The nav is already the list of what they may reach, in the order the
 * event runs, so the volunteer lands on Check-in and the electrical team lands
 * on their sheet — without this file knowing either of those facts.
 */
function Landing() {
  const { can } = useMe();
  if (can('requests.read')) return <Dashboard />;

  const first = STALLS_NAV.find((n) => !n.end && navAllows(n, can));
  // ⚠️ Not an error page when there is nothing. A person with a stalls grant
  // that reaches no screen is somebody whose access was set up wrong, and the
  // sentence has to say that rather than blaming them for arriving.
  if (!first) {
    return (
      <Empty>
        Your stalls access does not reach any screen yet. Ask whoever set it up to grant a role with
        something in it.
      </Empty>
    );
  }
  return <Navigate to={first.to} replace />;
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

export interface StallsNavItem {
  label: string;
  to: string;
  /**
   * A NAME from the shared icon registry (`ui/icons.tsx`), never a component.
   *
   * ⚠️ The nav is data the host reads, and a glyph imported here would make
   * this module's route list carry presentation into whatever renders it. An
   * unknown name draws a generic dot rather than throwing, so a typo is visible
   * without being fatal.
   */
  glyph: string;
  group?: string;
  end?: boolean;
  /**
   * Hidden unless the caller holds this action — or, given several, ANY of
   * them.
   *
   * ⚠️ A list, because Planning & Zones is reached by two different people for
   * two different reasons: a coordinator planning stalls holds `planning.read`,
   * and an admin setting the bays and the rate card holds `config.read`. The
   * screen shows each of them only the tabs they hold, so one entry gated on
   * either action is the honest description of it.
   */
  requires?: StallPrivilege | StallPrivilege[];
}

/**
 * Whether a nav item is reachable by someone.
 *
 * 🔴 Takes `can` rather than a privilege LIST, and both readers of the nav go
 * through it. A write implies its read (`IMPLIED_READ` in `@msr/stalls`), so a
 * plain `privileges.includes(...)` hides a screen from the one person it is
 * for — the sidebar did exactly that until this was shared.
 */
export const navAllows = (n: StallsNavItem, can: (a: StallPrivilege) => boolean) =>
  !n.requires || (Array.isArray(n.requires) ? n.requires.some(can) : can(n.requires));

/** The whole of the prototype's nav, grouped by where in the event timeline a
 *  screen is used: requests and selection before the event, onboarding and
 *  money between, operations on the day. */
export const STALLS_NAV: StallsNavItem[] = [
  // ⚠️ Every entry below carries a `requires` now, including the four that
  // carried none. An ungated item is a link to a screen the API then refuses —
  // and since the check-in and chairs-and-tables volunteer stopped holding
  // `requests.read`, three of those four would have been exactly that.
  { label: 'Dashboard', to: '/m/stalls', glyph: 'home', end: true, requires: 'requests.read' },
  // ⚠️ ONE entry, where there were two. "Stall Requests" (triage) and "All
  // Requests" (the pipeline) were the same rows behind two presets, and the
  // split cost a reader the question "which list is my request in?" every time
  // they went looking. The triage preset survives as a filter on this one.
  {
    label: 'All Requests',
    to: '/m/stalls/requests',
    glyph: 'list-view',
    group: 'Requests & Selection',
    requires: 'requests.read',
  },
  {
    label: 'Planning & Zones',
    to: '/m/stalls/planning',
    glyph: 'layers',
    group: 'Requests & Selection',
    // ⚠️ Either action. The bays, the grid's columns, the rates, the charges
    // and the fines are tabs on this screen now rather than on Admin, and they
    // are `config.read` — so an admin who holds no planning action still has a
    // reason to be here, and the screen gates each tab on its own.
    requires: ['planning.read', 'config.read'],
  },
  {
    label: 'Communication',
    to: '/m/stalls/communication',
    glyph: 'megaphone',
    group: 'Onboarding & Money',
    requires: 'comms.read',
  },
  {
    label: 'Vendor Onboarding',
    to: '/m/stalls/onboarding',
    glyph: 'clipboard-list',
    group: 'Onboarding & Money',
    requires: 'onboarding.read',
  },
  {
    label: 'Finance',
    to: '/m/stalls/finance',
    glyph: 'bar-chart',
    group: 'Onboarding & Money',
    requires: 'finance.read',
  },
  {
    label: 'Electrical & Venue',
    to: '/m/stalls/electrical',
    glyph: 'sliders',
    group: 'Event Operations',
    // Its own action, so the electrical and venue-prep teams can be given the
    // sheet without the planning grid and every requester's details with it.
    requires: 'electrical.read',
  },
  {
    label: 'Check-In',
    to: '/m/stalls/checkin',
    glyph: 'circle-check',
    group: 'Event Operations',
    requires: 'checkin.read',
  },
  {
    label: 'Chairs & Tables',
    to: '/m/stalls/equipment',
    glyph: 'layout-grid',
    group: 'Event Operations',
    requires: 'equipment.read',
  },
  {
    label: 'Admin',
    to: '/m/stalls/admin',
    glyph: 'settings',
    group: 'Configuration',
    requires: 'config.read',
  },
  // ⚠️ Gated on `config.read`, not on `roles.write` or `users.write`. Both
  // screens are readable before they are writable — the catalogue is reference
  // material and the directory names who holds what — and each hides its own
  // writes behind the privilege that authorises them.
  {
    label: 'Roles & Privileges',
    to: '/m/stalls/access/roles',
    glyph: 'shield',
    group: 'Access',
    requires: 'config.read',
  },
  {
    label: 'Users',
    to: '/m/stalls/access/users',
    glyph: 'users',
    group: 'Access',
    requires: 'config.read',
  },
  // ⚠️ No `requires`. The manual is the one screen everybody gets: a volunteer
  // who holds only `checkin:write` is exactly the reader who has never seen the
  // rest of the pipeline and most needs to know where their counter sits in it.
  { label: 'Documentation', to: '/m/stalls/docs', glyph: 'file-text', group: 'Help' },
];

export { MeProvider, useMe } from './me';
export { RequesterProvider, useRequester } from './requester';
