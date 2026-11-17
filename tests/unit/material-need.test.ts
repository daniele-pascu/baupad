import { describe, expect, it } from 'vitest';
import { aufmassSources } from '../../src/lib/material-sources';
import { averageUse, chooseRate, guideRate, materialKey, needCalc, packText, palletText, planId, planTotal, roundUpQty, siteCalc, siteStock, toUnit } from '../../src/lib/materials';
import type { ProjectState } from '../../src/lib/store';
import type { Damage, LvDocument, Material, MaterialItem, MaterialPlan, MaterialUse, Plan, Project } from '../../src/lib/types';

const item = (status: MaterialItem['status'], qty: number, extra: Partial<MaterialItem> = {}): MaterialItem => ({
  id: `${status}-${qty}-${Math.random()}`,
  projectId: 'p1',
  materialId: 'm1',
  name: 'Reparaturmörtel R4',
  unit: 'Sack',
  qty,
  status,
  history: [],
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
const use = (qty: number, done: number | null, extra: Partial<MaterialUse> = {}): MaterialUse => ({
  id: `u-${qty}-${done}-${Math.random()}`,
  projectId: 'p1',
  materialId: 'm1',
  name: 'Reparaturmörtel R4',
  unit: 'Sack',
  date: '2026-11-17',
  qty,
  done,
  doneUnit: 'm²',
  by: 'Test',
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});
const mortar: Material = { id: 'm1', name: 'Reparaturmörtel R4', unit: 'Sack', packSize: 25, packUnit: 'kg', perPallet: 40, usageRate: 8, usageUnit: 'kg', usageBasis: 'm²', createdAt: 0, updatedAt: 0 };
const plan = (extra: Partial<MaterialPlan> = {}): MaterialPlan => ({ id: 'p1:m1', projectId: 'p1', materialId: 'm1', name: 'Reparaturmörtel R4', unit: 'Sack', basis: 'm²', total: 500, rateMode: 'auto', createdAt: 0, updatedAt: 0, ...extra });

describe('Material: Bestand je Baustelle', () => {
  it('bestellt, geliefert, verbraucht und vorhanden je Material', () => {
    const items = [item('offen', 10), item('bestellt', 40), item('geliefert', 80), item('geliefert', 20), item('geliefert', 5, { materialId: null, name: 'Grundierung', unit: 'Eimer' })];
    const uses = [use(30, 100), use(22, null)];
    const [g, r] = siteStock(items, uses);
    expect(g).toMatchObject({ name: 'Grundierung', delivered: 5, used: 0, onSite: 5 });
    expect(r).toMatchObject({ key: 'm1', open: 10, ordered: 40, delivered: 100, used: 52, onSite: 48 });
  });

  it('mehr verbraucht als geliefert: vorhanden bleibt 0; Bedarfsrechnung allein erscheint auch', () => {
    const [s] = siteStock([item('geliefert', 10)], [use(12, null)]);
    expect(s.onSite).toBe(0);
    expect(siteStock([], [], [plan()])).toHaveLength(1);
  });

  it('frei eingegebenes Material: Schlüssel aus Bezeichnung und Einheit, Kennung der Rechnung ≤ 80 Zeichen', () => {
    const a = materialKey({ name: 'Grundierung Primer X', unit: 'Eimer' });
    expect(a).toBe(materialKey({ name: 'grundierung primer-x', unit: 'eimer' }));
    expect(planId('0f1e2d3c-4b5a-4987-8a7b-6c5d4e3f2a1b', { name: 'Ein sehr langer Materialname mit vielen Wörtern', unit: 'Karton' }).length).toBeLessThanOrEqual(80);
  });
});

describe('Material: Durchschnitt und Richtwert', () => {
  it('Durchschnitt nur aus Einträgen mit „dabei geschafft“ in der Bezugsgröße', () => {
    const a = averageUse([use(30, 100), use(10, 50), use(99, null), use(5, 10, { doneUnit: 'm' })], 'm2');
    expect(a).toMatchObject({ qty: 40, done: 150, n: 2 });
    expect(a!.rate).toBeCloseTo(0.2667, 4);
    expect(averageUse([use(5, null)], 'm²')).toBeNull();
  });

  it('Richtwert in kg je m² wird über das Gebinde in Sack je m² umgerechnet', () => {
    expect(guideRate(mortar, 'm²')).toBeCloseTo(0.32);
    expect(guideRate(mortar, 'm')).toBeNull();
    expect(toUnit(50, 'kg', mortar)).toBe(2);
    expect(toUnit(3, 'Sack', mortar)).toBe(3);
    expect(toUnit(3, 'l', mortar)).toBeNull();
  });

  it('automatisch: Baustelle vor allen Baustellen vor Richtwert; eigener Wert, wenn gewählt', () => {
    const site = { rate: 0.3, qty: 30, done: 100, n: 1 };
    const company = { rate: 0.28, qty: 56, done: 200, n: 3 };
    expect(chooseRate({ mode: 'auto', own: null, site, company, guide: 0.32 })).toEqual({ rate: 0.3, source: 'site' });
    expect(chooseRate({ mode: 'auto', own: null, site: null, company, guide: 0.32 })).toEqual({ rate: 0.28, source: 'company' });
    expect(chooseRate({ mode: 'auto', own: null, site: null, company: null, guide: 0.32 })).toEqual({ rate: 0.32, source: 'guide' });
    expect(chooseRate({ mode: 'auto', own: 1, site: null, company: null, guide: null })).toBeNull();
    expect(chooseRate({ mode: 'own', own: 0.5, site, company, guide: 0.32 })).toEqual({ rate: 0.5, source: 'own' });
  });
});

describe('Material: Bedarf und Nachbestellen', () => {
  const stock = { used: 52, onSite: 48, ordered: 40, open: 0, unit: 'Sack' };

  it('Bedarf − verbraucht − vorhanden − unterwegs = fehlt, auf ganze Säcke aufgerundet', () => {
    // 500 m² × 0,32 = 160 Sack; noch nötig 108; gedeckt 88; fehlt 20
    expect(needCalc(500, 0.32, stock)).toEqual({ need: 160, remaining: 108, covered: 88, missing: 20, reorder: 20, surplus: 0 });
    expect(needCalc(500, 0.3205, stock).reorder).toBe(21); // 20,25 → 21 Sack
    expect(needCalc(300, 0.3, stock)).toMatchObject({ reorder: 0, missing: 0, surplus: 50 });
  });

  it('auf ganze Paletten aufrunden; Paletten- und Inhaltstext', () => {
    expect(needCalc(500, 0.32, stock, { perPallet: 40, pallets: true }).reorder).toBe(40);
    expect(needCalc(500, 0.32, stock, { perPallet: 40, pallets: false }).reorder).toBe(20);
    expect(palletText(48, 40, 'Sack')).toBe('1 Palette + 8 Sack');
    expect(palletText(80, 40, 'Sack')).toBe('2 Paletten');
    expect(palletText(20, 40, 'Sack')).toBe('');
    expect(packText(28, mortar)).toBe('700 kg');
  });

  it('Maßeinheiten auf 0,1 aufrunden, Stückeinheiten ganz', () => {
    expect(roundUpQty(2.31, 'm³')).toBe(2.4);
    expect(roundUpQty(2.31, 'Eimer')).toBe(3);
    expect(roundUpQty(3, 'Stk')).toBe(3);
    expect(roundUpQty(-1, 'kg')).toBe(0);
  });

  it('Gesamtmenge aus Aufmaß/LV wird nachgeführt; fehlt sie, gilt die eingetippte', () => {
    const sources = [{ id: 'aufmass:m²', label: 'Aufmaß: Fläche', value: 520, unit: 'm²' }];
    expect(planTotal(plan({ source: 'aufmass:m²' }), sources)).toEqual({ total: 520, from: 'Aufmaß: Fläche' });
    expect(planTotal(plan({ source: 'aufmass:m²', basis: 'm' }), sources)).toEqual({ total: 500, from: null });
    expect(planTotal(plan({ source: 'lv:x' }), sources)).toEqual({ total: 500, from: null });
  });

  it('siteCalc: Durchschnitt dieser Baustelle aus dem Verbrauch, dann Nachbestellung', () => {
    const [s] = siteStock([item('geliefert', 100), item('bestellt', 40)], [use(30, 100)], [plan()]);
    const other = use(60, 100, { projectId: 'p2' });
    const c = siteCalc({ projectId: 'p1', stock: s, plan: plan(), material: mortar, uses: [use(30, 100), other], sources: [] });
    expect(c.rate).toEqual({ rate: 0.3, source: 'site' });
    // 500 × 0,3 = 150; noch nötig 120; gedeckt 70 + 40 = 110; fehlt 10
    expect(c.result).toMatchObject({ need: 150, remaining: 120, covered: 110, reorder: 10 });
    // ohne eigene Einträge: Durchschnitt aller Baustellen (nur die andere Baustelle: 0,6)
    const [s2] = siteStock([item('geliefert', 100)], [], [plan()]);
    expect(siteCalc({ projectId: 'p1', stock: s2, plan: plan(), material: mortar, uses: [other], sources: [] }).rate).toEqual({ rate: 0.6, source: 'company' });
    // eigener Wert in kg je m² → Sack je m²
    expect(siteCalc({ projectId: 'p1', stock: s2, plan: plan({ rateMode: 'own', rate: 10, rateUnit: 'kg' }), material: mortar, uses: [], sources: [] }).rate).toEqual({ rate: 0.4, source: 'own' });
  });
});

describe('Material: Mengen aus dem Aufmaß', () => {
  const meta = { rev: 1, deviceId: 'd', deletedAt: null, createdAt: 0, updatedAt: 0 };
  const dmg = (id: string, extra: Partial<Damage>): Damage =>
    ({ ...meta, id, projectId: 'p1', planId: 'pl1', number: 1, shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1, rotation: 0 }, color: '#f00', labelOffset: null, length: 1, width: 1, depth: null, area: 1, ...extra }) as Damage;
  const state = (damages: Damage[], lvDocs: LvDocument[] = []): ProjectState => ({
    project: { ...meta, id: 'p1', name: 'P', site: '', address: '', client: '', editor: '', date: '', notes: '' } as Project,
    costCenters: {},
    files: {},
    plans: { pl1: { ...meta, id: 'pl1', projectId: 'p1' } as unknown as Plan },
    damages: Object.fromEntries(damages.map((d) => [d.id, d])),
    components: {},
    elements: {},
    lvDocs: Object.fromEntries(lvDocs.map((d) => [d.id, d])),
  });

  it('Summen je Messart und gesamt je Einheit; gelöschte Messungen zählen nicht', () => {
    const s = aufmassSources(
      state([
        dmg('a', { measureType: 'flaeche', kind: 'area', area: 120 }),
        dmg('b', { measureType: 'wand', kind: 'area', area: 80 }),
        dmg('c', { measureType: 'laenge', kind: 'line', length: 35, width: null, area: null }),
        dmg('d', { measureType: 'flaeche', kind: 'area', area: 999, deletedAt: 5 }),
      ]),
    );
    expect(s.find((x) => x.id === 'aufmass:m²')).toMatchObject({ label: 'Aufmaß: alle Messungen', value: 200, unit: 'm²' });
    expect(s.find((x) => x.id === 'typ:wand|m²')).toMatchObject({ label: 'Aufmaß: Wand', value: 80 });
    expect(s.find((x) => x.id === 'aufmass:m')).toMatchObject({ label: 'Aufmaß: Länge', value: 35 });
  });

  it('LV-Position: Menge laut LV und gemessen', () => {
    const lv: LvDocument = {
      ...meta,
      id: 'lv1',
      projectId: 'p1',
      kind: 'lv',
      name: 'LV',
      number: '',
      fileName: '',
      groups: [],
      positions: [{ id: 'pos1', number: '01.02', shortText: 'Betonersatz', longText: '', unit: 'm2', quantity: 150, unitPrice: null, totalPrice: null, group: '', issues: [], rule: null }],
    };
    const s = aufmassSources(state([dmg('a', { measureType: 'flaeche', kind: 'area', area: 42, positionRef: 'lv1:pos1' })], [lv]));
    expect(s.find((x) => x.id === 'lv:lv1:pos1')).toMatchObject({ label: 'Pos. 01.02 Betonersatz – laut LV', value: 150, unit: 'm²' });
    expect(s.find((x) => x.id === 'lvm:lv1:pos1')).toMatchObject({ label: 'Pos. 01.02 Betonersatz – gemessen', value: 42, unit: 'm²' });
  });
});
