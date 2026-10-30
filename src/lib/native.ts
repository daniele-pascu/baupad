import { Capacitor } from '@capacitor/core';

/**
 * Store-App (Android/iOS über Capacitor) erkennen und native Funktionen nutzen. Im Browser und als
 * installierte Web-App ist nichts davon aktiv – die App läuft dort unverändert weiter.
 */

/** Läuft BauPad als Store-App (Android/iOS)? */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/** android | ios | web */
export const nativePlatform = (): string => Capacitor.getPlatform();

/**
 * Foto mit der echten Kamera-App des Geräts aufnehmen (volle Auflösung, HDR, Aufnahmezeit in den Bilddaten).
 * Liefert null, wenn die Person abbricht. Das Plugin wird erst hier geladen (im Browser nie).
 */
export async function nativeTakePhoto(): Promise<File | null> {
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  try {
    const perm = await Camera.checkPermissions();
    if (perm.camera === 'denied' || perm.camera === 'prompt' || perm.camera === 'prompt-with-rationale') {
      const asked = await Camera.requestPermissions({ permissions: ['camera'] });
      if (asked.camera === 'denied') throw new Error('Kamerazugriff wurde nicht erlaubt. Bitte in den Einstellungen des Geräts freigeben.');
    }
    const shot = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri,
      quality: 92,
      correctOrientation: true,
      saveToGallery: false,
      presentationStyle: 'fullscreen',
    });
    if (!shot.webPath) return null;
    const blob = await (await fetch(shot.webPath)).blob();
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15);
    return new File([blob], `BauPad_${stamp}.${shot.format || 'jpg'}`, { type: blob.type || 'image/jpeg', lastModified: now.getTime() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Abbruch durch die Person ist kein Fehler
    if (/cancel|abgebrochen|No image picked/i.test(msg)) return null;
    throw e;
  }
}
