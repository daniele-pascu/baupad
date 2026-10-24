import { describe, expect, it } from 'vitest';
import { buildLines, parseGermanNumber, parseLv, sumPositions, type Line } from '../../src/lib/lv-parse';

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
});
