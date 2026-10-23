// Erzeugt Testdateien: mehrseitiges PDF (inkl. gedrehter Seite und Seite mit zwei Planfeldern).
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const grey = rgb(0.25, 0.25, 0.25);

function floorPlan(page, x, y, w, h, title) {
  // Außenwände
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: 3 });
  // Raster / Stützen
  for (let i = 1; i < 6; i++) {
    const cx = x + (w * i) / 6;
    page.drawLine({ start: { x: cx, y }, end: { x: cx, y: y + h }, thickness: 0.4, color: grey, dashArray: [6, 4] });
  }
  for (let j = 1; j < 4; j++) {
    const cy = y + (h * j) / 4;
    page.drawLine({ start: { x, y: cy }, end: { x: x + w, y: cy }, thickness: 0.4, color: grey, dashArray: [6, 4] });
  }
  for (let i = 1; i < 6; i++)
    for (let j = 1; j < 4; j++) page.drawRectangle({ x: x + (w * i) / 6 - 5, y: y + (h * j) / 4 - 5, width: 10, height: 10, color: rgb(0.2, 0.2, 0.2) });
  // Innenwände
  page.drawLine({ start: { x: x + w * 0.4, y }, end: { x: x + w * 0.4, y: y + h * 0.6 }, thickness: 2 });
  page.drawLine({ start: { x: x + w * 0.4, y: y + h * 0.6 }, end: { x: x + w, y: y + h * 0.6 }, thickness: 2 });
  page.drawText(title, { x: x + 10, y: y + h - 22, size: 14, font: bold });
  page.drawText('Rampe', { x: x + w * 0.65, y: y + h * 0.3, size: 11, font });
  page.drawText('Technik', { x: x + w * 0.15, y: y + h * 0.3, size: 11, font });
}

// Seite 1: Deckblatt (A4 hoch)
{
  const p = doc.addPage([595, 842]);
  p.drawText('Planunterlagen Wohnanlage Süd', { x: 60, y: 760, size: 22, font: bold });
  p.drawText('Deckblatt – keine Planseite', { x: 60, y: 720, size: 14, font });
}
// Seite 2: A3 quer, ein Plan
{
  const p = doc.addPage([1191, 842]);
  p.drawRectangle({ x: 20, y: 20, width: 1151, height: 802, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
  floorPlan(p, 80, 120, 1000, 640, 'A-101 Untergeschoss');
  p.drawText('Plan A-101 – Untergeschoss  M 1:100', { x: 820, y: 40, size: 12, font });
}
// Seite 3: A3 quer, zwei Planfelder nebeneinander im Blattrahmen
{
  const p = doc.addPage([1191, 842]);
  p.drawRectangle({ x: 20, y: 20, width: 1151, height: 802, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
  floorPlan(p, 60, 160, 500, 560, 'A-102 Decke TG');
  floorPlan(p, 630, 160, 500, 560, 'A-103 Wand Nord');
  p.drawText('Blatt mit zwei Planfeldern', { x: 60, y: 60, size: 12, font });
}
// Seite 4: A4, mit /Rotate 90 gespeichert (wird quer angezeigt)
{
  const p = doc.addPage([595, 842]);
  p.setRotation(degrees(90));
  p.drawRectangle({ x: 20, y: 20, width: 555, height: 802, borderColor: rgb(0, 0, 0), borderWidth: 1 });
  floorPlan(p, 60, 60, 475, 720, 'B-204 Stiege 2');
}
writeFileSync(join(dir, 'plaene.pdf'), await doc.save());
console.log('plaene.pdf erstellt');
