// The module's public surface for a host router: two route trees, a nav list,
// and the providers a host must wrap the staff tree in. The host mounts
// `stallsStaffRoutes` under its /m/stalls and `stallsPublicRoutes` wherever it
// serves public pages. Nothing here knows which shell it is inside.
import type { StallAction } from '@msr/stalls';
import { Navigate, type RouteObject } from 'react-router';
import { BankForm } from './public/BankForm';
import { FormPicker } from './public/FormPicker';
import { FssaiUpload } from './public/FssaiUpload';
import { RequestForm } from './public/RequestForm';
import { StaffPage } from './public/StaffPage';
import { StatusPage } from './public/StatusPage';
import { Submitted } from './public/Submitted';
import { Admin } from './staff/Admin';
import { CheckIn } from './staff/CheckIn';
import { Communication } from './staff/Communication';
import { Dashboard } from './staff/Dashboard';
import { Electrical } from './staff/Electrical';
import { Finance } from './staff/Finance';
import { Furniture } from './staff/Furniture';
import { Onboarding } from './staff/Onboarding';
import { Planning } from './staff/Planning';
import { Refunds } from './staff/Refunds';
import { Requests } from './staff/Requests';

export const stallsPublicRoutes: RouteObject[] = [
  { index: true, element: <Navigate to='apply' replace /> },
  { path: 'apply', element: <FormPicker /> },
  { path: 'apply/:type', element: <RequestForm /> },
  { path: 'submitted', element: <Submitted /> },
  { path: 'status/:token', element: <StatusPage /> },
  { path: 'bank/:token', element: <BankForm /> },
  { path: 'fssai/:token', element: <FssaiUpload /> },
  { path: 'staff/:token', element: <StaffPage /> },
];

export const stallsStaffRoutes: RouteObject[] = [
  { index: true, element: <Dashboard /> },
  { path: 'requests', element: <Requests mode='triage' /> },
  { path: 'all', element: <Requests mode='all' /> },
  { path: 'planning', element: <Planning /> },
  { path: 'comms', element: <Communication /> },
  { path: 'onboarding', element: <Onboarding /> },
  { path: 'finance', element: <Finance /> },
  { path: 'electrical', element: <Electrical /> },
  { path: 'checkin', element: <CheckIn /> },
  { path: 'furniture', element: <Furniture /> },
  { path: 'refunds', element: <Refunds /> },
  { path: 'admin', element: <Admin /> },
];

export interface StallsNavItem {
  label: string;
  to: string;
  icon: string;
  group?: string;
  end?: boolean;
  /** Hidden unless the caller holds this action. */
  requires?: StallAction;
}

/** The prototype's nav, in its groups. */
export const STALLS_NAV: StallsNavItem[] = [
  { label: 'Dashboard', to: '/m/stalls', icon: 'home', end: true },
  { label: 'Stall Requests', to: '/m/stalls/requests', icon: 'clipboard-list', group: 'Requests & Selection' },
  { label: 'All Requests', to: '/m/stalls/all', icon: 'list-view', group: 'Requests & Selection' },
  { label: 'Planning & Zones', to: '/m/stalls/planning', icon: 'layout-grid', group: 'Requests & Selection', requires: 'planning:read' },
  { label: 'Communication', to: '/m/stalls/comms', icon: 'megaphone', group: 'Vendor Operations', requires: 'comms:write' },
  { label: 'Vendor Onboarding', to: '/m/stalls/onboarding', icon: 'users', group: 'Vendor Operations' },
  { label: 'Electrical & Venue', to: '/m/stalls/electrical', icon: 'layers', group: 'Vendor Operations', requires: 'planning:read' },
  { label: 'Check-in', to: '/m/stalls/checkin', icon: 'log-in', group: 'Vendor Operations' },
  { label: 'Chairs & Tables', to: '/m/stalls/furniture', icon: 'check-square', group: 'Vendor Operations' },
  { label: 'Finance', to: '/m/stalls/finance', icon: 'file-text', group: 'Money', requires: 'finance:read' },
  { label: 'Refunds', to: '/m/stalls/refunds', icon: 'arrow-left-right', group: 'Money', requires: 'finance:read' },
  { label: 'Admin', to: '/m/stalls/admin', icon: 'settings', group: 'Configuration', requires: 'config:read' },
];

export { Frame } from './frame';
export { MeProvider, useMe } from './me';
export { ToastProvider, useToast } from './ui/components/Toast';
export { Icon } from './ui/icons';
