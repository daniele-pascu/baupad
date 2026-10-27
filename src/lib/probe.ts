import { polygonArea, type Point } from './geometry';

/**
 * Kontrollmessung („Messung“): misst im Plan, ohne etwas zu verändern oder zu speichern.
 * Punkte in Seitenkoordinaten, k = Seiteneinheiten je Meter (aus der Kalibrierung bzw. dem
 * Maßstab des gezeichneten Plans) – Zoom und Verschieben ändern die Werte daher nie.
 */
export type ProbeKind = 'length' | 'area' | 'angle' | 'radius' | 'distance';

export const PROBE_KINDS: { id: ProbeKind; label: string; icon: string; hint: string }[] = [
  { id: 'length', label: 'Länge', icon: 'ruler', hint: 'Punkte nacheinander antippen – die Länge aller Abschnitte wird addiert. Enter oder „Fertig“ beendet.' },
  { id: 'area', label: 'Fläche', icon: 'polygon', hint: 'Eckpunkte nacheinander antippen, Startpunkt oder „Fertig“ schließt die Fläche.' },
  { id: 'angle', label: 'Winkel', icon: 'angle', hint: 'Drei Punkte antippen: erster Schenkel, Scheitelpunkt, zweiter Schenkel.' },
  { id: 'radius', label: 'Radius', icon: 'radius', hint: 'Mittelpunkt und einen Punkt auf dem Kreis antippen.' },
  { id: 'distance', label: 'Abstand', icon: 'dimension', hint: 'Zwei Punkte antippen – Abstand, waagrecht und senkrecht. Mit ausgewählter Linie: senkrechter Abstand zu ihr.' },
];

/** Benötigte Punkte: feste Anzahl (Winkel 3, Radius 2, Abstand 2 bzw. 1 mit Bezugslinie) oder offen (Länge, Fläche). */
export function probeTarget(kind: ProbeKind, withRef = false): number | null {
  if (kind === 'angle') return 3;
  if (kind === 'radius') return 2;
  if (kind === 'distance') return withRef ? 1 : 2;
  return null;
}

export type ProbeResult =
  | { kind: 'length'; total: number; segments: number[] }
  | { kind: 'area'; area: number; perimeter: number }
  | { kind: 'angle'; degrees: number }
  | { kind: 'radius'; radius: number; diameter: number }
  | { kind: 'distance'; distance: number; dx: number; dy: number; foot?: Point };

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/** Lotfußpunkt von p auf die Gerade durch a–b (unbegrenzt: senkrechter Abstand zu parallelen Linien) */
export function perpendicularFoot(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return a;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Winkel bei b zwischen den Schenkeln b→a und b→c in Grad (0–180) */
export function angleAt(a: Point, b: Point, c: Point): number {
  const v1 = Math.atan2(a.y - b.y, a.x - b.x);
  const v2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(v1 - v2) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

/**
 * Ergebnis einer Messung (null, solange Punkte fehlen). Längen in m, Flächen in m², Winkel in Grad.
 * `ref`: Bezugslinie für den senkrechten Abstand.
 */
export function probeResult(kind: ProbeKind, pts: Point[], k: number, ref?: [Point, Point] | null): ProbeResult | null {
  const m = (u: number) => u / k;
  if (kind === 'length') {
    if (pts.length < 2) return null;
    const segments = pts.slice(1).map((p, i) => m(dist(pts[i], p)));
    return { kind, total: segments.reduce((s, x) => s + x, 0), segments };
  }
  if (kind === 'area') {
    if (pts.length < 3) return null;
    const perimeter = pts.reduce((s, p, i) => s + dist(p, pts[(i + 1) % pts.length]), 0);
    return { kind, area: polygonArea(pts) / (k * k), perimeter: m(perimeter) };
  }
  if (kind === 'angle') return pts.length < 3 ? null : { kind, degrees: angleAt(pts[0], pts[1], pts[2]) };
  if (kind === 'radius') {
    if (pts.length < 2) return null;
    const r = m(dist(pts[0], pts[1]));
    return { kind, radius: r, diameter: 2 * r };
  }
  // Abstand: zwei Punkte, oder ein Punkt senkrecht zur Bezugslinie
  if (ref && pts.length >= 1) {
    const foot = perpendicularFoot(pts[0], ref[0], ref[1]);
    return { kind, distance: m(dist(pts[0], foot)), dx: m(Math.abs(foot.x - pts[0].x)), dy: m(Math.abs(foot.y - pts[0].y)), foot };
  }
  if (pts.length < 2) return null;
  return { kind, distance: m(dist(pts[0], pts[1])), dx: m(Math.abs(pts[1].x - pts[0].x)), dy: m(Math.abs(pts[1].y - pts[0].y)) };
}

const de = (n: number, d = 2) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Ergebnis als Text, z. B. „4,20 m“, „12,35 m² · Umfang 14,20 m“, „90,0°“ */
export function formatProbe(r: ProbeResult): { main: string; extra: string } {
  switch (r.kind) {
    case 'length':
      return { main: `${de(r.total)} m`, extra: r.segments.length > 1 ? `${r.segments.length} Abschnitte: ${r.segments.map((x) => de(x)).join(' + ')} m` : '' };
    case 'area':
      return { main: `${de(r.area)} m²`, extra: `Umfang ${de(r.perimeter)} m` };
    case 'angle':
      return { main: `${de(r.degrees, 1)}°`, extra: '' };
    case 'radius':
      return { main: `r = ${de(r.radius)} m`, extra: `Ø ${de(r.diameter)} m` };
    case 'distance':
      return { main: `${de(r.distance)} m`, extra: `waagrecht ${de(r.dx)} m · senkrecht ${de(r.dy)} m` };
  }
}
