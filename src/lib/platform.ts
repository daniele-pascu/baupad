import { useSyncExternalStore } from 'react';
import { isNativeApp } from './native';

/** Als App vom Home-Bildschirm gestartet (iOS/Android/Desktop-PWA) oder Store-App? Nur dort gibt es den Kamera-Modus. */
export const isInstalledApp = (): boolean =>
  typeof window !== 'undefined' && (isNativeApp() || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Handy/Tablet (grober Zeiger): dort gibt es keinen Knopf „Auswahl“ – ein benutztes Werkzeug endet mit dem nächsten Fingertipp ins Leere */
export const isTouchDevice = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

/** Handy-Breite (bis 600 px): folgt dem Drehen des Geräts */
const PHONE = '(max-width: 600px)';
export const usePhone = (): boolean =>
  useSyncExternalStore(
    (l) => {
      const q = matchMedia(PHONE);
      q.addEventListener('change', l);
      return () => q.removeEventListener('change', l);
    },
    () => matchMedia(PHONE).matches,
    () => false,
  );
