import { useCallback, useEffect, useState } from 'react';

// Separate from the public site's own 'theme' key (public/theme/useThemeMode.ts) — a school
// admin's dashboard preference isn't the same setting as a visitor's marketing-site preference.
const STORAGE_KEY = 'dashboard-theme';

function readStoredMode(): 'light' | 'dark' {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  // No explicit choice yet -- default to the OS/browser preference instead of
  // hardcoding light, so a dark-mode user isn't greeted with a light flash on first visit.
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useDashboardThemeMode() {
  const [mode, setMode] = useState<'light' | 'dark'>(readStoredMode);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  return { mode, toggleMode };
}
