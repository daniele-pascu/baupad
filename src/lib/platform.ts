/** Als App vom Home-Bildschirm gestartet (iOS/Android/Desktop-PWA)? Nur dort gibt es den Kamera-Modus. */
export const isInstalledApp = (): boolean =>
  typeof window !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
