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
import { componentsOf, costCenterLabel, damagesOf, elementsOf, planTitle, safeFileName, type ExportFile } from './aufmass';
import { dimsVisible, visibleDamages, visibleElements } from './layers';
import { annotationsOf, contentRegion, dimGeometry, drawingSheet, isDrawingPlan, PAPER, PRINT_HEADER_MM, PRINT_MARGIN_MM, printScale, shapeToPage, unitsPerMeter } from './drawing';
import { getBlob } from './db';
import { damageNo } from './numbering';
import {
  layoutLabels,
  leaderLine,
  pathToSvg,
  shapeAABB,
  shapePath,
  type Point,
} from './geometry';
import { canvasToBlob, closePdf, clampRenderScale, imageToCanvas, loadImageBitmap, openPdf, pageViewport, renderPdfRegion, renderPdfToCanvas } from './pdf';
import type { ProjectState } from './store';
import { exportPaper, layoutSheet, planHeading, type OverviewCorner, type SheetLayout } from './sheet-layout';
import { DEFAULT_TRANSPARENCY, fillOf, fillPaths, strokeGeometry } from './style';
import type { Component, Damage, Plan, Rect, Shape, ShapeStyle } from './types';

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
  };
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
    else if (f.hatch)
      page.drawSvgPath(f.hatch, { x: 0, y: 0, borderColor: hexToRgb(fill.color), borderWidth: f.hatchWidth, borderOpacity: fill.opacity, borderLineCap: LineCapStyle.Round });
  }
  const line = strokeGeometry(shape, svgMap, style?.lineType, width);
  const common = { x: 0, y: 0, borderDashArray: line.dash, borderLineCap: LineCapStyle.Round };
  if (halo) page.drawSvgPath(line.d, { ...common, borderColor: halo, borderWidth: width + 1.6, borderOpacity: 0.75 });
  page.drawSvgPath(line.d, { ...common, borderColor: hexToRgb(color), borderWidth: width, borderOpacity: 1 });
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
    const width = d.style?.lineWidth ?? stroke;
    drawStyledShape(t.page, (p) => t.map(p), d.shape, d.color, d.style, width, DEFAULT_TRANSPARENCY.damage, haloRgb(d.color));
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

/** A3 in PDF-Punkten und Millimetern */
const A3 = { wPt: 1190.55, hPt: 841.89, wMm: 420, hMm: 297 };
const MM = 72 / 25.4;

/**
 * Gezeichneter Plan als Vektorseite im Format A3 mit Normmaßstab (z. B. 1:100).
 * Zeichnungsobjekte, Maßketten, Messungen und Bauteilbuchstaben werden als Vektoren gezeichnet.
 */
function addDrawingPage(ctx: Ctx, data: ProjectState, plan: Plan) {
  const k = unitsPerMeter(plan);
  // Ausgeblendete Ebenen werden nicht gedruckt; der Blattausschnitt folgt dem gesamten Inhalt
  const allElements = elementsOf(data, plan.id);
  const allDamages = damagesOf(data, plan.id);
  const elements = visibleElements(plan, allElements);
  const damages = visibleDamages(plan, allDamages);
  // Bauteilbuchstaben werden nicht mehr verwendet (Daten bleiben gespeichert, erscheinen aber nicht im Export)
  const components: ReturnType<typeof componentsOf> = [];
  // Mit Papierformat: genau das Zeichenblatt im gewählten Maßstab; sonst (ältere Pläne) Inhalt
  // auf A3 mit passendem Normmaßstab
  const sheet = drawingSheet(plan);
  const paperFmt = plan.drawing?.paper ? PAPER[plan.drawing.paper] : null;
  const region = sheet ?? contentRegion(plan, allElements, allDamages);
  const portrait = paperFmt ? paperFmt.h > paperFmt.w : region.h > region.w;
  const W = paperFmt ? paperFmt.w * MM : portrait ? A3.hPt : A3.wPt;
  const H = paperFmt ? paperFmt.h * MM : portrait ? A3.wPt : A3.hPt;
  const margin = (paperFmt ? PRINT_MARGIN_MM : 12) * MM;
  const headerPt = (paperFmt ? PRINT_HEADER_MM : 16) * MM;
  const avail = { w: (W - 2 * margin) / MM, h: (H - 2 * margin - headerPt) / MM };
  const scaleN = paperFmt ? (plan.drawing?.scale ?? 100) : printScale({ w: region.w / k, h: region.h / k }, avail);
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
  const fmtLabel = paperFmt ? paperFmt.label : portrait ? 'A3 Hochformat' : 'A3 Querformat';
  const barM = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].find((m) => (m * 1000) / scaleN >= 35) ?? 200;
  const barPt = ((barM * 1000) / scaleN) * MM;
  drawSheetHeader(
    ctx,
    page,
    H,
    { x: margin, y: margin, w: W - 2 * margin, h: headerPt },
    plan,
    [plan.showPaper ? fmtLabel : '', plan.showScale ? `Maßstab 1:${scaleN}` : ''].filter(Boolean),
    plan.showScale ? barPt + 12 : 0,
  );

  // Zeichnungsobjekte
  const dimColor = rgb(0.16, 0.3, 0.5);
  for (const e of elements) {
    const shape = shapeToPage(e.shape, k);
    const color = hexToRgb(visibleHex(e.color));
    if (e.type === 'text') {
      const size = shape.h * u;
      const at = map({ x: shape.x, y: shape.y + shape.h * 0.82 });
      page.drawText(clean(ctx, e.text ?? ''), { x: at.x, y: at.y, size, font: ctx.font, color, rotate: degrees(-(shape.rotation ?? 0)) });
      continue;
    }
    if (e.type === 'dimension') {
      const svg = pathToSvg(shapePath(shape), (p) => {
        const q = map(p);
        return { x: q.x, y: -q.y };
      });
      page.drawSvgPath(svg, { x: 0, y: 0, borderColor: color, borderWidth: 0.6 });
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
    for (const l of labels) drawRotatedText(l.text, paper({ x: l.at.x * k, y: l.at.y * k }), 0);
  }
  // Messungen und Bauteilbuchstaben darüber
  drawDamages(ctx, target, region, damages, components);
  // Maßstabsleiste rechts im Kopfbereich (nur wenn der Maßstab angezeigt werden soll)
  if (!plan.showScale) return;
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
