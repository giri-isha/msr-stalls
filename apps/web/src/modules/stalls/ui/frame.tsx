// The module's outer box, and where `.stalls` goes for everything inside a route.
//
// ── PROVENANCE ──
// This whole `ui/` folder is the MSR Volunteering module's design system,
// copied across so the two modules read as one product. The files are
// near-verbatim; what changed is the token SCOPE — `.msrv` became `.stalls`, and
// the utility classes and keyframes with it (`stalls-lift`, `stalls-icon-btn`,
// `stalls-shimmer`, `@keyframes stalls-*`).
//
// ⚠️ The rename is not cosmetic. Both modules are destined for the same host
// shell, and two sheets declaring the same class on `:root`-adjacent selectors
// would fight over one palette the moment either side is retuned. Each module
// owns its own scope. If these are ever merged into a shared platform sheet,
// that is the change to make — not a second copy under a third name.
//
// ⚠️ It is NOT the only place the class is applied, and the exception is worth
// knowing: `components/Toast.tsx` puts `stalls` on its own host too, because that
// host is mounted above the router (so a confirmation outlives its screen) and
// therefore renders OUTSIDE this element. The rule is the general one — anything
// this module renders outside the route tree has to carry the token scope with
// it, or its `var(--…)` reads resolve to nothing.
//
// ⚠️ It is what makes the scoping in `tokens.css` real. The module's screens
// are inline styles reading `var(--bg)`, `var(--card)`, `var(--pri)` and forty
// more — none of which a host defines. Every one of them resolves because it is
// inside this element. A screen mounted outside it renders unstyled, which is
// the failure mode we want: visible immediately, rather than a token quietly
// falling back to `initial`.
import type { ReactNode } from 'react';
// The display face, imported here rather than in the app entry so the
// @font-face CSS travels with this module's chunk. Self-hosted rather than a
// Google Fonts link: the host's CSP is `font-src 'self'`, so a CDN file would
// never load in production.
//
// ⚠️ Outfit for headings, Geist for everything else — a geometric sans against
// a neutral one. Both subsets of Outfit are kept on purpose: `latin-ext` covers
// the diacritics a requester's name can carry into a page heading.
import '@fontsource-variable/geist';
import '@fontsource-variable/outfit';
import './tokens.css';

/** Wraps a module screen. `flex:1` so it fills the shell's route slot. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className='stalls'
      style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      {children}
    </div>
  );
}
