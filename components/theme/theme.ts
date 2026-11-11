/**
 * Theme handling (replaces next-themes, whose client-rendered inline script triggers React 19
 * warnings). Light is the default regardless of the OS setting; an explicit choice is stored
 * in localStorage and applied by a tiny blocking script before first paint, so there is no
 * flash of the wrong theme.
 */

export const THEME_STORAGE_KEY = 'p2h-theme';
export type Theme = 'light' | 'dark';

/** Runs in <head> before paint. Must stay dependency-free and tiny. */
export const themeInitScript = `(function(){var t='light';try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');if(s==='dark'||s==='light')t=s}catch(e){}document.documentElement.dataset.theme=t})()`;

export function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still applies for this page view.
  }
}
