import type { Point } from './geometry';
import type { PlanSeg } from './pdf-snap';
import type { PageText } from './scale-detect';
import type { Rect } from './types';

/**
 * Maßangaben eines Vektor-PDFs lesen: Maßtext (Zahl + Einheit) → zugehörige Maßlinie mit ihren
 * Begrenzungen (Maßhilfslinien bzw. Schrägstriche) → Länge der Strecke im Plan. Aus mehreren
 * Maßen ergibt sich der Maßstab; widersprüchliche Maße werden gekennzeichnet, nicht verwendet.
 *
 * Nicht jede Zahl ist ein Maß: gezählt werden nur Zahlen, die mittig über einer passenden,
 * parallelen Linie stehen. Fotos/Scans (ohne Text und Linien) liefern nichts.
 */

export type DimUnit = 'm' | 'cm' | 'mm';
export const UNIT_FACTOR: Record<DimUnit, number> = { m: 1, cm: 0.01, mm: 0.001 };

const SUP: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

/**
 * Maßtext lesen: „420“, „5“, „1245“, „515,5“, „515⁵“ (hochgestellte mm), „4,20“, „5,155 m“.
 * Zahlen ohne Einheit sind wie in den meisten Bauplänen Zentimeter (420 = 4,20 m, 5 = 0,05 m,
 * 1245 = 12,45 m, 515,5 = 5,155 m); mit zwei oder drei Nachkommastellen Meter (4,20 m).
 * Millimeter nur mit „mm“ im Plan oder wenn im Dialog so gewählt.
 */
export function parseDimText(s: string): { value: number; units: DimUnit[]; text: string } | null {
  let t = s.trim().replace(/\s+/g, ' ');
  const unit = /\s?(mm|cm|m)$/i.exec(t)?.[1]?.toLowerCase() as DimUnit | undefined;
  if (unit) t = t.slice(0, -unit.length).trim();
  // hochgestellte Ziffern (z. B. 515⁵ = 515,5 cm)
  const sup = /([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(t);
  if (sup) t = `${t.slice(0, -sup[1].length)}${/[.,]/.test(t) ? '' : ','}${[...sup[1]].map((c) => SUP[c]).join('')}`;
  if (!/^\d{1,5}([.,]\d{1,3})?$/.test(t)) return null;
  const value = Number(t.replace(',', '.'));
  if (!(value > 0)) return null;
  if (unit) return { value, units: [unit], text: s.trim() };
  const decimals = /[.,](\d+)$/.exec(t)?.[1].length ?? 0;
  // Zentimeter: ganze Zahl oder eine Nachkommastelle; Meter: zwei/drei Nachkommastellen
  const units: DimUnit[] = decimals >= 2 ? ['m'] : ['cm'];
  return { value, units, text: s.trim() };
}

export interface DimMatch {
  /** Maßtext wie im Plan */
  text: string;
  value: number;
  units: DimUnit[];
  /** Maßlinie: Anfangs- und Endpunkt in Plankoordinaten, Länge in Seiteneinheiten */
  a: Point;
  b: Point;
  length: number;
  /** Lage des Textes (für die Anzeige) */
  at: Point;
}

const deg = (r: number) => (r * 180) / Math.PI;
/** Richtungsunterschied zweier Geraden (0…90°) */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 180) + 180) % 180;
  return Math.min(d, 180 - d);
}

/**
 * Maßtexte den Maßlinien zuordnen: parallele Linie direkt unter/neben dem Text (Abstand bis ca.
 * zwei Schrifthöhen), der Text liegt über der Linie; die Linie wird an kreuzenden Strichen
 * (Maßhilfslinien, Schrägstriche) geteilt – maßgeblich ist das Stück, über dem der Text steht.
 */
export function matchDimensionLines(items: PageText[], segs: PlanSeg[], region: Rect | null): DimMatch[] {
  const inRegion = (p: Point) => !region || (p.x >= region.x && p.x <= region.x + region.w && p.y >= region.y && p.y <= region.y + region.h);
  const straight = segs.filter((s) => s.straight && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 2);
  const out: DimMatch[] = [];
  for (const t of items) {
    if (!inRegion(t)) continue;
    const parsed = parseDimText(t.str);
    if (!parsed) continue;
    let best: { seg: PlanSeg; dist: number; tPar: number } | null = null;
    for (const s of straight) {
      const ang = deg(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x));
      if (angleDiff(ang, t.angle) > 2) continue;
      const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      if (len < t.width * 0.8) continue;
      const ux = (s.b.x - s.a.x) / len;
      const uy = (s.b.y - s.a.y) / len;
      const tPar = ((t.x - s.a.x) * ux + (t.y - s.a.y) * uy) / len;
      if (tPar < 0 || tPar > 1) continue;
      const dist = Math.abs((t.x - s.a.x) * -uy + (t.y - s.a.y) * ux);
      if (dist > Math.max(2.2 * t.height, 6) || dist < 0.2 * t.height) continue;
      if (!best || dist < best.dist) best = { seg: s, dist, tPar };
    }
    if (!best) continue;
    const { seg } = best;
    const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
    const lineAng = deg(Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x));
    // Teilungspunkte: kreuzende Striche (nicht parallel) entlang der Maßlinie
    const cuts = [0, 1];
    for (const c of straight) {
      if (c === seg) continue;
      if (angleDiff(deg(Math.atan2(c.b.y - c.a.y, c.b.x - c.a.x)), lineAng) < 25) continue;
      const x = intersectParam(seg.a, seg.b, c.a, c.b);
      if (x !== null && x > 1e-4 && x < 1 - 1e-4) cuts.push(x);
    }
    cuts.sort((p, q) => p - q);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i + 1 < cuts.length; i++)
      if (cuts[i] <= best.tPar && best.tPar <= cuts[i + 1]) {
        lo = cuts[i];
        hi = cuts[i + 1];
        break;
      }
    const a = { x: seg.a.x + (seg.b.x - seg.a.x) * lo, y: seg.a.y + (seg.b.y - seg.a.y) * lo };
    const b = { x: seg.a.x + (seg.b.x - seg.a.x) * hi, y: seg.a.y + (seg.b.y - seg.a.y) * hi };
    const length = (hi - lo) * len;
    // Der Text muss auf sein Linienstück passen und (wie in CAD üblich) etwa mittig darüber stehen
    if (length < t.width * 0.8) continue;
    if (Math.abs((best.tPar - (lo + hi) / 2) * len) > 0.08 * length + 0.5 * t.width) continue;
    out.push({ text: parsed.text, value: parsed.value, units: parsed.units, a, b, length, at: { x: t.x, y: t.y } });
  }
  // dieselbe Linie nur einmal (z. B. doppelt gelesener Text)
  return out.filter((m, i) => out.findIndex((o) => Math.abs(o.a.x - m.a.x) < 0.01 && Math.abs(o.a.y - m.a.y) < 0.01 && Math.abs(o.b.x - m.b.x) < 0.01 && Math.abs(o.b.y - m.b.y) < 0.01) === i);
}

/** Parameter (0…1) des Schnittpunkts auf a–b mit der Strecke c–d, sonst null */
function intersectParam(a: Point, b: Point, c: Point, d: Point): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return u >= -1e-6 && u <= 1 + 1e-6 && t >= 0 && t <= 1 ? t : null;
}

export interface DimRow {
  match: DimMatch;
  /** Wert in Metern bei der gewählten Einheit (null: Einheit passt nicht zu diesem Text) */
  meters: number | null;
  /** im Plan gemessen (m) beim ermittelten Maßstab */
  measured: number | null;
  deviation: number | null;
  ok: boolean;
}

export interface DimAnalysis {
  unit: DimUnit;
  /** Seiteneinheiten je Meter (Median der passenden Maße); null = keine zwei passenden Maße */
  k: number | null;
  rows: DimRow[];
  okCount: number;
  /** weitere Gruppe passender Maße mit anderem Maßstab (Plan mit mehreren Maßstäben?) */
  otherScale: number | null;
}

/** Toleranz: Maße passen zusammen, wenn sie höchstens 1,5 % vom gemeinsamen Maßstab abweichen */
export const LINE_TOLERANCE = 0.015;

function cluster(ks: number[]): { k: number; members: number[] } | null {
  let best: { k: number; members: number[] } | null = null;
  for (const c of ks) {
    const members = ks.map((k, i) => (Math.abs(k - c) / c <= LINE_TOLERANCE ? i : -1)).filter((i) => i >= 0);
    if (!best || members.length > best.members.length) {
      const sorted = members.map((i) => ks[i]).sort((p, q) => p - q);
      best = { k: sorted[Math.floor(sorted.length / 2)], members };
    }
  }
  return best;
}

/**
 * Maßstab aus den Maßlinien: die größte Gruppe übereinstimmender Maße (Zahlen ohne Einheit als
 * cm, mit zwei Nachkommastellen als m; mit `forced` alle in dieser Einheit). Mindestens zwei
 * Maße müssen passen – ein einzelnes Maß ist keine Kontrolle.
 */
export function analyzeDimensions(matches: DimMatch[], forced?: DimUnit): DimAnalysis {
  // ohne Vorgabe: jede Zahl in ihrer Einheit (ganze Zahlen cm, „4,20“ m); mit Vorgabe alle Zahlen in dieser Einheit
  const unitOf = (m: DimMatch) => forced ?? m.units[0];
  const units: DimUnit[] = forced ? [forced] : ['cm'];
  let best: { unit: DimUnit; k: number | null; members: Set<number>; ks: (number | null)[] } | null = null;
  for (const unit of units) {
    const ks = matches.map((m) => m.length / (m.value * UNIT_FACTOR[unitOf(m)]));
    const idx = ks.map((k, i) => (k !== null ? i : -1)).filter((i) => i >= 0);
    const c = cluster(idx.map((i) => ks[i]!));
    const members = new Set(c ? c.members.map((j) => idx[j]) : []);
    if (!best || members.size > best.members.size) best = { unit, k: c && members.size >= 2 ? c.k : null, members, ks };
  }
  const b = best!;
  // angezeigte Einheit: die der meisten passenden Maße (z. B. „5,00“-Ketten → m)
  if (!forced) {
    const count = (u: DimUnit) => [...b.members].filter((i) => unitOf(matches[i]) === u).length;
    b.unit = count('m') > count('cm') ? 'm' : 'cm';
  }
  const rows: DimRow[] = matches.map((m, i) => {
    const meters = m.value * UNIT_FACTOR[unitOf(m)];
    const measured = b.k && meters !== null ? m.length / b.k : null;
    const deviation = measured !== null && meters ? measured / meters - 1 : null;
    return { match: m, meters, measured, deviation, ok: b.k !== null && b.members.has(i) };
  });
  // zweite Gruppe (anderer Maßstab) unter den übrigen Maßen
  const rest = b.ks.map((k, i) => (k !== null && !b.members.has(i) ? k : null)).filter((k): k is number => k !== null);
  const second = cluster(rest);
  const otherScale = b.k && second && second.members.length >= 2 && Math.abs(second.k - b.k) / b.k > 0.05 ? second.k : null;
  return { unit: b.unit, k: b.k, rows, okCount: rows.filter((r) => r.ok).length, otherScale };
}

/** Kalibrierstrecke aus den passenden Maßen: die längste Maßlinie, Länge beim gemeinsamen Maßstab */
export function calibrationLine(a: DimAnalysis, use?: boolean[]): { a: Point; b: Point; meters: number; count: number } | null {
  const rows = a.rows.filter((r, i) => (use ? use[i] : r.ok) && r.meters !== null);
  if (rows.length < 1) return null;
  const ks = rows.map((r) => r.match.length / r.meters!).sort((p, q) => p - q);
  const k = ks[Math.floor(ks.length / 2)];
  const ref = rows.reduce((m, r) => (r.match.length > m.match.length ? r : m));
  return { a: ref.match.a, b: ref.match.b, meters: Math.round((ref.match.length / k) * 10000) / 10000, count: rows.length };
}
