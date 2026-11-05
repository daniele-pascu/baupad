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
