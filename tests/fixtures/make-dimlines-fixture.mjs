// Testplan mit Maßlinien in cm (1:50): Kette „515,5 · 240 · 365“ mit Schrägstrichen, senkrechtes
// Maß „365“, ein falsch beschriftetes Maß („420“ an 4,00 m) und Störzahlen (Raum 101, 12,50 m²).
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([1191, 842]);
const k = 72 / 0.0254 / 50; // Punkte je Meter bei 1:50
const black = rgb(0, 0, 0);
const tick = (x, y) => page.drawLine({ start: { x: x - 3, y: y - 3 }, end: { x: x + 3, y: y + 3 }, thickness: 0.6, color: black });
const text = (t, x, y, rot = 0) => {
  const w = font.widthOfTextAtSize(t, 9);
  if (rot) page.drawText(t, { x: x - 3, y: y - w / 2, size: 9, font, rotate: degrees(90) });
  else page.drawText(t, { x: x - w / 2, y: y + 2.5, size: 9, font });
};

// Grundriss
const x0 = 150;
const y0 = 300;
const chain = [515.5, 240, 365]; // cm
const W = chain.reduce((a, b) => a + b, 0) / 100 * k;
const H = 3.65 * k;
page.drawRectangle({ x: x0, y: y0, width: W, height: H, borderColor: black, borderWidth: 2 });
page.drawText('Raum 101', { x: x0 + 40, y: y0 + H / 2, size: 11, font });
page.drawText('12,50 m²', { x: x0 + 40, y: y0 + H / 2 - 16, size: 9, font });

// waagrechte Maßkette unter dem Grundriss: eine Linie, Schrägstriche an den Teilungen
const yd = y0 - 30;
page.drawLine({ start: { x: x0 - 10, y: yd }, end: { x: x0 + W + 10, y: yd }, thickness: 0.5, color: black });
let pos = x0;
tick(pos, yd);
for (const cm of chain) {
  const len = (cm / 100) * k;
  text(String(cm).replace('.', ','), pos + len / 2, yd);
  pos += len;
  tick(pos, yd);
  page.drawLine({ start: { x: pos, y: yd - 6 }, end: { x: pos, y: y0 }, thickness: 0.3, color: black }); // Maßhilfslinie
}

// senkrechtes Maß rechts: 365 cm
const xd = x0 + W + 30;
page.drawLine({ start: { x: xd, y: y0 - 8 }, end: { x: xd, y: y0 + H + 8 }, thickness: 0.5, color: black });
tick(xd, y0);
tick(xd, y0 + H);
text('365', xd, y0 + H / 2, 90);

// falsch beschriftetes Maß über dem Grundriss: Linie 4,00 m, Text „420“
const yt = y0 + H + 40;
page.drawLine({ start: { x: x0 - 8, y: yt }, end: { x: x0 + 4 * k + 8, y: yt }, thickness: 0.5, color: black });
tick(x0, yt);
tick(x0 + 4 * k, yt);
text('420', x0 + 2 * k, yt);

writeFileSync(join(dir, 'masslinien.pdf'), await doc.save());
console.log('masslinien.pdf');
