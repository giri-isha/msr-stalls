import '@testing-library/jest-dom/vitest';

// The module's `useBreakpoint` reads `window.matchMedia` at import time, as
// the volunteering module's does. jsdom has no implementation, so every screen
// test needs this stand-in. Desktop is reported (no query matches) so tables
// render as tables rather than as row cards: every `min-width` query matches.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: /min-width/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
