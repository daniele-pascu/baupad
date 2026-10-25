import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { aufmassBlocksSheet, exportXlsx } from '../../src/lib/aufmass';
import type { ProjectState } from '../../src/lib/store';
import type { Damage, LvDocument, Plan } from '../../src/lib/types';

/** Excel nach Vorlage: Blöcke je Leistung, Kopfzeile mit Firmenlogo rechts und Seitenzahl in der Mitte */

const meta = { createdAt: 1, updatedAt: 1, rev: 1, deviceId: 't', deletedAt: null };
const plan = { ...meta, id: 'p1', projectId: 'x', costCenterId: 'c1', fileId: '', pageIndex: 0, pageWidth: 100, pageHeight: 100, crop: null, planNumber: '064', planName: 'TG', floor: '', area: '', description: '', numberStart: 1, sortIndex: 0 } as Plan;
const dmg = (id: string, n: number, o: Partial<Damage>): Damage =>
  ({ ...meta, id, projectId: 'x', planId: 'p1', number: n, shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1 }, color: '#f00', labelOffset: null, kind: 'damage', length: 2, width: 3, depth: null, area: 6, componentId: null, positionRef: null, label: null, ...o }) as Damage;
const lv: LvDocument = {
  ...meta,
  id: 'lv1',
  projectId: 'x',
  kind: 'lv',
  name: 'Beton',
  number: '1',
  fileName: '',
  groups: [],
  positions: [{ id: 'a', number: '01.01', shortText: 'Betonausbruch', longText: 'Betonausbruch bis 3 cm', unit: 'm2', quantity: 10, unitPrice: 50, totalPrice: 500, group: '01', issues: [] }],
};
const data = {
  project: { ...meta, id: 'x', name: 'Tiefgarage & Co', number: '', address: '', client: '' },
  costCenters: { c1: { ...meta, id: 'c1', projectId: 'x', number: '91092', name: 'Ebene 1', sortIndex: 0 } },
  files: {},
  plans: { p1: plan },
  damages: {
    d1: dmg('d1', 1, { positionRef: 'lv1:a' }),
    d2: dmg('d2', 2, { positionRef: 'lv1:a', width: 1, area: 2 }),
    d3: dmg('d3', 3, { kind: 'line', width: null, area: null, length: 4.5 }),
  },
  components: {},
  elements: {},
  lvDocs: { lv1: lv },
} as unknown as ProjectState;

describe('Excel nach Vorlage', () => {
  it('Block je Leistung: Pos. + Kurztext, lückenlose Tabelle, Summe, Einheits- und Gesamtpreis (Formeln); Linien getrennt; eine Seite', () => {
    const sh = aufmassBlocksSheet(data, [plan], new Set(), 'Tiefgarage · 91092');
    const text = (c: unknown) => (c && typeof c === 'object' && 'v' in c ? (c as { v: unknown }).v : null);
    const rows = sh.rows.map((r) => r.map(text));
    expect(rows[0][0]).toBe('Aufmaß');
    expect(rows[1][0]).toBe('Tiefgarage · 91092');
    expect(rows[3][0]).toBe('Pos. 01.01  Betonausbruch'); // nur Kurztext, kein Langtext
    expect(rows.flat().some((v) => typeof v === 'string' && v.includes('bis 3 cm'))).toBe(false);
    // Tiefe ohne Werte → keine Spalte (keine leeren Kästen)
    expect(rows[4]).toEqual(['Plan', 'Nr.', 'Länge (m)', 'Breite (m)', 'Menge (m²)']);
    expect(rows[5]).toEqual(['064', 1, 2, 3, 6]);
    expect(rows[6]).toEqual(['064', 2, 2, 1, 2]);
    expect(sh.rows[7][4]).toMatchObject({ t: 'formula', f: 'SUM(E6:E7)', v: 8 });
    expect(rows[7][3]).toBe('Summe m²');
    expect(rows[8].slice(3)).toEqual(['Einheitspreis (€/m²)', 50]);
    expect(rows[9][3]).toBe('Summe gesamte Leistung');
    expect(sh.rows[9][4]).toMatchObject({ t: 'formula', f: 'E8*E9', v: 400 });
    // Linie ohne Leistung: eigener Block nur mit Plan, Nr., Länge, Menge (m)
    const lineTitle = rows.findIndex((r) => r[0] === 'Linien ohne Leistung');
    expect(lineTitle).toBeGreaterThan(9);
    expect(rows[lineTitle + 1]).toEqual(['Plan', 'Nr.', 'Länge (m)', 'Menge (m)']);
    expect(rows[lineTitle + 2]).toEqual(['064', 3, 4.5, 4.5]);
    expect(sh).toMatchObject({ pageLayout: true, onePage: true, print: true });
  });

  it('Kopfzeile: links Projekt / Kostenstelle, Mitte Seite, rechts Logo (Bild in der Datei)', () => {
    const logo = { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), type: 'png' as const, width: 120, height: 40 };
    const f = exportXlsx(data, { kind: 'costCenter', costCenterId: 'c1' }, 'standard', { logo });
    const z = unzipSync(f.data);
    const sheet1 = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(sheet1).toContain('view="pageLayout"');
    expect(sheet1).toContain('fitToWidth="1" fitToHeight="1"'); // alles auf einer Seite
    expect(sheet1).toContain('<oddHeader>&amp;L&amp;9Tiefgarage &amp;&amp; Co / 91092 – Ebene 1&amp;C&amp;9Seite &amp;P von &amp;N&amp;R&amp;G</oddHeader>');
    expect(sheet1).toContain('<legacyDrawingHF r:id="rIdHF"/>');
    expect(strFromU8(z['xl/worksheets/_rels/sheet1.xml.rels'])).toContain('vmlDrawingHF1.vml');
    const vml = strFromU8(z['xl/drawings/vmlDrawingHF1.vml']);
    expect(vml).toContain('id="RH"');
    expect(vml).toContain('width:120pt;height:40pt');
    expect(strFromU8(z['xl/drawings/_rels/vmlDrawingHF1.vml.rels'])).toContain('../media/logo.png');
    expect(z['xl/media/logo.png']).toEqual(logo.bytes);
    expect(strFromU8(z['[Content_Types].xml'])).toContain('Extension="png"');
    // ohne Logo: Kopfzeile ohne Bild
    const g = unzipSync(exportXlsx(data, { kind: 'costCenter', costCenterId: 'c1' }).data);
    expect(strFromU8(g['xl/worksheets/sheet1.xml'])).not.toContain('&amp;G');
    expect(g['xl/media/logo.png']).toBeUndefined();
  });
});
