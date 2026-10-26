import { isDrawingPlan, shapeInfo, shapeToMeters, unitsPerMeter } from './drawing';
import { isOpenShape } from './geometry';
import { formatMeasure } from './numbers';
import { PT_PER_M } from './scale-detect';
import type { Plan, Shape } from './types';

/**
 * Maßstab eines Plans: Seiteneinheiten je Meter. Gezeichnete Pläne haben ihn immer, importierte
 * nur nach einer Kalibrierung über eine bekannte Strecke (sonst null – Maße werden eingegeben).
 */
export function planUnitsPerMeter(plan: Plan): number | null {
  if (isDrawingPlan(plan)) return unitsPerMeter(plan);
  const c = plan.calibration;
  if (!c || !(c.meters > 0)) return null;
  const d = Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);
  return d > 0 ? d / c.meters : null;
}

/**
 * Fläche (m²) und Umfang (m) einer geschlossenen Markierung aus der Plangeometrie – Rechteck,
 * Kreis/Ellipse, Dreieck, Polygon. null bei offenen Formen oder ohne Maßstab.
 */
export function geometryMeasures(shape: Shape, k: number | null): { area: number; perimeter: number; formula: string } | null {
  if (!k || isOpenShape(shape)) return null;
  const s = shapeToMeters(shape, k);
  const info = shapeInfo({ type: s.type, shape: s });
  if (!info || info.area === null) return null;
  const formula =
    s.type === 'rect' ? 'Länge × Breite' : s.type === 'ellipse' ? (Math.abs(s.w - s.h) < 1e-9 ? 'π · r²' : 'π · a · b') : 'Polygonfläche aus den Eckpunkten';
  return { area: Math.round(info.area * 10000) / 10000, perimeter: Math.round(info.perimeter * 10000) / 10000, formula };
}

export type CalibrationState = 'none' | 'auto' | 'confirmed' | 'manual';

/** Abweichung der Prüfstrecke (gemessen/Soll − 1), null ohne Prüfung */
export function checkDeviation(plan: Plan): number | null {
  const c = plan.calibration?.check;
  return c && c.expected > 0 ? c.measured / c.expected - 1 : null;
}

/** Prozent mit Vorzeichen, z. B. „+0,4 %“ */
export function formatPercent(v: number): string {
  const r = Math.round(v * 1000) / 10; // auf 0,1 % gerundet – „−0,0 %“ vermeiden
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/**
 * Stand der Kalibrierung eines importierten Plans – klar getrennt: automatisch erkannt (noch
 * zu prüfen), automatisch erkannt und bestätigt, selbst kalibriert, nicht kalibriert.
 */
export function calibrationStatus(plan: Plan, kind: 'pdf' | 'image' | undefined): { state: CalibrationState; short: string; text: string; warn: boolean } {
  const c = plan.calibration;
  const upm = planUnitsPerMeter(plan);
  if (!c || !upm) return { state: 'none', short: 'Nicht kalibriert', text: 'Nicht kalibriert – Maße werden eingegeben, Flächen nicht aus dem Plan berechnet.', warn: true };
  const dev = checkDeviation(plan);
  const checkText = dev === null ? '' : ` · Prüfstrecke ${formatMeasure(c.check!.expected)} m: Abweichung ${formatPercent(dev)}`;
  const badCheck = dev !== null && Math.abs(dev) > 0.02;
  if (c.auto) {
    const confirmed = !!c.auto.confirmed;
    return {
      state: confirmed ? 'confirmed' : 'auto',
      short: `${c.auto.label}${confirmed ? ' ✓' : ' – prüfen'}`,
      text: `Maßstab ${c.auto.label} automatisch erkannt${confirmed ? ', bestätigt' : ' – noch nicht geprüft'}${checkText}`,
      warn: !confirmed || badCheck,
    };
  }
  // PDF: Papiermaßstab des gedruckten Plans (bei Bildern ohne Bedeutung)
  const n = kind === 'pdf' ? PT_PER_M / upm : null;
  const ratio = n ? ` (≈ 1:${n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 ? 1 : 0 })})` : '';
  return {
    state: 'manual',
    short: n ? `≈ 1:${Math.round(n)}` : 'Kalibriert',
    text: `Selbst kalibriert über Referenzstrecke ${formatMeasure(c.meters)} m${ratio}${checkText}`,
    warn: badCheck,
  };
}
