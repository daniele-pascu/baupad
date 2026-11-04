/**
 * Blitz für die Kamera im Browser (Live-Bild): Aus, Auto, An. Browser kennen keinen echten Blitz, nur die
 * Lampe („torch“, v. a. Android/Chrome). An = Lampe dauerhaft an (auch fürs Vorschaubild); Auto = bei
 * dunklem Bild kurz beim Auslösen; Aus = nie. iPhone/Safari kann die Lampe im Browser nicht schalten –
 * dort hat die Kamera des Geräts (Store-App bzw. „Gerätekamera“) den eigenen Blitz (Auto/An/Aus).
 */
export type FlashMode = 'off' | 'auto' | 'on';

export const FLASH_LABEL: Record<FlashMode, string> = { off: 'Aus', auto: 'Auto', on: 'An' };
export const nextFlash = (m: FlashMode): FlashMode => (m === 'off' ? 'auto' : m === 'auto' ? 'on' : 'off');

export function loadFlash(): FlashMode {
  try {
    const v = localStorage.getItem('camFlash');
    return v === 'on' || v === 'auto' ? v : 'off';
  } catch {
    return 'off';
  }
}
export function saveFlash(m: FlashMode) {
  try {
    localStorage.setItem('camFlash', m);
  } catch {
    /* egal */
  }
}

export const torchSupported = (track: MediaStreamTrack | null | undefined) => !!(track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch;

export async function setTorch(track: MediaStreamTrack | null | undefined, on: boolean): Promise<boolean> {
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

/** Ist das Vorschaubild dunkel? (mittlere Helligkeit eines kleinen Abbilds) */
export function isDark(v: HTMLVideoElement): boolean {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 24;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g || !v.videoWidth) return false;
  g.drawImage(v, 0, 0, 32, 24);
  const d = g.getImageData(0, 0, 32, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4) < 70;
}

/**
 * Vor dem Auslösen: bei Auto und dunklem Bild die Lampe kurz einschalten (Belichtung passt sich an).
 * Liefert eine Funktion, die nach der Aufnahme wieder ausschaltet.
 */
export async function flashBeforeShot(mode: FlashMode, track: MediaStreamTrack | null | undefined, v: HTMLVideoElement): Promise<() => void> {
  if (mode !== 'auto' || !torchSupported(track) || !isDark(v)) return () => undefined;
  if (!(await setTorch(track, true))) return () => undefined;
  await new Promise((r) => setTimeout(r, 450));
  return () => void setTorch(track, false);
}

export const FLASH_HINT = 'Blitz/Lampe lässt sich in diesem Browser nicht schalten (z. B. iPhone/Safari). Tipp: „Gerätekamera“ benutzen – dort Blitz Auto/An/Aus.';
