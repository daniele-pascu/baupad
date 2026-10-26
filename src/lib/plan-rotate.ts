import type { Plan, PlanRotation, Rect } from './types';

type Pt = { x: number; y: number };

/** Eine Vierteldrehung im Uhrzeigersinn innerhalb einer Seite der Höhe H: (x, y) → (H − y, x) */
const cwPoint = (p: Pt, H: number): Pt => ({ x: H - p.y, y: p.x });
const cwRect = (r: Rect, H: number): Rect => ({ x: H - r.y - r.h, y: r.x, w: r.h, h: r.w });

/**
 * Planunterlage um `turn` Grad im Uhrzeigersinn drehen: Seitengröße, Ausschnitt und
 * Kalibrierung werden mitgedreht (Kalibrierlänge bleibt). Nur für Pläne ohne Messungen,
 * Markierungen und Zeichnungen – deren Lage wird hier bewusst nicht verändert.
 */
export function rotatePlan(plan: Plan, turn: 90 | 180 | 270): Plan {
  let p = { ...plan };
  for (let i = 0; i < turn / 90; i++) {
    const H = p.pageHeight;
    p = {
      ...p,
      pageWidth: p.pageHeight,
      pageHeight: p.pageWidth,
      crop: p.crop ? cwRect(p.crop, H) : null,
      ...(p.calibration ? { calibration: { ...p.calibration, a: cwPoint(p.calibration.a, H), b: cwPoint(p.calibration.b, H) } } : {}),
    };
  }
  const rotation = ((((plan.rotation ?? 0) + turn) % 360) as PlanRotation) || 0;
  const { rotation: _old, ...rest } = p;
  return rotation ? { ...rest, rotation } : rest;
}
