import { isHostDarkColors } from './host.js';

export const THEME_STORAGE_KEY = 'image-toolbox-theme';
export const THEME_VERSION_KEY = 'image-toolbox-theme-version';
export const THEME_VERSION = 'neutral-teal-light-default-v1';

export const THEME_CHOICES = {
  SYSTEM: 'system',
  LIGHT: 'light',
  DARK: 'dark',
};

const VALID_THEME_CHOICES = new Set(Object.values(THEME_CHOICES));
let systemThemeListenerBound = false;

export function initTheme() {
  applyThemeChoice(getThemeChoice(), false);
  bindSystemThemeListener();
}

export function getThemeChoice() {
  const savedVersion = localStorage.getItem(THEME_VERSION_KEY);
  let savedTheme = localStorage.getItem(THEME_STORAGE_KEY);

  if (savedVersion !== THEME_VERSION) {
    savedTheme = THEME_CHOICES.LIGHT;
    localStorage.setItem(THEME_STORAGE_KEY, savedTheme);
    localStorage.setItem(THEME_VERSION_KEY, THEME_VERSION);
  } else if (!VALID_THEME_CHOICES.has(savedTheme)) {
    savedTheme = THEME_CHOICES.LIGHT;
  }

  return savedTheme;
}

export function applyThemeChoice(choice, persist = true) {
  const themeChoice = VALID_THEME_CHOICES.has(choice) ? choice : THEME_CHOICES.LIGHT;

  if (persist) {
    localStorage.setItem(THEME_STORAGE_KEY, themeChoice);
    localStorage.setItem(THEME_VERSION_KEY, THEME_VERSION);
  }

  document.documentElement.setAttribute('data-theme-preference', themeChoice);
  document.documentElement.setAttribute('data-theme', resolveTheme(themeChoice));
}

function resolveTheme(choice) {
  if (choice === THEME_CHOICES.SYSTEM) {
    return getSystemTheme();
  }

  return choice;
}

function getSystemTheme() {
  const hostDark = isHostDarkColors();
  if (hostDark !== null) {
    return hostDark ? THEME_CHOICES.DARK : THEME_CHOICES.LIGHT;
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? THEME_CHOICES.DARK
      : THEME_CHOICES.LIGHT;
  }

  return THEME_CHOICES.LIGHT;
}

function bindSystemThemeListener() {
  if (systemThemeListenerBound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (getThemeChoice() === THEME_CHOICES.SYSTEM) {
      applyThemeChoice(THEME_CHOICES.SYSTEM, false);
    }
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', handleChange);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(handleChange);
  }

  systemThemeListenerBound = true;
}
