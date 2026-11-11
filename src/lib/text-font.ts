import { StandardFonts } from 'pdf-lib';
import type { FontFamily, TextFont } from './types';

/**
 * Schrift für Textobjekte im Plan (Zeichnen und Aufmaß). Drei Schriftarten, die es auch im PDF ohne
 * eingebettete Schriftdatei gibt (Standardschriften): Helvetica, Times, Courier – je normal, fett, kursiv.
 */
export const FONT_FAMILIES: { id: FontFamily; label: string; css: string }[] = [
  { id: 'sans', label: 'Standard', css: 'Helvetica, Arial, sans-serif' },
  { id: 'serif', label: 'Serifen (Times)', css: '"Times New Roman", Times, serif' },
  { id: 'mono', label: 'Schreibmaschine', css: '"Courier New", Courier, monospace' },
];

export const fontFamilyCss = (f?: TextFont) => (FONT_FAMILIES.find((x) => x.id === f?.family) ?? FONT_FAMILIES[0]).css;

/** SVG-/CSS-Eigenschaften der Schrift */
export const fontProps = (f?: TextFont) => ({
  fontFamily: fontFamilyCss(f),
  fontWeight: f?.bold ? 700 : 400,
  fontStyle: f?.italic ? 'italic' : 'normal',
});

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
