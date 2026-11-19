import { describe, expect, it } from 'vitest';
import { hitShape, insertVertex, moveVertex, nearestEdge, removeVertex, segmentsShape, shapeParts, shapePath, shapeVertices } from '../../src/lib/geometry';
import { pathLength, suggestMeasures } from '../../src/lib/drawing';

/** Aufmaß, Länge mit Freier Form: Linien einzeln (z. B. Risse mit Lücken) – eine Messung, Länge = Summe */
describe('Linien einzeln', () => {
  // A–B 2 m, C–D 1 m (Lücke 0,5 m), E–F 1 m ab der Mitte von A–B (Seiteneinheiten = m)
  const pts = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2.5, y: 0 },
    { x: 2.5, y: 1 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ];
  const s = segmentsShape(pts)!;

  it('Punktpaare werden Linien, ein angefangener letzter Punkt entfällt', () => {
    expect(s.type).toBe('freehand');
    expect(s.closed).toBe(false);
    expect(s.breaks).toEqual([2, 4]);
    expect(segmentsShape([...pts, { x: 9, y: 9 }])!.breaks).toEqual([2, 4]);
    expect(segmentsShape([{ x: 0, y: 0 }])).toBeNull();
    expect(segmentsShape(pts.slice(0, 2))!.breaks).toBeUndefined(); // eine Linie: keine Lücke
  });

  it('Länge ist die Summe der Linien (Lücken zählen nicht)', () => {
    expect(pathLength(s)).toBeCloseTo(4, 6);
    expect(suggestMeasures(s, 1).length).toBe(4);
  });

  it('Darstellung setzt an jeder Lücke neu an; Antippen nur auf einer Linie', () => {
    expect(shapePath(s).map((c) => c.c).join('')).toBe('MLMLML');
    expect(hitShape(s, { x: 2.25, y: 0 }, 0.05)).toBe(false); // in der Lücke
    expect(hitShape(s, { x: 1, y: 0.5 }, 0.05)).toBe(true);
    expect(shapeParts(s, shapeVertices(s)).map((p) => p.length)).toEqual([2, 2, 2]);
    // Lücken sind keine Kanten (Punkt einfügen)
    expect(nearestEdge(s, { x: 2.25, y: 0 })!.edge).not.toBe(1);
  });

  it('Punkt verschieben, einfügen und entfernen behält die Linien', () => {
    expect(moveVertex(s, 1, { x: 3, y: 0 }).breaks).toEqual([2, 4]);
    expect(pathLength(moveVertex(s, 1, { x: 3, y: 0 }))).toBeCloseTo(5, 6);
    const ins = insertVertex(s, 2, { x: 2.5, y: 0.5 });
    expect(ins.breaks).toEqual([2, 5]);
    expect(pathLength(ins)).toBeCloseTo(4, 6);
    // Endpunkt einer Linie entfernen: die Linie (nur noch ein Punkt) entfällt ganz
    const rm = removeVertex(s, 3)!;
    expect(rm.breaks).toEqual([2]);
    expect(pathLength(rm)).toBeCloseTo(3, 6);
  });
});
