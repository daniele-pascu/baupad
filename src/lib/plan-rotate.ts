import type { Component, Damage, Plan, PlanRotation, Rect, Shape } from './types';

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


/** Form um eine Vierteldrehung im Uhrzeigersinn mitdrehen: Mittelpunkt wandert, Drehwinkel +90° (Größe bleibt) */
function cwShape(s: Shape, H: number): Shape {
  const c = cwPoint({ x: s.x + s.w / 2, y: s.y + s.h / 2 }, H);
  const rotation = (((s.rotation ?? 0) + 90) % 360 + 360) % 360;
  return { ...s, x: c.x - s.w / 2, y: c.y - s.h / 2, rotation };
}

/**
 * Plan samt Inhalt drehen: Messungen (mit im Plan gezeichneten Abzügen), Beschriftungen und Bauteilbuchstaben
 * drehen mit, Maße und Flächen bleiben unverändert. Ergebnis: geänderte Datensätze zum Speichern.
 */
export function rotatePlanWithContent(plan: Plan, damages: Damage[], components: Component[], turn: 90 | 180 | 270): { plan: Plan; damages: Damage[]; components: Component[] } {
  let H = plan.pageHeight;
  let W = plan.pageWidth;
  let ds = damages;
  let cs = components;
  let check = plan.calibration?.check;
  for (let i = 0; i < turn / 90; i++) {
    const h = H;
    ds = ds.map((d) => ({
      ...d,
      shape: cwShape(d.shape, h),
      labelOffset: d.labelOffset ? { dx: -d.labelOffset.dy, dy: d.labelOffset.dx } : d.labelOffset,
      ...(d.deductions ? { deductions: d.deductions.map((x) => ({ ...x, ...(x.shape ? { shape: cwShape(x.shape, h) } : {}), ...(x.labelAt ? { labelAt: cwPoint(x.labelAt, h) } : {}) })) } : {}),
    }));
    cs = cs.map((c) => ({ ...c, ...cwPoint({ x: c.x, y: c.y }, h) }));
    if (check) check = { ...check, a: cwPoint(check.a, h), b: cwPoint(check.b, h) };
    [H, W] = [W, H];
  }
  const p = rotatePlan(plan, turn);
  const next = check && p.calibration ? { ...p, calibration: { ...p.calibration, check } } : p;
  return { plan: next, damages: ds, components: cs };
}
