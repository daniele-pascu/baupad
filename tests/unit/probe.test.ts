import { describe, expect, it } from 'vitest';
import { angleAt, formatProbe, perpendicularFoot, probeResult, probeTarget } from '../../src/lib/probe';

// k = 100 Seiteneinheiten je Meter
const k = 100;
const P = (x: number, y: number) => ({ x, y });

describe('Messung (Kontrollmessung)', () => {
  it('Länge: Summe aller Abschnitte in m', () => {
    const r = probeResult('length', [P(0, 0), P(300, 0), P(300, 400)], k)!;
    expect(r).toMatchObject({ kind: 'length', total: 7, segments: [3, 4] });
    expect(formatProbe(r)).toEqual({ main: '7,00 m', extra: '2 Abschnitte: 3,00 + 4,00 m' });
    expect(probeResult('length', [P(0, 0)], k)).toBeNull();
  });

  it('Fläche und Umfang aus den Eckpunkten (auch unregelmäßig)', () => {
    expect(probeResult('area', [P(0, 0), P(400, 0), P(400, 250), P(0, 250)], k)).toEqual({ kind: 'area', area: 10, perimeter: 13 });
    // Dreieck 3 × 4 m
    const tri = probeResult('area', [P(0, 0), P(300, 0), P(0, 400)], k)!;
    expect(tri).toMatchObject({ area: 6, perimeter: 12 });
    expect(formatProbe(tri).main).toBe('6,00 m²');
  });

  it('Winkel am mittleren Punkt (Scheitel), 0–180°', () => {
    expect(angleAt(P(100, 0), P(0, 0), P(0, 100))).toBeCloseTo(90, 9);
    expect(angleAt(P(100, 0), P(0, 0), P(-100, 0))).toBeCloseTo(180, 9);
    expect(angleAt(P(100, 0), P(0, 0), P(100, 100))).toBeCloseTo(45, 9);
    expect(angleAt(P(100, 0), P(0, 0), P(100, -100))).toBeCloseTo(45, 9); // Richtung egal
    expect(formatProbe(probeResult('angle', [P(100, 0), P(0, 0), P(50, 86.6025403784)], k)!).main).toBe('60,0°');
  });

  it('Radius und Durchmesser', () => {
    expect(probeResult('radius', [P(0, 0), P(150, 200)], k)).toEqual({ kind: 'radius', radius: 2.5, diameter: 5 });
  });

  it('Abstand mit waagrechtem und senkrechtem Anteil; senkrecht zu einer Bezugslinie', () => {
    expect(probeResult('distance', [P(0, 0), P(300, 400)], k)).toEqual({ kind: 'distance', distance: 5, dx: 3, dy: 4 });
    // Abstand zwischen parallelen Linien: Punkt auf der zweiten Linie, senkrecht zur ersten (auch außerhalb ihres Endes)
    const r = probeResult('distance', [P(900, 250)], k, [P(0, 0), P(500, 0)])!;
    expect(r).toMatchObject({ distance: 2.5, dx: 0, dy: 2.5, foot: { x: 900, y: 0 } });
    expect(perpendicularFoot(P(0, 100), P(0, 0), P(100, 100))).toEqual({ x: 50, y: 50 });
    expect(probeTarget('distance', true)).toBe(1);
    expect(probeTarget('length')).toBeNull();
  });

  it('Zoom/Verschieben ändern nichts: nur Seitenkoordinaten und Maßstab zählen', () => {
    const a = probeResult('length', [P(10, 10), P(110, 10)], k)!;
    const b = probeResult('length', [P(10, 10), P(110, 10)], k)!;
    expect(a).toEqual(b);
    expect(probeResult('length', [P(10, 10), P(110, 10)], 50)).toMatchObject({ total: 2 }); // anderer Maßstab
  });
});
