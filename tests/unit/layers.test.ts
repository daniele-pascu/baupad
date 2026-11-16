import { describe, expect, it } from 'vitest';
import { lineShape, polygonShape } from '../../src/lib/geometry';
import { areasBelow } from '../../src/lib/layers';

describe('Zeichen-Reihenfolge im Aufmaß', () => {
  const P = (x: number, y: number) => ({ x, y });
  const wand1 = { id: 'wand1', shape: lineShape(P(0, 0), P(5, 0)) };
  const flaeche = { id: 'flaeche', shape: polygonShape([P(0, 0), P(5, 0), P(5, 3), P(0, 3)], true) };
  const wand2 = { id: 'wand2', shape: polygonShape([P(5, 0), P(5, 3), P(0, 3)], false) };
  it('Flächen liegen unten, Linien darüber – egal was zuerst gemessen wurde', () => {
    expect(areasBelow([wand1, flaeche, wand2]).map((d) => d.id)).toEqual(['flaeche', 'wand1', 'wand2']);
    expect(areasBelow([flaeche, wand1]).map((d) => d.id)).toEqual(['flaeche', 'wand1']);
  });
  it('unter sich behalten Flächen und Linien ihre Reihenfolge', () => {
    const f2 = { id: 'f2', shape: polygonShape([P(1, 1), P(2, 1), P(2, 2)], true) };
    expect(areasBelow([f2, wand2, flaeche, wand1]).map((d) => d.id)).toEqual(['f2', 'flaeche', 'wand2', 'wand1']);
  });
});
