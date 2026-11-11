import { useSyncExternalStore } from 'react';

/**
 * Eigene Farben (frei gewählt): werden je Gerät gespeichert und erscheinen danach neben den Standardfarben
 * (Darstellung, Text). Höchstens 8 – die älteste fällt heraus.
 */
const KEY = 'customColors';
const MAX = 8;
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    cache = Array.isArray(v) ? v.filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) : [];
  } catch {
    cache = [];
  }
  return cache;
}

export function addCustomColor(color: string, standard: string[] = []) {
  const c = color.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(c) || standard.includes(c)) return;
  const next = [c, ...read().filter((x) => x !== c)].slice(0, MAX);
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* optional */
  }
  listeners.forEach((l) => l());
}

export function removeCustomColor(color: string) {
  cache = read().filter((x) => x !== color.toLowerCase());
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* optional */
  }
  listeners.forEach((l) => l());
}

export function useCustomColors(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => [],
  );
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** frei gewählte Farbe merken, sobald die Auswahl kurz ruht (der Farbwähler meldet jede Zwischenfarbe) */
export function rememberCustomColorSoon(color: string, standard: string[] = []) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => addCustomColor(color, standard), 900);
}
