// SHELL — the standalone router. Discarded at migration: the host's router
// mounts `stallsBackofficeRoutes` under its own /m/stalls and `stallsPublicRoutes`
// under whatever public path it chooses. The two route trees are the module's;
// this file only decides where they hang.
import { Navigate, createBrowserRouter } from 'react-router';
import { stallsPublicRoutes, stallsBackofficeRoutes } from '@/modules/stalls';
import { PublicLayout } from './PublicLayout';
import { BackofficeLayout } from './BackofficeLayout';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to='/stalls/apply' replace /> },
  {
    path: '/stalls',
    element: <PublicLayout />,
    children: stallsPublicRoutes,
  },
  {
    path: '/m/stalls',
    element: <BackofficeLayout />,
    children: stallsBackofficeRoutes,
  },
  { path: '*', element: <Navigate to='/stalls/apply' replace /> },
]);
