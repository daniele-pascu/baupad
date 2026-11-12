import {
  LineCapStyle,
  PDFDocument,
  PDFName,
  StandardFonts,
  degrees,
  fill,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingGrayscaleColor,
  setGraphicsState,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { componentsOf, costCenterLabel, damagesOf, elementsOf, findPosition, planTitle, safeFileName, type ExportFile } from './aufmass';
import { dimsVisible, visibleDamages, visibleElements } from './layers';
import { annotationsOf, dimGeometry, dimLeader, isDrawingPlan, ROOM_LINE, textBoxWidth, textFontSize, textLines, lineEnds, PAPER, PRINT_HEADER_MM, PRINT_MARGIN_MM, fillRegion, aufmassPaper, shapeToPage, unitsPerMeter } from './drawing';
import { withRoomAreas } from './regions';
const textBoxWidthOf = (e: DrawElement, h: number) => textBoxWidth(e, h, e.font);
import { getBlob } from './db';
import { MADE_WITH } from './crew-pdf';
import { damageNo } from './numbering';
import {
  layoutLabels,
  leaderLine,
  pathToSvg,
  shapeAABB,
  shapePath,
  type Point,
  polygonShape,
  shapeVertices,
} from './geometry';
import { canvasToBlob, closePdf, clampRenderScale, imageToCanvas, loadImageBitmap, openPdf, pageViewport, renderPdfRegion, renderPdfToCanvas } from './pdf';
import type { ProjectState } from './store';
import { exportPaper, layoutSheet, planHeading, type OverviewCorner, type SheetLayout } from './sheet-layout';
import { DEFAULT_TRANSPARENCY, fillOf, fillPaths, strokeGeometry } from './style';
import type { Component, Damage, DrawElement, LegendPos, Plan, Rect, Shape, ShapeStyle, TextFont } from './types';
import { pdfStandardFont } from './text-font';
import { symbolGeometry } from './symbols';
import { wallGeometry, wallOpenings } from './walls';
import { deductionNumbers } from './numbering';
import { measureLabel } from './measure';
import { planLegend, type LegendEntry } from './legend';
import { formatArea, formatMeasure } from './numbers';

/**
 * PDF-Export bearbeiteter Pläne.
 *
 * Jede Seite hat genau das Papierformat des Plans (A4/A3, hoch/quer). Der Plan bzw. Ausschnitt
 * wird proportional und zentriert in den Druckbereich (1 cm Rand, Kopfzeile) eingepasst.
 * PDF-Pläne: Die Originalseite wird vektoriell eingebettet (nur der Planbereich); Markierungen,
 * Nummern und Kopfzeile werden als Vektorgrafik darübergelegt.
 * Bildpläne (und PDFs, die sich nicht verändern lassen, z. B. verschlüsselte) werden als
 * hochauflösendes Bild eingebettet.
 * Die Originaldateien bleiben unverändert.
 */

interface Ctx {
  out: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  charset: Set<number>;
  libDocs: Map<string, PDFDocument | null>;
  jsDocs: Map<string, PDFDocumentProxy>;
  overview: PdfExportOptions['overview'];
  projectName: string;
  /** alle Pläne des Projekts (Vorgaben der Legende) */
  plans: Plan[];
  /** Projektdaten (Texte auf importierten Plänen) */
  data: ProjectState;
  /** Schriften der Textobjekte (Standardschriften, vorab eingebettet) */
  textFonts: Map<string, PDFFont>;
}

/** Schrift eines Textobjekts (Helvetica, Times, Courier – normal, fett, kursiv) */
const textFont = (ctx: Ctx, f: TextFont | undefined) => ctx.textFonts.get(pdfStandardFont(f)) ?? ctx.font;

/** Text eines Textobjekts (Seitenkoordinaten) auf das Blatt zeichnen */
function drawTextElement(ctx: Ctx, page: PDFPage, e: DrawElement, shape: Shape, map: (p: Point) => Point, ptPerUnit: number) {
  if (e.room) {
    // Raumstempel: Zeilen mittig um die Mitte der Form (gedreht wie die Form)
    const fs = textFontSize(e, shape.h);
    const r = ((shape.rotation ?? 0) * Math.PI) / 180;
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    textLines(e).forEach((line, i) => {
      const f = textFont(ctx, i === 0 ? { ...e.font, bold: true } : e.font);
      const txt = clean(ctx, line);
      const wPage = f.widthOfTextAtSize(txt, fs * ptPerUnit) / ptPerUnit;
      // Grundlinie links der Zeile relativ zur Mitte, dann drehen
      const lx = -wPage / 2;
      const ly = -shape.h / 2 + fs * 0.82 + i * ROOM_LINE * fs;
      const at = map({ x: cx + lx * Math.cos(r) - ly * Math.sin(r), y: cy + lx * Math.sin(r) + ly * Math.cos(r) });
      page.drawText(txt, { x: at.x, y: at.y, size: fs * ptPerUnit, font: f, color: hexToRgb(visibleHex(e.color)), rotate: degrees(-(shape.rotation ?? 0)) });
    });
    return;
  }
  const at = map({ x: shape.x, y: shape.y + shape.h * 0.82 });
  page.drawText(clean(ctx, e.text ?? ''), { x: at.x, y: at.y, size: shape.h * ptPerUnit, font: textFont(ctx, e.font), color: hexToRgb(visibleHex(e.color)), rotate: degrees(-(shape.rotation ?? 0)) });
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Entfernt Zeichen, die die Standardschrift nicht darstellen kann. */
function clean(ctx: Ctx, s: string): string {
  return [...s.replace(/[–—]/g, '-')]
    .map((ch) => (ctx.charset.has(ch.codePointAt(0)!) ? ch : '?'))
    .join('');
}

function fitText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/** Abbildung Seitenkoordinaten → PDF-Benutzerkoordinaten für eine Ausgabeseite. */
interface Target {
  page: PDFPage;
  map: (p: Point) => Point;
  /** Textdrehung in Grad, damit Text in Leserichtung erscheint */
  textRotation: number;
  /** PDF-Punkte je Seiteneinheit */
  ptPerUnit: number;
}

export type { OverviewCorner } from './sheet-layout';

export interface PdfExportOptions {
  planIds: string[];
  /** Übersicht des Gesamtplans bei Planausschnitten (im freien Platz des Blatts, verdeckt nichts) */
  overview?: { enabled: boolean; corner: OverviewCorner };
}

export async function exportPlansPdf(data: ProjectState, opts: PdfExportOptions): Promise<ExportFile> {
  const out = await PDFDocument.create();
  out.setTitle('Aufmaßplan');
  out.setCreator('BauPad');
  out.setProducer('BauPad');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ctx: Ctx = {
    out,
    font,
    bold,
    charset: new Set(font.getCharacterSet()),
    libDocs: new Map(),
    jsDocs: new Map(),
    overview: opts.overview,
    projectName: data.project.name,
    plans: Object.values(data.plans),
    data,
    textFonts: new Map(),
  };
  // Schriften der Texte auf den gewählten Plänen vorab einbetten
  for (const planId of opts.planIds)
    for (const e of elementsOf(data, planId))
      if (e.type === 'text')
        for (const f of e.room ? [e.font, { ...e.font, bold: true }] : [e.font]) {
          const name = pdfStandardFont(f);
          if (!ctx.textFonts.has(name)) ctx.textFonts.set(name, name === StandardFonts.Helvetica ? font : name === StandardFonts.HelveticaBold ? bold : await out.embedFont(name));
        }
  try {
    for (const planId of opts.planIds) {
      const plan = data.plans[planId];
      if (!plan || plan.deletedAt) continue;
      await addPlanPage(ctx, data, plan);
    }
  } finally {
    for (const d of ctx.jsDocs.values()) void closePdf(d);
  }
  if (!out.getPageCount()) throw new Error('Keine Pläne ausgewählt.');
  const bytes = await out.save();
  const plans = opts.planIds.map((id) => data.plans[id]).filter(Boolean);
  const cc = plans.length ? data.costCenters[plans[0].costCenterId] : undefined;
  const sameCc = plans.every((p) => p.costCenterId === plans[0]?.costCenterId);
  const name =
    plans.length === 1
      ? safeFileName(data.project.name, costCenterLabel(cc), plans[0].planNumber || plans[0].planName, 'Plan')
      : safeFileName(data.project.name, sameCc ? (costCenterLabel(cc)) : '', 'Plaene');
  return { name: `${name}.pdf`, data: bytes, mimeType: 'application/pdf' };
}

async function addPlanPage(ctx: Ctx, data: ProjectState, plan: Plan) {
  if (isDrawingPlan(plan)) {
    addDrawingPage(ctx, data, plan);
    return;
  }
  const file = data.files[plan.fileId];
  if (!file) throw new Error(`Originaldatei zu Plan ${planTitle(plan)} fehlt.`);
  const region: Rect = plan.crop ?? { x: 0, y: 0, w: plan.pageWidth, h: plan.pageHeight };
  const damages = visibleDamages(plan, damagesOf(data, plan.id));
  // Blatt A4/A3: Plan(ausschnitt) proportional und zentriert eingepasst, Übersicht im freien Platz
  const withOverview = !!(ctx.overview?.enabled && plan.crop);
  const L = layoutSheet(exportPaper(plan), region, {
    overview: withOverview ? { aspect: plan.pageWidth / plan.pageHeight, corner: ctx.overview!.corner } : null,
  });

  if (file.kind === 'pdf') {
    const bytes = await getBlob(file.id);
    if (!bytes) throw new Error(`Originaldatei ${file.name} nicht gefunden.`);
    let jsDoc = ctx.jsDocs.get(file.id);
    if (!jsDoc) {
      jsDoc = await openPdf(bytes);
      ctx.jsDocs.set(file.id, jsDoc);
    }
    const jsPage = await jsDoc.getPage(plan.pageIndex + 1);
    if (!ctx.libDocs.has(file.id)) {
      let libDoc: PDFDocument | null = null;
      try {
        libDoc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
      } catch {
        libDoc = null; // z. B. verschlüsselt → Bild-Export
      }
      ctx.libDocs.set(file.id, libDoc);
    }
    const libDoc = ctx.libDocs.get(file.id);
    const rot = plan.rotation ?? 0;
    const full = withOverview ? await renderPdfToCanvas(jsPage, 900, null, rot) : null;
    if (libDoc) {
      try {
        // Originalseite vektoriell einbetten: nur der Planbereich (BBox), skaliert und ggf. gedreht
        // auf die Planfläche des Blatts (Matrix aus der Ansichtstransformation von pdf.js)
        const viewport = pageViewport(jsPage, rot);
        const [a, b, c, d, e, f] = viewport.transform as number[];
        const pts = [
          [region.x, region.y],
          [region.x + region.w, region.y],
          [region.x, region.y + region.h],
          [region.x + region.w, region.y + region.h],
        ].map(([x, y]) => viewport.convertToPdfPoint(x, y) as number[]);
        const xs = pts.map((q) => q[0]);
        const ys = pts.map((q) => q[1]);
        const bbox = { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
        const u = L.u;
        const matrix: [number, number, number, number, number, number] = [
          u * a,
          -u * b,
          u * c,
          -u * d,
          L.plan.x + (e - region.x) * u,
          L.h - L.plan.y - (f - region.y) * u,
        ];
        const embedded = await ctx.out.embedPage(libDoc.getPage(plan.pageIndex), bbox, matrix);
        const page = ctx.out.addPage([L.w, L.h]);
        // weißer Untergrund: der Mischmodus braucht einen deckenden Hintergrund (sonst grau in manchen Betrachtern)
        if (!plan.planColor) page.drawRectangle({ x: L.plan.x, y: L.h - L.plan.y - L.plan.h, width: L.plan.w, height: L.plan.h, color: rgb(1, 1, 1) });
        page.drawPage(embedded);
        if (!plan.planColor) grayOut(ctx, page, { x: L.plan.x, y: L.h - L.plan.y - L.plan.h, w: L.plan.w, h: L.plan.h });
        await finishSheet(ctx, page, plan, L, region, damages, full);
        return;
      } catch (e) {
        console.warn('Vektor-Export nicht möglich, verwende Bild-Export', e);
      }
    }
    // Bild-Export für nicht veränderbare PDFs: etwa 200 dpi auf dem Papier
    const scale = clampRenderScale(region.w, region.h, Math.max(1, (L.u * 200) / 72));
    const canvas = document.createElement('canvas');
    await renderPdfRegion(jsPage, canvas, region, scale, rot).promise;
    await addRasterSheet(ctx, plan, L, region, damages, canvas, full);
    return;
  }

  const bytes = await getBlob(file.id);
  if (!bytes) throw new Error(`Originaldatei ${file.name} nicht gefunden.`);
  const bitmap = await loadImageBitmap(bytes, file.mimeType);
  try {
    const canvas = imageToCanvas(bitmap, 8192, region, plan.rotation);
    const full = withOverview ? imageToCanvas(bitmap, 900, null, plan.rotation) : null;
    await addRasterSheet(ctx, plan, L, region, damages, canvas, full);
  } finally {
    bitmap.close();
  }
}

/**
 * Planunterlage schwarz-weiß (Vektor bleibt Vektor): graue Fläche mit Mischmodus „Sättigung“
 * über den Plan – übernimmt die Helligkeit des Plans, entfernt nur die Farbe. Die Markierungen
 * werden danach farbig darübergezeichnet.
 */
function grayOut(ctx: Ctx, page: PDFPage, r: { x: number; y: number; w: number; h: number }) {
  const gs = page.node.newExtGState('GSGray', ctx.out.context.obj({ Type: 'ExtGState', BM: PDFName.of('Saturation') }));
  page.pushOperators(pushGraphicsState(), setGraphicsState(gs), setFillingGrayscaleColor(0.5), rectangle(r.x, r.y, r.w, r.h), fill(), popGraphicsState());
}

/** Bild in Graustufen (Planunterlage schwarz-weiß), in place */
function grayscaleCanvas(canvas: HTMLCanvasElement) {
  const c2d = canvas.getContext('2d', { willReadFrequently: true });
  if (!c2d || !canvas.width || !canvas.height) return;
  const img = c2d.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  c2d.putImageData(img, 0, 0);
}

async function addRasterSheet(ctx: Ctx, plan: Plan, L: SheetLayout, region: Rect, damages: Damage[], canvas: HTMLCanvasElement, full: HTMLCanvasElement | null) {
  if (!plan.planColor) {
    grayscaleCanvas(canvas);
    if (full) grayscaleCanvas(full);
  }
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const img = await ctx.out.embedJpg(await blob.arrayBuffer());
  const page = ctx.out.addPage([L.w, L.h]);
  page.drawImage(img, { x: L.plan.x, y: L.h - L.plan.y - L.plan.h, width: L.plan.w, height: L.plan.h });
  await finishSheet(ctx, page, plan, L, region, damages, full);
}

/** Kopfzeile, Markierungen mit Nummern und ggf. Übersicht auf das Blatt zeichnen. */
async function finishSheet(ctx: Ctx, page: PDFPage, plan: Plan, L: SheetLayout, region: Rect, damages: Damage[], full: HTMLCanvasElement | null) {
  const map = (p: Point): Point => ({ x: L.plan.x + (p.x - region.x) * L.u, y: L.h - (L.plan.y + (p.y - region.y) * L.u) });
  const target: Target = { page, map, textRotation: 0, ptPerUnit: L.u };
  drawSheetHeader(ctx, page, L.h, L.header, plan, plan.showPaper ? [PAPER[exportPaper(plan)].label] : []);
  drawDamages(ctx, target, region, damages, []);
  // Texte (Werkzeug „Text“ im Aufmaß)
  const k = unitsPerMeter(plan);
  for (const e of visibleElements(plan, elementsOf(ctx.data, plan.id))) if (e.type === 'text') drawTextElement(ctx, page, e, shapeToPage(e.shape, k), map, L.u);
  const lg = planLegend(plan, ctx.plans, damages);
  if (lg.show) drawLegend(ctx, page, { x: L.plan.x, y: L.h - (L.plan.y + L.plan.h), w: L.plan.w, h: L.plan.h }, lg.pos, lg.entries);
  if (L.overview && full && plan.crop) await drawOverview(ctx, page, L, plan, L.overview, full);
}

/**
 * Kopfzeile: links „Plannummer 067 | Aufmaßplan“, darunter optional die Bemerkung; rechts nur
 * die ausdrücklich eingeschalteten Angaben (Format, Maßstab). Trennlinie darunter.
 */
function drawSheetHeader(ctx: Ctx, page: PDFPage, pageH: number, header: Rect, plan: Plan, right: string[], reserveRight = 0) {
  const size = 15;
  const rightText = clean(ctx, right.join(' · '));
  const rw = rightText ? ctx.font.widthOfTextAtSize(rightText, 10) : 0;
  const maxW = header.w - Math.max(rw, reserveRight) - (rw || reserveRight ? 16 : 0);
  page.drawText(fitText(ctx.bold, clean(ctx, planHeading(plan)), size, maxW), { x: header.x, y: pageH - header.y - size, size, font: ctx.bold, color: rgb(0.1, 0.1, 0.12) });
  const note = plan.showNote ? plan.description.trim().replace(/\s+/g, ' ') : '';
  if (note) page.drawText(fitText(ctx.font, clean(ctx, note), 8, maxW), { x: header.x, y: pageH - header.y - size - 11, size: 8, font: ctx.font, color: rgb(0.3, 0.33, 0.38) });
  if (rightText) page.drawText(rightText, { x: header.x + header.w - rw, y: pageH - header.y - 14, size: 10, font: ctx.font, color: rgb(0.3, 0.33, 0.38) });
  const ly = pageH - (header.y + header.h) + 6;
  page.drawLine({ start: { x: header.x, y: ly }, end: { x: header.x + header.w, y: ly }, thickness: 0.5, color: rgb(0.8, 0.82, 0.85) });
}

// ---------------------------------------------------------------------------
// Übersicht des Gesamtplans bei Planausschnitten

async function drawOverview(ctx: Ctx, page: PDFPage, L: SheetLayout, plan: Plan, o: Rect, full: HTMLCanvasElement) {
  const blob = await canvasToBlob(full, 'image/jpeg', 0.85);
  const img: PDFImage = await ctx.out.embedJpg(await blob.arrayBuffer());
  const y = (top: number, hgt: number) => L.h - top - hgt;
  page.drawImage(img, { x: o.x, y: y(o.y, o.h), width: o.w, height: o.h });
  page.drawRectangle({ x: o.x, y: y(o.y, o.h), width: o.w, height: o.h, borderColor: rgb(0.45, 0.48, 0.52), borderWidth: 0.6 });
  // Verwendeter Ausschnitt rot umrandet (maßstäblich zur Gesamtseite)
  const c = plan.crop!;
  const sx = o.w / plan.pageWidth;
  const sy = o.h / plan.pageHeight;
  page.drawRectangle({ x: o.x + c.x * sx, y: y(o.y + c.y * sy, c.h * sy), width: c.w * sx, height: c.h * sy, borderColor: rgb(0.86, 0.1, 0.1), borderWidth: 1.6 });
  const fs = 7;
  page.drawText(clean(ctx, fitText(ctx.font, 'Gesamtplan – Ausschnitt rot', fs, o.w)), { x: o.x, y: L.h - (o.y + o.h) - fs - 2, size: fs, font: ctx.font, color: rgb(0.35, 0.38, 0.42) });
}

/** Schriftgröße der Nummern in PDF-Punkten, abhängig von der Plangröße auf dem Papier. */
function labelFontPt(region: Rect, ptPerUnit: number): number {
  const minSide = Math.min(region.w, region.h) * ptPerUnit;
  return Math.max(7, Math.min(16, minSide * 0.011));
}

function drawRectMapped(t: Target, r: Rect, opts: { color?: ReturnType<typeof rgb>; borderColor?: ReturnType<typeof rgb>; borderWidth?: number; opacity?: number }) {
  const a = t.map({ x: r.x, y: r.y });
  const b = t.map({ x: r.x + r.w, y: r.y + r.h });
  t.page.drawRectangle({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
    color: opts.color,
    borderColor: opts.borderColor,
    borderWidth: opts.borderWidth,
    opacity: opts.opacity,
  });
}

function drawTextMapped(t: Target, text: string, at: Point, size: number, font: PDFFont, color = rgb(0.1, 0.1, 0.12)) {
  const p = t.map(at);
  t.page.drawText(text, { x: p.x, y: p.y, size, font, color, rotate: degrees(t.textRotation) });
}

/**
 * Form mit ihrer Darstellung zeichnen: Füllung aus der unveränderten Form, Umrandung mit
 * Linientyp und -stärke (Wellen-/Zickzacklinie nur als Darstellung), optional mit Kontur.
 */
function drawStyledShape(
  page: PDFPage,
  map: (p: Point) => Point,
  shape: Shape,
  color: string,
  style: ShapeStyle | undefined,
  width: number,
  defaultTransparency: number,
  halo: ReturnType<typeof rgb> | null,
) {
  // drawSvgPath erwartet y nach unten
  const svgMap = (p: Point) => {
    const q = map(p);
    return { x: q.x, y: -q.y };
  };
  const fill = fillOf(shape, color, style, defaultTransparency);
  if (fill && fill.opacity > 0) {
    const f = fillPaths(shape, svgMap, fill, 1);
    if (f.solid) page.drawSvgPath(f.solid, { x: 0, y: 0, color: hexToRgb(fill.color), opacity: fill.opacity });
    else if (f.hatch) {
      // Flächenfarbe hinter der Schraffur
      if (f.bg && fill.bg) page.drawSvgPath(f.bg, { x: 0, y: 0, color: hexToRgb(fill.bg) });
      page.drawSvgPath(f.hatch, { x: 0, y: 0, borderColor: hexToRgb(fill.color), borderWidth: f.hatchWidth, borderOpacity: fill.opacity, borderLineCap: LineCapStyle.Round });
    }
  }
  const line = strokeGeometry(shape, svgMap, style?.lineType, width, width, style?.dashScale);
  const common = { x: 0, y: 0, borderDashArray: line.dash, borderLineCap: LineCapStyle.Round };
  const lineOpacity = 1 - Math.min(100, Math.max(0, style?.lineTransparency ?? 0)) / 100;
  if (halo) page.drawSvgPath(line.d, { ...common, borderColor: halo, borderWidth: width + 1.6, borderOpacity: 0.75 * lineOpacity });
  page.drawSvgPath(line.d, { ...common, borderColor: hexToRgb(color), borderWidth: width, borderOpacity: lineOpacity });
}

/** Gut sichtbare Strichfarbe (Weiß wäre auf weißem Plan unsichtbar) */
const visibleHex = (hex: string) => (hex.toLowerCase() === '#ffffff' ? '#8e8e93' : hex);
/** Kontur: hell unter dunklen, dunkel unter hellen Farben */
function haloRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 170 ? rgb(0.11, 0.11, 0.12) : rgb(1, 1, 1);
}

function drawDamages(ctx: Ctx, t: Target, region: Rect, damages: Damage[], components: Component[]) {
  const u = 1 / t.ptPerUnit;
  const fs = labelFontPt(region, t.ptPerUnit);
  const stroke = Math.max(0.8, fs * 0.14);
  // Formen
  for (const d of damages) {
    if (d.style?.points) {
      // Stück mit Punkten: gefüllte Kreise an jedem Punkt
      const seen = new Set<string>();
      for (const p of shapeVertices(d.shape)) {
        const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        t.page.drawCircle({ ...t.map(p), size: fs * 0.42, color: hexToRgb(visibleHex(d.color)), borderColor: rgb(1, 1, 1), borderWidth: stroke * 0.6 });
      }
      continue;
    }
    const width = d.style?.lineWidth ?? stroke;
    drawStyledShape(t.page, (p) => t.map(p), d.shape, d.color, d.style, width, DEFAULT_TRANSPARENCY.damage, haloRgb(d.color));
  }
  // im Plan gezeichnete Abzüge: gestrichelt, schraffiert in ihrer Farbe, mit Nummer (z. B. „3-A1 Tür“)
  const dedStyle: ShapeStyle = { lineType: 'dashed', fillType: 'hatch', hatch: { pattern: 'lines', angle: 45, spacing: 4 }, fillTransparency: 35 };
  for (const d of damages) {
    const nos = deductionNumbers(d);
    for (const [xi, x] of (d.deductions ?? []).entries()) {
      if (!x.shape) continue;
      const col = x.color ?? '#e03131';
      drawStyledShape(t.page, (p) => t.map(p), x.shape, col, dedStyle, stroke * 0.8, 35, null);
      const b = shapeAABB(x.shape);
      const at = x.labelAt ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const name = x.label && !/^(Abzug|Zuschlag) \d+$/.test(x.label) ? ` ${x.label}` : '';
      const text = clean(ctx, `${nos[xi]}${name}`);
      // gut lesbar: größer, fett, auf weißem Kästchen mit Rahmen in der Farbe des Abzugs
      // gleiche Größe und gleiches Kästchen wie die Nummern der Messungen
      const tw = ctx.bold.widthOfTextAtSize(text, fs) * u;
      const pad = fs * 0.35 * u;
      const bh = fs * 1.35 * u;
      drawRectMapped(t, { x: at.x - tw / 2 - pad, y: at.y - bh / 2, w: tw + 2 * pad, h: bh }, { color: rgb(1, 1, 1), borderColor: hexToRgb(col), borderWidth: stroke * 0.8, opacity: 0.92 });
      drawTextMapped(t, text, { x: at.x - tw / 2, y: at.y + bh * 0.23 }, fs, ctx.bold);
    }
  }
  // Nummern
  const padX = fs * 0.35 * u;
  const boxH = fs * 1.35 * u;
  const labels = layoutLabels(
    damages.map((d) => ({
      id: d.id,
      bounds: shapeAABB(d.shape),
      shape: d.shape,
      w: ctx.bold.widthOfTextAtSize(clean(ctx, damageNo(d)), fs) * u + 2 * padX,
      h: boxH,
      offset: d.labelOffset,
    })),
    fs * 0.25 * u,
    { area: region },
  );
  // Verbindungslinien zuerst, damit sie unter den Nummern liegen
  for (const d of damages) {
    const line = leaderLine(d.shape, labels.get(d.id)!, fs * 0.4 * u);
    if (line) t.page.drawLine({ start: t.map(line.from), end: t.map(line.to), thickness: stroke * 0.7, color: hexToRgb(d.color), opacity: 0.95 });
  }
  for (const d of damages) {
    const r = labels.get(d.id)!;
    const color = hexToRgb(visibleHex(d.color));
    drawRectMapped(t, r, { color: rgb(1, 1, 1), borderColor: color, borderWidth: stroke * 0.8, opacity: 0.92 });
    drawTextMapped(t, clean(ctx, damageNo(d)), { x: r.x + padX, y: r.y + boxH * 0.73 }, fs, ctx.bold);
  }
  // Bauteilkennzeichnungen (A, B, C …) als Kreis mit Buchstabe
  for (const c of components) {
    const radius = fs * 0.95; // in Punkten
    const center = t.map({ x: c.x, y: c.y });
    const white = c.color.toLowerCase() === '#ffffff';
    t.page.drawCircle({
      x: center.x,
      y: center.y,
      size: radius,
      color: white ? rgb(0.11, 0.11, 0.12) : rgb(1, 1, 1),
      borderColor: hexToRgb(visibleHex(c.color)),
      borderWidth: stroke * 1.3,
    });
    const letter = clean(ctx, c.letter);
    const size = fs * (letter.length > 1 ? 0.8 : 1.05);
    const tw = ctx.bold.widthOfTextAtSize(letter, size) * u;
    drawTextMapped(
      t,
      letter,
      { x: c.x - tw / 2, y: c.y + size * 0.36 * u },
      size,
      ctx.bold,
      white ? rgb(1, 1, 1) : hexToRgb(visibleHex(c.color)),
    );
  }
}

// ---------------------------------------------------------------------------
// Selbst gezeichnete Pläne

const MM = 72 / 25.4;

/**
 * Gezeichneter Plan als Vektorseite im Format A3 mit Normmaßstab (z. B. 1:100).
 * Zeichnungsobjekte, Maßketten, Messungen und Bauteilbuchstaben werden als Vektoren gezeichnet.
 */
function addDrawingPage(ctx: Ctx, data: ProjectState, plan: Plan) {
  const k = unitsPerMeter(plan);
  // Ausgeblendete Ebenen werden nicht gedruckt; der Blattausschnitt folgt dem gesamten Inhalt
  const allElements = withRoomAreas(elementsOf(data, plan.id), textBoxWidthOf);
  const allDamages = damagesOf(data, plan.id);
  const elements = visibleElements(plan, allElements);
  const damages = visibleDamages(plan, allDamages);
  // Bauteilbuchstaben werden nicht mehr verwendet (Daten bleiben gespeichert, erscheinen aber nicht im Export)
  const components: ReturnType<typeof componentsOf> = [];
  // Aufmaßplan: die Zeichnung füllt immer das Blatt (gewähltes Format, sonst A3 passend) und steht zentriert –
  // egal wie groß sie ist; der Maßstab des Zeichenblatts wird dafür nicht eingehalten
  const region = fillRegion(plan, allElements, allDamages);
  const paperFmt = PAPER[aufmassPaper(plan, region)];
  const W = paperFmt.w * MM;
  const H = paperFmt.h * MM;
  const margin = PRINT_MARGIN_MM * MM;
  const headerPt = PRINT_HEADER_MM * MM;
  const avail = { w: (W - 2 * margin) / MM, h: (H - 2 * margin - headerPt) / MM };
  const fillU = Math.min((avail.w * MM) / region.w, (avail.h * MM) / region.h);
  const scaleN = ((1000 / k) * MM) / fillU;
  // Seiteneinheit (1/k m) → Punkte auf dem Papier
  const u = (1000 / k / scaleN) * MM;
  const ox = (W - region.w * u) / 2;
  const oy = margin + headerPt + (H - 2 * margin - headerPt - region.h * u) / 2;
  const page = ctx.out.addPage([W, H]);
  /** Papierkoordinaten (pt, y nach unten) → PDF */
  const pdf = (q: Point): Point => ({ x: q.x, y: H - q.y });
  const paper = (p: Point): Point => ({ x: ox + (p.x - region.x) * u, y: oy + (p.y - region.y) * u });
  const map = (p: Point): Point => pdf(paper(p));
  const target: Target = { page, map, textRotation: 0, ptPerUnit: u };

  // Kopf: Plannummer | Titel; Format und Maßstab nur, wenn ausdrücklich eingeschaltet
  const fmtLabel = paperFmt.label;
  // „ohne Maßstab“ gewählt: nie anzeigen
  const showScale = !!plan.showScale && !plan.drawing?.fit;
  const barM = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].find((m) => (m * 1000) / scaleN >= 35) ?? 200;
  const barPt = ((barM * 1000) / scaleN) * MM;
  drawSheetHeader(
    ctx,
    page,
    H,
    { x: margin, y: margin, w: W - 2 * margin, h: headerPt },
    plan,
    // tatsächlicher Maßstab auf dem Blatt (Zeichnung füllt das Blatt, daher meist kein Normmaßstab)
    [plan.showPaper ? fmtLabel : '', showScale ? `Maßstab 1:${Math.round(scaleN)}` : ''].filter(Boolean),
    showScale ? barPt + 12 : 0,
  );

  // Zeichnungsobjekte
  const dimColor = rgb(0.16, 0.3, 0.5);
  const openingsPage = wallOpenings(elements, k);
  for (const e of elements) {
    const shape = shapeToPage(e.shape, k);
    const color = hexToRgb(visibleHex(e.color));
    if (e.type === 'text') {
      drawTextElement(ctx, page, e, shape, map, u);
      continue;
    }
    if (e.type === 'dimension') {
      const svg = pathToSvg(shapePath(shape), (p) => {
        const q = map(p);
        return { x: q.x, y: -q.y };
      });
      page.drawSvgPath(svg, { x: 0, y: 0, borderColor: color, borderWidth: 0.6 });
      if (e.offset) {
        // Hilfslinien zu den gemessenen Punkten
        const [a, b] = lineEnds(shape);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / len;
        const ny = (b.x - a.x) / len;
        const off = e.offset * k;
        const s = Math.sign(off);
        const over = 1.2 / u; // 1,2 pt Überstand
        // Abstand zum Objekt in mm auf dem Papier (einstellbar je Maßlinie)
        const gap = Math.min(((e.extGap ?? 1) * MM) / u, Math.abs(off) * 0.8);
        for (const p of [a, b]) {
          const from = map({ x: p.x + nx * (off - s * gap), y: p.y + ny * (off - s * gap) });
          const to = map({ x: p.x - nx * s * over, y: p.y - ny * s * over });
          page.drawLine({ start: from, end: to, thickness: 0.4, color });
        }
      }
      continue;
    }
    if (e.type === 'wall' && e.wall) {
      // Wand: Flächenstücke (Füllung/Schraffur) und Umriss; Öffnungen der Türen/Fenster ausgespart
      const geo = wallGeometry(shapeVertices(shape), shape.closed === true, e.wall.thickness * k, openingsPage);
      for (const q of geo.quads) {
        const qs = polygonShape(q, true);
        const f = fillOf(qs, visibleHex(e.color), e.style, DEFAULT_TRANSPARENCY.element);
        if (!f || f.opacity <= 0) continue;
        const svgMap = (p: Point) => {
          const m = map(p);
          return { x: m.x, y: -m.y };
        };
        const fp = fillPaths(qs, svgMap, f, 1);
        if (fp.solid) page.drawSvgPath(fp.solid, { x: 0, y: 0, color: hexToRgb(f.color), opacity: f.opacity });
        else if (fp.hatch) {
          if (fp.bg && f.bg) page.drawSvgPath(fp.bg, { x: 0, y: 0, color: hexToRgb(f.bg) });
          page.drawSvgPath(fp.hatch, { x: 0, y: 0, borderColor: hexToRgb(f.color), borderWidth: fp.hatchWidth, borderOpacity: f.opacity, borderLineCap: LineCapStyle.Round });
        }
      }
      for (const [a, b] of geo.lines) page.drawLine({ start: map(a), end: map(b), thickness: e.style?.lineWidth ?? 0.9, color, lineCap: LineCapStyle.Round });
      continue;
    }
    if (e.type === 'symbol' && e.symbol) {
      // Bauteil/Symbol als Vektor (wie am Bildschirm)
      const geo = symbolGeometry(e.symbol, shape, k);
      const lw = e.style?.lineWidth ?? 0.8;
      for (const l of geo.lines) {
        const d = l.pts.map((p, i) => {
          const q = map(p);
          return `${i ? 'L' : 'M'}${q.x.toFixed(2)} ${(-q.y).toFixed(2)}`;
        }).join('') + (l.closed ? 'Z' : '');
        page.drawSvgPath(d, { x: 0, y: 0, borderColor: color, borderWidth: l.dashed ? lw * 0.6 : lw, borderDashArray: l.dashed ? [3, 2] : undefined, borderLineCap: LineCapStyle.Round, ...(l.fill ? { color } : {}) });
      }
      for (const t of geo.texts) {
        const size = t.size * u;
        const txt = clean(ctx, t.text);
        const w = ctx.bold.widthOfTextAtSize(txt, size);
        const c = map(t.at);
        const a = (-t.angle * Math.PI) / 180;
        // Mitte → linke Grundlinie (gedreht)
        const ox = -w / 2;
        const oy = -size * 0.35;
        page.drawText(txt, { x: c.x + ox * Math.cos(a) - oy * Math.sin(a), y: c.y + ox * Math.sin(a) + oy * Math.cos(a), size, font: ctx.bold, color, rotate: degrees(-t.angle) });
      }
      continue;
    }
    drawStyledShape(page, map, shape, visibleHex(e.color), e.style, e.style?.lineWidth ?? 1.1, DEFAULT_TRANSPARENCY.element, null);
  }
  // Maßketten
  const fs = 7.5;
  const drawRotatedText = (text: string, center: Point, angle: number) => {
    const t = clean(ctx, text);
    const w = ctx.bold.widthOfTextAtSize(t, fs);
    const a = (angle * Math.PI) / 180;
    const d = { x: Math.cos(a), y: Math.sin(a) };
    const down = { x: -Math.sin(a), y: Math.cos(a) };
    const start = pdf({ x: center.x - (d.x * w) / 2 + down.x * fs * 0.35, y: center.y - (d.y * w) / 2 + down.y * fs * 0.35 });
    page.drawText(t, { x: start.x, y: start.y, size: fs, font: ctx.bold, color: dimColor, rotate: degrees(-angle) });
  };
  for (const e of dimsVisible(plan) ? elements : []) {
    const { dims, labels } = annotationsOf(e);
    for (const dm of dims) {
      const a = paper({ x: dm.a.x * k, y: dm.a.y * k });
      const b = paper({ x: dm.b.x * k, y: dm.b.y * k });
      // Maßlinie zu kurz für die Zahl → daneben mit Führungslinie und Unterstrich (wie im CAD)
      const ld = dm.leader ? dimLeader(a, b, ctx.bold.widthOfTextAtSize(clean(ctx, dm.text), fs), fs) : null;
      if (ld) {
        for (let i = 1; i < ld.path.length; i++) page.drawLine({ start: pdf(ld.path[i - 1]), end: pdf(ld.path[i]), thickness: 0.35, color: dimColor });
        drawRotatedText(dm.text, ld.center, ld.angle);
        continue;
      }
      if (Math.hypot(b.x - a.x, b.y - a.y) < 12) continue;
      const off = dm.inline ? 0 : 9;
      const g = dimGeometry(a, b, dm.side, off);
      if (!dm.inline) {
        const ext = (p: Point, q: Point) =>
          page.drawLine({ start: pdf({ x: p.x + g.nx * 2, y: p.y + g.ny * 2 }), end: pdf({ x: q.x + g.nx * 2.5, y: q.y + g.ny * 2.5 }), thickness: 0.35, color: dimColor });
        ext(a, g.a2);
        ext(b, g.b2);
        page.drawLine({ start: pdf(g.a2), end: pdf(g.b2), thickness: 0.45, color: dimColor });
        const ang = Math.atan2(g.b2.y - g.a2.y, g.b2.x - g.a2.x) + Math.PI / 4;
        for (const p of [g.a2, g.b2]) {
          const tx = Math.cos(ang) * 2.2;
          const ty = Math.sin(ang) * 2.2;
          page.drawLine({ start: pdf({ x: p.x - tx, y: p.y - ty }), end: pdf({ x: p.x + tx, y: p.y + ty }), thickness: 0.8, color: dimColor });
        }
      }
      const textOff = dm.inline ? 5 : 4;
      drawRotatedText(dm.text, { x: g.mid.x + g.nx * textOff, y: g.mid.y + g.ny * textOff }, g.angle);
    }
    for (const l of labels) {
      const at = paper({ x: l.at.x * k, y: l.at.y * k });
      if (l.angle === undefined && !l.lines) {
        drawRotatedText(l.text, at, 0);
        continue;
      }
      // gedreht/mehrzeilig (Fenster nach ÖNORM): Zeilen quer zur Leserichtung, Bündigkeit wie am Bildschirm
      const lines = l.lines ?? [l.text];
      const anchor = l.anchor ?? 'middle';
      const a = ((l.angle ?? 0) * Math.PI) / 180;
      const d = { x: Math.cos(a), y: Math.sin(a) };
      const down = { x: -Math.sin(a), y: Math.cos(a) };
      const along = anchor === 'middle' ? 0 : (anchor === 'end' ? -1 : 1) * (l.pad ?? 0) * fs;
      lines.forEach((ln, j) => {
        const t = clean(ctx, ln);
        const w = ctx.bold.widthOfTextAtSize(t, fs);
        const x0 = (anchor === 'end' ? -w : anchor === 'middle' ? -w / 2 : 0) + along;
        const y0 = (anchor === 'middle' ? (l.pad ?? 0) * fs : 0) + (j - (lines.length - 1) / 2) * fs * 1.15 + fs * 0.35;
        const start = pdf({ x: at.x + d.x * x0 + down.x * y0, y: at.y + d.y * x0 + down.y * y0 });
        page.drawText(t, { x: start.x, y: start.y, size: fs, font: ctx.bold, color: dimColor, rotate: degrees(-(l.angle ?? 0)) });
      });
    }
  }
  // Messungen und Bauteilbuchstaben darüber
  drawDamages(ctx, target, region, damages, components);
  const lg = planLegend(plan, Object.values(data.plans), damages);
  if (lg.show) drawLegend(ctx, page, { x: margin - 2, y: margin - 2, w: W - 2 * margin + 4, h: H - 2 * margin - headerPt + 4 }, lg.pos, lg.entries);
  // Maßstabsleiste rechts im Kopfbereich (nur wenn der Maßstab angezeigt werden soll)
  if (!showScale) return;
  const lblW = ctx.font.widthOfTextAtSize(`${String(barM).replace('.', ',')} m`, 6.5);
  const bx = W - margin - barPt - lblW / 2;
  const by = H - margin - 28;
  const seg = 4;
  for (let i = 0; i < seg; i++)
    page.drawRectangle({ x: bx + (barPt / seg) * i, y: by, width: barPt / seg, height: 3, color: i % 2 ? rgb(1, 1, 1) : rgb(0.15, 0.15, 0.17), borderColor: rgb(0.15, 0.15, 0.17), borderWidth: 0.5 });
  page.drawText('0', { x: bx - 2, y: by + 5, size: 6.5, font: ctx.font, color: rgb(0.3, 0.33, 0.38) });
  const lbl = `${String(barM).replace('.', ',')} m`;
  page.drawText(lbl, { x: bx + barPt - ctx.font.widthOfTextAtSize(lbl, 6.5) / 2, y: by + 5, size: 6.5, font: ctx.font, color: rgb(0.3, 0.33, 0.38) });
}

/**
 * Foto-PDF (eigene Datei): je Foto ein großes Bild, darüber klar beschriftet, zu welchem Plan, welcher
 * Nummer und welcher Leistungsposition es gehört (dazu Art, Menge, Bemerkung). Zwei Fotos je A4-Seite.
 */
export async function exportPhotosPdf(data: ProjectState, planIds: string[]): Promise<ExportFile> {
  const out = await PDFDocument.create();
  out.setTitle('Fotos Aufmaß');
  out.setCreator('BauPad');
  out.setProducer('BauPad');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const ctx = { charset: new Set(font.getCharacterSet()) } as Ctx;
  const { getPhotoStorage } = await import('./photo-storage');
  const storage = getPhotoStorage();
  const photoMeta = new Map((await storage.list()).map((p) => [p.id, p]));
  const W = 595.28;
  const H = 841.89;
  const M = 36;
  const INK = rgb(0.1, 0.1, 0.12);
  const MUTED = rgb(0.4, 0.42, 0.46);
  const HEAD = 34;
  const SLOT = (H - 2 * M - HEAD - 16) / 2;
  const CAP = 50;
  const date = new Date().toLocaleDateString('de-DE');
  let page: PDFPage | null = null;
  let slot = 2;
  let pageNo = 0;
  const newPage = () => {
    page = out.addPage([W, H]);
    pageNo++;
    slot = 0;
    page.drawText(fitText(bold, clean(ctx, `Fotodokumentation - ${data.project.name}`), 13, W - 2 * M - 80), { x: M, y: H - M - 13, size: 13, font: bold, color: INK });
    page.drawText(date, { x: W - M - font.widthOfTextAtSize(date, 9), y: H - M - 12, size: 9, font, color: MUTED });
    page.drawLine({ start: { x: M, y: H - M - HEAD + 10 }, end: { x: W - M, y: H - M - HEAD + 10 }, thickness: 0.6, color: MUTED });
    const pn = `Seite ${pageNo}`;
    page.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 8), y: M - 16, size: 8, font, color: MUTED });
    page.drawText(MADE_WITH, { x: (W - font.widthOfTextAtSize(MADE_WITH, 8)) / 2, y: M - 16, size: 8, font, color: MUTED });
  };
  let count = 0;
  for (const planId of planIds) {
    const plan = data.plans[planId];
    if (!plan || plan.deletedAt) continue;
    for (const d of damagesOf(data, plan.id)) {
      for (const id of d.photoIds ?? []) {
        let img: PDFImage;
        try {
          const b = await storage.blobs(id);
          if (!b) continue;
          img = new Uint8Array(b.data)[0] === 0x89 ? await out.embedPng(b.data) : await out.embedJpg(b.data);
        } catch {
          continue;
        }
        if (slot >= 2) newPage();
        const pg = page as unknown as PDFPage;
        const top = H - M - HEAD - slot * (SLOT + 16);
        // Beschriftung: Plan · Nr. groß, darunter Position, dann Art/Menge/Bemerkung
        pg.drawRectangle({ x: M, y: top - CAP, width: W - 2 * M, height: CAP, color: rgb(0.95, 0.95, 0.96) });
        pg.drawRectangle({ x: M, y: top - CAP, width: 6, height: CAP, color: hexToRgb(d.color) });
        const pos = findPosition(data, d.positionRef)?.pos;
        const l1 = clean(ctx, `Plan ${planTitle(plan)}   ·   Nr. ${damageNo(d)}`);
        const l2 = clean(ctx, pos ? `Position ${pos.number}  ${pos.shortText}` : 'Position: ohne Leistungszuordnung');
        const qty = d.area !== null ? `${formatArea(d.area)} m²` : `${formatMeasure(d.length)} m`;
        const taken = photoMeta.get(id)?.takenAt;
        const l3 = clean(ctx, [measureLabel(d), qty, d.rebar ? `Bewehrung ${formatMeasure(d.rebar)} lfm` : '', d.note?.trim() ?? '', taken ? `Foto vom ${new Date(taken).toLocaleDateString('de-DE')}` : ''].filter(Boolean).join('  ·  '));
        pg.drawText(fitText(bold, l1, 13, W - 2 * M - 20), { x: M + 14, y: top - 17, size: 13, font: bold, color: INK });
        pg.drawText(fitText(font, l2, 10.5, W - 2 * M - 20), { x: M + 14, y: top - 31, size: 10.5, font, color: INK });
        pg.drawText(fitText(font, l3, 8.5, W - 2 * M - 20), { x: M + 14, y: top - 44, size: 8.5, font, color: MUTED });
        const maxW = W - 2 * M;
        const maxH = SLOT - CAP - 6;
        const s = Math.min(maxW / img.width, maxH / img.height);
        const iw = img.width * s;
        const ih = img.height * s;
        pg.drawImage(img, { x: M + (maxW - iw) / 2, y: top - CAP - 6 - ih, width: iw, height: ih });
        slot++;
        count++;
      }
    }
  }
  if (!count) throw new Error('Keine Fotos zu den Messungen der ausgewählten Pläne.');
  const plans = planIds.map((id) => data.plans[id]).filter(Boolean);
  const name = plans.length === 1 ? safeFileName(data.project.name, plans[0].planNumber || plans[0].planName, 'Fotos') : safeFileName(data.project.name, 'Fotos');
  return { name: `${name}.pdf`, data: await out.save(), mimeType: 'application/pdf' };
}

/** Farblegende als weißer Kasten in der gewählten Ecke des Planbereichs (PDF-Koordinaten, y nach oben): je Farbe ein Feld und die Bezeichnung */
function drawLegend(ctx: Ctx, page: PDFPage, box: { x: number; y: number; w: number; h: number }, pos: LegendPos, entries: LegendEntry[]) {
  if (!entries.length) return;
  const size = 8;
  const row = 11;
  const labels = entries.map((e) => fitText(ctx.font, clean(ctx, e.label), size, 200));
  const w = Math.max(ctx.bold.widthOfTextAtSize('Legende', size), ...labels.map((l) => ctx.font.widthOfTextAtSize(l, size) + 14)) + 12;
  const h = 14 + entries.length * row + 4;
  const x = pos[1] === 'l' ? box.x + 4 : box.x + box.w - w - 4;
  const y = pos[0] === 'b' ? box.y + 4 : box.y + box.h - h - 4;
  page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1), borderColor: rgb(0.55, 0.57, 0.6), borderWidth: 0.6 });
  page.drawText('Legende', { x: x + 6, y: y + h - 11, size, font: ctx.bold, color: rgb(0.1, 0.1, 0.12) });
  entries.forEach((e, i) => {
    const ty = y + h - 14 - (i + 1) * row + 3;
    page.drawRectangle({ x: x + 6, y: ty - 1, width: 9, height: 7, color: hexToRgb(e.color), borderColor: rgb(0.4, 0.4, 0.45), borderWidth: 0.4 });
    page.drawText(labels[i], { x: x + 20, y: ty, size, font: ctx.font, color: rgb(0.1, 0.1, 0.12) });
  });
}
