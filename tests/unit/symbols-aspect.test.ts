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
