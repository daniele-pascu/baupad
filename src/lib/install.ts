import { useSyncExternalStore } from 'react';
import { isNativeApp } from './native';

/**
 * BauPad als App installieren (PWA): Android und PC (Chrome/Edge) bieten einen eigenen
 * Installationsdialog an („beforeinstallprompt“), iPhone/iPad nur „Zum Home-Bildschirm“ in Safari.
 * Ist BauPad installiert (eigenes Fenster), gibt es nichts mehr zu tun.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Platform = 'ios' | 'android' | 'desktop';
export type Browser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'other';

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Läuft BauPad als installierte App (eigenes Fenster bzw. Home-Bildschirm)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    installed ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function platform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS meldet sich als Mac – erkennbar an der Touch-Bedienung
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function browser(): Browser {
  const ua = navigator.userAgent;
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
  if (/CriOS|Chrome/i.test(ua)) return 'chrome';
  if (/Safari/i.test(ua)) return 'safari';
  return 'other';
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // eigener Knopf statt der Browser-Leiste
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    emit();
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', emit);
}

/** Installationsdialog des Browsers öffnen; false = nicht verfügbar (Anleitung zeigen) */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  emit();
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') installed = true;
  emit();
  return outcome;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
let snapshot = { standalone: false, canPrompt: false };
const getSnapshot = () => {
  const next = { standalone: isStandalone() || isNativeApp(), canPrompt: !!deferred };
  if (next.standalone !== snapshot.standalone || next.canPrompt !== snapshot.canPrompt) snapshot = next;
  return snapshot;
};

/** Zustand für die Oberfläche: installiert? direkter Installationsdialog möglich? */
export function useInstallState(): { standalone: boolean; canPrompt: boolean } {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Speicherstatus: Browser bestätigt dauerhafte Speicherung (Daten werden nicht automatisch gelöscht) */
export async function storageStatus(): Promise<{ persisted: boolean; usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { persisted: (await navigator.storage.persisted?.()) ?? false, usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
