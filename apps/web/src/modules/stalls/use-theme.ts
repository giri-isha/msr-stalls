import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/** The host's key, so a module mounted inside it inherits the choice rather
 *  than keeping a second one that disagrees. */
const STORAGE_KEY = 'stalls-theme';

function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * Reads and writes the app theme.
 *
 * ⚠️ The DOM is the source of truth, not this hook's state. The initial `.dark`
 * class is set by the inline script in `index.html` before paint, so reading it
 * back is what keeps the two in step — a `useState('light')` initial value would
 * paint one wrong frame on every load in dark mode.
 *
 * SHELL — at migration the host owns the theme and this file goes with the rest
 * of `app/`. What survives is that the module's tokens follow `.dark` on
 * `<html>` (`ui/tokens.css`) rather than carrying a theme of their own, so
 * whatever owns the class owns the palette.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document === 'undefined' ? 'light' : currentTheme(),
  );

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode, or storage disabled. The choice still applies to this
      // visit; only remembering it is lost.
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  // Keep in step if another tab changes the theme.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        document.documentElement.classList.toggle('dark', e.newValue === 'dark');
        setThemeState(currentTheme());
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return { theme, setTheme, toggle };
}
