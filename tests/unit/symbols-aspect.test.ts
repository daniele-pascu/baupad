import { describe, expect, it } from 'vitest';
import { SYMBOLS, symbolAnchor } from '../../src/lib/symbols';

describe('Bauteile: Türen proportional, Durchbrüche frei', () => {
  it('jede Tür behält beim Vergrößern das Seitenverhältnis', () => {
    for (const d of SYMBOLS.filter((s) => s.group === 'door')) expect(symbolAnchor({ id: d.id }), d.id).not.toBeNull();
  });
  it('Durchbrüche (Schächte, Öffnungen, Aussparungen) lassen sich frei in die Länge ziehen', () => {
    for (const d of SYMBOLS.filter((s) => s.group === 'shaft')) expect(symbolAnchor({ id: d.id }), d.id).toBeNull();
  });
});

import { windowLabels } from '../../src/lib/drawing';
describe('Fenster nach ÖNORM: Breite/Höhe in cm, gedreht und nie auf dem Kopf', () => {
  const base = { type: 'symbol' as const, symbol: { id: 'win1' }, showDims: true, opening: { height: 1.5, sill: 0.9 } };
  it('waagrechtes Fenster: aufwärts gelesen, Breite links, Höhe rechts; RPH darüber', () => {
    const [size, rph] = windowLabels({ ...base, shape: { type: 'rect', x: 0, y: 0, w: 1.3, h: 0.3 } });
    expect(size).toMatchObject({ text: '130/150', angle: -90, anchor: 'end', lines: ['130', '150'] });
    expect(rph).toMatchObject({ text: 'RPH 90', angle: 0 });
    expect(rph.at.y).toBeLessThan(size.at.y);
  });
  it('um 180° gedreht: Schrift wird gewendet, bleibt lesbar', () => {
    const [size, rph] = windowLabels({ ...base, shape: { type: 'rect', x: 0, y: 0, w: 1.3, h: 0.3, rotation: 180 } });
    expect(size.angle).toBe(90);
    expect(rph.angle).toBe(0);
  });
  it('„Maße anzeigen“ aus bzw. kein Fenster: keine Beschriftung', () => {
    expect(windowLabels({ ...base, showDims: false, shape: { type: 'rect', x: 0, y: 0, w: 1, h: 0.3 } })).toEqual([]);
    expect(windowLabels({ ...base, symbol: { id: 'door1' }, shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1 } })).toEqual([]);
  });
});

import { SYMBOL_GROUPS, symbolGeometry } from '../../src/lib/symbols';
describe('Fenster: Glas immer gleich dick und mittig, nur der Rahmen wächst mit der Wand', () => {
  /** Abstände der Glaslinien von der Mitte (in m), Fenster 1,20 m breit, Tiefe t (k = 1 Einheit je m) */
  const glassOffsets = (t: number) => {
    const g = symbolGeometry({ id: 'win1' }, { type: 'rect', x: 0, y: 0, w: 1.2, h: t }, 1);
    // Rahmen = erste (geschlossene) Linie, danach die beiden Glaslinien
    return g.lines.slice(1).map((l) => Math.round((l.pts[0].y - t / 2) * 1000) / 1000);
  };
  it('Standardtiefe 30 cm, 50 cm und 20 cm: Glas jeweils ±2,4 cm um die Mitte', () => {
    for (const t of [0.3, 0.5, 0.2]) expect(glassOffsets(t)).toEqual([-0.024, 0.024]);
  });
  it('der Rahmen folgt der Wanddicke', () => {
    const g = symbolGeometry({ id: 'win1' }, { type: 'rect', x: 0, y: 0, w: 1.2, h: 0.5 }, 1);
    expect(Math.max(...g.lines[0].pts.map((p) => p.y))).toBeCloseTo(0.5);
  });
});

describe('Heizung entfernt', () => {
  it('keine Gruppe und keine Heizungssymbole mehr', () => {
    expect(SYMBOL_GROUPS.map((g) => g.id)).not.toContain('heating');
    expect(SYMBOLS.some((s) => (s.group as string) === 'heating')).toBe(false);
  });
});
