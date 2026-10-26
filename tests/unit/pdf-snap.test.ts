import { describe, expect, it } from 'vitest';
import { mul, pathSegments, SegIndex, type PlanSeg } from '../../src/lib/pdf-snap';
import { findSnap } from '../../src/lib/snap';

// Ansicht wie pdf.js: y nach unten, Seitenhöhe 842
const VIEW: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 842];
const I: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

describe('Planlinien aus PDF-Pfaden', () => {
  it('Rechteck (moveTo/lineTo/closePath) → 4 Strecken mit Eckpunkten, in Seitenkoordinaten', () => {
    const out: PlanSeg[] = [];
    pathSegments([0, 100, 100, 1, 300, 100, 1, 300, 200, 1, 100, 200, 4], VIEW, 0, out, null);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ a: { x: 100, y: 742 }, b: { x: 300, y: 742 }, ends: 3, straight: true });
    expect(out[3].b).toEqual({ x: 100, y: 742 }); // geschlossen
  });
  it('Transformation (cm) wird angewendet: erst die Pfadmatrix, dann die Ansicht', () => {
    const out: PlanSeg[] = [];
    pathSegments([0, 0, 0, 1, 10, 0], mul(VIEW, [2, 0, 0, 2, 50, 50]), 0, out, null);
    expect(out[0].a).toEqual({ x: 50, y: 792 });
    expect(out[0].b).toEqual({ x: 70, y: 792 });
  });
  it('Kurve: in Teilstücke zerlegt, nur Anfang und Ende sind Eckpunkte', () => {
    const out: PlanSeg[] = [];
    pathSegments([0, 0, 0, 2, 0, 50, 50, 100, 100, 100], I, 0, out, null);
    expect(out).toHaveLength(8);
    expect(out.map((s) => s.ends)).toEqual([1, 0, 0, 0, 0, 0, 0, 2]);
    expect(out.every((s) => !s.straight)).toBe(true);
    expect(out[7].b).toEqual({ x: 100, y: 100 });
  });
  it('nur Strecken im Planausschnitt', () => {
    const out: PlanSeg[] = [];
    pathSegments([0, 0, 0, 1, 10, 0, 0, 500, 500, 1, 510, 500], I, 0, out, { x: 400, y: 400, w: 200, h: 200 });
    expect(out).toHaveLength(1);
  });
});

describe('Punktfang auf Planlinien', () => {
  const out: PlanSeg[] = [];
  pathSegments([0, 100, 100, 1, 300, 100, 1, 300, 200, 1, 100, 200, 4], I, 0, out, null); // Raum
  pathSegments([0, 200, 50, 1, 200, 250], I, 1, out, null); // Linie quer durch
  const index = new SegIndex(out);
  const snap = (x: number, y: number, tol = 6) => findSnap({ x, y }, [], tol, index.near({ x, y }, tol));

  it('Ecke, Mittelpunkt, Schnittpunkt, auf Linie', () => {
    expect(snap(103, 98)).toEqual({ point: { x: 100, y: 100 }, kind: 'end' });
    expect(snap(203, 103)).toEqual({ point: { x: 200, y: 100 }, kind: 'intersection' }); // Linie quer trifft die Wand
    expect(snap(198, 203)).toEqual({ point: { x: 200, y: 200 }, kind: 'intersection' });
    expect(snap(297, 152)).toEqual({ point: { x: 300, y: 150 }, kind: 'mid' });
    expect(snap(240, 103)).toMatchObject({ point: { x: 240, y: 100 }, kind: 'nearest' });
    expect(snap(150, 150)).toBeNull(); // nichts in der Nähe
  });
  it('Index liefert nur nahe Strecken, nächste zuerst', () => {
    const near = index.near({ x: 102, y: 150 }, 5);
    expect(near).toHaveLength(1);
    expect(near[0].a).toEqual({ x: 100, y: 200 });
  });
});
