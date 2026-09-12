// The module's public surface for a host router: two route trees and a nav
// list. The host mounts `stallsStaffRoutes` under its /m/stalls and
// `stallsPublicRoutes` wherever it serves public pages. Nothing here knows
// which shell it is inside.
import type { StallAction } from '@msr/stalls';
import { Navigate, type RouteObject } from 'react-router';
import { FormPicker } from './public/FormPicker';
import { RequestForm } from './public/RequestForm';
import { StatusPage } from './public/StatusPage';
import { Submitted } from './public/Submitted';
import { Admin } from './staff/Admin';
import { Dashboard } from './staff/Dashboard';
import { Planning } from './staff/Planning';
import { Requests } from './staff/Requests';

export const stallsPublicRoutes: RouteObject[] = [
  { index: true, element: <Navigate to='apply' replace /> },
  { path: 'apply', element: <FormPicker /> },
  { path: 'apply/:type', element: <RequestForm /> },
  { path: 'submitted', element: <Submitted /> },
  { path: 'status/:token', element: <StatusPage /> },
];

export const stallsStaffRoutes: RouteObject[] = [
  { index: true, element: <Dashboard /> },
  { path: 'requests', element: <Requests mode='triage' /> },
  { path: 'all', element: <Requests mode='all' /> },
  { path: 'planning', element: <Planning /> },
  { path: 'admin', element: <Admin /> },
];

export interface StallsNavItem {
  label: string;
  to: string;
  group?: string;
  end?: boolean;
  /** Hidden unless the caller holds this action. */
  requires?: StallAction;
}

/** The prototype's nav, Phase 1 entries only. Phase 2 and 3 add
 *  Communication, Onboarding, Electrical & Venue, Check-in, Chairs & Tables
 *  and Finance here as they land. */
export const STALLS_NAV: StallsNavItem[] = [
  { label: 'Dashboard', to: '/m/stalls', end: true },
  { label: 'Stall Requests', to: '/m/stalls/requests', group: 'Requests & Selection' },
  { label: 'All Requests', to: '/m/stalls/all', group: 'Requests & Selection' },
  {
    label: 'Planning & Zones',
    to: '/m/stalls/planning',
    group: 'Requests & Selection',
    requires: 'planning:read',
  },
  { label: 'Admin', to: '/m/stalls/admin', group: 'Configuration', requires: 'config:read' },
];

export { MeProvider, useMe } from './me';
