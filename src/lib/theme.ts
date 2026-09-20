import { useState, useEffect, useCallback } from 'react';
import { ThemeMode } from './types';
import { api } from './tauri';

export const THEME_STORAGE_KEY = 'upsed-theme-mode';
export const LEGACY_THEME_STORAGE_KEY = 'voltwatch-theme-mode';

export function getSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

export function applyTheme(mode: ThemeMode): 'dark' | 'light' {
  const resolved = mode === 'system' ? getSystemTheme() : mode;
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    root.classList.remove('dark', 'light');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
  }
  return resolved;
}

export function useTheme() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system';
    return (
      (localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode) ||
      (localStorage.getItem(LEGACY_THEME_STORAGE_KEY) as ThemeMode) ||
      'system'
    );
  });

  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => {
    const saved = (typeof window !== 'undefined'
      ? localStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(LEGACY_THEME_STORAGE_KEY)
      : null) as ThemeMode || 'system';
    return applyTheme(saved);
  });

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore storage error
    }
    api.setTheme(mode).catch(console.error);
    const resolved = applyTheme(mode);
    setResolvedTheme(resolved);
  }, []);

  // Fetch initial setting from SQLite backend
  useEffect(() => {
    api.getTheme()
      .then((saved) => {
        if (saved && (saved === 'system' || saved === 'dark' || saved === 'light')) {
          setThemeModeState(saved);
          try {
            localStorage.setItem(THEME_STORAGE_KEY, saved);
          } catch {
            // ignore
          }
          const resolved = applyTheme(saved);
          setResolvedTheme(resolved);
        }
      })
      .catch(console.error);
  }, []);

  // Listen to OS system theme changes in real-time when mode is 'system'
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      if (themeMode === 'system') {
        const resolved = applyTheme('system');
        setResolvedTheme(resolved);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [themeMode]);

  return {
    themeMode,
    resolvedTheme,
    setThemeMode,
  };
}

