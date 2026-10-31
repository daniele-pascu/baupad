import { isNativeApp } from './native';

/** Als App vom Home-Bildschirm gestartet (iOS/Android/Desktop-PWA) oder Store-App? Nur dort gibt es den Kamera-Modus. */
export const isInstalledApp = (): boolean =>
  typeof window !== 'undefined' && (isNativeApp() || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/** Handy/Tablet (grober Zeiger): dort gibt es keinen Knopf „Auswahl“ – ein benutztes Werkzeug endet mit dem nächsten Fingertipp ins Leere */
export const isTouchDevice = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
