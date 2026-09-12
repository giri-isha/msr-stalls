// SHELL — the standalone router. Discarded at migration: the host's router
// mounts `stallsStaffRoutes` under its own /m/stalls and `stallsPublicRoutes`
// under whatever public path it chooses. The two route trees are the module's;
// this file only decides where they hang.
import { Navigate, createBrowserRouter } from 'react-router';
import { stallsPublicRoutes, stallsStaffRoutes } from '@/modules/stalls';
import { PublicLayout } from './PublicLayout';
import { StaffLayout } from './StaffLayout';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to='/stalls/apply' replace /> },
  {
    path: '/stalls',
    element: <PublicLayout />,
    children: stallsPublicRoutes,
  },
  {
    path: '/m/stalls',
    element: <StaffLayout />,
    children: stallsStaffRoutes,
  },
  { path: '*', element: <Navigate to='/stalls/apply' replace /> },
]);
