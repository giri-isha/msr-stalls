// The module's public surface for a host router: two route trees and a nav
// list. The host mounts `stallsStaffRoutes` under its /m/stalls and
// `stallsPublicRoutes` wherever it serves public pages. Nothing here knows
// which shell it is inside.
import type { StallAction } from '@msr/stalls';
import { Navigate, type RouteObject } from 'react-router';
import { AccessLink } from './public/AccessLink';
import { BankForm } from './public/BankForm';
import { FormPicker } from './public/FormPicker';
import { FssaiForm } from './public/FssaiForm';
import { RequestForm } from './public/RequestForm';
import { StaffRegistration } from './public/StaffRegistration';
import { StatusPage } from './public/StatusPage';
import { Submitted } from './public/Submitted';
import { Admin } from './staff/Admin';
import { CheckIn } from './staff/CheckIn';
import { Communication } from './staff/Communication';
import { Dashboard } from './staff/Dashboard';
import { Documentation } from './staff/Documentation';
import { Electrical } from './staff/Electrical';
import { Equipment } from './staff/Equipment';
import { Finance } from './staff/Finance';
import { Onboarding } from './staff/Onboarding';
import { Planning } from './staff/Planning';
import { Requests } from './staff/Requests';

export const stallsPublicRoutes: RouteObject[] = [
  { index: true, element: <Navigate to='apply' replace /> },
  { path: 'apply', element: <FormPicker /> },
  { path: 'apply/:type', element: <RequestForm /> },
  { path: 'submitted', element: <Submitted /> },
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

export const stallsStaffRoutes: RouteObject[] = [
  { index: true, element: <Dashboard /> },
  { path: 'requests', element: <Requests mode='triage' /> },
  { path: 'all', element: <Requests mode='all' /> },
  { path: 'planning', element: <Planning /> },
  { path: 'communication', element: <Communication /> },
  { path: 'onboarding', element: <Onboarding /> },
  { path: 'electrical', element: <Electrical /> },
  { path: 'checkin', element: <CheckIn /> },
  { path: 'equipment', element: <Equipment /> },
  { path: 'finance', element: <Finance /> },
  { path: 'admin', element: <Admin /> },
  { path: 'docs', element: <Documentation /> },
];

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
  /** Hidden unless the caller holds this action. */
  requires?: StallAction;
}

/** The whole of the prototype's nav, grouped by where in the event timeline a
 *  screen is used: requests and selection before the event, onboarding and
 *  money between, operations on the day. */
export const STALLS_NAV: StallsNavItem[] = [
  { label: 'Dashboard', to: '/m/stalls', glyph: 'home', end: true },
  {
    label: 'Stall Requests',
    to: '/m/stalls/requests',
    glyph: 'clipboard-list',
    group: 'Requests & Selection',
  },
  { label: 'All Requests', to: '/m/stalls/all', glyph: 'list-view', group: 'Requests & Selection' },
  {
    label: 'Planning & Zones',
    to: '/m/stalls/planning',
    glyph: 'layers',
    group: 'Requests & Selection',
    requires: 'planning:read',
  },
  {
    label: 'Communication',
    to: '/m/stalls/communication',
    glyph: 'megaphone',
    group: 'Onboarding & Money',
    requires: 'comms:write',
  },
  {
    label: 'Vendor Onboarding',
    to: '/m/stalls/onboarding',
    glyph: 'clipboard-list',
    group: 'Onboarding & Money',
  },
  {
    label: 'Finance',
    to: '/m/stalls/finance',
    glyph: 'bar-chart',
    group: 'Onboarding & Money',
    requires: 'finance:read',
  },
  {
    label: 'Electrical & Venue',
    to: '/m/stalls/electrical',
    glyph: 'sliders',
    group: 'Event Operations',
    // Its own action, so the electrical and venue-prep teams can be given the
    // sheet without the planning grid and every requester's details with it.
    requires: 'electrical:read',
  },
  {
    label: 'Check-in',
    to: '/m/stalls/checkin',
    glyph: 'circle-check',
    group: 'Event Operations',
  },
  {
    label: 'Chairs & Tables',
    to: '/m/stalls/equipment',
    glyph: 'layout-grid',
    group: 'Event Operations',
  },
  {
    label: 'Admin',
    to: '/m/stalls/admin',
    glyph: 'settings',
    group: 'Configuration',
    requires: 'config:read',
  },
  // ⚠️ No `requires`. The manual is the one screen everybody gets: a volunteer
  // who holds only `checkin:write` is exactly the reader who has never seen the
  // rest of the pipeline and most needs to know where their counter sits in it.
  { label: 'Documentation', to: '/m/stalls/docs', glyph: 'file-text', group: 'Help' },
];

export { MeProvider, useMe } from './me';
