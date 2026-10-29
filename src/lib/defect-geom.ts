/**
 * Mängelplan – reine Geometrie und Zusammenfassungen (ohne Browser-Abhängigkeiten, daher getrennt testbar).
 * Koordinaten sind relativ zum Planbild (0..1).
 */
import { photoSiteKey } from './photos';
import type { DefectKind, DefectMark, DefectPlan, PhotoSite } from './types';


/** nächste freie Nummer im Plan */
export const nextMarkNo = (marks: Pick<DefectMark, 'no'>[]) => marks.reduce((m, x) => Math.max(m, x.no), 0) + 1;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** umschließendes Rechteck einer Markierung */
export function markBox(m: Pick<DefectMark, 'shape' | 'points'>): Box {
  const xs = m.points.map((p) => p.x);
  const ys = m.points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Ankerpunkt für die Nummer: Pin/Text am Punkt, Formen oben in der Mitte, Linie am Ende */
export function markAnchor(m: Pick<DefectMark, 'shape' | 'points'>): { x: number; y: number } {
  if (m.shape === 'pin' || m.shape === 'text') return m.points[0];
  if (m.shape === 'line') return m.points[m.points.length - 1];
  const b = markBox(m);
  return { x: b.x + b.w / 2, y: b.y };
}

const distToSegment = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, ar: number) => {
  // Seitenverhältnis einrechnen, damit die Toleranz in beiden Richtungen gleich wirkt
  const dx = (b.x - a.x) * ar;
  const dy = b.y - a.y;
  const px = (p.x - a.x) * ar;
  const py = p.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
  const ex = px - t * dx;
  const ey = py - t * dy;
  return Math.sqrt(ex * ex + ey * ey);
};

/**
 * Trifft der Punkt die Markierung? tol = Toleranz relativ zur Bildhöhe, ar = Breite/Höhe des Bildes.
 * Pin und Text: Umkreis; Rechteck/Ellipse: Fläche; Linie/Freihand: Nähe zum Strich.
 */
export function hitMark(m: Pick<DefectMark, 'shape' | 'points'>, p: { x: number; y: number }, tol: number, ar: number): boolean {
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot((a.x - b.x) * ar, a.y - b.y);
  switch (m.shape) {
    case 'pin':
      return d(p, { x: m.points[0].x, y: m.points[0].y - tol }) <= tol * 1.6;
    case 'text':
      return d(p, m.points[0]) <= tol * 2;
    case 'rect': {
      const b = markBox(m);
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    }
    case 'ellipse': {
      const b = markBox(m);
      const rx = b.w / 2 + tol;
      const ry = b.h / 2 + tol;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      return rx > 0 && ry > 0 && ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 <= 1;
    }
    case 'line':
    case 'freehand':
      for (let i = 0; i < m.points.length - 1; i++) if (distToSegment(p, m.points[i], m.points[i + 1], ar) <= tol) return true;
      return m.points.length === 1 && d(p, m.points[0]) <= tol;
  }
}

/** Freihandzug ausdünnen (nur Punkte mit Mindestabstand), damit Pläne klein bleiben */
export function thinPoints(points: { x: number; y: number }[], minDist = 0.004): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  if (points.length && out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

/** Zusammenfassung je Baustelle für die Übersicht */
export interface DefectSiteSummary {
  key: string;
  site: PhotoSite;
  plans: DefectPlan[];
  counts: Record<DefectKind, number>;
  photos: number;
  lastAt: number;
}

export function summarize(plans: DefectPlan[], marks: DefectMark[]): DefectSiteSummary[] {
  const byPlan = new Map<string, DefectMark[]>();
  for (const m of marks) byPlan.set(m.planId, [...(byPlan.get(m.planId) ?? []), m]);
  const out = new Map<string, DefectSiteSummary>();
  for (const p of plans) {
    const key = photoSiteKey(p);
    const s = out.get(key) ?? {
      key,
      site: { projectId: p.projectId, name: p.siteName, number: p.siteNumber, address: p.siteAddress },
      plans: [],
      counts: { mangel: 0, ausbesserung: 0, hinweis: 0, erledigt: 0 },
      photos: 0,
      lastAt: 0,
    };
    s.plans.push(p);
    for (const m of byPlan.get(p.id) ?? []) {
      s.counts[m.kind]++;
      s.photos += m.photoIds.length;
      s.lastAt = Math.max(s.lastAt, m.updatedAt);
    }
    s.lastAt = Math.max(s.lastAt, p.updatedAt);
    out.set(key, s);
  }
  return [...out.values()].sort((a, b) => b.lastAt - a.lastAt);
}
