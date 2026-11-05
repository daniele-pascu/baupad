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
