import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportAufmassblatt } from '../../src/lib/aufmassblatt';
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
  it('Kopfzeile wie Vorlage: Logo links, „Seite von Seiten“ rechts; Seitenlayout, Seitenbreite', () => {
    expect(sheet).toContain('<oddHeader>&amp;L&amp;G&amp;R&amp;P von &amp;N</oddHeader>');
    expect(strFromU8(zip['xl/drawings/vmlDrawingHF1.vml'])).toContain('id="LH"');
    expect(sheet).toContain('view="pageLayout"');
    expect(sheet).toContain('fitToWidth="1" fitToHeight="0"');
    expect(strFromU8(zip['xl/styles.xml'])).toContain('Aptos Narrow');
  });
  it('ohne LV: Kopf mit Nummer, Bauvorhaben, Kostenstelle, Leistungszeitraum; Flächen und Linien mit Plan und Nr.', () => {
    for (const t of ['Aufmaßblatt 007', 'Bauvorhaben X', '91092 – Ebene 1', '01.10.2026', 'Aufmaß', 'Flächen', 'Linien und Längen']) expect(sheet).toContain(`>${t}<`);
    expect(sheet).toContain('<f>C11*D11</f>'); // m² = Länge × Breite als Formel
    expect(sheet).toMatch(/<f>SUM\(C\d+:C\d+\)<\/f>/); // Summe Linien
  });
});
