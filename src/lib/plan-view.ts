import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Ebenen-Konfiguration von pdf.js (Typ nicht exportiert) */
export type OptionalContentConfig = Awaited<ReturnType<PDFDocumentProxy['getOptionalContentConfig']>>;

/**
 * Ansicht eines PDF-Plans ohne KI: PDF-Ebenen (falls der CAD-Export sie mitgibt) ein-/ausblenden und den
 * Inhalt nach Merkmalen filtern – Text aus, dünne Linien aus (Maßketten, Hilfslinien, Möbel), einzelne Farben aus.
 * Übrig bleiben z. B. nur die dicken Striche und Flächen: Wände, Stützen, Schächte. Das ist eine Näherung
 * (keine Bedeutung, nur Strichstärke und Farbe), gilt für Ansicht und PDF-Export und wird je Plan gespeichert.
 *
 * Gefiltert wird beim Zeichnen: die Zeichenbefehle der Seite (pdf.js-Operatorliste) werden selbst auf die Leinwand
 * gebracht und dabei weggelassen, was ausgeblendet ist. Ohne Filter zeichnet pdf.js wie bisher (nur Ebenen über
 * dessen eigene Ebenen-Konfiguration).
 */

export interface PlanView {
  /** Text ausblenden (Beschriftungen, Maßzahlen, Raumstempel – sofern als Text im PDF, nicht als Kurven) */
  hideText?: boolean;
  /** Bilder (eingebettete Fotos/Scans) ausblenden */
  hideImages?: boolean;
  /** Linien dünner als … pt ausblenden (0 oder fehlend = alle Linien) */
  minWidth?: number;
  /** ausgeblendete Farben (#rrggbb bzw. „pattern“ für Schraffuren/Muster) */
  hideColors?: string[];
  /** ausgeblendete PDF-Ebenen (Kennungen der Ebenen) */
  hideLayers?: string[];
}

/** Schlüssel für Schraffuren und Muster in der Farbliste */
export const PATTERN = 'pattern';
const PATTERN_FILL = 'rgba(120,120,120,0.35)';
const PATTERN_STROKE = '#8a8a8a';

/** Inhalt wird gefiltert (eigenes Zeichnen nötig) */
export const viewFilters = (v?: PlanView | null): boolean => !!v && (!!v.hideText || !!v.hideImages || (v.minWidth ?? 0) > 0 || !!v.hideColors?.length);
/** irgendeine Abweichung vom Original (Filter oder Ebenen) */
export const viewActive = (v?: PlanView | null): boolean => viewFilters(v) || !!v?.hideLayers?.length;
/** leere Angaben entfernen; nichts aktiv → undefined (Feld wird nicht gespeichert) */
export function cleanView(v: PlanView | undefined): PlanView | undefined {
  if (!v) return undefined;
  const out: PlanView = {};
  if (v.hideText) out.hideText = true;
  if (v.hideImages) out.hideImages = true;
  if ((v.minWidth ?? 0) > 0) out.minWidth = v.minWidth;
  if (v.hideColors?.length) out.hideColors = [...v.hideColors];
  if (v.hideLayers?.length) out.hideLayers = [...v.hideLayers];
  return Object.keys(out).length ? out : undefined;
}
/** stabiler Schlüssel für Abhängigkeiten/Caches */
export const viewKey = (v?: PlanView | null): string => (viewActive(v) ? JSON.stringify(cleanView(v ?? undefined)) : '');

export interface PdfLayer {
  id: string;
  name: string;
  depth: number;
  /** Gruppenüberschrift (nicht schaltbar) */
  heading?: boolean;
}

export interface PlanAnalysis {
  /** Seite enthält gezeichnete Pfade (Vektor-PDF) */
  vector: boolean;
  hasText: boolean;
  hasImages: boolean;
  /** Farben (Strich und Füllung) nach Häufigkeit, höchstens 24; „pattern“ = Schraffur/Muster */
  colors: { key: string; count: number }[];
  /** vorkommende Strichstärken in pt (aufsteigend) mit Häufigkeit */
  widths: { width: number; count: number }[];
  layers: PdfLayer[];
}

const OPS = pdfjs.OPS;
const STROKE_OPS = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const FILL_OPS = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
const EO_OPS = new Set<number>([OPS.eoFill, OPS.eoFillStroke, OPS.closeEOFillStroke]);
const IMAGE_OPS = new Set<number>([OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask]);

type Matrix = ArrayLike<number>;
const detScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const hex = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '#000000');

/** PDF-Ebenen des Dokuments in Reihenfolge und Verschachtelung des Ebenen-Panels */
export async function pdfLayers(doc: PDFDocumentProxy): Promise<PdfLayer[]> {
  const occ = await doc.getOptionalContentConfig();
  const order = occ.getOrder();
  if (!order) return [];
  const out: PdfLayer[] = [];
  const seen = new Set<string>();
  const walk = (items: unknown[], depth: number) => {
    for (const it of items) {
      if (typeof it === 'string') {
        const g = occ.getGroup(it) as { name?: string } | null;
        if (g && !seen.has(it)) {
          seen.add(it);
          out.push({ id: it, name: g.name || it, depth });
        }
      } else if (Array.isArray(it)) walk(it, depth + 1);
      else if (it && typeof it === 'object' && Array.isArray((it as { order?: unknown }).order)) {
        const o = it as { name?: string; order: unknown[] };
        out.push({ id: `heading:${out.length}`, name: o.name || '', depth, heading: true });
        walk(o.order, depth + 1);
      }
    }
  };
  walk(order as unknown[], 0);
  for (const [id, g] of occ as unknown as Iterable<[string, { name?: string }]>) if (!seen.has(id)) out.push({ id, name: g.name || id, depth: 0 });
  return out;
}

const occCache = new WeakMap<PDFDocumentProxy, Map<string, Promise<OptionalContentConfig>>>();
/** Ebenen-Konfiguration mit den ausgeblendeten Ebenen (null = alles sichtbar, Standard von pdf.js) */
export function layerConfig(doc: PDFDocumentProxy, hideLayers?: string[]): Promise<OptionalContentConfig | null> {
  if (!hideLayers?.length) return Promise.resolve(null);
  const key = [...hideLayers].sort().join('|');
  let map = occCache.get(doc);
  if (!map) occCache.set(doc, (map = new Map()));
  let p = map.get(key);
  if (!p) {
    p = doc.getOptionalContentConfig().then((occ) => {
      for (const id of hideLayers) occ.setVisibility(id, false);
      return occ;
    });
    map.set(key, p);
  }
  return p;
}

/** Merkmale der Seite für das Menü „Ansicht“ (Farben, Strichstärken, Text, Bilder, Ebenen) */
export async function analyzePlanPage(doc: PDFDocumentProxy, page: PDFPageProxy): Promise<PlanAnalysis> {
  const layers = await pdfLayers(doc);
  const list = await page.getOperatorList();
  const colors = new Map<string, number>();
  const widths = new Map<number, number>();
  let vector = false;
  let hasText = false;
  let hasImages = false;
  let st = { lw: 1, k: 1, stroke: '#000000', fill: '#000000', strokePat: false, fillPat: false };
  const stack: (typeof st)[] = [];
  let inText = false;
  const bump = (m: Map<string, number>, key: string) => m.set(key, (m.get(key) ?? 0) + 1);
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push(st);
        st = { ...st };
        break;
      case OPS.restore:
        st = stack.pop() ?? st;
        break;
      case OPS.transform:
        st.k *= detScale(args as Matrix);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(st);
        st = { ...st };
        if (args[0] && typeof args[0] === 'object') st.k *= detScale(args[0] as Matrix);
        break;
      case OPS.paintFormXObjectEnd:
        st = stack.pop() ?? st;
        break;
      case OPS.setLineWidth:
        st.lw = Number(args[0]) || 0;
        break;
      case OPS.setGState:
        for (const [k, v] of args[0] as [string, unknown][]) if (k === 'LW') st.lw = Number(v) || 0;
        break;
      case OPS.setStrokeRGBColor:
        st.stroke = hex(args[0]);
        st.strokePat = false;
        break;
      case OPS.setFillRGBColor:
        st.fill = hex(args[0]);
        st.fillPat = false;
        break;
      case OPS.setStrokeColorN:
        st.strokePat = true;
        break;
      case OPS.setFillColorN:
        st.fillPat = true;
        break;
      case OPS.beginText:
        inText = true;
        hasText = true;
        break;
      case OPS.endText:
        inText = false;
        break;
      case OPS.constructPath: {
        if (inText) break;
        const op = args[0] as number;
        if (STROKE_OPS.has(op)) {
          vector = true;
          widths.set(Math.round(st.lw * st.k * 100) / 100, (widths.get(Math.round(st.lw * st.k * 100) / 100) ?? 0) + 1);
          bump(colors, st.strokePat ? PATTERN : st.stroke);
        }
        if (FILL_OPS.has(op)) {
          vector = true;
          bump(colors, st.fillPat ? PATTERN : st.fill);
        }
        break;
      }
      default:
        if (IMAGE_OPS.has(fn)) hasImages = true;
    }
  }
  return {
    vector,
    hasText,
    hasImages,
    colors: [...colors].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 24),
    widths: [...widths].map(([width, count]) => ({ width, count })).sort((a, b) => a.width - b.width),
    layers,
  };
}

function makePath(data: unknown): Path2D {
  if (data instanceof Path2D) return data;
  const path = new Path2D();
  const d = data as ArrayLike<number> | null;
  if (!d || typeof d === 'string') return path;
  for (let i = 0; i < d.length; ) {
    switch (d[i++]) {
      case 0:
        path.moveTo(d[i++], d[i++]);
        break;
      case 1:
        path.lineTo(d[i++], d[i++]);
        break;
      case 2:
        path.bezierCurveTo(d[i++], d[i++], d[i++], d[i++], d[i++], d[i++]);
        break;
      case 3:
        path.quadraticCurveTo(d[i++], d[i++], d[i++], d[i++]);
        break;
      case 4:
        path.closePath();
        break;
      default:
        return path;
    }
  }
  return path;
}

const CAPS = ['butt', 'round', 'square'] as const;
const JOINS = ['miter', 'round', 'bevel'] as const;

/**
 * Seite gefiltert zeichnen (Ansicht und Export). `viewport` wie bei pdf.js (Ausschnitt, Maßstab, Drehung);
 * `occ` = Ebenen-Konfiguration mit ausgeblendeten Ebenen oder null.
 */
export async function renderFiltered(page: PDFPageProxy, canvas: HTMLCanvasElement, viewport: PageViewport, view: PlanView, occ: OptionalContentConfig | null): Promise<void> {
  const list = await page.getOperatorList();
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const t = viewport.transform as number[];
  ctx.setTransform(t[0], t[1], t[2], t[3], t[4], t[5]);
  const hidden = new Set((view.hideColors ?? []).map((c) => c.toLowerCase()));
  const minWidth = view.minWidth ?? 0;
  let st = { lw: 1, k: 1, stroke: '#000000', fill: '#000000', strokePat: false, fillPat: false, sa: 1, fa: 1 };
  const stack: (typeof st)[] = [];
  const vis: boolean[] = [];
  let visible = true;
  let inText = false;
  let pendingClip: CanvasFillRule | null = null;
  const applyDash = (arr: unknown, phase: unknown) => {
    try {
      ctx.setLineDash(Array.isArray(arr) ? (arr as number[]) : []);
      ctx.lineDashOffset = Number(phase) || 0;
    } catch {
      /* ungültiges Muster */
    }
  };
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        ctx.save();
        stack.push(st);
        st = { ...st };
        break;
      case OPS.restore:
        ctx.restore();
        st = stack.pop() ?? st;
        break;
      case OPS.transform: {
        const m = args as number[];
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        st.k *= detScale(m);
        break;
      }
      case OPS.paintFormXObjectBegin: {
        ctx.save();
        stack.push(st);
        st = { ...st };
        const m = args[0] as number[] | null;
        if (m && typeof m === 'object') {
          ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
          st.k *= detScale(m);
        }
        const bbox = args[1] as number[] | null;
        if (bbox && typeof bbox === 'object') {
          const clip = new Path2D();
          clip.rect(bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]);
          ctx.clip(clip);
        }
        break;
      }
      case OPS.paintFormXObjectEnd:
        ctx.restore();
        st = stack.pop() ?? st;
        break;
      case OPS.setLineWidth:
        st.lw = Number(args[0]) || 0;
        break;
      case OPS.setLineCap:
        ctx.lineCap = CAPS[Number(args[0])] ?? 'butt';
        break;
      case OPS.setLineJoin:
        ctx.lineJoin = JOINS[Number(args[0])] ?? 'miter';
        break;
      case OPS.setMiterLimit:
        ctx.miterLimit = Number(args[0]) || 10;
        break;
      case OPS.setDash:
        applyDash(args[0], args[1]);
        break;
      case OPS.setGState:
        for (const [k, v] of args[0] as [string, unknown][]) {
          if (k === 'LW') st.lw = Number(v) || 0;
          else if (k === 'LC') ctx.lineCap = CAPS[Number(v)] ?? 'butt';
          else if (k === 'LJ') ctx.lineJoin = JOINS[Number(v)] ?? 'miter';
          else if (k === 'D' && Array.isArray(v)) applyDash(v[0], v[1]);
          else if (k === 'CA') st.sa = Number(v);
          else if (k === 'ca') st.fa = Number(v);
        }
        break;
      case OPS.setStrokeRGBColor:
        st.stroke = hex(args[0]);
        st.strokePat = false;
        break;
      case OPS.setFillRGBColor:
        st.fill = hex(args[0]);
        st.fillPat = false;
        break;
      case OPS.setStrokeColorN:
        st.strokePat = true;
        break;
      case OPS.setFillColorN:
        st.fillPat = true;
        break;
      case OPS.beginText:
        inText = true;
        break;
      case OPS.endText:
        inText = false;
        break;
      case OPS.beginMarkedContent:
        vis.push(true);
        break;
      case OPS.beginMarkedContentProps: {
        const v = args[0] === 'OC' ? (occ ? occ.isVisible(args[1] as never) : true) : true;
        vis.push(v);
        visible = vis.every(Boolean);
        break;
      }
      case OPS.endMarkedContent:
        vis.pop();
        visible = vis.every(Boolean);
        break;
      case OPS.clip:
        pendingClip = 'nonzero';
        break;
      case OPS.eoClip:
        pendingClip = 'evenodd';
        break;
      case OPS.constructPath: {
        const op = args[0] as number;
        const path = makePath((args[1] as unknown[] | undefined)?.[0]);
        if (!visible || inText) {
          if (pendingClip) {
            ctx.clip(path, pendingClip);
            pendingClip = null;
          }
          break;
        }
        const rule: CanvasFillRule = EO_OPS.has(op) ? 'evenodd' : 'nonzero';
        if (FILL_OPS.has(op)) {
          const key = st.fillPat ? PATTERN : st.fill;
          if (!hidden.has(key)) {
            ctx.globalAlpha = st.fa;
            ctx.fillStyle = st.fillPat ? PATTERN_FILL : st.fill;
            ctx.fill(path, rule);
          }
        }
        if (STROKE_OPS.has(op)) {
          const key = st.strokePat ? PATTERN : st.stroke;
          if (!hidden.has(key) && st.lw * st.k >= minWidth) {
            ctx.globalAlpha = st.sa;
            ctx.strokeStyle = st.strokePat ? PATTERN_STROKE : st.stroke;
            ctx.lineWidth = st.lw > 0 ? st.lw : 0.15 / st.k;
            ctx.stroke(path);
          }
        }
        ctx.globalAlpha = 1;
        if (pendingClip) {
          ctx.clip(path, pendingClip);
          pendingClip = null;
        }
        break;
      }
      default:
        if (IMAGE_OPS.has(fn) && visible && !view.hideImages && (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject)) {
          try {
            const img = (fn === OPS.paintImageXObject ? page.objs.get(args[0] as string) : args[0]) as { bitmap?: ImageBitmap; width?: number; height?: number } | null;
            const bmp = img?.bitmap;
            if (bmp) {
              const w = img!.width ?? bmp.width;
              const h = img!.height ?? bmp.height;
              ctx.save();
              ctx.scale(1 / w, -1 / h);
              ctx.drawImage(bmp, 0, -h, w, h);
              ctx.restore();
            }
          } catch {
            /* Bild noch nicht geladen – weglassen */
          }
        }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
