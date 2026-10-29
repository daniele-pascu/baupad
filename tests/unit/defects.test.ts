import { describe, expect, it } from 'vitest';
import { hitMark, markAnchor, markBox, nextMarkNo, summarize, thinPoints } from '../../src/lib/defect-geom';
import type { DefectMark, DefectPlan } from '../../src/lib/types';

const mark = (shape: DefectMark['shape'], points: { x: number; y: number }[], extra: Partial<DefectMark> = {}): DefectMark => ({
  id: 'm',
  planId: 'p',
  no: 1,
  shape,
  color: '#d6242b',
  points,
  text: '',
  kind: 'mangel',
  title: '',
  description: '',
  photoIds: [],
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe('Mängelplan – Geometrie und Nummern', () => {
  it('umschließendes Rechteck und Ankerpunkt der Nummer', () => {
    const r = mark('rect', [{ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 }]);
    const b = markBox(r);
    expect(b.x).toBeCloseTo(0.2);
    expect(b.y).toBeCloseTo(0.1);
    expect(b.w).toBeCloseTo(0.4);
    expect(b.h).toBeCloseTo(0.4);
    expect(markAnchor(r).x).toBeCloseTo(0.4);
    expect(markAnchor(r).y).toBeCloseTo(0.1);
    expect(markAnchor(mark('pin', [{ x: 0.3, y: 0.7 }]))).toEqual({ x: 0.3, y: 0.7 });
    expect(markAnchor(mark('line', [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }]))).toEqual({ x: 0.5, y: 0.5 });
  });

  it('trifft Pins, Flächen und Linien mit Toleranz', () => {
    const ar = 1.4;
    const tol = 0.02;
    expect(hitMark(mark('pin', [{ x: 0.5, y: 0.5 }]), { x: 0.5, y: 0.485 }, tol, ar)).toBe(true);
    expect(hitMark(mark('pin', [{ x: 0.5, y: 0.5 }]), { x: 0.6, y: 0.6 }, tol, ar)).toBe(false);
    const rect = mark('rect', [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }]);
    expect(hitMark(rect, { x: 0.3, y: 0.3 }, tol, ar)).toBe(true);
    expect(hitMark(rect, { x: 0.41, y: 0.41 }, tol, ar)).toBe(true); // innerhalb der Toleranz
    expect(hitMark(rect, { x: 0.5, y: 0.5 }, tol, ar)).toBe(false);
    const ell = mark('ellipse', [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }]);
    expect(hitMark(ell, { x: 0.3, y: 0.3 }, tol, ar)).toBe(true);
    expect(hitMark(ell, { x: 0.205, y: 0.205 }, tol, ar)).toBe(false); // Ecke liegt außerhalb der Ellipse
    const line = mark('line', [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }]);
    expect(hitMark(line, { x: 0.5, y: 0.11 }, tol, ar)).toBe(true);
    expect(hitMark(line, { x: 0.5, y: 0.2 }, tol, ar)).toBe(false);
  });

  it('nächste Nummer und Ausdünnen von Freihandzügen', () => {
    expect(nextMarkNo([])).toBe(1);
    expect(nextMarkNo([{ no: 1 }, { no: 3 }])).toBe(4);
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i / 1000, y: 0 }));
    const thin = thinPoints(pts, 0.01);
    expect(thin.length).toBeLessThan(10);
    expect(thin[0]).toEqual(pts[0]);
    expect(thin[thin.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('fasst Pläne und Markierungen je Baustelle zusammen', () => {
    const plan = (id: string, siteName: string, projectId: string | null = null): DefectPlan => ({ id, companyId: null, projectId, siteName, siteNumber: '', siteAddress: '', title: id, width: 100, height: 80, createdAt: 1, updatedAt: 1 });
    const plans = [plan('a', 'Garage'), plan('b', 'garage'), plan('c', 'Halle', 'proj1')];
    const marks = [mark('pin', [{ x: 0, y: 0 }], { planId: 'a', kind: 'mangel', photoIds: ['f1', 'f2'] }), mark('rect', [{ x: 0, y: 0 }, { x: 1, y: 1 }], { planId: 'b', kind: 'erledigt' })];
    const s = summarize(plans, marks);
    expect(s).toHaveLength(2);
    const garage = s.find((x) => x.key === 'n:garage')!;
    expect(garage.plans.map((p) => p.id)).toEqual(['a', 'b']);
    expect(garage.counts).toEqual({ mangel: 1, ausbesserung: 0, hinweis: 0, erledigt: 1 });
    expect(garage.photos).toBe(2);
    expect(s.find((x) => x.key === 'p:proj1')!.plans).toHaveLength(1);
  });
});
