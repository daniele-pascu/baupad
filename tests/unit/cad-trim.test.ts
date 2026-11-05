import { describe, expect, it } from 'vitest';
import { trimByFence, trimShape } from '../../src/lib/cad';
import { lineShape, shapeVertices } from '../../src/lib/geometry';
import type { Shape } from '../../src/lib/types';
import { printFit } from '../../src/lib/drawing';

const rect = (x: number, y: number, w: number, h: number): Shape => ({ type: 'rect', x, y, w, h });
const pts = (s: Shape) => shapeVertices(s).map((p) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);

describe('Stutzen (trimShape)', () => {
  it('entfernt bei einer Linie den Abschnitt zwischen zwei Schnittkanten', () => {
    const line = lineShape({ x: 0, y: 0 }, { x: 10, y: 0 });
    const cutters = [lineShape({ x: 3, y: -1 }, { x: 3, y: 1 }), lineShape({ x: 7, y: -1 }, { x: 7, y: 1 })];
    const out = trimShape(line, { x: 5, y: 0.1 }, cutters)!;
    expect(out.map(pts)).toEqual([[[0, 0], [3, 0]], [[7, 0], [10, 0]]]);
  });

  it('entfernt bis zum Linienende, wenn auf einer Seite keine Kante liegt', () => {
    const line = lineShape({ x: 0, y: 0 }, { x: 10, y: 0 });
    const out = trimShape(line, { x: 9, y: 0 }, [lineShape({ x: 7, y: -1 }, { x: 7, y: 1 })])!;
    expect(out.map(pts)).toEqual([[[0, 0], [7, 0]]]);
  });

  it('gibt null ohne Schnittpunkte zurück', () => {
    expect(trimShape(lineShape({ x: 0, y: 0 }, { x: 10, y: 0 }), { x: 5, y: 0 }, [])).toBeNull();
  });

  it('öffnet ein Rechteck zwischen zwei Schnittpunkten (Rest als offene Polylinie)', () => {
    // senkrechte Linie bei x = 5 schneidet Ober- und Unterkante
    const out = trimShape(rect(0, 0, 10, 4), { x: 8, y: 0 }, [lineShape({ x: 5, y: -1 }, { x: 5, y: 5 })])!;
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('freehand');
    expect(out[0].closed).toBe(false);
    // rechte Hälfte entfernt: Rest läuft von (5,4) über die linken Ecken nach (5,0)
    expect(pts(out[0])).toEqual([[5, 4], [0, 4], [0, 0], [5, 0]]);
  });

  it('stutzt eine offene Polylinie über Eckpunkte hinweg', () => {
    const poly: Shape = { type: 'freehand', closed: false, x: 0, y: 0, w: 10, h: 10, points: [[0, 0], [1, 0], [1, 1]] };
    const out = trimShape(poly, { x: 10, y: 0 }, [lineShape({ x: 5, y: -1 }, { x: 5, y: 1 }), lineShape({ x: 9, y: 5 }, { x: 11, y: 5 })])!;
    expect(out.map(pts)).toEqual([[[0, 0], [5, 0]], [[10, 5], [10, 10]]]);
  });
});

describe('Stutzen mit Zaun (trimByFence)', () => {
  it('stutzt alle gekreuzten Linien zwischen ihren Schnittkanten', () => {
    // zwei waagrechte Linien zwischen zwei senkrechten Wänden, Zaun senkrecht durch die Mitte
    const shapes = [
      lineShape({ x: 0, y: 0 }, { x: 10, y: 0 }),
      lineShape({ x: 0, y: 2 }, { x: 10, y: 2 }),
      lineShape({ x: 3, y: -1 }, { x: 3, y: 3 }),
      lineShape({ x: 7, y: -1 }, { x: 7, y: 3 }),
    ];
    const res = trimByFence(shapes, { x: 5, y: -0.5 }, { x: 5, y: 2.5 });
    expect([...res.keys()].sort()).toEqual([0, 1]);
    expect(res.get(0)!.map(pts)).toEqual([[[0, 0], [3, 0]], [[7, 0], [10, 0]]]);
    expect(res.get(1)!.map(pts)).toEqual([[[0, 2], [3, 2]], [[7, 2], [10, 2]]]);
  });
});

describe('PDF: Zeichnung passend aufs Format (printFit)', () => {
  // A4 quer, 1:100 → Blatt 27,7 × 17,6 m (Seiteneinheiten cm)
  const plan = { pageWidth: 2770, pageHeight: 1760, drawing: { unit: 'm' as const, unitsPerMeter: 100, paper: 'A4-quer' as const, scale: 100 } };
  const avail = { w: 277, h: 176 };

  it('druckt das Blatt im gewählten Maßstab, wenn alles darauf liegt', () => {
    const fit = printFit(plan, [{ shape: rect(1, 1, 10, 5) }], [], avail);
    expect(fit).toMatchObject({ scale: 100, fitted: false, region: { x: 0, y: 0, w: 2770, h: 1760 } });
  });

  it('verkleinert eine 80 × 50 m große Fläche auf den nächsten passenden Normmaßstab', () => {
    const fit = printFit(plan, [{ shape: rect(0, 0, 80, 50) }], [], avail);
    expect(fit.fitted).toBe(true);
    expect(fit.scale).toBe(500);
    expect((fit.region.w / 100) * 1000 / fit.scale).toBeLessThanOrEqual(avail.w);
  });
});
