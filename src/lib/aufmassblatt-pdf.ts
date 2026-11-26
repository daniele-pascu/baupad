import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { ExportFile } from './aufmass';
import { BLATT_BOTTOM_IN, BLATT_SIDE_IN, blattTopMargin, type Cell, type HeaderImage, type Sheet } from './xlsx';

const W = 595.28;
const H = 841.89;
const BLACK = rgb(0.07, 0.07, 0.07);
const money = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Look = { font: 'regular' | 'bold' | 'italic'; size: number; align: 'left' | 'center' | 'right'; fill?: ReturnType<typeof rgb>; color?: ReturnType<typeof rgb>; line?: boolean; box?: boolean; indent?: boolean };

/** Aussehen eines Zellformats – dieselben Formate wie in der Excel-Datei (siehe xlsx.ts) und in der Vorschau */
function lookOf(s = ''): Look {
  const t = /^amT(C|N|Q|DQ|D)(b?)(l?)$/.exec(s);
  if (t) {
    const ded = t[1] === 'D' || t[1] === 'DQ';
    return {
      font: ded ? 'italic' : 'regular',
      size: 11,
      align: t[1] === 'C' ? 'center' : 'right',
      fill: t[2] ? rgb(0.965, 0.965, 0.973) : undefined,
      color: t[1] === 'DQ' ? rgb(0.706, 0.341, 0.227) : t[1] === 'D' ? rgb(0.33, 0.33, 0.33) : undefined,
      line: !!t[3],
    };
  }
  const right = /^(amColHeadR|amNum|amNumBold|amQtyBold|amTotalNum)$/.test(s);
  return {
    font: /^(amTitle|amDoc|amPos|amBold|amNumBold|amQtyBold|amTotal|amTotalNum|amBox|amTHead)$/.test(s) ? 'bold' : /^(amColHead|amColHeadR|amThNote|amNote)$/.test(s) ? 'italic' : 'regular',
    size: s === 'amTitle' ? 14 : /^(amDoc|amBox|amTotal|amTotalNum)$/.test(s) ? 12 : s === 'amLabel' ? 10 : /^amColHead/.test(s) ? 9 : 11,
    align: right ? 'right' : s === 'amTHead' || s === 'amBox' ? 'center' : 'left',
    fill: s === 'amTHead' ? rgb(0.925, 0.925, 0.937) : undefined,
    line: /^amColHead/.test(s),
    box: s === 'amBox',
    indent: s === 'amThNote' || s === 'amNote',
  };
}

/** Zeilenhöhe wie in Excel (größere Schrift etwas mehr) – passend zu den Seitenumbrüchen des Blatts */
const rowHeight = (row: Cell[]) => (row.some((c) => c?.s === 'amTitle') ? 21 : row.some((c) => c?.s === 'amDoc' || c?.s === 'amBox' || c?.s === 'amTotal') ? 17.5 : 15);

/**
 * Das Aufmaßblatt als PDF: dieselben Zeilen, Spalten, Formate und Seitenumbrüche wie die Excel-Datei – A4 hoch,
 * waagrecht zentriert, Kopfzeile mit Logo links, Blattname in der Mitte und „Seite von Seiten“ rechts.
 */
export async function aufmassblattPdf(sheet: Sheet, fileName: string, logo?: HeaderImage | null): Promise<ExportFile> {
  const doc = await PDFDocument.create();
  doc.setTitle(sheet.name);
  doc.setProducer('');
  doc.setCreator('');
  const fonts: Record<Look['font'], PDFFont> = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const charset = new Set(fonts.regular.getCharacterSet());
  const clean = (s: string) => [...s.replace(/[–—]/g, '-')].map((ch) => (charset.has(ch.codePointAt(0)!) ? ch : '?')).join('');
  const image = logo ? await (logo.type === 'png' ? doc.embedPng(logo.bytes) : doc.embedJpg(logo.bytes)) : null;

  const side = BLATT_SIDE_IN * 72;
  const top = blattTopMargin(logo) * 72;
  const bottom = BLATT_BOTTOM_IN * 72;
  // Spaltenbreite in Excel (Zeichen) → Punkt; passt das Blatt nicht in die Breite, wird alles gleichmäßig kleiner
  const colPt = sheet.widths.map((w) => (w * 7 + 5) * 0.75);
  const total = colPt.reduce((a, b) => a + b, 0);
  const k = Math.min(1, (W - 2 * side) / total, (sheet.scale ?? 100) / 100);
  const x0 = (W - total * k) / 2; // waagrecht zentriert: links und rechts derselbe Rand
  const xs = colPt.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w * k], [x0]);
  // Helvetica läuft breiter als die schmale Schrift der Excel-Datei: etwas kleiner setzen, damit Zahlen in ihre Spalten passen
  const pt = (size: number) => size * 0.86 * k;
  const breaks = new Set(sheet.rowBreaks);
  const merged = new Map<number, number>(); // Zeile → letzte Spalte der verbundenen Zellen ab A
  for (const m of sheet.merges ?? []) {
    const r = /^A(\d+):([A-Z])\1$/.exec(m);
    if (r) merged.set(Number(r[1]), r[2].charCodeAt(0) - 65);
  }

  let page = doc.addPage([W, H]);
  let y = H - top;
  sheet.rows.forEach((row, ri) => {
    const h = rowHeight(row) * k;
    if (ri > 0 && (breaks.has(ri + 1) || y - h < bottom)) {
      page = doc.addPage([W, H]);
      y = H - top;
    }
    y -= h;
    row.forEach((c, i) => {
      if (!c || i >= colPt.length) return;
      const look = lookOf(c.s);
      const last = look.box ? (merged.get(ri + 1) ?? i) : i;
      const x = xs[i];
      const w = xs[last + 1] - x;
      if (look.fill) page.drawRectangle({ x, y, width: w, height: h, color: look.fill });
      if (look.box) page.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: 0.6 });
      if (look.line) page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.6, color: BLACK });
      if (c.t === 'blank') return;
      const text = clean(c.t === 'str' ? c.v : /^amTC/.test(c.s ?? '') ? String(c.v) : money(c.v));
      const font = fonts[look.font];
      const size = pt(look.size);
      const tw = font.widthOfTextAtSize(text, size);
      const pad = (look.indent ? 7 : 2.5) * k;
      const tx = look.align === 'right' ? x + w - pad - tw : look.align === 'center' ? x + (w - tw) / 2 : x + pad;
      page.drawText(text, { x: tx, y: y + (h - size) / 2 + size * 0.14, size, font, color: look.color ?? BLACK });
    });
  });

  // Kopfzeile jeder Seite: Logo links, Blattname kursiv in der Mitte, „Seite von Seiten“ rechts
  const pages = doc.getPages();
  pages.forEach((p, n) => {
    const hy = H - 0.3 * 72;
    if (image && logo) p.drawImage(image, { x: side, y: hy - logo.height, width: logo.width, height: logo.height });
    const center = clean(sheet.headerCenter ?? '');
    if (center) p.drawText(center, { x: (W - fonts.italic.widthOfTextAtSize(center, 9)) / 2, y: hy - 9, size: 9, font: fonts.italic, color: BLACK });
    const no = `${n + 1} von ${pages.length}`;
    p.drawText(no, { x: W - side - fonts.regular.widthOfTextAtSize(no, 10), y: hy - 10, size: 10, font: fonts.regular, color: BLACK });
  });
  return { name: fileName.replace(/\.xlsx$/i, '') + '.pdf', data: await doc.save(), mimeType: 'application/pdf' };
}
