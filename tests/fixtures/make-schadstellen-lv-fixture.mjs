// Erzeugt ein erfundenes Beispiel-LV „Betoninstandsetzung“ im Kurz-LV-Format (eine Zeile je Position) mit
// Schadstellen-Positionen nach Größe und Tiefe sowie einer Zulage „je weitere 10 mm“ – keine echten Daten,
// Mengen und Preise sind frei erfunden.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const de = (n) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\./g, ' ');
let total = 0;
/** Position: [Nr., Kurztext, Menge, Einheit, EP] → mit Positionspreis */
const pos = (no, text, qty, unit, ep) => {
  const gp = Math.round(qty * ep * 100) / 100;
  total += gp;
  return [no, text, `${de(qty)} ${unit}`, de(ep), de(gp)];
};
const pages = [
  [
    ['LG14', 'Betoninstandsetzung'],
    ['01.', 'Tiefgarage Untergeschoss'],
    ['01.14.', 'Besondere Instandsetzungsarbeiten'],
    ['01.14.10.', 'Vorarbeiten'],
    pos('01.14.10.01A.', 'Baustelleneinrichtung', 1, 'PA', 4500),
    pos('01.14.10.02A.', 'Sandstrahlen der Betonoberfläche', 1169, 'm²', 37.75),
    ['01.14.20.', 'Schadstellen flächig'],
    ['01.14.20.01', 'Schadstellen stemmen und reprofilieren, Abrechnung je Schadstelle.'],
    pos('01.14.20.01A.', 'Schadstelle bis 0,25 m², Abtragstiefe bis 20 mm', 120, 'Stk', 48),
    pos('01.14.20.01B.', 'Schadstelle bis 0,25 m², Abtragstiefe über 20 bis 40 mm', 80, 'Stk', 62),
    pos('01.14.20.01C.', 'Schadstelle über 0,25 bis 1,5 m², Abtragstiefe bis 20 mm', 60, 'm²', 145),
    pos('01.14.20.01D.', 'Schadstelle über 0,25 bis 1,5 m², Abtragstiefe über 20 bis 40 mm', 40, 'm²', 178),
    pos('01.14.20.01E.', 'Schadstelle über 1,5 m², Abtragstiefe bis 40 mm', 25, 'm²', 162),
    ['01.14.20.02', 'Aufzahlung auf die Positionen Schadstellen.'],
    pos('01.14.20.02A.', 'Aufzahlung je weitere 10 mm Abtragstiefe', 90, 'm²', 18.5),
    ['01.14.25.', 'Reprofilierung'],
    pos('01.14.25.01A.', 'Reprofilierung mit PCC-Mörtel, Schichtdicke bis 20 mm', 180, 'm²', 96),
    pos('01.14.25.01B.', 'Reprofilierung mit PCC-Mörtel, Schichtdicke über 20 bis 40 mm', 120, 'm²', 132),
    pos('01.14.25.02A.', 'Haftbrücke auf die Schadstelle auftragen', 300, 'm²', 14.5),
    ['01.14.30.', 'Schadstellen streifenförmig'],
    pos('01.14.30.01A.', 'Schadstelle streifenförmig, Höhe bis 30 cm, Abtragstiefe bis 20 mm', 150, 'm', 54),
    pos('01.14.30.01B.', 'Schadstelle streifenförmig, Höhe bis 30 cm, Abtragstiefe über 20 bis 40 mm', 80, 'm', 71),
  ],
  [
    ['01.14.40.', 'Risse und Bewehrung'],
    pos('01.14.40.01A.', 'Risse verpressen mit Injektionsharz', 51, 'm', 94.19),
    pos('01.14.40.02A.', 'Bewehrung entrosten und beschichten', 200, 'm', 12.4),
    ['01.14.50.', 'Oberfläche'],
    ['01.14.50.01', 'Die bestehenden Stützen sind zu sanieren.'],
    pos('01.14.50.01A.', 'Egalisierung', 1169, 'm²', 44.75),
    pos('01.14.50.01B.', 'Betonretusche', 1169, 'm²', 22.42),
    pos('01.14.50.01C.', 'Schutz der Betonstützen nach der Sanierung', 1169, 'm²', 10.84),
    ['sum', 'SUMME:'],
  ],
];

pages.forEach((rows, i) => {
  const p = doc.addPage([595, 842]);
  const t = (s, x, y, size = 8, f = font) => p.drawText(s, { x, y, size, font: f });
  const right = (s, x, y) => t(s, x - font.widthOfTextAtSize(s, 8), y);
  t('Auftrag Kurz-LV', 40, 800);
  t(`Seite ${i + 1} von ${pages.length}`, 500, 800);
  t('Gewerk: Betoninstandsetzung Tiefgarage (Beispiel – erfundene Mengen und Preise)', 40, 788);
  t('12.11.2026', 520, 788);
  t('Baustelle Musterstraße 1', 40, 776);
  t('Pos', 60, 750);
  t('Kurztext', 200, 750);
  t('W/E ME EH', 370, 750);
  t('EP', 470, 750);
  t('GP', 530, 750);
  let y = 730;
  for (const r of rows) {
    if (r[0] === 'sum') {
      t(r[1], 330, y - 10);
      right(de(Math.round(total * 100) / 100), 560, y - 10);
      continue;
    }
    t(r[0], 40, y);
    t(r[1], 120, y);
    if (r[2]) right(r[2], 440, y);
    if (r[3]) right(r[3], 495, y);
    if (r[4]) right(r[4], 560, y);
    y -= 14;
  }
});
writeFileSync(join(dir, 'schadstellen-lv.pdf'), await doc.save());
console.log(`schadstellen-lv.pdf erzeugt, Summe ${de(Math.round(total * 100) / 100)}`);
