import { describe, expect, it } from 'vitest';
import { autoBookings, bookingFactor, detectRule, positionRefs, refMismatch, ruleFactor, ruleText, stepStart } from '../../src/lib/pos-rules';
import type { Damage, LvDocument, LvPosition, PosRule } from '../../src/lib/types';

const detect = (shortText: string, longText = '') => detectRule({ shortText, longText });
const dmg = (area: number | null, depthMm: number | null, extra: Partial<Damage> = {}) =>
  ({ id: 'd', kind: 'damage', measureType: 'schadstelle', shape: { type: 'rect' }, area, depth: depthMm === null ? null : depthMm / 1000, count: 1, ...extra }) as unknown as Damage;

describe('Regel aus dem Positionstext erkennen', () => {
  it('Größe je Schadstelle: bis, über … bis, über', () => {
    expect(detect('Schadstelle instand setzen, Einzelfläche bis 0,25 m2')).toMatchObject({ areaTo: 0.25 });
    expect(detect('Schadstelle über 0,25 bis 1,5 m²')).toMatchObject({ areaFrom: 0.25, areaTo: 1.5 });
    expect(detect('Schadstelle über 0,25 m² bis 1,50 m²')).toMatchObject({ areaFrom: 0.25, areaTo: 1.5 });
    expect(detect('Schadstelle größer als 1,5 m²')).toMatchObject({ areaFrom: 1.5 });
  });
  it('Tiefe: bis, über … bis (mm und cm)', () => {
    expect(detect('Betonabtrag Tiefe bis 20 mm')).toMatchObject({ depthTo: 20 });
    expect(detect('Betonabtrag, Tiefe über 20 bis 40 mm')).toMatchObject({ depthFrom: 20, depthTo: 40 });
    expect(detect('Ausbruchtiefe bis 4 cm')).toMatchObject({ depthTo: 40 });
  });
  it('Größe und Tiefe in einer Position', () => {
    expect(detect('Schadstelle bis 0,25 m², Abtragstiefe bis 20 mm')).toEqual({ areaTo: 0.25, depthTo: 20 });
  });
  it('Zulage je weitere 10 mm – mit und ohne Beginn im Text', () => {
    expect(detect('Aufzahlung Schadstelle je weitere 10 mm Tiefe')).toEqual({ stepMm: 10 });
    expect(detect('Mehrtiefe über 40 mm, je weitere 10 mm')).toEqual({ stepMm: 10, stepFrom: 40 });
    expect(detect('Betonabtrag je weiterem cm Tiefe')).toEqual({ stepMm: 10 });
    expect(detect('Schadstelle bis 0,25 m², je angefangene 10 mm über 60 mm')).toEqual({ areaTo: 0.25, stepMm: 10, stepFrom: 60 });
  });
  it('kein Tiefenmaß: Höhe eines Streifens, Durchmesser, Körnung; Positionen ohne Klassen', () => {
    expect(detect('Schadstelle streifenförmig, Höhe bis 30 cm')).toBeNull();
    expect(detect('Schadstelle streifenförmig, Höhe bis 30 cm, Abtragstiefe bis 20 mm')).toBeNull(); // Streifen: noch nicht unterstützt
    expect(detect('Sandstrahlen der Betonoberfläche')).toBeNull();
    expect(detect('Bewehrung ergänzen, Durchmesser bis 12 mm')).toBeNull();
    expect(detect('Egalisierung, Körnung bis 2 mm')).toBeNull();
  });
});

describe('Folgeleistungen und Bewehrung erkennen', () => {
  const d2 = (shortText: string, unit: string) => detectRule({ shortText, longText: '', unit });
  it('Folgeleistung ohne Klasse (m² oder Stk): zählt bei jeder Schadstelle', () => {
    expect(d2('Haftbrücke auf die Schadstelle auftragen', 'm²')).toEqual({ always: true });
    expect(d2('Reprofilierung mit PCC-Mörtel', 'm²')).toEqual({ always: true });
    expect(d2('Korrosionsschutz auftragen', 'Stk')).toEqual({ always: true });
  });
  it('mit Klasse bleibt es die Klasse', () => {
    expect(d2('Reprofilierung mit PCC-Mörtel, Schichtdicke über 20 bis 40 mm', 'm²')).toEqual({ depthFrom: 20, depthTo: 40 });
  });
  it('Bewehrung nach Länge: zählt die lfm der Schadstelle', () => {
    expect(d2('Bewehrung entrosten und beschichten', 'm')).toEqual({ rebar: true });
    expect(d2('Bewehrung entrosten und beschichten', 'kg')).toBeNull();
  });
  it('flächige Arbeiten ohne Bezug zur Schadstelle bleiben außen vor', () => {
    for (const t of ['Sandstrahlen der Betonoberfläche', 'Egalisierung', 'Betonretusche', 'Schutz der Betonstützen nach der Sanierung']) expect(d2(t, 'm²')).toBeNull();
    expect(d2('Risse verpressen mit Injektionsharz', 'm')).toBeNull();
  });
  it('Anwendung: Folgeleistung immer, Bewehrung nur mit eingetragener Länge', () => {
    expect(ruleFactor({ always: true }, dmg(0.2, null))).toBe(1);
    expect(ruleFactor({ rebar: true }, dmg(0.2, 30))).toBe(0);
    expect(ruleFactor({ rebar: true }, dmg(0.2, 30, { rebar: 1.2 }))).toBe(1);
    expect(ruleText({ always: true })).toBe('jede Schadstelle');
    expect(ruleText({ rebar: true })).toBe('Bewehrung der Schadstelle (lfm)');
  });
});

describe('Regel anwenden', () => {
  it('Größe je Schadstelle: untere Grenze ausgeschlossen, obere eingeschlossen', () => {
    const small: PosRule = { areaTo: 0.25 };
    const mid: PosRule = { areaFrom: 0.25, areaTo: 1.5 };
    expect([ruleFactor(small, dmg(0.25, 10)), ruleFactor(mid, dmg(0.25, 10))]).toEqual([1, 0]);
    expect([ruleFactor(small, dmg(0.26, 10)), ruleFactor(mid, dmg(0.26, 10))]).toEqual([0, 1]);
    // 3 Stellen zu je 0,2 m² (Anzahl 3): Größe je einzelner Schadstelle
    expect(ruleFactor(small, dmg(0.6, 10, { count: 3 }))).toBe(1);
    expect(ruleFactor(small, dmg(null, 10))).toBe(0);
  });
  it('Tiefe: 1 mm über der Grenze ist schon die nächste Klasse', () => {
    const a: PosRule = { depthTo: 20 };
    const b: PosRule = { depthFrom: 20, depthTo: 40 };
    expect([ruleFactor(a, dmg(1, 20)), ruleFactor(b, dmg(1, 20))]).toEqual([1, 0]);
    expect([ruleFactor(a, dmg(1, 21)), ruleFactor(b, dmg(1, 21))]).toEqual([0, 1]);
    expect(ruleFactor(a, dmg(1, null))).toBe(0); // ohne Tiefe keine Tiefenklasse
  });
  it('Zulage: jede angefangene Stufe zählt, Beginn laut Position oder größte Tiefenklasse', () => {
    const z: PosRule = { stepMm: 10 };
    expect(ruleFactor(z, dmg(1, 60), 60)).toBe(0);
    expect(ruleFactor(z, dmg(1, 61), 60)).toBe(1);
    expect(ruleFactor(z, dmg(1, 70), 60)).toBe(1);
    expect(ruleFactor(z, dmg(1, 71), 60)).toBe(2);
    expect(ruleFactor(z, dmg(1, 85), 60)).toBe(3);
    expect(ruleFactor({ stepMm: 10, stepFrom: 40 }, dmg(1, 85), 60)).toBe(5); // Beginn laut Position geht vor
    expect(ruleFactor(z, dmg(1, 85), null)).toBe(0); // kein Beginn bekannt
  });
  it('Text der Regel', () => {
    expect(ruleText({ areaFrom: 0.25, areaTo: 1.5, depthTo: 40 })).toBe('Größe über 0,25 bis 1,5 m² · Tiefe bis 40 mm');
    expect(ruleText({ stepMm: 10 }, 60)).toBe('je weitere 10 mm ab 60 mm');
  });
});

describe('automatische Zuordnung im Projekt', () => {
  const pos = (id: string, rule: PosRule | null | undefined, group = 'G1'): LvPosition =>
    ({ id, number: id, shortText: id, longText: '', unit: 'm²', quantity: null, unitPrice: null, totalPrice: null, group, issues: [], rule }) as LvPosition;
  const doc = {
    id: 'lv',
    deletedAt: null,
    positions: [
      pos('klein20', { areaTo: 0.25, depthTo: 20, confirmed: true }),
      pos('klein40', { areaTo: 0.25, depthFrom: 20, depthTo: 40, confirmed: true }),
      pos('gross40', { areaFrom: 0.25, areaTo: 1.5, depthFrom: 20, depthTo: 40, confirmed: true }),
      pos('zulage', { stepMm: 10, confirmed: true }),
      pos('offen', { depthTo: 40 }), // nicht bestätigt → zählt nicht
      pos('sand', null),
    ],
  } as unknown as LvDocument;
  const data = { lvDocs: { lv: doc } };
  it('Beginn der Zulage = größte bestätigte Tiefenklasse', () => {
    expect(stepStart(doc, doc.positions[3])).toBe(40);
  });
  it('Schadstelle zählt bei der passenden Klasse und – wenn tiefer – zusätzlich in der Zulage', () => {
    expect(autoBookings(data, dmg(0.2, 15))).toEqual([{ ref: 'lv:klein20', factor: 1 }]);
    expect(autoBookings(data, dmg(0.6, 35))).toEqual([{ ref: 'lv:gross40', factor: 1 }]);
    // 0,2 m², 61 mm tief: Grundposition ist die größte Tiefenklasse (bis 40 mm), dazu die Zulage mit
    // 3 Stufen ab 40 mm (41–50, 51–60, 61–70)
    expect(autoBookings(data, dmg(0.2, 61))).toEqual([
      { ref: 'lv:klein40', factor: 1 },
      { ref: 'lv:zulage', factor: 3 },
    ]);
    // die kleinere Tiefenklasse bleibt geschlossen
    expect(autoBookings(data, dmg(0.2, 21)).map((b) => b.ref)).toEqual(['lv:klein40']);
  });
  it('von Hand zugeordnet: zählt nur, wenn die Regel der Position passt', () => {
    // 39,20 m² von Hand bei „bis 0,25 m²“ → passt nicht, zählt dort nicht
    const big = dmg(39.2, 30, { positionRef: 'lv:klein40' });
    expect(refMismatch(data, big, 'lv:klein40')).toBe('Größe bis 0,25 m² · Tiefe über 20 bis 40 mm');
    expect(bookingFactor(data, big, 'lv:klein40')).toBe(0);
    expect(positionRefs(data, big)).toEqual([]); // keine Klasse für diese Größe im Test-LV
    // passende Zuordnung von Hand bleibt Hauptposition
    const ok = dmg(0.2, 30, { positionRef: 'lv:klein40' });
    expect(refMismatch(data, ok, 'lv:klein40')).toBeNull();
    expect(positionRefs(data, ok)).toEqual(['lv:klein40']);
    // Position ohne Regel: Zuordnung von Hand gilt immer
    const sand = dmg(39.2, 30, { positionRef: 'lv:sand' });
    expect(bookingFactor(data, sand, 'lv:sand')).toBe(1);
    expect(positionRefs(data, sand)).toEqual(['lv:sand']);
    // andere Messarten sind von den Regeln nicht betroffen
    expect(bookingFactor(data, dmg(39.2, 30, { positionRef: 'lv:klein40', measureType: 'flaeche', kind: 'area' }), 'lv:klein40')).toBe(1);
  });
  it('nur Schadstellen; abgewählte Positionen zählen nicht', () => {
    expect(autoBookings(data, dmg(0.2, 15, { measureType: 'flaeche', kind: 'area' }))).toEqual([]);
    expect(autoBookings(data, dmg(0.2, 15, { autoOff: ['lv:klein20'] }))).toEqual([]);
  });
});
