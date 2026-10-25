import { isDrawingPlan, unitsPerMeter } from './drawing';
import type { Plan } from './types';

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
