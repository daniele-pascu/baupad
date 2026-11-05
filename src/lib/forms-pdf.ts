import { PDFDocument, StandardFonts } from 'pdf-lib';
import { safeFileName, type ExportFile } from './aufmass';
import { drawInBox, drawLines, hexColor, sanitize } from './form-fill';
import { BASELINE_PT, DEFAULT_FORM_COLOR, displayValue, fontSizeOf, lineBoxes, type CustomField, type CustomLayout, type FormEntry, type Measure } from './forms';
import type { PDFFont } from 'pdf-lib';

const STD: Record<string, [StandardFonts, StandardFonts]> = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};

/**
 * Ausgefülltes Firmenformular: Werte an den eingerichteten Stellen in das Original-PDF schreiben.
 * Einzeilig: Schrift wird bis zur Mindestgröße verkleinert, dann abgeschnitten. Mehrzeilig: Umbruch auf die
 * Zeilen des Kastens; bei Platzmangel kleinere Schrift, zuletzt „…“ (die Eingabemaske warnt vorher).
 */
export async function fillCustomForm(pdf: ArrayBuffer, layout: CustomLayout, values: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  // Schriftart und Farbe je Feld (Standardschriften des PDF, jeweils einmal eingebettet)
  const fonts = new Map<string, PDFFont>();
  const fontOf = async (f: CustomField) => {
    const k = `${f.font ?? 'helvetica'}:${f.bold ? 1 : 0}`;
    if (!fonts.has(k)) fonts.set(k, await doc.embedFont(STD[f.font ?? 'helvetica'][f.bold ? 1 : 0]));
    return fonts.get(k)!;
  };
  const page = doc.getPage(0);
  const pageH = page.getHeight();
  for (const f of layout.fields) {
    const text = displayValue(f, values[f.id]);
    if (!text) continue;
    const font = await fontOf(f);
    const color = hexColor(f.color || DEFAULT_FORM_COLOR);
    // Schrift 0,5 mm über der Unterkante (wie im Editor gezeigt); eingestellte Größe genau
    if (f.type === 'multiline') drawLines(page, font, pageH, lineBoxes(f), text, fontSizeOf(f), color, BASELINE_PT);
    else if (f.type === 'checkbox') drawInBox(page, font, pageH, f.box, 'X', { max: Math.min(12, f.box.h * 0.9), align: 'center', color });
    else drawInBox(page, font, pageH, f.box, text.replace(/\s*\n\s*/g, ' · '), { max: fontSizeOf(f), exact: !!f.fontSize, baseline: BASELINE_PT, align: f.align ?? (f.type === 'amount' || f.type === 'number' ? 'right' : 'left'), color });
  }
  return doc.save();
}

/** Datei für Vorschau/Download */
export async function filledEntryFile(entry: FormEntry, pdf: ArrayBuffer): Promise<ExportFile> {
  const data = await fillCustomForm(pdf, entry.layout, entry.values);
  return { name: `${safeFileName(entry.templateName, entry.siteName, `Nr${entry.no}`, entry.date)}.pdf`, data, mimeType: 'application/pdf' };
}

let measurePromise: Promise<Measure> | null = null;
/** Textbreiten der PDF-Schrift (Helvetica) für die Eingabemaske – einmal laden, dann synchron */
export function helveticaMeasure(): Promise<Measure> {
  measurePromise ??= (async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    return (text: string, size: number) => font.widthOfTextAtSize(sanitize(font, text), size);
  })();
  return measurePromise;
}
