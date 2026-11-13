import { describe, expect, it } from 'vitest';
import { materialDuplicates, matchesMaterial, normUnit, parsePrice, supplierDuplicates } from '../../src/lib/materials';
import type { Material, Supplier } from '../../src/lib/types';

const mat = (id: string, name: string, unit: string, extra: Partial<Material> = {}): Material => ({ id, name, unit, createdAt: 0, updatedAt: 0, ...extra });

describe('Materialverwaltung: doppelte Einträge', () => {
  const all = [mat('a', 'Zementestrich CT-C25', 'm²', { articleNo: 'Z-100', supplierId: 's1' }), mat('b', 'Kabelbinder 300 mm', 'Stk')];

  it('gleicher Name mit gleicher Einheit – Schreibweise, Umlaute und Einheitsform egal', () => {
    expect(materialDuplicates({ name: 'zementestrich ct c25', unit: 'm2' }, all).map((d) => [d.material.id, d.reason])).toEqual([['a', 'name']]);
    expect(materialDuplicates({ name: 'Kabelbinder 300mm', unit: 'Stück' }, all).map((d) => d.material.id)).toEqual(['b']);
    // andere Einheit = anderes Material (z. B. Sack statt m²)
    expect(materialDuplicates({ name: 'Zementestrich CT-C25', unit: 'Sack' }, all)).toEqual([]);
  });

  it('gleiche Artikelnummer beim selben Lieferanten; das Material selbst zählt nicht', () => {
    expect(materialDuplicates({ name: 'Estrich', unit: 'Sack', articleNo: 'z 100', supplierId: 's1' }, all).map((d) => d.reason)).toEqual(['articleNo']);
    expect(materialDuplicates({ name: 'Estrich', unit: 'Sack', articleNo: 'Z-100', supplierId: 's2' }, all)).toEqual([]);
    expect(materialDuplicates({ ...all[0] }, all)).toEqual([]);
  });

  it('Lieferanten: gleicher Name auch mit anderer Rechtsform-Schreibweise', () => {
    const sup: Supplier[] = [{ id: 's1', name: 'Baustoff Muster GmbH', createdAt: 0, updatedAt: 0 }];
    expect(supplierDuplicates({ name: 'baustoff muster' }, sup).map((s) => s.id)).toEqual(['s1']);
    expect(supplierDuplicates({ name: 'Baustoff Muster Ges.m.b.H.' }, sup)).toHaveLength(1);
    expect(supplierDuplicates({ name: 'Holz Huber' }, sup)).toEqual([]);
  });
});

describe('Materialverwaltung: Eingaben', () => {
  it('Preis mit Komma, Punkt, €-Zeichen; leer = unbekannt; Unsinn = ungültig', () => {
    expect(parsePrice('12,5')).toBe(12.5);
    expect(parsePrice('1.234,56 €')).toBe(1234.56);
    expect(parsePrice('7.90')).toBe(7.9);
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('abc')).toBeUndefined();
    expect(parsePrice('-3')).toBeUndefined();
  });
  it('Einheiten und Suche', () => {
    expect(normUnit('m²')).toBe(normUnit('qm'));
    expect(normUnit('Stück')).toBe('stk');
    expect(matchesMaterial(mat('a', 'Zementestrich', 'm²', { articleNo: 'Z-100' }), 'z100')).toBe(true);
    expect(matchesMaterial(mat('a', 'Zementestrich', 'm²'), 'muster', 'Baustoff Muster')).toBe(true);
    expect(matchesMaterial(mat('a', 'Zementestrich', 'm²'), 'holz')).toBe(false);
  });
});

import { listSummary, overdue, parseQty, pendingDuplicate, setStatus, withHistory } from '../../src/lib/materials';
import type { MaterialItem } from '../../src/lib/types';

const item = (id: string, extra: Partial<MaterialItem> = {}): MaterialItem => ({ id, projectId: 'p1', name: 'Estrich', unit: 'm²', qty: 10, price: 2, status: 'offen', history: [], createdAt: 0, updatedAt: 0, ...extra });

describe('Materialliste je Baustelle', () => {
  it('gleiches Material noch nicht geliefert = Dublette (nach Stamm-Kennung bzw. Name + Einheit)', () => {
    const list = [item('a', { materialId: 'm1' }), item('b', { name: 'Kies', unit: 't', status: 'geliefert' })];
    expect(pendingDuplicate(list, { materialId: 'm1', name: 'x', unit: 'x' })?.id).toBe('a');
    expect(pendingDuplicate(list, { materialId: null, name: 'kies', unit: 't' })).toBeNull(); // schon geliefert → neue Bestellung ok
    expect(pendingDuplicate(list, { materialId: null, name: 'ESTRICH', unit: 'm2' })?.id).toBe('a');
  });
  it('Status mit Verlauf, Summen, überfällig, Menge', () => {
    const x = setStatus(item('a'), 'bestellt', 'Max', 1000);
    expect(x.status).toBe('bestellt');
    expect(x.history).toEqual([{ at: 1000, by: 'Max', text: 'Bestellt' }]);
    expect(setStatus(x, 'bestellt', 'Max')).toBe(x); // unverändert, kein Eintrag
    expect(withHistory(item('a'), 'A', 't').history).toHaveLength(1);
    expect(listSummary([item('a'), item('b', { status: 'geliefert', price: null })])).toEqual({ count: { offen: 1, bestellt: 0, geliefert: 1 }, value: 20, total: 2 });
    expect(overdue(item('a', { deliveryDate: '2026-11-01' }), '2026-11-05')).toBe(true);
    expect(overdue(item('a', { deliveryDate: '2026-11-01', status: 'geliefert' }), '2026-11-05')).toBe(false);
    expect(parseQty('2,5')).toBe(2.5);
    expect(parseQty('0')).toBeUndefined();
  });
});

import { canOrder, equipmentAt, equipmentInStock, equipmentOut, isEquipment, markOrdered, nextOrderNo, openBySupplier, orderText, ordersInTransit, overviewCounts, placeEquipment } from '../../src/lib/materials';
import type { Material as Mat, MaterialItem as Item } from '../../src/lib/types';

describe('Übersicht, Bestellungen, Geräte', () => {
  const item = (o: Partial<Item>): Item => ({ id: o.id ?? 'i', projectId: 'p1', name: 'Mörtel', unit: 'Sack', qty: 10, status: 'offen', history: [], createdAt: 1, updatedAt: 1, ...o });
  const dev = (o: Partial<Mat>): Mat => ({ id: 'g', name: 'Fräse', unit: 'Stk', kind: 'geraet', createdAt: 1, updatedAt: 1, ...o });

  it('bestellen dürfen Admin, Büro und Polier, Arbeiter nicht', () => {
    expect(canOrder({ companyId: 'c', role: 'admin' })).toBe(true);
    expect(canOrder({ companyId: 'c', role: 'buero' })).toBe(true);
    expect(canOrder({ companyId: 'c', role: 'polier' })).toBe(true);
    expect(canOrder({ companyId: 'c', role: 'arbeiter' })).toBe(false);
    expect(canOrder(null)).toBe(true); // ohne Firma (Einzelgerät) keine Einschränkung
  });

  it('Bestellnummer zählt je Jahr hoch', () => {
    expect(nextOrderNo([], 2026)).toBe('B-2026-001');
    expect(nextOrderNo([{ orderNo: 'B-2026-007' }, { orderNo: 'B-2025-040' }, {}], 2026)).toBe('B-2026-008');
  });

  it('offener Bedarf je Lieferant, ohne Lieferant zuletzt; nur offene Positionen', () => {
    const g = openBySupplier(
      [item({ id: 'a', supplierId: 's2' }), item({ id: 'b', supplierId: null }), item({ id: 'c', supplierId: 's1', deliveryDate: '2026-11-20' }), item({ id: 'd', supplierId: 's1', deliveryDate: '2026-11-18' }), item({ id: 'e', supplierId: 's1', status: 'bestellt' })],
      (id) => ({ s1: 'Alpha', s2: 'Beta' })[id] ?? '',
    );
    expect(g.map((x) => x.supplierId)).toEqual(['s1', 's2', '']);
    expect(g[0].items.map((x) => x.id)).toEqual(['d', 'c']);
  });

  it('als bestellt markieren: Nummer, Zeit, Verlauf; unterwegs je Bestellnummer mit frühestem Termin', () => {
    const done = markOrdered([item({ id: 'a', deliveryDate: '2026-11-20' }), item({ id: 'b', deliveryDate: '2026-11-18' })], 'B-2026-001', 'Max', 5);
    expect(done.every((x) => x.status === 'bestellt' && x.orderNo === 'B-2026-001' && x.orderedAt === 5)).toBe(true);
    expect(done[0].history.at(-1)).toEqual({ at: 5, by: 'Max', text: 'Bestellt (B-2026-001)' });
    const t = ordersInTransit([...done, item({ id: 'c', status: 'bestellt', supplierId: 's9' }), item({ id: 'd', status: 'geliefert', orderNo: 'B-2026-001' })]);
    expect(t.map((x) => [x.orderNo, x.items.length, x.due])).toEqual([
      ['B-2026-001', 2, '2026-11-18'],
      ['', 1, ''],
    ]);
  });

  it('Bestelltext: je Baustelle mit Lieferadresse, Artikelnummer und Termin', () => {
    const text = orderText({
      orderNo: 'B-2026-003',
      company: 'Testfirma',
      by: 'Max Polier',
      items: [item({ materialId: 'm1', deliveryDate: '2026-11-18' }), item({ id: 'x', projectId: 'p2', name: 'Schalöl', unit: 'l', qty: 20.5, note: 'früh' })],
      articleNo: (id) => (id === 'm1' ? 'R4-25' : ''),
      site: (id) => (id === 'p1' ? { name: 'Tiefgarage Nord', address: 'Hauptstraße 1, 4020 Linz' } : { name: 'Halle Süd', address: '' }),
    });
    expect(text).toContain('Bestellung B-2026-003 – Testfirma');
    expect(text).toContain('Baustelle: Tiefgarage Nord\nLieferadresse: Hauptstraße 1, 4020 Linz\n- 10 Sack Mörtel (Art.-Nr. R4-25) – Liefertermin 18.11.2026');
    expect(text).toContain('Baustelle: Halle Süd\n- 20,5 l Schalöl – früh');
    expect(text.trim().endsWith('Max Polier')).toBe(true);
  });

  it('Geräte: Stück je Baustelle, Rest im Lager, Verlauf, Kennzahlen', () => {
    expect(isEquipment(dev({}))).toBe(true);
    expect(isEquipment({})).toBe(false);
    let m = dev({ total: 5 });
    expect([equipmentOut(m), equipmentInStock(m)]).toEqual([0, 5]);
    m = placeEquipment(m, 'p1', 2, 'Tiefgarage Nord', 'Büro', 7);
    m = placeEquipment(m, 'p2', 1, 'Halle Süd', 'Büro', 8);
    expect([equipmentAt(m, 'p1'), equipmentAt(m, 'p2'), equipmentOut(m), equipmentInStock(m)]).toEqual([2, 1, 3, 2]);
    expect(m.log).toEqual([
      { at: 7, by: 'Büro', text: 'Tiefgarage Nord: 0 → 2 Stk' },
      { at: 8, by: 'Büro', text: 'Halle Süd: 0 → 1 Stk' },
    ]);
    expect(placeEquipment(m, 'p1', 2, 'Tiefgarage Nord', 'Büro')).toBe(m); // nichts geändert
    m = placeEquipment(m, 'p1', 0, 'Tiefgarage Nord', 'Polier', 9); // alle zurück
    expect(m.places).toEqual([{ siteId: 'p2', qty: 1 }]);
    expect(equipmentInStock({ total: 1, places: [{ siteId: 'p1', qty: 3 }] })).toBe(0); // nie negativ
    const c = overviewCounts([item({}), item({ status: 'bestellt', deliveryDate: '2026-11-01' }), item({ status: 'geliefert' })], [m, dev({ total: 2, places: [{ siteId: 'p1', qty: 2 }] })], '2026-11-13');
    expect(c).toEqual({ open: 1, ordered: 1, late: 1, out: 3 });
  });
});
