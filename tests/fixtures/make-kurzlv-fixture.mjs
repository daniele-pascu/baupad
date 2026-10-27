// Erzeugt ein erfundenes „Kurz-LV“ (eine Zeile je Position, Punkt-Nummern, W/E-Kennzeichen) – keine echten Daten.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);

// [Nr., Kurztext, W/E, Menge+Einheit, EP, GP]; W/E am Text („Text W“) oder an der Menge („W 1 140,00 m²“) wie in echten Ausdrucken
const pages = [
  [
    ['LG11', 'Estrich'],
    ['01.', 'Massnahme A'],
    ['01.11.', 'Estricharbeiten'],
    ['01.11.21.', 'Vorbereiten des Untergrundes'],
    ['01.11.21.07', 'Untergrund als Vorbereitung fuer Verbundestriche.'],
    ['01.11.21.07C.', 'Untergrund aufrauen', '', '300,00 m²', '4,24', '1 271,56'],
    ['01.11.21.07D.', 'Haftbruecke herstellen', 'E', '100,00 m²', '1,59', '********'],
    ['01.14.', 'Besondere Instandsetzungsarbeiten'],
    ['01.14.80.31', 'Sanieren von Rissen.'],
    ['01.14.80.31A.', 'Risse verpressen mit Injektionsharz', '', '51,00 Stk', '94,19', '4 803,69'],
  ],
  [
    ['02.', 'Massnahme B'],
    ['02.14.', 'Besondere Instandsetzungsarbeiten'],
    ['02.14.80.90', 'Die bestehenden Stuetzen sind zu sanieren'],
    ['02.14.80.90A.', 'Sandstrahlen W', '', '1 140,00 m²', '37,75', '********'],
    ['02.14.80.90B.', 'Egalisierung', 'W+', '1 140,00 m²', '44,75', '********'],
    ['02.14.80.91A.', 'Verklebung CFK', '', '184,00 m', '64,38', '11 845,92'],
    ['', 'Baustelle einrichten', '', '1,00 PA 5 000,00 5 000,00'],
    ['S1.', 'M3-001.MFK Sanierung Bodenplatte'],
    ['S1.12.14.85.03', 'Gefaelleregulierungen systemkompatibel'],
    ['S1.12.14.85.03A.2', 'Gefaelleregulierung auf Kunstharzbasis', '', '150,00 kg', '4,95', '742,50'],
    ['sum', 'SUMME:', '23 663,67'],
  ],
];

pages.forEach((rows, i) => {
  const p = doc.addPage([595, 842]);
  const t = (s, x, y, size = 8) => p.drawText(s, { x, y, size, font });
  const right = (s, x, y) => t(s, x - font.widthOfTextAtSize(s, 8), y);
  t('Auftrag Kurz-LV', 40, 800);
  t(`Seite ${i + 1} von ${pages.length}`, 500, 800);
  t('Gewerk: Musterarbeiten Tiefgarage', 40, 788);
  t('01.01.2026', 520, 788);
  t('Baustelle Musterstrasse 1', 40, 776);
  t('Pos', 60, 750);
  t('Kurztext', 200, 750);
  t('W/E ME EH', 370, 750);
  t('EP', 470, 750);
  t('GP', 530, 750);
  let y = 730;
  for (const r of rows) {
    if (r[0] === 'sum') {
      t(r[1], 330, y - 10);
      right(r[2], 560, y - 10);
      continue;
    }
    if (r[0]) t(r[0], 40, y);
    t(r[1], r[0] ? 120 : 140, y);
    if (r[2] === 'W+') right(`W ${r[3]}`, 440, y);
    else {
      if (r[2]) t(r[2], 365, y);
      if (r[3]) (r[4] ? right(r[3], 440, y) : t(r[3], 380, y));
    }
    if (r[4]) right(r[4], 495, y);
    if (r[5]) right(r[5], 560, y);
    y -= 14;
  }
});
writeFileSync(join(dir, 'kurz-lv.pdf'), await doc.save());
console.log('kurz-lv.pdf erzeugt');
