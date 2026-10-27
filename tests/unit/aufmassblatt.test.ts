import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { aufmassNameOf } from '../../src/lib/aufmass';
import { defaultPeriod, exportAufmassblatt } from '../../src/lib/aufmassblatt';
import type { ProjectState } from '../../src/lib/store';
import type { Damage, Plan } from '../../src/lib/types';

const meta = { createdAt: 1, updatedAt: 1, rev: 1, deviceId: 't', deletedAt: null };
const plan = { ...meta, id: 'p1', projectId: 'x', costCenterId: 'c1', fileId: '', pageIndex: 0, pageWidth: 100, pageHeight: 100, crop: null, planNumber: '64', planName: 'TG', floor: '', area: '', description: '', numberStart: 1, sortIndex: 0 } as Plan;
const dmg = (id: string, n: number, o: Partial<Damage>): Damage =>
  ({ ...meta, id, projectId: 'x', planId: 'p1', number: n, shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1 }, color: '#f00', labelOffset: null, kind: 'damage', length: 2, width: 3, depth: null, area: 6, componentId: null, positionRef: null, label: null, ...o }) as Damage;
const data = {
  project: { ...meta, id: 'x', name: 'Bauvorhaben X', number: '', address: '', client: '' },
  costCenters: { c1: { ...meta, id: 'c1', projectId: 'x', number: '91092', name: 'Ebene 1', sortIndex: 0 } },
  files: {},
  plans: { p1: plan },
  damages: { d1: dmg('d1', 1, {}), d2: dmg('d2', 2, { kind: 'line', width: null, area: null, length: 4.5 }) },
  components: {},
  elements: {},
  lvDocs: {},
} as unknown as ProjectState;
const logo = { bytes: new Uint8Array([137, 80, 78, 71]), type: 'png' as const, width: 99, height: 27 };

describe('Aufmaßblatt (Firmenvorlage)', () => {
  const zip = unzipSync(exportAufmassblatt(data, { kind: 'costCenter', costCenterId: 'c1' }, { no: '007', period: '01.10.2026' }, { logo }).data);
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']);
  it('Kopfzeile wie Vorlage: Logo links, „Seite von Seiten“ rechts; Seitenlayout, eine Seite', () => {
    // Mitte: Aufmaßblatt-Nummer kursiv 9 pt wie in der neuen Vorlage
    expect(sheet).toContain('<oddHeader>&amp;L&amp;G&amp;C&amp;&quot;-,Kursiv&quot;&amp;9Aufmaßblatt 007&amp;R&amp;P von &amp;N</oddHeader>');
    expect(sheet).toContain('<pageMargins left="0.61" right="0.61"');
    expect(strFromU8(zip['xl/drawings/vmlDrawingHF1.vml'])).toContain('id="LH"');
    expect(sheet).toContain('view="pageLayout"');
    expect(sheet).toContain('fitToWidth="1" fitToHeight="1"'); // immer eine Seite
    expect(strFromU8(zip['xl/styles.xml'])).toContain('Aptos Narrow');
  });
  it('ohne LV: Kopf mit Nummer, Bauvorhaben, Kostenstelle, Leistungszeitraum; Flächen und Linien mit Plan und Nr.', () => {
    for (const t of ['Aufmaßblatt 007', 'Bauvorhaben X', '91092 – Ebene 1', '01.10.2026', 'Aufmaß', 'Flächen', 'Linien und Längen']) expect(sheet).toContain(`>${t}<`);
    expect(sheet).toContain('<f>C11*D11</f>'); // m² = Länge × Breite als Formel
    expect(sheet).toMatch(/<f>SUM\(C\d+:C\d+\)<\/f>/); // Summe Linien
    // nichts zu bemerken → keine Spalte „Bemerkung“, keine Messart
    expect(sheet).not.toContain('>Bemerkung<');
    expect(sheet).not.toContain('>Schadstelle<');
  });
  it('Spalte „Bemerkung“ nur mit Hinweis (z. B. Fläche aus dem Plan)', () => {
    const withNote = { ...data, damages: { ...data.damages, d1: dmg('d1', 1, { areaFromShape: true }) } } as unknown as ProjectState;
    const ws = strFromU8(unzipSync(exportAufmassblatt(withNote, { kind: 'plan', planId: 'p1' }, { no: '010', period: '' }).data)['xl/worksheets/sheet1.xml']);
    expect(ws.match(/>Bemerkung</g)).toHaveLength(1); // nur in der Flächentabelle, nicht bei den Linien
    expect(ws).toContain('>Fläche aus Plan<');
  });

  it('jede LV/MFK und das Aufmaß ohne Position beginnt auf einer neuen Seite; fester Zoom, damit die Umbrüche gelten', () => {
    const pos = (id: string, number: string, unit: string) => ({ id, number, shortText: `Text ${number}`, longText: '', unit, quantity: null, unitPrice: 10, totalPrice: null, group: '', issues: [] });
    const doc = (id: string, kind: 'lv' | 'mfk', number: string, p: ReturnType<typeof pos>) => ({ ...meta, id, projectId: 'x', kind, name: `Dok ${number}`, number, fileName: '', groups: [], positions: [p] });
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, dmg(`m${i}`, 10 + i, { positionRef: 'm1:b', kind: 'line', width: null, area: null, length: 1 })]));
    const two = {
      ...data,
      lvDocs: { l1: doc('l1', 'lv', '1', pos('a', '01', 'm²')), m1: doc('m1', 'mfk', '2', pos('b', '02', 'm')) },
      damages: { ...data.damages, d3: dmg('d3', 3, { positionRef: 'l1:a' }), ...many },
    } as unknown as ProjectState;
    const ws = strFromU8(unzipSync(exportAufmassblatt(two, { kind: 'costCenter', costCenterId: 'c1' }, { no: '008', period: '' }, { logo }).data)['xl/worksheets/sheet1.xml']);
    const rowOf = (text: string) => Number(new RegExp(`<row r="(\\d+)"[^>]*>(?:(?!</row>).)*>${text}<`).exec(ws)![1]);
    const breaks = [...ws.matchAll(/<brk id="(\d+)" max="16383" man="1"\/>/g)].map((m) => Number(m[1]) + 1);
    // Umbruch vor der MFK und vor dem Aufmaß ohne Position (nicht vor der ersten LV)
    expect(breaks).toEqual([rowOf('MFK - 2 Dok 2'), rowOf('Aufmaß ohne Leistungsposition')]);
    expect(ws).not.toContain('fitToPage');
    // die lange MFK (60 Messungen) passt durch kleineren Zoom auf eine Seite
    const scale = Number(/scale="(\d+)"/.exec(ws)![1]);
    expect(scale).toBeLessThan(100);
    expect(scale).toBeGreaterThanOrEqual(50);
  });
});

describe('Rechnungen', () => {
  // zwei Teilrechnungen, je ein Plan; TR 2 hat zwei Pläne mit derselben Position
  const inv = (id: string, no: number, period = '') => ({ id, kind: 'tr' as const, no, period, createdAt: 1 });
  const pl = (id: string, invoiceId: string, planNumber: string) => ({ ...plan, id, invoiceId, planNumber }) as Plan;
  const pos = { id: 'a', number: '01', shortText: 'Beton', longText: '', unit: 'm²', quantity: null, unitPrice: 10, totalPrice: null, group: '', issues: [] };
  const split = {
    ...data,
    project: { ...data.project, splitByInvoice: true, invoices: [inv('t1', 1), inv('t2', 2, 'Oktober 2026')] },
    plans: { p1: pl('p1', 't1', '1'), p2: pl('p2', 't2', '1'), p3: pl('p3', 't2', '2') },
    lvDocs: { l1: { ...meta, id: 'l1', projectId: 'x', kind: 'lv', name: 'Haupt-LV', number: '', fileName: '', groups: [], positions: [pos] } },
    damages: {
      d1: dmg('d1', 1, { positionRef: 'l1:a' }),
      d2: dmg('d2', 1, { planId: 'p2', positionRef: 'l1:a', length: 1, width: 1, area: 1 }),
      d3: dmg('d3', 1, { planId: 'p3', positionRef: 'l1:a', length: 2, width: 1, area: 2 }),
    },
  } as unknown as ProjectState;

  it('Aufmaßblatt je Rechnung: alle Pläne der Rechnung, gleiche Position zusammengefasst', () => {
    const f = exportAufmassblatt(split, { kind: 'invoice', invoiceId: 't2' }, { no: '004', period: 'Oktober 2026' });
    expect(f.name).toContain('TR2');
    const ws = strFromU8(unzipSync(f.data)['xl/worksheets/sheet1.xml']);
    expect(ws).toContain('>Aufmaßblatt 004 – 2. Teilrechnung<');
    expect(ws.match(/>01</g)).toHaveLength(2); // Position einmal (dazu in der Zusammenstellung) …
    expect(ws).toMatch(/<f>SUM\(E15:E16\)<\/f><v>3<\/v>/); // … mit 1 + 2 m² aus beiden Plänen, ohne TR 1 (6 m²)
  });

  it('Leistungszeitraum der Rechnung als Vorschlag', () => {
    expect(defaultPeriod(split, { kind: 'invoice', invoiceId: 't2' })).toBe('Oktober 2026');
  });

  it('Aufmaß je Plan: durchnummeriert oder eigener Name', () => {
    const two = { ...data, plans: { p1: plan, p2: { ...plan, id: 'p2', planNumber: '65' } } } as unknown as ProjectState;
    expect(aufmassNameOf(two, two.plans.p1)).toBe('Aufmaß 1');
    expect(aufmassNameOf(two, two.plans.p2)).toBe('Aufmaß 2');
    expect(aufmassNameOf(two, { ...two.plans.p2, aufmassName: ' Keller Nord ' })).toBe('Keller Nord');
  });
});
