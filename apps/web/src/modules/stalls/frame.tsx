// The module's outer box, and where `.msrs` goes for everything inside it.
//
// This is what makes the scoping in `ui/tokens.css` real: every screen here
// styles with inline objects reading `var(--bg)`, `var(--card)`, `var(--pri)`
// and forty more, none of which the platform defines. They resolve because
// they are inside this element. A screen mounted outside it renders unstyled —
// visible at once, rather than a token quietly falling back to `initial`.
//
// Ported from msr-volunteering's frame.tsx with the class renamed, so both
// modules can sit in the host without either restyling the other.
import '@fontsource-variable/geist';
import '@fontsource-variable/outfit';
import type { ReactNode } from 'react';
import './ui/tokens.css';

export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className='msrs' style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {children}
    </div>
  );
}
