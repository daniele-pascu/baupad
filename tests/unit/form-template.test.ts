import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeForm, labelKey, type FormPage } from '../../src/lib/form-template';

const load = (name: string): FormPage => JSON.parse(new TextDecoder().decode(readFileSync(`tests/fixtures/forms/${name}.json`))) as FormPage;

describe('Firmenformulare erkennen', () => {
  it('Beschriftungen werden Werten zugeordnet', () => {
    expect(labelKey('Bauvorhaben:')).toBe('project');
    expect(labelKey('Kst.')).toBe('costCenter');
    expect(labelKey('Personalstand: Bauleiter:')).toBe('staff.bauleiter');
    expect(labelKey('Auftraggeber / Kontrolle')).toBeNull();
    expect(labelKey('MST Muhr Sanierungstechnik Ges.m.b.H.')).toBeNull();
    expect(labelKey('office@mst-muhr.at')).toBeNull();
    expect(labelKey('Nr. _______')).toBe('no');
    expect(labelKey('am')).toBe('date');
  });

  it('MST Bau-Tagesbericht: Felder mit Schreiblinien, mehrzeilige Bereiche, Datum ohne Jahr', () => {
    const l = analyzeForm(load('mst-tagesbericht'), 'tag');
    const by = Object.fromEntries(l.fields.map((f) => [f.key, f]));
    expect(Object.keys(by).sort()).toEqual(['acceptanceBy', 'acceptanceTime', 'costCenter', 'date', 'from', 'incidents', 'no', 'notes', 'project', 'staff.bauleiter', 'staff.facharbeiter', 'staff.vorarbeiter', 'to', 'work']);
    // Nummer rechts neben „Bau-Tagesbericht Nr.“, Datum zwischen „am“ und „2026“
    expect(by.no.box.x).toBeGreaterThan(182);
    expect(by.no.box.x).toBeLessThan(205);
    expect(by.date.dateFormat).toBe('dd.MM.');
    expect(by.date.box.x).toBeGreaterThan(425);
    expect(by.date.box.x + by.date.box.w).toBeLessThan(540);
    // Bauvorhaben: Linie von 106 bis 466 bei y ≈ 181
    expect(Math.round(by.project.box.x)).toBe(109);
    expect(Math.round(by.project.box.x + by.project.box.w)).toBe(465);
    expect(by.project.box.y + by.project.box.h).toBeLessThan(183);
    // Leistungsbeschreibung: erste Zeile neben der Beschriftung, 9 weitere Zeilen bis „Besondere Vorkommnisse“
    expect(by.work.lines?.length).toBe(9);
    expect(by.incidents.lines?.length).toBe(1);
    expect(by.notes.lines?.length).toBe(2);
    expect(by['staff.facharbeiter'].box.x).toBeGreaterThan(464);
    expect(by.acceptanceTime.box.x).toBeGreaterThan(121);
    expect(by.acceptanceTime.box.x + by.acceptanceTime.box.w).toBeLessThan(220);
    expect(by.acceptanceBy.box.x).toBeGreaterThan(257);
    expect(l.table).toBeNull();
  });

  it('MST Regieliste: Kopffelder in Zellen, Wochentabelle mit 7 × 4 Spalten und 10 Zeilen, Material und Kosten', () => {
    const l = analyzeForm(load('mst-regieliste'), 'regie');
    const by = Object.fromEntries(l.fields.map((f) => [f.key, f]));
    expect(Object.keys(by).sort()).toEqual(['client', 'date', 'lodgingCosts', 'materials', 'miscCosts', 'no', 'number', 'project', 'subject', 'travelCosts', 'week']);
    // Bauvorhaben-Zelle: Wert unter der Beschriftung, Zelle endet vor „Auftrags-Nr.“ (x ≈ 437)
    expect(by.project.box.y).toBeGreaterThan(135);
    expect(by.project.box.x + by.project.box.w).toBeLessThan(440);
    expect(by.project.box.x + by.project.box.w).toBeGreaterThan(400);
    expect(by.client.box.y).toBeGreaterThan(89);
    expect(by.materials.lines?.length).toBeGreaterThanOrEqual(3);
    expect(by.materials.box.x + by.materials.box.w).toBeLessThan(390);
    const t = l.table!;
    expect(t.weekly).toBe(true);
    expect(t.rows).toBe(10);
    expect(Math.round(t.rowHeight)).toBe(20);
    expect(Math.round(t.top)).toBe(240);
    expect(t.cols.find((c) => c.key === 'name')?.x).toBeLessThan(30);
    const keys = t.cols.map((c) => c.key);
    expect(keys.filter((k) => k.startsWith('day:')).length).toBe(28);
    expect(keys).toContain('day:0:hours');
    expect(keys).toContain('day:2:ot50');
    expect(keys).toContain('day:6:travel');
    const mi = t.cols.find((c) => c.key === 'day:2:hours')!;
    expect(mi.x).toBeGreaterThan(380);
    expect(mi.x).toBeLessThan(400);
  });
});
