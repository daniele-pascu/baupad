import { describe, expect, it } from 'vitest';
import { buildLines, longTextParagraphs, parseGermanNumber, parseLv, sumPositions, type Line } from '../../src/lib/lv-parse';
import { nextPositionNumber } from '../../src/lib/numbering';

/** Zeile aus Zellen (Abstand groß genug für eine Spaltentrennung) */
const L = (page: number, ...cells: string[]): Line => ({ page, x: 40, cells });
const header = (page: number) => [
  L(page, 'Muster Bau GmbH'),
  L(page, 'Angebot / EUR'),
  L(page, 'Sanierung Tiefgarage'),
  L(page, 'Positionsnummer', 'Positionstext', 'P ZZ V'),
  L(page, `Seite: ${page}`),
];

describe('LV aus PDF-Text', () => {
  it('deutsche Zahlen mit Leerzeichen als Tausendertrennung', () => {
    expect(parseGermanNumber('5 150,00')).toBe(5150);
    expect(parseGermanNumber('1.234,5')).toBe(1234.5);
    expect(parseGermanNumber('abc')).toBeNull();
  });

  it('Zeilen und Spalten aus Textstücken', () => {
    const lines = buildLines(
      [
        { str: '92 01 01 B1', x: 40, y: 700, w: 60 },
        { str: 'Stellplatzmarkierung weiß', x: 150, y: 700.5, w: 130 },
        { str: 'Z', x: 560, y: 700, w: 6 },
      ],
      1,
    );
    expect(lines[0].cells).toEqual(['92 01 01 B1', 'Stellplatzmarkierung weiß', 'Z']);
  });

  it('Positionen mit Menge, Einheit, Preisen und Langtext; Kopfzeilen und Summen werden übergangen', () => {
    const lines: Line[] = [];
    for (const p of [1, 2, 3]) lines.push(...header(p));
    lines.push(
      L(1, '92', 'Markierungsarbeiten', 'Z'),
      L(1, '92 01', 'Markierungen neu', 'Z'),
      L(1, '92 01 01', 'Dauerhafte Markierungen, lösemittelfrei', 'Z'),
      L(1, '92 01 01 A', 'Vormarkierungen', 'Z'),
      L(1, 'LT 1', 'Erstellen von Vormarkierungen gemäß Vorgabe.'),
      L(1, 'Lohn :', '0,40'),
      L(1, '5 150,00 m', 'Einheitspreis :', '0,53 EUR', '2 729,50'),
      L(2, '92 01 01 B1', 'Stellplatzmarkierungen weiß', 'w', 'Z'),
      L(2, 'LT 1', 'Linienbreite bis 12 cm.'),
      L(2, 'Hinweis: deckungsgleich herstellen.'),
      L(2, '120,00 Stk', 'Einheitspreis :', '33,85 EUR', '4 000,00'),
      L(2, '92 01', 'Markierungen neu', '6 729,50'),
      L(3, '92 01 01 C', 'Sonderfarbton', 'Z'),
      L(3, '10,00 Psch', 'Einheitspreis :', '5,00 EUR', '50,00'),
      L(3, 'Zusammenstellung (EUR)'),
      L(3, '92 99 99 Z', 'nach der Zusammenstellung', 'Z'),
    );
    const lv = parseLv(lines, 3);
    expect(lv.title).toBe('Sanierung Tiefgarage');
    expect(lv.groups).toEqual([
      { number: '92', title: 'Markierungsarbeiten' },
      { number: '92 01', title: 'Markierungen neu' },
    ]);
    expect(lv.positions.map((p) => p.number)).toEqual(['92 01 01 A', '92 01 01 B1', '92 01 01 C']);
    const [a, b, c] = lv.positions;
    expect(a).toMatchObject({ shortText: 'Vormarkierungen', unit: 'm', quantity: 5150, unitPrice: 0.53, totalPrice: 2729.5, group: '92 01', issues: [] });
    expect(a.longText).toContain('Dauerhafte Markierungen'); // Grundtext
    expect(a.longText).toContain('Erstellen von Vormarkierungen');
    expect(a.longText).not.toContain('Lohn');
    expect(b.shortText).toBe('Stellplatzmarkierungen weiß');
    expect(b.longText).toContain('deckungsgleich');
    // Unstimmigkeiten werden markiert, nicht stillschweigend übernommen
    expect(b.issues).toContain('Menge × Einheitspreis ≠ Positionspreis');
    expect(c.issues).toEqual([]);
    expect(lv.groupSums['92 01']).toBe(6729.5);
    expect(sumPositions(lv.positions)).toBe(6779.5);
  });

  it('Kurz-LV: eine Zeile je Position mit Punkt-Nummern, W/E-Kennzeichen, Pauschalen ohne Nummer, Summe laut Dokument', () => {
    const head = (page: number) => [
      L(page, 'Auftrag Kurz-LV', `Seite ${page} von 2`),
      L(page, 'Gewerk: Betoninstandsetzung', '17.12.2025'),
      L(page, 'Baustelle Musterplatz 1'),
      L(page, 'Pos', 'Kurztext', 'W/E ME EH', 'EP', 'GP'),
    ];
    const lines: Line[] = [
      ...head(1),
      L(1, 'LG11', 'Estrich'),
      L(1, '02.', 'Maßnahme I'),
      L(1, '02.11.21.', 'Vorbereiten des Untergrundes'),
      L(1, '02.11.21.04', 'Niveauausgleich aus Splitt, einschließlich'),
      L(1, '02.11.21.04X.', "Niveauausgleich ü.10 cm b.' 50 cm' W", '44,00 m³', '0,00 ********'), // W am Text
      L(1, '02.11.21.07', 'Untergrund als Vorbereitung.'),
      L(1, '02.11.21.07C.', 'Untergrund aufrauen', '300,00 m²', '4,24', '1 271,56'), // EP gerundet → keine Warnung
      L(1, '02.11.22.30A.', 'Bodendämmung 45 mm stark', 'E', '2 580,00 m²', '125,43 ********'), // eigene Zelle
      L(1, '02.11.23.05P.', 'Estrich 60mm EN 13813', '300,00 m²', '40,48 12 144,67'), // EP und GP in einer Zelle
      L(1, '02.14.', 'Besondere Instandsetzungsarbeiten'),
      ...head(2),
      L(2, '02.11.27.01K.', 'Spezialestrich 60mm', 'W 2 300,00 m²', '123,21 ********'), // W an der Menge
      L(2, '03.14.', 'Besondere Instandsetzungsarbeiten'), // wie 02.14. – keine Kopfzeile
      L(2, '03.14.80.31A.', 'Risse verpressen', '510,00 Stk', '94,19', '48 034,75'),
      L(2, 'Umlage MST', '1,00 PA 22 000,00 22 000,00'),
      L(2, 'S1.12.25.24.03U.1', 'Aufzahlung Außenecken', '70,00 Stk', '20,33', '1 423,10'),
      L(2, 'S1.12.25.24.03V.', 'Minderpreis System', '1 000,00 m²', '-23,00', '-23 000,00'),
      L(2, 'SUMME:', '61 874,08'),
      L(2, 'NACHLASS:', '3,00 %', '-1 856,22'),
    ];
    const lv = parseLv(lines, 2);
    expect(lv.title).toBe('Betoninstandsetzung');
    expect(lv.total).toBe(61874.08);
    expect(lv.positions.map((p) => p.number)).toEqual(['02.11.21.04X.', '02.11.21.07C.', '02.11.22.30A.', '02.11.23.05P.', '02.11.27.01K.', '03.14.80.31A.', 'o. Nr. 1', 'S1.12.25.24.03U.1', 'S1.12.25.24.03V.']);
    const by = (n: string) => lv.positions.find((p) => p.number === n)!;
    expect(by('02.11.21.04X.')).toMatchObject({ shortText: "Niveauausgleich ü.10 cm b.' 50 cm'", quantity: 44, unit: 'm³', unitPrice: 0, totalPrice: null, group: '02.11.21.', issues: [] });
    expect(by('02.11.21.04X.').longText).toBe('Niveauausgleich aus Splitt, einschließlich\nWahlposition (W)'); // Grundtext + Kennzeichen
    expect(by('02.11.21.07C.')).toMatchObject({ quantity: 300, unit: 'm²', unitPrice: 4.24, totalPrice: 1271.56, issues: [] });
    expect(by('02.11.22.30A.')).toMatchObject({ quantity: 2580, unitPrice: 125.43, totalPrice: null });
    expect(by('02.11.22.30A.').longText).toBe('Eventualposition (E)');
    expect(by('02.11.23.05P.')).toMatchObject({ unitPrice: 40.48, totalPrice: 12144.67, issues: [] });
    expect(by('02.11.27.01K.')).toMatchObject({ shortText: 'Spezialestrich 60mm', quantity: 2300, totalPrice: null });
    expect(by('03.14.80.31A.')).toMatchObject({ group: '03.14.', unit: 'Stk', totalPrice: 48034.75 });
    expect(by('o. Nr. 1')).toMatchObject({ shortText: 'Umlage MST', quantity: 1, unit: 'PA', unitPrice: 22000, totalPrice: 22000, group: '' });
    expect(by('S1.12.25.24.03V.')).toMatchObject({ unitPrice: -23, totalPrice: -23000 });
    expect(lv.groups.map((g) => g.number)).toEqual(['LG11', '02.', '02.11.21.', '02.14.', '03.14.']);
    // Summe der Positionspreise (W/E ohne GP) = Summe laut Dokument
    expect(sumPositions(lv.positions)).toBe(61874.08);
  });

  it('Kurz-LV-Erkennung greift nicht, wenn das übliche Format Positionen liefert', () => {
    const lv = parseLv([L(1, '92 01 01 A', 'Vormarkierungen', 'Z'), L(1, '5 150,00 m', 'Einheitspreis :', '0,53 EUR', '2 729,50')], 1);
    expect(lv.positions.map((p) => p.number)).toEqual(['92 01 01 A']);
    expect(lv.total).toBeNull();
  });

  it('ÖNORM mit fünf Stufen („00 02 10 01 A“), Kennzeichen E/Z in eigenen Zellen, ausgesternter GP, Leistungssumme', () => {
    const head = (page: number) => [L(page, 'Bau GmbH'), L(page, 'Angebot / EUR'), L(page, 'LV Bautechnik'), L(page, 'Positionsnummer', 'Positionstext', 'P ZZ V w G K V')];
    const lines: Line[] = [
      L(1, 'Leistungssumme netto', '18 090,00 EUR'),
      ...head(2),
      L(2, '00', 'Baustellengemeinkosten'),
      L(2, 'Z'),
      L(2, '00 02', 'Allgemeine Bestimmungen'),
      L(2, '00 02 10', 'Beweissicherung und Sonstiges'),
      L(2, '00 02 10 01', 'Berücksichtigung Pandemie', 'Z'),
      L(2, '00 02 10 01 A', 'Pandemie Maßnahmen', 'E', 'Z'),
      L(2, 'LT 1'),
      L(2, 'Lohn', ':', '2 040,00'),
      L(2, '1,00 PA', 'Einheitspreis', ':', '4 080,00 EUR', '************'),
      L(2, '00 02 10 03 B', 'Beweissicherung Sachverständiger', 'Z'),
      L(2, '1,00 PA', 'Einheitspreis', ':', '14 590,00 EUR', '14 590,00'),
      L(2, '00 02 10', 'Beweissicherung und Sonstiges', '14 590,00'),
      ...head(3),
      L(3, '00 02 15 01 B', 'Mehraufwand Unterbrechungen', 'Z'),
      L(3, '50,00 d', 'Einheitspreis', ':', '70,00 EUR', '3 500,00'),
      L(3, 'Zusammenstellung (EUR)'),
    ];
    const lv = parseLv(lines, 3);
    expect(lv.positions.map((p) => p.number)).toEqual(['00 02 10 01 A', '00 02 10 03 B', '00 02 15 01 B']);
    const [a, b, c] = lv.positions;
    expect(a).toMatchObject({ shortText: 'Pandemie Maßnahmen', quantity: 1, unit: 'PA', unitPrice: 4080, totalPrice: null, group: '00 02 10', issues: [] });
    expect(a.longText).toBe('Berücksichtigung Pandemie\nEventualposition (E)');
    expect(b).toMatchObject({ unitPrice: 14590, totalPrice: 14590, group: '00 02 10' });
    expect(c).toMatchObject({ unit: 'd', quantity: 50, totalPrice: 3500, issues: [] }); // Tage
    expect(lv.groups.map((g) => g.number)).toEqual(['00', '00 02', '00 02 10']);
    expect(lv.groupSums['00 02 10']).toBe(14590);
    expect(lv.total).toBe(18090);
    expect(sumPositions(lv.positions)).toBe(18090);
  });

  it('Punkt-Nummern („03.12.11.26.01.A“) mit EP-Zeile, Lohn/Sonstiges, „Nicht angeboten“; MFK samt Nummer erkannt', () => {
    const lines: Line[] = [
      L(1, 'Projekt:', '91000 - M1-003.MFK Tiefgarage Estrich'),
      L(1, 'LV-Bezeichnung', 'M1-003.MFK Tiefgarage Estrich'),
      L(1, 'Summe', '23 750,00'),
      L(2, 'Inhalt'),
      L(2, '03 M1-003.MFK Tiefgarage Estrich..............', '3'),
      L(3, 'Pos. Nr.', 'Stichwort', 'Menge Einheit', 'Einheitspreis', 'Positionspreis'),
      L(3, '03', 'M1-003.MFK Tiefgarage Estrich'),
      L(3, '03.12', 'Maßnahme I'),
      L(3, '03.12.11', 'Estricharbeiten'),
      L(3, 'Version 022 (2021-12)'),
      L(3, '03.12.11.26', 'Sonderaufbauten'),
      L(3, '03.12.11.26.01', 'Besondere Vorbereitungen nach Abtrag'),
      L(3, 'Gilt für die folgenden Positionen.'),
      L(3, 'Frei formulierte Position'),
      L(3, '03.12.11.26.01.A', 'Untergrund überschleifen'),
      L(3, 'Überschleifen des Betonuntergrundes.'),
      // Seitenumbruch: Spaltenkopf wiederholt sich – gehört nicht zum Langtext
      L(3, 'Pos. Nr.', 'Stichwort', 'Menge Einheit', 'Einheitspreis', 'Positionspreis'),
      L(3, 'Lohn', '6,15'),
      L(3, 'Sonstiges', '2,80'),
      L(3, 'EP', '2 500,00 m²', '8,95', '22 375,00'),
      L(3, 'Frei formulierte Position'),
      L(3, '03.12.11.26.01.B', 'Kugelstrahlen'),
      L(3, 'Lohn'),
      L(3, 'Sonstiges'),
      L(3, 'EP', '2 500,00 m²', 'Nicht angeboten'),
      L(3, '03.12.11.26.01.K.1', 'Aufzahlung Ecken'),
      L(3, 'EP', '50,00 Stk', '27,50', '1 375,00'),
      L(3, '03.12.11.26', 'Sonderaufbauten', '23 750,00'),
      L(4, 'Zusammenstellung'),
      L(4, 'Gesamtpreis', '23 750,00'),
    ];
    const lv = parseLv(lines, 4);
    expect(lv.title).toBe('M1-003.MFK Tiefgarage Estrich');
    expect([lv.kind, lv.number]).toEqual(['mfk', 'M1-003']);
    expect(lv.positions.map((p) => p.number)).toEqual(['03.12.11.26.01.A', '03.12.11.26.01.B', '03.12.11.26.01.K.1']);
    const [a, b, k] = lv.positions;
    expect(a).toMatchObject({ shortText: 'Untergrund überschleifen', quantity: 2500, unit: 'm²', unitPrice: 8.95, totalPrice: 22375, group: '03.12.11.26', issues: [] });
    // Grundtext samt Langtext, eigener Langtext; ohne Preisanteile und „Frei formulierte Position“
    expect(a.longText).toBe('Besondere Vorbereitungen nach Abtrag\nGilt für die folgenden Positionen.\nÜberschleifen des Betonuntergrundes.');
    expect(b).toMatchObject({ unitPrice: null, totalPrice: null, issues: [] });
    expect(b.longText).toContain('Nicht angeboten');
    expect(b.longText).not.toMatch(/Lohn|Sonstiges/);
    expect(k).toMatchObject({ quantity: 50, unit: 'Stk', totalPrice: 1375 });
    expect(lv.groups.map((g) => g.number)).toEqual(['03', '03.12', '03.12.11', '03.12.11.26']);
    expect(lv.groupSums['03.12.11.26']).toBe(23750);
    expect(lv.total).toBe(23750);
    expect(sumPositions(lv.positions)).toBe(23750);
  });
});


describe('Positionsnummer weiterzählen (manuelle Eingabe)', () => {
  it('Zahlen mit führenden Nullen, Gruppen und Buchstaben', () => {
    expect(nextPositionNumber('1')).toBe('2');
    expect(nextPositionNumber('9')).toBe('10');
    expect(nextPositionNumber('01.01')).toBe('01.02');
    expect(nextPositionNumber('01.09')).toBe('01.10');
    expect(nextPositionNumber('92 01 01 A')).toBe('92 01 01 B');
    expect(nextPositionNumber('03.12.11.26.01.A')).toBe('03.12.11.26.01.B');
    expect(nextPositionNumber('02.11.21.07C.')).toBe('02.11.21.07D.');
    expect(nextPositionNumber('Pos 5a')).toBe('Pos 6a');
    expect(nextPositionNumber('')).toBe('');
    expect(nextPositionNumber('Zusatz')).toBe('');
  });

  it('Langtext lesbar: umbrochene Zeilen werden zu Absätzen, Überschrift bleibt eigene Zeile, Silbentrennung entfernt', () => {
    const t = [
      'Besondere Vorbereitungen nach Abtrag',
      'Überschleifen des Betonuntergrundes zur Entfernung von Spitzen, Graten und Höhen-',
      'versätzen bis 5mm Abtragstiefe mittels großflächigem Diamantschleifgerät mit',
      'Absaugung.',
      'Abgerechnet wird die bearbeitete Fläche.',
      '- Absaugung inbegriffen',
      'Eventualposition (E)',
    ].join('\n');
    expect(longTextParagraphs(t)).toEqual([
      'Besondere Vorbereitungen nach Abtrag',
      'Überschleifen des Betonuntergrundes zur Entfernung von Spitzen, Graten und Höhenversätzen bis 5mm Abtragstiefe mittels großflächigem Diamantschleifgerät mit Absaugung.',
      'Abgerechnet wird die bearbeitete Fläche.',
      '- Absaugung inbegriffen',
      'Eventualposition (E)',
    ]);
  });
});
