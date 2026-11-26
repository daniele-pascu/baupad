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
  it('Kopfzeile wie Vorlage: Logo links, „Seite von Seiten“ rechts; normale Ansicht, A4 in 100 % (nie „an Seite anpassen“)', () => {
    // Mitte: Aufmaßblatt-Nummer kursiv 9 pt wie in der neuen Vorlage
    expect(sheet).toContain('<oddHeader>&amp;L&amp;G&amp;C&amp;&quot;-,Kursiv&quot;&amp;9Aufmaßblatt 007&amp;R&amp;P von &amp;N</oddHeader>');
    expect(sheet).toContain('<pageMargins left="0.61" right="0.61"');
    expect(strFromU8(zip['xl/drawings/vmlDrawingHF1.vml'])).toContain('id="LH"');
    expect(sheet).not.toContain('view="pageLayout"'); // normale Ansicht – wie jede andere Excel-Datei
    expect(sheet).not.toContain('<brk '); // keine festen Seitenumbrüche
    // nie auf eine Seite gequetscht: fester Maßstab 100 %, lange Listen laufen auf die nächste Seite
    expect(sheet).toContain('<pageSetup paperSize="9" orientation="portrait" scale="100"/>');
    expect(sheet).not.toContain('fitToPage');
    expect(sheet).not.toContain('fitToHeight');
    expect(strFromU8(zip['xl/styles.xml'])).toContain('Aptos Narrow');
  });
  it('ohne LV: Kopf mit Nummer, Bauvorhaben, Kostenstelle, Leistungszeitraum; Flächen und Linien mit Plan und Nr.', () => {
    for (const t of ['Aufmaßblatt 007', 'Bauvorhaben X', '91092 – Ebene 1', '01.10.2026', 'Aufmaß', 'Betoninstandsetzung', 'Länge']) expect(sheet).toContain(`>${t}<`); // je Messart eine Tabelle
    expect(sheet).not.toContain('>Summe<');
    // Kopf: nur Bauvorhaben und Kostenstelle (und Leistungszeitraum) – keine Zeile „Plan“
    expect(sheet).not.toContain('>Pläne<');
    expect(sheet.match(/>Plan</g)).toHaveLength(2); // nur noch als Spaltenkopf der beiden Tabellen // wie in der Vorlage: Summe unter der Mengenspalte, Einheit daneben – ohne Beschriftung
    expect(sheet).toMatch(/<f>ROUND\(C(\d+)\*D\1,2\)<\/f>/); // m² = Länge × Breite als Formel
    // je Messart nur die gefragten Maße, Menge gleich danach: Fläche Länge|Breite|m² (E), Länge nur m (C)
    expect(sheet).toMatch(/<f>SUM\(E\d+:E\d+\)<\/f>/);
    expect(sheet).toMatch(/<f>SUM\(C\d+:C\d+\)<\/f>/);
    // nichts zu bemerken → keine Spalte „Bemerkung“
    expect(sheet).not.toContain('>Bemerkung<');
  });
  it('ohne gemessene Tiefe: keine Spalte Tiefe; mit Tiefe Länge|Breite|Tiefe|m²', () => {
    expect(sheet).not.toContain('>Tiefe<');
    const withDepth = { ...data, damages: { ...data.damages, d1: dmg('d1', 1, { depth: 0.05 }) } } as unknown as ProjectState;
    const z = unzipSync(exportAufmassblatt(withDepth, { kind: 'costCenter', costCenterId: 'c1' }, { no: '008', period: '01.10.2026' }).data);
    const s2 = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(s2).toContain('>Tiefe<');
    expect(s2).toMatch(/<f>SUM\(F\d+:F\d+\)<\/f>/);
  });
  it('Spalte „Bemerkung“ nur mit Notiz – gleich neben der Menge; „aus Plan“ steht nie da', () => {
    const withNote = { ...data, damages: { ...data.damages, d1: dmg('d1', 1, { note: 'Sockel' }), d2: dmg('d2', 2, { kind: 'line', width: null, area: null, length: 4.5, areaFromShape: true }) } } as unknown as ProjectState;
    const ws = strFromU8(unzipSync(exportAufmassblatt(withNote, { kind: 'plan', planId: 'p1' }, { no: '010', period: '' }).data)['xl/worksheets/sheet1.xml']);
    expect(ws.match(/>Bemerkung</g)).toHaveLength(1); // nur in der Flächentabelle, nicht bei den Linien
    // Tabelle Plan|Nr.|Länge|Breite|m² (A–E): die Bemerkung steht gleich daneben in F – nie mit leeren Spalten dazwischen
    expect(ws).toMatch(/<c r="F\d+"[^>]*>(<is>)?<t[^>]*>Bemerkung</);
    expect(ws).toMatch(/<c r="F\d+"[^>]*>(<is>)?<t[^>]*>Sockel</);
    expect(ws).not.toContain('aus Plan');
  });
  it('Tabelle mit grauem Kopf, jede zweite Zeile getönt – nur über die Spalten der Tabelle', () => {
    const lines = Object.fromEntries([1, 2, 3].map((i) => [`l${i}`, dmg(`l${i}`, i, { kind: 'line', width: null, area: null, length: i })]));
    const z = unzipSync(exportAufmassblatt({ ...data, damages: lines } as unknown as ProjectState, { kind: 'plan', planId: 'p1' }, { no: '013', period: '' }).data);
    const ws = strFromU8(z['xl/worksheets/sheet1.xml']);
    const styles = strFromU8(z['xl/styles.xml']);
    const xfs = [.../<cellXfs[^>]*>(.*)<\/cellXfs>/.exec(styles)![1].matchAll(/<xf [^>]*?(?:\/>|>.*?<\/xf>)/g)].map((m) => m[0]);
    expect(Number(/<cellXfs count="(\d+)"/.exec(styles)![1])).toBe(xfs.length);
    const row = (text: string) => new RegExp(`<row r="\\d+"[^>]*>((?:(?!<\\/row>).)*>${text}<(?:(?!<\\/row>).)*)<\\/row>`).exec(ws)![1];
    const stylesOf = (cells: string) => [...cells.matchAll(/<c r="([A-J])\d+" s="(\d+)"/g)].map((m) => [m[1], xfs[Number(m[2])]] as const);
    // Kopf: Füllung (grau) in A–C, rechts davon nichts
    const head = stylesOf(row('Plan'));
    expect(head.map(([c]) => c)).toEqual(['A', 'B', 'C']);
    for (const [, xf] of head) expect(xf).toContain('fillId="4"');
    // Zeilen: 1. ohne Füllung, 2. getönt, 3. ohne Füllung mit Linie unten
    const body = [10, 11, 12].map((r) => stylesOf(new RegExp(`<row r="${r}"[^>]*>(.*?)<\\/row>`).exec(ws)![1]));
    expect(body.map((cells) => cells.map(([c]) => c).join(''))).toEqual(['ABC', 'ABC', 'ABC']);
    expect(body.map((cells) => cells.every(([, xf]) => xf.includes('fillId="5"')))).toEqual([false, true, false]);
    expect(body.map((cells) => cells.every(([, xf]) => xf.includes('borderId="1"')))).toEqual([false, false, true]);
  });
  it('Linien der Tabelle nur über ihre Spalten – nie über die Blattbreite', () => {
    // Längentabelle Plan|Nr.|m (A–C): rechts davon keine formatierten (linierten) Zellen in den Messzeilen
    const xml = sheet.slice(sheet.indexOf('>Länge<'));
    const head = /<row r="(\d+)"[^>]*>(?:(?!<\/row>).)*>Plan<(?:(?!<\/row>).)*<\/row>/.exec(xml)!;
    expect(head[0]).not.toMatch(/<c r="[D-J]\d+"/);
    const next = new RegExp(`<row r="${Number(head[1]) + 1}"[^>]*>(?:(?!<\\/row>).)*<\\/row>`).exec(xml)!;
    expect(next[0]).toMatch(/<c r="C\d+"/);
    expect(next[0]).not.toMatch(/<c r="[D-J]\d+"/);
  });

  it('Bewehrung: eine Zeile je Nummer, lfm als Formel aus allen Längen (2*0.2+3*0.2+0.54+3*0.9), Summe', () => {
    expect(sheet).not.toContain('>Bewehrung<');
    const items = [
      { id: 'r1', count: 2, length: 0.2 },
      { id: 'r2', count: 3, length: 0.2 },
      { id: 'r3', count: 1, length: 0.54 },
      { id: 'r4', count: 3, length: 0.9 },
    ];
    const withRebar = { ...data, damages: { d1: dmg('d1', 1, { rebar: 4.24, rebarItems: items }), d2: dmg('d2', 2, { kind: 'line', width: null, area: null, length: 4.5, rebar: 1.25 }) } } as unknown as ProjectState;
    const ws = strFromU8(unzipSync(exportAufmassblatt(withRebar, { kind: 'plan', planId: 'p1' }, { no: '011', period: '' }).data)['xl/worksheets/sheet1.xml']);
    for (const t of ['Bewehrung', 'lfm']) expect(ws).toContain(`>${t}<`);
    expect(ws).toContain('<f>2*0.2+3*0.2+0.54+3*0.9</f><v>4.24</v>');
    expect(ws).toContain('<f>1.25</f><v>1.25</v>'); // ältere Messung: nur die Summe
    expect(ws).toMatch(/<f>SUM\(C\d+:C\d+\)<\/f><v>5.49<\/v>/);
  });

  it('Abzüge/Zuschläge: eigene Zeilen mit Formel und Bemerkung, Summe = netto; Position rechnet netto', () => {
    // Wand 5,50 × 2,30 = 12,65 m², abzüglich 2 Fenster 1,00 × 1,20 und einer Tür 1,00 × 2,10, zuzüglich Nische 0,50 × 1,00
    const deductions = [
      { id: 'a', label: 'Fenster', count: 2, length: 1, width: 1.2 },
      { id: 'b', label: 'Tür', count: 1, length: 1, width: 2.1 },
      { id: 'c', label: 'Nische', count: 1, length: 0.5, width: 1, add: true },
    ];
    const pos = { id: 'a', number: '01', shortText: 'Spachteln', longText: '', unit: 'm²', quantity: null, unitPrice: 10, totalPrice: null, group: '', issues: [] };
    const withDeds = {
      ...data,
      lvDocs: { l1: { ...meta, id: 'l1', projectId: 'x', kind: 'lv', name: 'LV', number: '', fileName: '', groups: [], positions: [pos] } },
      damages: { d1: dmg('d1', 1, { kind: 'area', length: 5.5, width: 2.3, area: 8.65, deductions, positionRef: 'l1:a' }) },
    } as unknown as ProjectState;
    const ws = strFromU8(unzipSync(exportAufmassblatt(withDeds, { kind: 'plan', planId: 'p1' }, { no: '011', period: '' }).data)['xl/worksheets/sheet1.xml']);
    // Abzug/Zuschlag ohne eigene Nummer: was es ist, steht in der Bemerkung
    for (const t of ['Abzug Fenster (2×)', 'Abzug Tür', 'Zuschlag Nische', 'Bemerkung']) expect(ws).toContain(`>${t}<`);
    for (const t of ['1-A1', '1-A2', '1-Z1']) expect(ws).not.toContain(t);
    const main = /<f>ROUND\((C(\d+)\*D\2),2\)<\/f><v>12.65<\/v>/.exec(ws)!;
    const r = Number(main[2]);
    expect(ws).toContain(`<f>-2*ROUND(C${r + 1}*D${r + 1},2)</f><v>-2.4</v>`);
    expect(ws).toContain(`<f>-ROUND(C${r + 2}*D${r + 2},2)</f><v>-2.1</v>`);
    expect(ws).toContain(`<f>ROUND(C${r + 3}*D${r + 3},2)</f><v>0.5</v>`);
    expect(ws).toContain(`<f>SUM(E${r}:E${r + 3})</f><v>8.65</v>`); // 12,65 − 2,40 − 2,10 + 0,50
  });

  it('Abzüge bei Linien: gemessene Länge, darunter Teillängen; Summe = netto', () => {
    const withDeds = {
      ...data,
      damages: { d2: dmg('d2', 2, { kind: 'line', width: null, area: null, length: 12.4, deductions: [{ id: 'a', label: 'Tür', count: 2, length: 1 }] }) },
    } as unknown as ProjectState;
    const ws = strFromU8(unzipSync(exportAufmassblatt(withDeds, { kind: 'plan', planId: 'p1' }, { no: '012', period: '' }).data)['xl/worksheets/sheet1.xml']);
    expect(ws).toContain('>Abzug Tür (2 × 1,00 m)<');
    expect(ws).toContain('<v>12.4</v>');
    expect(ws).toContain('<v>-2</v>');
    expect(ws).toMatch(/<f>SUM\(C\d+:C\d+\)<\/f><v>10.4<\/v>/);
  });

  it('mehrere LV/MFK und das Aufmaß ohne Position: A4 in 100 % – nie auf eine Seite gequetscht; lange Tabelle beginnt auf der neuen Seite wieder mit ihrer Kopfzeile', () => {
    const pos = (id: string, number: string, unit: string) => ({ id, number, shortText: `Text ${number}`, longText: '', unit, quantity: null, unitPrice: 10, totalPrice: null, group: '', issues: [] });
    const doc = (id: string, kind: 'lv' | 'mfk', number: string, p: ReturnType<typeof pos>) => ({ ...meta, id, projectId: 'x', kind, name: `Dok ${number}`, number, fileName: '', groups: [], positions: [p] });
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, dmg(`m${i}`, 10 + i, { positionRef: 'm1:b', kind: 'line', width: null, area: null, length: 1 })]));
    const two = {
      ...data,
      lvDocs: { l1: doc('l1', 'lv', '1', pos('a', '01', 'm²')), m1: doc('m1', 'mfk', '2', pos('b', '02', 'm')) },
      damages: { ...data.damages, d3: dmg('d3', 3, { positionRef: 'l1:a' }), ...many },
    } as unknown as ProjectState;
    const ws = strFromU8(unzipSync(exportAufmassblatt(two, { kind: 'costCenter', costCenterId: 'c1' }, { no: '008', period: '' }, { logo }).data)['xl/worksheets/sheet1.xml']);
    // 60 Zeilen passen nicht auf eine Seite: Umbruch in der Tabelle, danach steht die Kopfzeile (Plan | Nr. | m) wieder oben
    const breaks = [...ws.matchAll(/<brk id="(\d+)"[^>]*man="1"/g)].map((m) => Number(m[1]) + 1);
    expect(breaks.length).toBeGreaterThan(0);
    const rowXml = (r: number) => new RegExp(`<row r="${r}"[^>]*>(.*?)<\\/row>`).exec(ws)![1];
    const repeated = breaks.filter((r) => />Plan<.*>Nr\.<.*>m</.test(rowXml(r)));
    expect(repeated.length).toBeGreaterThan(0);
    // die Zeile darunter ist eine Messzeile derselben Tabelle, die Summe zählt über den Umbruch hinweg alle 60
    expect(rowXml(repeated[0] + 1)).toMatch(/<c r="C\d+"[^>]*><v>1<\/v>/);
    expect(ws).toMatch(/<f>SUM\(C\d+:C\d+\)<\/f><v>60<\/v>/);
    expect(ws).toContain('scale="100"');
    expect(ws).not.toContain('fitToPage');
    expect(ws).not.toContain('fitToHeight');
    expect(ws).not.toContain('view="pageLayout"');
    // Zeilenhöhen frei (Excel passt sie selbst an): nur umbrochene Texte in verbundenen Zellen bekommen eine Höhe
    expect((ws.match(/customHeight="1"/g) ?? []).length).toBeLessThan(3);
  });
});

describe('Aufmaßblatt: Spaltenbreiten passen zum Inhalt', () => {
  const width = (ws: string, col: number) => Number(new RegExp(`<col min="${col}" max="${col}" width="([\\d.]+)"`).exec(ws)![1]);
  const sum = (ws: string) => Array.from({ length: 10 }, (_, i) => width(ws, i + 1)).reduce((a, b) => a + b, 0);
  const sheetOf = (damages: Record<string, Damage>, p: Partial<Plan> = {}) =>
    strFromU8(unzipSync(exportAufmassblatt({ ...data, plans: { p1: { ...plan, ...p } }, damages } as unknown as ProjectState, { kind: 'plan', planId: 'p1' }, { no: '040', period: '' }).data)['xl/worksheets/sheet1.xml']);
  it('übliche Werte: Standardbreiten, 100 %', () => {
    const ws = sheetOf(data.damages);
    expect(width(ws, 3)).toBe(9);
    expect(sum(ws)).toBe(87);
    expect(ws).toContain('scale="100"');
  });
  it('große Summe und lange Plannummer: Spalte wird breiter (kein „###“), das Blatt bleibt eine Seite breit', () => {
    const big = Object.fromEntries([1, 2, 3].map((i) => [`l${i}`, dmg(`l${i}`, i, { kind: 'line', width: null, area: null, length: 123456.78 })]));
    const ws = sheetOf(big, { planNumber: 'TG-Ebene-02' });
    expect(width(ws, 3)).toBeGreaterThanOrEqual(13); // 370.370,34 fett
    expect(width(ws, 1)).toBeGreaterThanOrEqual(12);
    expect(sum(ws)).toBe(87); // die Füllspalten G und H geben den Platz ab
    expect(ws).toContain('scale="100"');
    // reicht auch das nicht: Ausdruck etwas kleiner – die Breite passt trotzdem auf eine Seite
    const wide = sheetOf(big, { planNumber: 'Tiefgarage-Ebene-02-Nordseite' });
    expect(sum(wide)).toBeGreaterThan(87);
    const scale = Number(/scale="(\d+)"/.exec(wide)![1]);
    expect(scale).toBeLessThan(100);
    expect((sum(wide) * scale) / 100).toBeLessThanOrEqual(87);
  });
});

describe('Aufmaßblatt: immer nach Messart getrennt, Preise nur mit Position', () => {
  const pos = { id: 'a', number: '01', shortText: 'Beschichten', longText: '', unit: 'm²', quantity: null, unitPrice: 10, totalPrice: null, group: '', issues: [] };
  const lv = { l1: { ...meta, id: 'l1', projectId: 'x', kind: 'lv', name: 'LV', number: '', fileName: '', groups: [], positions: [pos] } };
  const ws = (d: unknown) => strFromU8(unzipSync(exportAufmassblatt(d as ProjectState, { kind: 'plan', planId: 'p1' }, { no: '030', period: '' }).data)['xl/worksheets/sheet1.xml']);
  it('eine Position mit Fläche und Wand: zwei Tabellen, Menge = Summe beider', () => {
    const s = ws({
      ...data,
      lvDocs: lv,
      damages: {
        d1: dmg('d1', 1, { kind: 'area', measureType: 'flaeche', positionRef: 'l1:a' } as Partial<Damage>),
        d2: dmg('d2', 2, { kind: 'area', measureType: 'wand', length: 4, width: 2.5, area: 10, positionRef: 'l1:a' } as Partial<Damage>),
      },
    });
    expect(s).toContain('>Fläche<');
    expect(s).toContain('>Wand<');
    expect(s).toContain('>Höhe<');
    expect([...s.matchAll(/<f>SUM\(E\d+:E\d+\)<\/f><v>([\d.]+)<\/v>/g)].map((m) => Number(m[1]))).toEqual([6, 10]);
    expect(s).toMatch(/<f>E\d+\+E\d+<\/f><v>16<\/v>/); // Menge der Position
    expect(s).toContain('Gesamtpreis in EUR');
  });
  it('keine Position gewählt: kein Teil mit Preisen', () => {
    const s = ws({ ...data, lvDocs: lv });
    for (const t of ['Gesamtpreis in EUR', 'Einheitspreis', 'Positionspreis', 'Beschichten']) expect(s).not.toContain(t);
  });
});

describe('Aufmaßblatt: Linien verschiedener Linienart nie zusammen', () => {
  const line = (id: string, n: number, length: number, lineType?: string) => dmg(id, n, { kind: 'line', width: null, area: null, length, ...(lineType ? { style: { lineType } } : {}) } as Partial<Damage>);
  const sheetOf = (...ls: Damage[]) =>
    strFromU8(unzipSync(exportAufmassblatt({ ...data, damages: Object.fromEntries(ls.map((d) => [d.id, d])) } as unknown as ProjectState, { kind: 'costCenter', costCenterId: 'c1' }, { no: '009', period: '' }, {}).data)['xl/worksheets/sheet1.xml']);
  const sums = (ws: string) => [...ws.matchAll(/<f>SUM\(C\d+:C\d+\)<\/f><v>([\d.]+)<\/v>/g)].map((m) => Number(m[1]));

  it('gerade und wellige Linien: je eine eigene Tabelle mit eigener Summe', () => {
    const ws = sheetOf(line('a', 1, 4), line('b', 2, 2.5, 'wave'), line('c', 3, 1.5), line('d', 4, 3, 'wave'));
    expect(ws).toContain('>Länge – Durchgezogen<');
    expect(ws).toContain('>Länge – Wellenlinie<');
    expect(ws.indexOf('>Länge – Durchgezogen<')).toBeLessThan(ws.indexOf('>Länge – Wellenlinie<'));
    expect(sums(ws)).toEqual([5.5, 5.5]); // 4 + 1,5 und 2,5 + 3 – nie 11 in einer Summe
  });
  it('nur durchgezogene Linien: eine Tabelle „Länge“ wie bisher', () => {
    const ws = sheetOf(line('a', 1, 4), line('c', 3, 1.5));
    expect(ws).toContain('>Länge<');
    expect(ws).not.toContain('Länge – ');
    expect(sums(ws)).toEqual([5.5]);
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
    expect(ws).toMatch(/<f>SUM\(E(\d+):E(\d+)\)<\/f><v>3<\/v>/); // … mit 1 + 2 m² aus beiden Plänen, ohne TR 1 (6 m²)
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

describe('Preise nur mit Freigabe „Preise und Summen“', () => {
  const pos = { id: 'a', number: '01', shortText: 'Beton', longText: '', unit: 'm²', quantity: 5, unitPrice: 12.5, totalPrice: 62.5, group: '', issues: [] };
  const withLv = {
    ...data,
    lvDocs: { l1: { ...meta, id: 'l1', projectId: 'x', kind: 'lv', name: 'Haupt-LV', number: '', fileName: '', groups: [], positions: [pos] } },
    damages: { d1: dmg('d1', 1, { positionRef: 'l1:a' }) },
  } as unknown as ProjectState;
  const sheet = (prices?: boolean) =>
    strFromU8(unzipSync(exportAufmassblatt(withLv, { kind: 'plan', planId: 'p1' }, { no: '020', period: '' }, prices === undefined ? {} : { prices }).data)['xl/worksheets/sheet1.xml']);
  it('mit Freigabe (Standard): Einheitspreis, Positionspreis und Gesamtpreis', () => {
    const ws = sheet();
    expect(ws).toContain('Einheitspreis');
    expect(ws).toContain('Gesamtpreis in EUR');
    expect(ws).toContain('12.5');
  });
  it('ohne Freigabe: Position und Menge ja, aber keine Preise und keine Zusammenstellung', () => {
    const ws = sheet(false);
    expect(ws).toContain('Beton');
    expect(ws).not.toContain('Einheitspreis');
    expect(ws).not.toContain('Positionspreis');
    expect(ws).not.toContain('Gesamtpreis in EUR');
    expect(ws).not.toContain('12.5');
  });
});
