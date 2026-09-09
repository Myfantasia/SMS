import { useCallback, useEffect, useState } from 'react';

// Same localStorage key the old vanilla-JS navbar (static/js/navbar.js) used, for
// continuity if a visitor already has a saved preference from before this rewrite.
const STORAGE_KEY = 'theme';

function readStoredMode(): 'light' | 'dark' {
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
}

export function useThemeMode() {
  const [mode, setMode] = useState<'light' | 'dark'>(readStoredMode);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return { mode, toggleMode };
}
