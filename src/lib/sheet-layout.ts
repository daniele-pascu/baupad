import { PAPER, PRINT_HEADER_MM, PRINT_MARGIN_MM } from './drawing';
import type { PaperFormat, Plan, Rect } from './types';

/**
 * Seitenlayout für den PDF-Export auf A4/A3 – getrennt von der Plangeometrie: Hier wird nur
 * festgelegt, wo und wie groß der Plan auf dem Papier erscheint. Gespeicherte Maße bleiben
 * unverändert. Alle Werte in PDF-Punkten, y nach unten (0 = Blattoberkante).
 */

export const MM = 72 / 25.4;
/** Abstand zwischen Plan und Übersicht */
const GAP_MM = 4;
/** Höhe der Beschriftung unter der Übersicht */
const OVERVIEW_LABEL_PT = 11;
/** kleinste sinnvolle Übersicht (längere Seite) */
const OVERVIEW_MIN_MM = 22;

export type OverviewCorner = 'tr' | 'tl' | 'br' | 'bl';

export interface SheetLayout {
  /** Blattgröße */
  w: number;
  h: number;
  margin: number;
  /** Kopfbereich mit Überschrift (innerhalb des Rands) */
  header: Rect;
  /** Bereich, in dem der Plan(ausschnitt) dargestellt wird */
  plan: Rect;
  /** Punkte je Seiteneinheit des Plans */
  u: number;
  /** Übersicht des Gesamtplans (Bild) – nur bei eingeschalteter Übersicht */
  overview: Rect | null;
}

/** Papierformat für den Export: gezeichnete Pläne → Zeichenblatt, sonst gewählt bzw. A4 passend. */
export function exportPaper(plan: Plan): PaperFormat {
  if (plan.drawing?.paper) return plan.drawing.paper;
  if (plan.paper && PAPER[plan.paper]) return plan.paper;
  return defaultPaper(plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight });
}

/** Standard: A4, Ausrichtung passend zum Plan(ausschnitt). */
export const defaultPaper = (r: { w: number; h: number }): PaperFormat => (r.w > r.h ? 'A4-quer' : 'A4-hoch');

/** Überschrift des Plans im PDF */
export const planHeading = (plan: Pick<Plan, 'title' | 'planNumber' | 'planName'>) =>
  plan.title?.trim() || `Aufmaßplan ${plan.planNumber || plan.planName}`.trim();

const fit = (r: { w: number; h: number }, box: { w: number; h: number }) => Math.min(box.w / r.w, box.h / r.h);

/** Größte Übersicht mit Seitenverhältnis `aspect` (+ Beschriftung) in einem Kasten, höchstens `max` lang. */
function overviewSize(aspect: number, boxW: number, boxH: number, max: number): { w: number; h: number } | null {
  const ih = boxH - OVERVIEW_LABEL_PT;
  if (boxW <= 0 || ih <= 0) return null;
  let w = Math.min(boxW, ih * aspect);
  if (Math.max(w, w / aspect) > max) w = aspect >= 1 ? max : max * aspect;
  return { w, h: w / aspect };
}

/**
 * Plan proportional und zentriert in den Druckbereich (Rand mindestens 1 cm, darunter die
 * Kopfzeile) einpassen. Mit Übersicht: zuerst freien Platz neben bzw. über/unter dem Plan
 * nutzen; reicht er nicht, wird der Plan nur so weit verkleinert, wie für eine kompakte
 * Übersicht nötig – je nachdem, ob seitlich oder oben/unten weniger Fläche verloren geht.
 */
export function layoutSheet(
  paper: PaperFormat,
  region: { w: number; h: number },
  opts: { overview?: { aspect: number; corner: OverviewCorner } | null } = {},
): SheetLayout {
  const p = PAPER[paper];
  const w = p.w * MM;
  const h = p.h * MM;
  const margin = PRINT_MARGIN_MM * MM;
  const headerH = PRINT_HEADER_MM * MM;
  const header: Rect = { x: margin, y: margin, w: w - 2 * margin, h: headerH };
  const C: Rect = { x: margin, y: margin + headerH, w: w - 2 * margin, h: h - 2 * margin - headerH };
  const center = (box: Rect, u: number): Rect => {
    const pw = region.w * u;
    const ph = region.h * u;
    return { x: box.x + (box.w - pw) / 2, y: box.y + (box.h - ph) / 2, w: pw, h: ph };
  };
  const u0 = fit(region, C);
  const ov = opts.overview;
  if (!ov) return { w, h, margin, header, plan: center(C, u0), u: u0, overview: null };

  const gap = GAP_MM * MM;
  const minSide = OVERVIEW_MIN_MM * MM;
  const right = ov.corner.endsWith('r');
  const bottom = ov.corner.startsWith('b');
  // Übersicht ergänzt nur: etwa ein Viertel der kürzeren Druckbereichsseite
  const max = Math.max(minSide, 0.28 * Math.min(C.w, C.h));
  const compact = Math.max(minSide, 0.22 * Math.min(C.w, C.h));

  /** Anordnung: Übersicht in einer Spalte (seitlich) bzw. Zeile (oben/unten) der Breite/Höhe `size` */
  const arrange = (side: 'col' | 'row', o: { w: number; h: number }, u: number) => {
    const boxH = o.h + OVERVIEW_LABEL_PT;
    const rest: Rect =
      side === 'col'
        ? { x: right ? C.x : C.x + o.w + gap, y: C.y, w: C.w - o.w - gap, h: C.h }
        : { x: C.x, y: bottom ? C.y : C.y + boxH + gap, w: C.w, h: C.h - boxH - gap };
    const plan = center(rest, u);
    const x = side === 'col' ? (right ? C.x + C.w - o.w : C.x) : right ? C.x + C.w - o.w : C.x;
    const y = side === 'row' ? (bottom ? C.y + C.h - boxH : C.y) : bottom ? C.y + C.h - boxH : C.y;
    return { w, h, margin, header, plan, u, overview: { x, y, w: o.w, h: o.h } };
  };

  // 1) Freier Platz bei unveränderter Plangröße
  const pw = region.w * u0;
  const ph = region.h * u0;
  const col = overviewSize(ov.aspect, C.w - pw - gap, C.h, max);
  const row = overviewSize(ov.aspect, C.w, C.h - ph - gap, max);
  const ok = (o: { w: number; h: number } | null): o is { w: number; h: number } => !!o && Math.max(o.w, o.h) >= minSide - 0.01;
  const free = [ok(col) ? { side: 'col' as const, o: col } : null, ok(row) ? { side: 'row' as const, o: row } : null]
    .filter(Boolean)
    .sort((a, b) => b!.o.w * b!.o.h - a!.o.w * a!.o.h)[0];
  if (free) return arrange(free.side, free.o, u0);

  // 2) Kein Platz frei: kompakte Übersicht, Plan nur so weit wie nötig verkleinern
  const oc = overviewSize(ov.aspect, C.w, C.h, compact)!;
  const uCol = fit(region, { w: C.w - oc.w - gap, h: C.h });
  const uRow = fit(region, { w: C.w, h: C.h - oc.h - OVERVIEW_LABEL_PT - gap });
  return uCol >= uRow ? arrange('col', oc, uCol) : arrange('row', oc, uRow);
}
