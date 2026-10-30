import { isNativeApp } from './native';

/** Als App vom Home-Bildschirm gestartet (iOS/Android/Desktop-PWA) oder Store-App? Nur dort gibt es den Kamera-Modus. */
export const isInstalledApp = (): boolean =>
  typeof window !== 'undefined' && (isNativeApp() || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
