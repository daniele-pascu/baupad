// Erzeugt eine erfundene MFK im Aufbau eines ÖNORM-Ausdrucks mit Punkt-Nummern und EP-Zeile – keine echten Daten.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);

// ['n', Nr., Text, Summe?] · ['t', Langtext] · ['p', Preisanteil, Betrag?] · ['ep', Menge+EH, EP, GP] · ['ff']
const pages = [
  [
    ['n', '09', 'M9-001.MFK Musterhalle Beschichtungen'],
    ['n', '09.12', 'Massnahme I'],
    ['n', '09.12.14', 'Besondere Instandsetzungsarbeiten'],
    ['n', '09.12.14.81', 'Betonboeden instandsetzen'],
    ['n', '09.12.14.81.38', 'Untergrundvorbehandlung fuer Beschichtungen'],
    ['t', 'Gilt fuer die folgenden Positionen.'],
    ['ff'],
    ['n', '09.12.14.81.38.A', 'Untergrund schleifen'],
    ['t', 'Ueberschleifen des Betonuntergrundes bis 5 mm.'],
    ['p', 'Lohn', '3,00'],
    ['p', 'Sonstiges', '1,20'],
    ['ep', '1 000,00 m²', '4,20', '4 200,00'],
    ['ff'],
    ['n', '09.12.14.81.38.B', 'Kugelstrahlen'],
    ['p', 'Lohn'],
    ['p', 'Sonstiges'],
    ['ep', '500,00 m²', 'Nicht angeboten'],
    ['n', '09.12.14.81.38.H', 'Hochzug vorbehandeln'],
    ['ep', '300,00 m', '4,55', '1 365,00'],
    ['n', '09.12.14.81', 'Betonboeden instandsetzen', '5 565,00'],
  ],
  [
    ['n', '09.12.14.85', 'Grundierungen'],
    ['n', '09.12.14.85.01', 'Grundierung auf Epoxydharzbasis'],
    ['n', '09.12.14.85.01.B', 'Grundierung einlagig'],
    ['ep', '1 000,00 m²', '5,92', '5 920,00'],
    ['n', '09.12.14.85.01.K.1', 'Ecken ausbilden'],
    ['ep', '20,00 Stk', '43,00', '860,00'],
    ['n', '09.12.14.85', 'Grundierungen', '6 780,00'],
  ],
];

const total = '12 345,00';
const all = 1 + pages.length;
const page = (i) => {
  const p = doc.addPage([595, 842]);
  const t = (s, x, y) => p.drawText(s, { x, y, size: 9, font });
  const right = (s, x, y) => t(s, x - font.widthOfTextAtSize(s, 9), y);
  return { p, t, right, footer: () => (t('Muster GmbH, Musterstrasse 1, 1000 Wien', 45, 40), right(`Seite ${i} von ${all}`, 550, 40)) };
};

// Deckblatt
{
  const { t, right, footer } = page(1);
  t('Muster GmbH', 50, 800);
  t('LV-Daten', 50, 760);
  t('LV-Bezeichnung', 50, 745);
  t('M9-001.MFK Musterhalle Beschichtungen', 200, 745);
  t('Summe', 50, 700);
  right(total, 550, 700);
  footer();
}
pages.forEach((rows, i) => {
  const { t, right, footer } = page(i + 2);
  t('Muster GmbH', 45, 800);
  t('Pos. Nr.', 47, 770);
  t('Stichwort', 140, 770);
  t('Menge Einheit', 330, 770);
  t('Einheitspreis', 420, 770);
  t('Positionspreis', 495, 770);
  let y = 745;
  for (const r of rows) {
    if (r[0] === 'n') {
      t(r[1], 47, y);
      t(r[2], 140, y);
      if (r[3]) right(r[3], 550, y);
    } else if (r[0] === 't') t(r[1], 140, y);
    else if (r[0] === 'ff') t('Frei formulierte Position', 140, y);
    else if (r[0] === 'p') {
      t(r[1], 300, y);
      if (r[2]) right(r[2], 400, y);
    } else {
      t('EP', 300, y);
      right(r[1], 400, y);
      if (r[3]) {
        right(r[2], 470, y);
        right(r[3], 550, y);
      } else t(r[2], 420, y);
    }
    y -= 14;
  }
  footer();
});
writeFileSync(join(dir, 'mfk-beispiel.pdf'), await doc.save());
console.log('mfk-beispiel.pdf erzeugt');
