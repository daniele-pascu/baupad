import { isDrawingPlan, shapeInfo, shapeToMeters, unitsPerMeter } from './drawing';
import { isOpenShape } from './geometry';
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
