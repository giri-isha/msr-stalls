import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import { UpdateToast } from './app/UpdateToast';
import './index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');

// ⚠️ No toast host here. The module ships its own (`ui/components/Toast.tsx`)
// and `BackofficeLayout` mounts it above the gate, so a confirmation outlives the
// screen that raised it. Mounting a second one at the root would put two
// notification stacks on the same page — which is what the `sonner` <Toaster>
// that stood here became the moment the module took the shared design system.
// ⚠️ `UpdateToast` sits OUTSIDE the router, deliberately. A waiting service
// worker is a fact about the tab, not about the screen — and a coordinator
// should be told about it wherever they happen to be, including on the public
// side, rather than only once they navigate to a route that mounts it.
createRoot(el).render(
  <StrictMode>
    <RouterProvider router={router} />
    <UpdateToast />
  </StrictMode>,
);
