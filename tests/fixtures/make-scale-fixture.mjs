// Testplan mit Maßketten (1:50, ohne Maßstabsangabe) für die automatische Maßstabserkennung.
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([1191, 842]); // A3 quer
const k = 72 / 0.0254 / 50; // Punkte je Meter bei 1:50
const x0 = 120;
const y0 = 160;
const walls = [5.0, 3.65, 2.4, 4.1]; // m
const depth = [3.2, 4.5]; // m
const W = walls.reduce((a, b) => a + b, 0) * k;
const H = depth.reduce((a, b) => a + b, 0) * k;
page.drawRectangle({ x: x0, y: y0, width: W, height: H, borderColor: rgb(0, 0, 0), borderWidth: 2.5 });
// waagrechte Maßkette über dem Grundriss
const yDim = y0 + H + 30;
page.drawLine({ start: { x: x0, y: yDim }, end: { x: x0 + W, y: yDim }, thickness: 0.5 });
let pos = x0;
for (const m of walls) {
  const len = m * k;
  page.drawLine({ start: { x: pos, y: yDim - 4 }, end: { x: pos, y: yDim + 4 }, thickness: 0.5 });
  const t = m.toFixed(2).replace('.', ',');
  const tw = font.widthOfTextAtSize(t, 9);
  page.drawText(t, { x: pos + len / 2 - tw / 2, y: yDim + 3, size: 9, font });
  pos += len;
}
// senkrechte Maßkette links (Text um 90° gedreht)
const xDim = x0 - 30;
pos = y0;
for (const m of depth) {
  const len = m * k;
  const t = m.toFixed(2).replace('.', ',');
  const tw = font.widthOfTextAtSize(t, 9);
  page.drawText(t, { x: xDim - 3, y: pos + len / 2 - tw / 2, size: 9, font, rotate: degrees(90) });
  pos += len;
}
page.drawText('Grundriss Keller', { x: x0, y: y0 - 40, size: 14, font });
page.drawText('Raum 101', { x: x0 + 60, y: y0 + H / 2, size: 11, font });
writeFileSync(join(dir, 'massketten.pdf'), await doc.save());
console.log('massketten.pdf', W.toFixed(1), H.toFixed(1));
