import { StandardFonts } from 'pdf-lib';
import type { FontFamily, TextFont } from './types';

/**
 * Schrift für Textobjekte im Plan (Zeichnen und Aufmaß). Drei Schriftarten, die es auch im PDF ohne
 * eingebettete Schriftdatei gibt (Standardschriften): Helvetica, Times, Courier – je normal, fett, kursiv.
 */
export const FONT_FAMILIES: { id: FontFamily; label: string; css: string }[] = [
  { id: 'sans', label: 'Arial (Standard)', css: 'Helvetica, Arial, sans-serif' },
  { id: 'serif', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { id: 'mono', label: 'Courier New', css: '"Courier New", Courier, monospace' },
];

export const fontFamilyCss = (f?: TextFont) => (FONT_FAMILIES.find((x) => x.id === f?.family) ?? FONT_FAMILIES[0]).css;

/** SVG-/CSS-Eigenschaften der Schrift */
export const fontProps = (f?: TextFont) => ({
  fontFamily: fontFamilyCss(f),
  fontWeight: f?.bold ? 700 : 400,
  fontStyle: f?.italic ? 'italic' : 'normal',
  ...(f?.underline ? { textDecoration: 'underline' } : {}),
});

/** Ausrichtung als Anteil der Rahmenbreite: 0 = links, 0,5 = mittig, 1 = rechts */
export const alignFactor = (f?: TextFont) => (f?.align === 'center' ? 0.5 : f?.align === 'right' ? 1 : 0);

/** mittlere Zeichenbreite im Verhältnis zur Schrifthöhe (für Begrenzungsrechteck und Antippen) */
export function charWidthFactor(f?: TextFont): number {
  const base = f?.family === 'mono' ? 0.6 : f?.family === 'serif' ? 0.5 : 0.56;
  return base + (f?.bold && f?.family !== 'mono' ? 0.04 : 0);
}

/** nur gesetzte Eigenschaften speichern (leer = Standardschrift) */
export function cleanFont(f: TextFont | undefined): TextFont | undefined {
  if (!f) return undefined;
  const out: TextFont = {};
  if (f.family && f.family !== 'sans') out.family = f.family;
  if (f.bold) out.bold = true;
  if (f.italic) out.italic = true;
  if (f.underline) out.underline = true;
  if (f.align === 'center' || f.align === 'right') out.align = f.align;
  return Object.keys(out).length ? out : undefined;
}

/** passende PDF-Standardschrift */
export function pdfStandardFont(f?: TextFont): StandardFonts {
  const b = !!f?.bold;
  const i = !!f?.italic;
  switch (f?.family) {
    case 'serif':
      return b && i ? StandardFonts.TimesRomanBoldItalic : b ? StandardFonts.TimesRomanBold : i ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
    case 'mono':
      return b && i ? StandardFonts.CourierBoldOblique : b ? StandardFonts.CourierBold : i ? StandardFonts.CourierOblique : StandardFonts.Courier;
    default:
      return b && i ? StandardFonts.HelveticaBoldOblique : b ? StandardFonts.HelveticaBold : i ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
  }
}

/**
 * Schriftgrade (pt auf dem Blatt): unter 10 in halben Punkten, von 10 bis 16 in ganzen, bis 24 in 2er- und darüber in
 * 4er-Schritten – so zählen auch „vergrößern“ und „verkleinern“. Ab 10 pt gibt es keine Kommastellen.
 */
export const TEXT_SIZES = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72];
/** Schriftgrad runden: ab 10 pt ganze Punkte, darunter halbe */
export const roundPt = (n: number) => (n >= 9.75 ? Math.round(n) : Math.round(n * 2) / 2);
/** nächster Schriftgrad nach oben bzw. unten: < 10 → 0,5; 10–16 → 1; 16–24 → 2; darüber → 4 */
export function nextSize(pt: number, dir: 1 | -1): number {
  const v = roundPt(pt);
  const e = 1e-9;
  if (dir > 0) {
    if (v < 10 - e) return Math.min(10, Math.floor(v * 2 + e) / 2 + 0.5);
    if (v < 16 - e) return Math.floor(v + e) + 1;
    if (v < 24 - e) return 16 + 2 * (Math.floor((v - 16) / 2 + e) + 1);
    return Math.min(400, 24 + 4 * (Math.floor((v - 24) / 4 + e) + 1));
  }
  if (v > 24 + e) return 24 + 4 * (Math.ceil((v - 24) / 4 - e) - 1);
  if (v > 16 + e) return 16 + 2 * (Math.ceil((v - 16) / 2 - e) - 1);
  if (v > 10 + e) return Math.ceil(v - e) - 1;
  return Math.max(2, Math.ceil(v * 2 - e) / 2 - 0.5);
}
