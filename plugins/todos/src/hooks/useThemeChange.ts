import { useEffect, useRef } from 'react';

const THEME_CHECK_INTERVAL = 1000; // Check every second

export function useThemeChange() {
  const lastThemeRef = useRef<boolean | null>(null);

  useEffect(() => {
    // Initialize the theme
    const initTheme = () => {
      const isDark = window.ztools?.isDarkColors() ?? false;
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
      lastThemeRef.current = isDark;
    };

    // Check for theme changes
    const checkThemeChange = () => {
      const isDark = window.ztools?.isDarkColors() ?? false;
      if (lastThemeRef.current !== isDark) {
        document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
        lastThemeRef.current = isDark;
      }
    };

    // Initialize theme on mount
    initTheme();

    // Set up polling to detect theme changes
    const intervalId = setInterval(checkThemeChange, THEME_CHECK_INTERVAL);

    // Also listen for system theme changes using matchMedia (if available)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      // Only update if ztools is not available or doesn't provide theme info
      if (!window.ztools?.isDarkColors) {
        const isDark = e.matches;
        document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
        lastThemeRef.current = isDark;
      }
    };

    // Add event listener for system theme changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    }

    // Cleanup
    return () => {
      clearInterval(intervalId);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleSystemThemeChange);
      }
    };
  }, []);
}