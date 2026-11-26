import { describe, expect, it } from 'vitest';
import { spatialNumbers } from '../../src/lib/numbering';
import type { Shape } from '../../src/lib/types';

const box = (x: number, y: number): Shape => ({ type: 'rect', x, y, w: 10, h: 10 });

describe('Nummern im Plan ordnen', () => {
  it('nummeriert von oben nach unten, je Zeile von links nach rechts – nur die vorhandenen Nummern werden getauscht', () => {
    const ds = [
      { id: 'unten-rechts', number: 1, shape: box(200, 300) },
      { id: 'oben-rechts', number: 2, shape: box(200, 0) },
      { id: 'unten-links', number: 5, shape: box(0, 302) }, // leicht versetzt: gleiche Zeile
      { id: 'oben-links', number: 7, shape: box(0, 3) },
    ];
    const ch = spatialNumbers(ds);
    const after = Object.fromEntries(ds.map((d) => [d.id, ch.get(d.id) ?? d.number]));
    expect(after).toEqual({ 'oben-links': 1, 'oben-rechts': 2, 'unten-links': 5, 'unten-rechts': 7 });
  });

  it('ändert nichts, wenn die Reihenfolge schon stimmt', () => {
    expect(spatialNumbers([{ id: 'a', number: 1, shape: box(0, 0) }, { id: 'b', number: 2, shape: box(50, 0) }]).size).toBe(0);
  });
});
