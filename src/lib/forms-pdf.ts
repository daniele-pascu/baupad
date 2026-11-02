import { PDFDocument, StandardFonts } from 'pdf-lib';
import { safeFileName, type ExportFile } from './aufmass';
import { drawInBox, drawLines, sanitize } from './form-fill';
import { displayValue, fontSizeOf, lineBoxes, type CustomLayout, type FormEntry, type Measure } from './forms';

/**
 * Ausgefülltes Firmenformular: Werte an den eingerichteten Stellen in das Original-PDF schreiben.
 * Einzeilig: Schrift wird bis zur Mindestgröße verkleinert, dann abgeschnitten. Mehrzeilig: Umbruch auf die
 * Zeilen des Kastens; bei Platzmangel kleinere Schrift, zuletzt „…“ (die Eingabemaske warnt vorher).
 */
export async function fillCustomForm(pdf: ArrayBuffer, layout: CustomLayout, values: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.getPage(0);
  const pageH = page.getHeight();
  for (const f of layout.fields) {
    const text = displayValue(f, values[f.id]);
    if (!text) continue;
    if (f.type === 'multiline') drawLines(page, font, pageH, lineBoxes(f), text, fontSizeOf(f));
    else if (f.type === 'checkbox') drawInBox(page, font, pageH, f.box, 'X', { max: Math.min(12, f.box.h * 0.9), align: 'center' });
    else drawInBox(page, font, pageH, f.box, text.replace(/\s*\n\s*/g, ' · '), { max: fontSizeOf(f), align: f.align ?? (f.type === 'amount' || f.type === 'number' ? 'right' : 'left') });
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
