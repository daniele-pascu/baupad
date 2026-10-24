import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildLines, parseLv, type Line, type ParsedLv, type TextItem } from './lv-parse';

/** Liest alle Textzeilen eines PDFs (Textebene; gescannte PDFs ohne Text liefern nichts). */
export async function extractLines(doc: PDFDocumentProxy): Promise<Line[]> {
  const lines: Line[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
    }
    lines.push(...buildLines(items, i));
    page.cleanup();
  }
  return lines;
}

/** LV aus einem geöffneten PDF lesen. */
export async function readLvFromPdf(doc: PDFDocumentProxy): Promise<ParsedLv> {
  const lines = await extractLines(doc);
  if (!lines.length) throw new Error('Das PDF enthält keinen lesbaren Text (z. B. ein Scan). Bitte ein PDF mit Textebene verwenden.');
  return parseLv(lines, doc.numPages);
}
