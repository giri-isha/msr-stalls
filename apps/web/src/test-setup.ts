import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

/**
 * `matchMedia`, which jsdom does not implement.
 *
 * ⚠️ Not a convenience. `ui/useBreakpoint.ts` reads the width through
 * `matchMedia` at module scope — deliberately, so the first paint already knows
 * whether it is on a phone rather than flashing the desktop layout and
 * correcting it in an effect — and every screen in the module sits under a
 * component that calls it. Without this stub the import itself throws and the
 * suite fails to collect, with a message about `matchMedia` that names none of
 * the screens it took down.
 *
 * ⚠️ It ANSWERS the query against `window.innerWidth` rather than returning a
 * flat `false`. A stub that always misses puts every test at the narrowest
 * breakpoint — the hook falls through to `'mobile'` when both min-width queries
 * fail — so the pipeline would render as cards and `getByRole('table')` would
 * find nothing, in a suite that never mentioned a viewport. jsdom's window is
 * 1024px wide, so this reports `desktop`, which is the layout these tests were
 * written against; a test wanting the phone layout sets `window.innerWidth` and
 * imports the screen fresh.
 *
 * Only `(min-width: Npx)` is understood, because that is the only form the hook
 * asks. Anything else misses, loudly enough to find in the one place that would
 * need to grow.
 */
if (!window.matchMedia) {
  window.matchMedia = (query: string) => {
    const [, px] = /\(min-width:\s*(\d+)px\)/.exec(query) ?? [];
    return {
      matches: px !== undefined && window.innerWidth >= Number(px),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

/**
 * A clean `localStorage` per test.
 *
 * ⚠️ The module remembers two things across visits — the theme, and whether a
 * given list was last read as rows or as tiles (`ui/useListView.ts`) — and
 * jsdom keeps one storage for a whole FILE. Without this, a test that clicks
 * "Card view" writes a preference that the next test in the file silently
 * inherits, and `getByRole('table')` fails in a test that never touched the
 * toggle. The failure would point at the second test, which is the one place
 * the bug is not.
 */
afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // Not every environment has one; a test that never wrote has none to clear.
  }
});
