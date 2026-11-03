import { useEffect, useLayoutEffect, useState } from 'react';

/** Darstellung der App (je Gerät): Größe von Schrift und Bedienelementen sowie hell/dunkel */
export type UiSize = 'small' | 'medium' | 'large';
export type UiTheme = 'light' | 'dark' | 'system';

const SIZE_KEY = 'uiSize';
const THEME_KEY = 'uiTheme';
const EVENT = 'appearance-change';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export const getUiSize = (): UiSize => read(SIZE_KEY, ['small', 'medium', 'large'] as const, 'medium');
export const getUiTheme = (): UiTheme => read(THEME_KEY, ['light', 'dark', 'system'] as const, 'light');

export function setUiSize(v: UiSize) {
  try {
    localStorage.setItem(SIZE_KEY, v);
  } catch {
    /* optional */
  }
  window.dispatchEvent(new Event(EVENT));
}
export function setUiTheme(v: UiTheme) {
  try {
    localStorage.setItem(THEME_KEY, v);
  } catch {
    /* optional */
  }
  window.dispatchEvent(new Event(EVENT));
}

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);
const VIEWPORT_SITE = 'width=device-width, initial-scale=1, viewport-fit=cover';
/** App: feste Größe – kein Vergrößern mit zwei Fingern und kein automatisches Zoomen in Eingabefelder */
const VIEWPORT_APP = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

/** Darstellung auf die Seite anwenden; nur in der App (die Website behält ihr eigenes Design und Zoom) */
export function applyAppearance(isApp: boolean) {
  const html = document.documentElement;
  const meta = document.querySelector('meta[name="viewport"]');
  if (!isApp) {
    delete html.dataset.size;
    delete html.dataset.theme;
    html.classList.remove('app-fixed');
    meta?.setAttribute('content', VIEWPORT_SITE);
    return;
  }
  const theme = getUiTheme();
  const dark = theme === 'dark' || (theme === 'system' && !!darkQuery()?.matches);
  html.dataset.size = getUiSize();
  html.dataset.theme = dark ? 'dark' : 'light';
  html.classList.add('app-fixed');
  meta?.setAttribute('content', VIEWPORT_APP);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#0a0a0b');
}

/** Wendet die Darstellung an und folgt Änderungen (Einstellungen, System hell/dunkel) */
export function useAppearance(isApp: boolean) {
  useLayoutEffect(() => {
    const apply = () => applyAppearance(isApp);
    apply();
    const q = darkQuery();
    window.addEventListener(EVENT, apply);
    q?.addEventListener?.('change', apply);
    // Safari: Vergrößern mit zwei Fingern auf der Seite sperren (Pläne zoomen selbst über Zeiger-Ereignisse)
    const block = (e: Event) => isApp && e.preventDefault();
    document.addEventListener('gesturestart', block);
    return () => {
      window.removeEventListener(EVENT, apply);
      q?.removeEventListener?.('change', apply);
      document.removeEventListener('gesturestart', block);
    };
  }, [isApp]);
}

/** aktuelle Einstellungen für die Einstellungsseite */
export function useAppearanceSettings() {
  const [state, setState] = useState(() => ({ size: getUiSize(), theme: getUiTheme() }));
  useEffect(() => {
    const on = () => setState({ size: getUiSize(), theme: getUiTheme() });
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return state;
}
