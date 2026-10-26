import { analyzeDimensions, calibrationLine, matchDimensionLines, type DimUnit } from './dimension-lines';
import type { Point } from './geometry';
import type { PlanSeg } from './pdf-snap';
import type { Plan, Rect } from './types';

/**
 * Maßstab eines importierten PDF-Plans automatisch erkennen – nur aus dem Text der Seite:
 *
 * 1. Maßstabsangabe („M 1:100“, „Maßstab 1:50“, „1:20“) im Planausschnitt.
 * 2. Maßketten: Maßzahlen auf einer gemeinsamen Linie (z. B. „5,00  3,65  2,40“). CAD-Programme
 *    setzen die Maßzahl in die Mitte ihrer Strecke; der Abstand zweier benachbarter Maßzahlen
 *    entspricht daher der halben Summe ihrer Maße. Stimmen mehrere Paare überein, ergibt sich
 *    der Maßstab der Zeichnung – auch wenn der Plan verkleinert gedruckt wurde.
 *
 * Beides zusammen: passt die Angabe zu den Maßketten, gilt die (exakte) Angabe; sonst gelten
 * die Maßketten mit Hinweis. Fotos und Scans enthalten keinen Text – dort bleibt das Kalibrieren.
 * Das Ergebnis ist eine gewöhnliche Kalibrierung: gespeicherte Messwerte ändern sich nie.
 */

/** Text in Seitenkoordinaten (PDF-Punkte, Ursprung oben links): Mitte, Richtung, Breite, Höhe */
export interface PageText {
  str: string;
  /** Mittelpunkt */
  x: number;
  y: number;
  /** Leserichtung in Grad (0 = waagrecht, 90/-90 = senkrecht) */
  angle: number;
  /** Ausdehnung entlang bzw. quer zur Leserichtung */
  width: number;
  height: number;
}

/** Seiteneinheiten (PDF-Punkt) je Meter bei Maßstab 1:1 */
export const PT_PER_M = 72 / 0.0254;

/** übliche Maßstäbe im Bauwesen */
const STANDARD = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 750, 1000, 1250, 2000, 2500, 5000];

export type ScaleSource = 'scale' | 'dims' | 'scale+dims' | 'lines';

export interface ScaleDetection {
  /** Seiteneinheiten je Meter */
  unitsPerMeter: number;
  /** z. B. „1:100“ bzw. „ca. 1:98“ */
  label: string;
  source: ScaleSource;
  /** Hinweis, z. B. Angabe und Maßketten widersprechen sich */
  warning?: string;
  /** Maßlinien: Einheit der Maßzahlen und Zahl der übereinstimmenden Maße */
  unit?: DimUnit;
  count?: number;
  /** Kalibrierstrecke in Seitenkoordinaten (für die Anzeige beim Kalibrieren) */
  a: Point;
  b: Point;
  meters: number;
}

const inRegion = (t: { x: number; y: number }, r: Rect | null) => !r || (t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h);

/** Texte einer Zeile (gleiche Richtung, gleiche Grundlinie) zusammenfassen */
function textLines(items: PageText[]): { str: string; x: number; y: number; items: PageText[] }[] {
  const lines: { key: string; items: PageText[] }[] = [];
  for (const t of items) {
    const dir = Math.round(t.angle / 90) * 90;
    const across = dir % 180 === 0 ? t.y : t.x;
    const line = lines.find((l) => l.key.startsWith(`${dir}:`) && Math.abs(Number(l.key.split(':')[1]) - across) < Math.max(2, t.height * 0.4));
    if (line) line.items.push(t);
    else lines.push({ key: `${dir}:${across}`, items: [t] });
  }
  return lines.map((l) => {
    const dir = Number(l.key.split(':')[0]);
    const along = (t: PageText) => (dir % 180 === 0 ? t.x : t.y) * (dir === 180 || dir === -90 ? -1 : 1);
    const sorted = [...l.items].sort((p, q) => along(p) - along(q));
    return { str: sorted.map((t) => t.str).join(' '), x: sorted[0].x, y: sorted[0].y, items: sorted };
  });
}

const SCALE_RE = /(?:^|[^\d.,:/])(M(?:aßstab|aßst\.?|st\.?|\.)?\s*:?\s*)?1\s*:\s*(\d{1,5})(?![\d:]|[.,]\d)/gi;

/** Maßstabsangaben im Bereich (beschriftete „M 1:100“ zuerst) */
export function findScaleNotes(items: PageText[], region: Rect | null): { n: number; labeled: boolean; x: number; y: number }[] {
  const out: { n: number; labeled: boolean; x: number; y: number }[] = [];
  for (const line of textLines(items.filter((t) => inRegion(t, region)))) {
    for (const m of line.str.matchAll(SCALE_RE)) {
      const n = Number(m[2]);
      if (STANDARD.includes(n) && n > 1) out.push({ n, labeled: !!m[1], x: line.x, y: line.y });
    }
  }
  return out;
}

/** Maßzahl lesen: „5,00“, „3.65“ (m) bzw. „365“ (cm) / „3650“ (mm); sonst null */
function dimValues(s: string): number[] {
  const t = s.trim();
  if (/^\d{1,3}[.,]\d{1,3}$/.test(t)) {
    const v = Number(t.replace(',', '.'));
    return v > 0 ? [v] : [];
  }
  if (/^\d{2,5}$/.test(t)) {
    const v = Number(t);
    // ganze Zahl: Zentimeter oder Millimeter (Meter-Ganzzahlen sind in Maßketten selten)
    return v > 0 ? [v / 100, v / 1000] : [];
  }
  return [];
}

interface Pair {
  k: number;
  unit: number;
  a: PageText;
  b: PageText;
  meters: number;
}

/**
 * Maßstab aus Maßketten: Paare benachbarter Maßzahlen auf einer Linie → Seiteneinheiten je
 * Meter. Gültig nur, wenn mindestens drei Paare auf ±2 % übereinstimmen.
 */
export function scaleFromDimensions(items: PageText[], region: Rect | null): { k: number; count: number; a: Point; b: Point; meters: number } | null {
  const pairs = dimensionPairs(items, region);
  let best: { k: number; members: Pair[] } | null = null;
  for (const c of pairs) {
    const members = pairs.filter((p) => Math.abs(p.k - c.k) / c.k <= 0.02);
    // je Zahlenpaar nur eine Einheitenannahme zählen
    const unique = members.filter((p, i) => members.findIndex((o) => o.a === p.a && o.b === p.b) === i);
    if (!best || unique.length > best.members.length) best = { k: c.k, members: unique };
  }
  if (!best || best.members.length < 3) return null;
  const ks = best.members.map((p) => p.k).sort((x, y) => x - y);
  const k = ks[Math.floor(ks.length / 2)];
  // längste gemeinsame Strecke als Kalibrierstrecke (Mitte der ersten bis Mitte der letzten Zahl)
  const ref = best.members.reduce((m, p) => (p.meters > m.meters ? p : m));
  return { k, count: best.members.length, a: { x: ref.a.x, y: ref.a.y }, b: { x: ref.b.x, y: ref.b.y }, meters: Math.hypot(ref.b.x - ref.a.x, ref.b.y - ref.a.y) / k };
}

/** Paare benachbarter Maßzahlen auf einer Linie (je Einheitenannahme ein Eintrag) */
function dimensionPairs(items: PageText[], region: Rect | null): Pair[] {
  const pairs: Pair[] = [];
  for (const line of textLines(items.filter((t) => inRegion(t, region)))) {
    const nums = line.items.filter((t) => dimValues(t.str).length);
    for (let i = 0; i + 1 < nums.length; i++) {
      const p = nums[i];
      const q = nums[i + 1];
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      // Maßzahlen dürfen sich nicht überlappen
      if (d < (p.width + q.width) / 2) continue;
      const vp = dimValues(p.str);
      const vq = dimValues(q.str);
      // gleiche Einheitenannahme für beide Zahlen (Index 0 = m/cm, 1 = mm)
      for (let u = 0; u < Math.max(vp.length, vq.length); u++) {
        const a = vp[Math.min(u, vp.length - 1)];
        const b = vq[Math.min(u, vq.length - 1)];
        const half = (a + b) / 2;
        if (half > 0) pairs.push({ k: d / half, unit: u, a: p, b: q, meters: half });
      }
    }
  }
  return pairs;
}

/** nächster üblicher Maßstab, wenn innerhalb ±1,5 % */
function snapStandard(n: number): number | null {
  const s = STANDARD.reduce((m, v) => (Math.abs(v - n) < Math.abs(m - n) ? v : m));
  return Math.abs(s - n) / s <= 0.015 ? s : null;
}

const fmtN = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 ? 1 : 0 });

/**
 * Maßstab eines Planbereichs ermitteln (null = nichts Sicheres gefunden). Mit den Linien der
 * Seite (`segs`) zuerst über die Maßlinien: Maßzahl + Einheit ↔ gezeichnete Strecke – die
 * zuverlässigste Quelle, auch bei verkleinert gedruckten Plänen.
 */
export function detectScale(items: PageText[], region: Rect | null, segs?: PlanSeg[]): ScaleDetection | null {
  const notes = findScaleNotes(items, region);
  const labeled = notes.filter((n) => n.labeled);
  const pool = labeled.length ? labeled : notes;
  const distinct = [...new Set(pool.map((n) => n.n))];
  const note = distinct.length === 1 ? pool[0] : null;
  if (segs?.length) {
    const an = analyzeDimensions(matchDimensionLines(items, segs, region));
    const line = an.k ? calibrationLine(an) : null;
    if (an.k && line) {
      const n = PT_PER_M / an.k;
      const snapped = STANDARD.find((v) => Math.abs(v - n) / v <= 0.005);
      const warnings = [
        note && Math.abs(n - note.n) / note.n > 0.03
          ? `Die Maßstabsangabe 1:${note.n} passt nicht zu den Maßlinien (ca. 1:${fmtN(n)}) – der Plan ist vermutlich verkleinert gedruckt. Es gelten die Maßlinien.`
          : '',
        an.otherScale ? `Im Plan stehen auch Maße mit anderem Maßstab (ca. 1:${fmtN(PT_PER_M / an.otherScale)}) – diesen Bereich ggf. getrennt zuschneiden und kalibrieren.` : '',
        an.okCount < an.rows.length ? `${an.rows.length - an.okCount} von ${an.rows.length} Maßen passen nicht und wurden nicht verwendet.` : '',
      ].filter(Boolean);
      return {
        unitsPerMeter: an.k,
        label: snapped ? `1:${snapped}` : `ca. 1:${fmtN(n)}`,
        source: 'lines',
        ...(warnings.length ? { warning: warnings.join(' ') } : {}),
        unit: an.unit,
        count: an.okCount,
        a: line.a,
        b: line.b,
        meters: line.meters,
      };
    }
  }
  const dims = scaleFromDimensions(items, region);
  const r = region ?? { x: 0, y: 0, w: 0, h: 0 };
  /** Kalibrierstrecke für eine Maßstabsangabe: waagrecht in der Planmitte, ca. ⅓ der Breite */
  const lineFor = (upm: number) => {
    const meters = Math.max(1, Math.round((Math.max(r.w, 300) / 3 / upm) * 2) / 2);
    const a = { x: r.x + r.w * 0.1, y: r.y + r.h / 2 };
    return { a, b: { x: a.x + meters * upm, y: a.y }, meters };
  };
  if (dims) {
    const nDims = PT_PER_M / dims.k;
    if (note && Math.abs(nDims - note.n) / note.n <= 0.03) {
      const upm = PT_PER_M / note.n;
      return { unitsPerMeter: upm, label: `1:${note.n}`, source: 'scale+dims', ...lineFor(upm) };
    }
    const snapped = snapStandard(nDims);
    const upm = snapped ? PT_PER_M / snapped : dims.k;
    return {
      unitsPerMeter: upm,
      label: snapped ? `1:${snapped}` : `ca. 1:${fmtN(nDims)}`,
      source: 'dims',
      warning: note
        ? `Die Maßstabsangabe 1:${note.n} passt nicht zu den Maßketten (ca. 1:${fmtN(nDims)}) – der Plan ist vermutlich verkleinert gedruckt. Es gelten die Maßketten.`
        : undefined,
      a: dims.a,
      b: dims.b,
      meters: Math.round((Math.hypot(dims.b.x - dims.a.x, dims.b.y - dims.a.y) / upm) * 1000) / 1000,
    };
  }
  if (note) {
    const upm = PT_PER_M / note.n;
    return { unitsPerMeter: upm, label: `1:${note.n}`, source: 'scale', ...lineFor(upm) };
  }
  return null;
}

/** Kalibrierung eines Plans aus der Erkennung (Vermerk „automatisch erkannt“) */
export function calibrationFrom(det: ScaleDetection): NonNullable<Plan['calibration']> {
  return {
    a: det.a,
    b: det.b,
    meters: det.meters,
    auto: { source: det.source, label: det.label, ...(det.warning ? { warning: det.warning } : {}), ...(det.unit ? { unit: det.unit, count: det.count } : {}) },
  };
}

export const SOURCE_LABELS: Record<ScaleSource, string> = {
  scale: 'Maßstabsangabe im Plan',
  dims: 'Maßketten im Plan',
  'scale+dims': 'Maßstabsangabe, bestätigt durch Maßketten',
  lines: 'Maßlinien im Plan',
};

/** Toleranz für „passt“: Maße höchstens 2 cm Abweichung (absolut), Maßstabsangabe ±3 % */
export const DIM_TOLERANCE_M = 0.02;
export const NOTE_TOLERANCE = 0.03;

export interface ScaleCheck {
  /** Maßstabsangaben im Plan und ihre Abweichung vom kalibrierten Maßstab */
  notes: { n: number; labeled: boolean; deviation: number; ok: boolean }[];
  /** Maßzahlen-Paare: Sollmaß (halbe Summe) und im Plan gemessen */
  dims: { a: string; b: string; expected: number; measured: number; deviation: number; ok: boolean }[];
  /** Anteil passender Maßpaare, größte Abweichung der passenden, Median aller */
  okCount: number;
  median: number | null;
}

/**
 * Kalibrierung prüfen: Wie gut passen Maßstabsangaben und Maßketten des Plans zum aktuellen
 * Maßstab (`upm` Seiteneinheiten je Meter)? Paare, die nicht passen, sind entweder keine
 * echte Maßkette (z. B. zufällig nebeneinander stehende Zahlen) oder widersprechen dem Maßstab.
 */
export function checkScale(items: PageText[], region: Rect | null, upm: number): ScaleCheck {
  const nCal = PT_PER_M / upm;
  const notes = findScaleNotes(items, region)
    .filter((n, i, all) => all.findIndex((o) => o.n === n.n) === i)
    .map((n) => {
      const deviation = n.n / nCal - 1;
      return { n: n.n, labeled: n.labeled, deviation, ok: Math.abs(deviation) <= NOTE_TOLERANCE };
    });
  const byPair = new Map<string, ScaleCheck['dims'][number]>();
  for (const p of dimensionPairs(items, region)) {
    const d = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
    const measured = d / upm;
    const deviation = measured / p.meters - 1;
    const key = `${p.a.x},${p.a.y}|${p.b.x},${p.b.y}`;
    const old = byPair.get(key);
    // je Zahlenpaar die Einheitenannahme, die am besten passt
    if (!old || Math.abs(deviation) < Math.abs(old.deviation))
      byPair.set(key, { a: p.a.str.trim(), b: p.b.str.trim(), expected: p.meters, measured, deviation, ok: Math.abs(measured - p.meters) <= DIM_TOLERANCE_M });
  }
  const dims = [...byPair.values()].sort((x, y) => Number(y.ok) - Number(x.ok) || Math.abs(x.deviation) - Math.abs(y.deviation));
  const okDevs = dims.filter((d) => d.ok).map((d) => d.deviation).sort((x, y) => x - y);
  return { notes, dims, okCount: okDevs.length, median: okDevs.length ? okDevs[Math.floor(okDevs.length / 2)] : null };
}

const UNIT_NAMES: Record<DimUnit, string> = { m: 'm', cm: 'cm', mm: 'mm' };
/** Quelle der Erkennung als Text, bei Maßlinien mit Anzahl und Einheit („Maßlinien im Plan: 4 Maße in cm“) */
export function sourceText(auto: { source: ScaleSource; unit?: DimUnit; count?: number }): string {
  return auto.source === 'lines' && auto.unit ? `${SOURCE_LABELS.lines}: ${auto.count ?? ''} Maße in ${UNIT_NAMES[auto.unit]}`.replace(':  ', ': ') : SOURCE_LABELS[auto.source];
}
