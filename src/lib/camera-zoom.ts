/**
 * Zoom im Kamera-Modus (Browser bzw. App auf dem Home-Bildschirm; die Store-App nutzt die Kamera des Geräts mit
 * deren eigenem Zoom). Was das Handy kann, erkennt die App selbst – in dieser Reihenfolge:
 *  1. Objektive: Meldet der Browser die Kameras mit Namen (iPhone: „Rückseitige Ultraweitwinkelkamera“, „…Telekamera“),
 *     gibt es je Objektiv eine Taste (0,5 · 1× · Tele) – echter optischer Zoom. Wie stark das Tele vergrößert (2×, 3×,
 *     5×), verrät der Browser nicht; die Taste heißt deshalb „Tele“.
 *  2. Zoom der Kamera: Meldet die Kamera einen Zoombereich (viele Android-Handys, z. B. 0,6× bis 10×), stellt die App
 *     ihn direkt ein; viele Handys wechseln dabei selbst auf das Weitwinkel- bzw. Tele-Objektiv.
 *  3. Sonst digital: Ausschnitt des Bildes (bis 4×) – das Foto hat dann entsprechend weniger Pixel.
 * Zwischen den Tasten: mit zwei Fingern ziehen.
 */
export type LensKind = 'front' | 'multi' | 'ultra' | 'tele' | 'wide' | 'other';
export interface Lens {
  id: string;
  label: string;
  kind: LensKind;
}
export interface Lenses {
  ultra?: Lens;
  wide?: Lens;
  tele?: Lens;
}
export interface HwZoom {
  min: number;
  max: number;
  step: number;
}

export const DIGITAL_MAX = 4;
export const DIGITAL_STOPS = [1, 2, 4];

/** Art des Objektivs aus dem Namen (iPhone deutsch/englisch, Android „facing back/front“) */
export function lensKind(label: string): LensKind {
  const l = label.toLowerCase();
  if (/front|vorder|facetime|selfie|user/.test(l)) return 'front';
  if (/dual|triple/.test(l)) return 'multi';
  if (/ultra/.test(l)) return 'ultra';
  if (/tele/.test(l)) return 'tele';
  if (/back|rück|rueck|rear|environment|camera|kamera/.test(l)) return 'wide';
  return 'other';
}

/** Objektive auf der Rückseite – nur, wenn außer dem normalen mindestens Ultraweitwinkel oder Tele erkannt ist */
export function backLenses(devices: { kind: string; deviceId: string; label: string }[]): Lenses {
  const out: Lenses = {};
  for (const d of devices) {
    if (d.kind !== 'videoinput' || !d.label) continue;
    const kind = lensKind(d.label);
    const lens = { id: d.deviceId, label: d.label, kind };
    if ((kind === 'ultra' || kind === 'tele' || kind === 'wide') && !out[kind]) out[kind] = lens;
  }
  return out.wide && (out.ultra || out.tele) ? out : {};
}

/** Tasten für den Zoom der Kamera: kleinster Wert (wenn unter 1), 1 und bis zu drei größere */
export function zoomStops(min: number, max: number): number[] {
  const stops: number[] = [];
  if (min < 0.95) stops.push(Math.round(min * 10) / 10);
  if (min <= 1.001 && max >= 1) stops.push(1);
  let bigger = [2, 3, 5, 10].filter((v) => v <= max + 0.01 && v > min);
  if (bigger.length > 3) bigger = bigger.filter((v) => v !== 3);
  return [...stops, ...bigger];
}

export const clampZoom = (z: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(z * 100) / 100));

/** Zwei-Finger-Zoom: Abstand jetzt ÷ Abstand am Anfang × Zoom am Anfang */
export const pinchZoom = (startZoom: number, startDist: number, dist: number, min: number, max: number) => clampZoom(startZoom * (startDist > 0 ? dist / startDist : 1), min, max);

/** digitaler Zoom: Ausschnitt um die Mitte verkleinern */
export function zoomCrop(crop: { x: number; y: number; w: number; h: number }, z: number) {
  if (z <= 1) return crop;
  const w = crop.w / z;
  const h = crop.h / z;
  return { x: crop.x + (crop.w - w) / 2, y: crop.y + (crop.h - h) / 2, w, h };
}

/** „0,5“, „1×“, „2,4×“ – wie in Kamera-Apps (unter 1 ohne ×) */
export function fmtZoom(z: number): string {
  const r = Math.round(z * 10) / 10;
  const s = String(r).replace('.', ',');
  return r < 1 ? s : `${s}×`;
}
