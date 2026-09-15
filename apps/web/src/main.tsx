import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './app/router';
import './index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing');

// ⚠️ No toast host here. The module ships its own (`ui/components/Toast.tsx`)
// and `BackofficeLayout` mounts it above the gate, so a confirmation outlives the
// screen that raised it. Mounting a second one at the root would put two
// notification stacks on the same page — which is what the `sonner` <Toaster>
// that stood here became the moment the module took the shared design system.
createRoot(el).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
