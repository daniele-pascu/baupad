// Erzeugt ein erfundenes Beispiel-LV im Aufbau eines ÖNORM-Ausdrucks (keine echten Daten).
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const pages = [
  [
    ['01', 'Baustellengemeinkosten', 'V'],
    ['01 11', 'Baustelle', 'V'],
    ['01 11 01 C', 'Baustelle einrichten', 'Z'],
    ['LT 1', 'Einrichten der Baustelle inkl. Geraete.'],
    ['qty', '1,00 PA', '1 200,00', '1 200,00'],
    ['01 11', 'Baustelle', '1 200,00'],
    ['92', 'Markierungsarbeiten', 'Z'],
    ['92 01', 'Markierungen neu', 'Z'],
    ['92 01 01', 'Dauerhafte Markierungen, loesemittelfrei', 'Z'],
    ['92 01 01 A', 'Linienmarkierung weiss', 'Z'],
    ['LT 1', 'Linienbreite bis 12 cm, durchgehend.'],
    ['', 'Lohn :', '2,00'],
    ['qty', '500,00 m', '3,00', '1 500,00'],
  ],
  [
    ['92 01 01 B', 'Sperrflaeche', 'w Z'],
    ['LT 1', 'Abgerechnet wird die umschlossene Flaeche.'],
    ['qty', '120,00 m²', '25,00', '3 000,00'],
    ['92 01 01 C', 'Richtungspfeile', 'Z'],
    ['LT 1', 'Pfeile gemaess StVO.'],
    ['qty', '10,00 Stk', '30,00', '310,00'],
    ['92 01', 'Markierungen neu', '4 810,00'],
  ],
  [['', 'Zusammenstellung (EUR)'], ['', 'Leistungssumme', '6 010,00']],
];

pages.forEach((rows, i) => {
  const p = doc.addPage([595, 842]);
  const t = (s, x, y, f = font, size = 9) => p.drawText(s, { x, y, size, font: f });
  t('Beispielbau GmbH', 40, 800, bold, 11);
  t('Angebot / EUR', 40, 784);
  t('Sanierung Tiefgarage Musterstrasse', 40, 770);
  t('Positionsnummer', 40, 750);
  t('Positionstext', 120, 750);
  t('P ZZ V', 520, 750);
  let y = 720;
  for (const r of rows) {
    if (r[0] === 'qty') {
      t(r[1], 160, y);
      t('Einheitspreis :', 260, y);
      t(`${r[2]} EUR`, 370, y);
      t(r[3], 500, y);
    } else {
      if (r[0]) t(r[0], 40, y);
      t(r[1], 120, y);
      if (r[2]) t(r[2], r[0] && /^\d/.test(r[2]) ? 500 : 520, y);
    }
    y -= 18;
  }
  t(`Seite: ${i + 1}`, 500, 40);
});
writeFileSync(join(dir, 'lv-beispiel.pdf'), await doc.save());
console.log('lv-beispiel.pdf erzeugt');
