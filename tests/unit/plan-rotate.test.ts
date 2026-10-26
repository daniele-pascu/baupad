import { describe, expect, it } from 'vitest';
import { contentBounds } from '../../src/lib/layout-detect';
import { rotatePlan } from '../../src/lib/plan-rotate';
import type { Plan } from '../../src/lib/types';

const plan = {
  id: 'p',
  pageWidth: 800,
  pageHeight: 600,
  crop: { x: 100, y: 50, w: 300, h: 200 },
  calibration: { a: { x: 100, y: 100 }, b: { x: 400, y: 100 }, meters: 6 },
} as unknown as Plan;
const len = (c: NonNullable<Plan['calibration']>) => Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y);

describe('Plan drehen', () => {
  it('90° im Uhrzeigersinn: Seite, Ausschnitt und Kalibrierung gedreht', () => {
    const r = rotatePlan(plan, 90);
    expect([r.pageWidth, r.pageHeight, r.rotation]).toEqual([600, 800, 90]);
    expect(r.crop).toEqual({ x: 350, y: 100, w: 200, h: 300 }); // oben links → oben rechts
    expect(r.calibration!.a).toEqual({ x: 500, y: 100 });
    expect(r.calibration!.b).toEqual({ x: 500, y: 400 });
    expect(len(r.calibration!)).toBe(len(plan.calibration!)); // Maßstab bleibt
    expect(r.calibration!.meters).toBe(6);
  });
  it('viermal 90° bzw. 90° + 270° ergibt wieder das Original (ohne Drehfeld)', () => {
    const four = rotatePlan(rotatePlan(rotatePlan(rotatePlan(plan, 90), 90), 90), 90);
    expect(four).toEqual(plan);
    expect('rotation' in four).toBe(false);
    expect(rotatePlan(rotatePlan(plan, 90), 270)).toEqual(plan);
  });
  it('180°: Ausschnitt gespiegelt, Größe gleich', () => {
    const r = rotatePlan(plan, 180);
    expect([r.pageWidth, r.pageHeight, r.rotation]).toEqual([800, 600, 180]);
    expect(r.crop).toEqual({ x: 400, y: 350, w: 300, h: 200 });
  });
  it('ganze Seite bleibt ganze Seite', () => {
    expect(rotatePlan({ ...plan, crop: null }, 270).crop).toBeNull();
  });
});

function image(W: number, H: number, ink: (x: number, y: number) => boolean): ImageData {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink(x, y)) data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
  return { width: W, height: H, data, colorSpace: 'srgb' } as ImageData;
}

describe('Weiße Ränder erkennen', () => {
  it('Inhalt in der Mitte: Rahmen darum (mit kleinem Abstand), in Seitenkoordinaten', () => {
    const img = image(200, 100, (x, y) => x >= 40 && x < 160 && y >= 20 && y < 80 && (x === 40 || y === 20 || x === 159 || y === 79));
    const r = contentBounds(img, 400, 200)!;
    expect(r.x).toBeCloseTo(78, 0);
    expect(r.y).toBeCloseTo(38, 0);
    expect(r.w).toBeCloseTo(244, 0);
    expect(r.h).toBeCloseTo(124, 0);
  });
  it('einzelne Staubpunkte am Rand werden ignoriert', () => {
    const img = image(200, 100, (x, y) => (x >= 50 && x < 150 && y >= 30 && y < 70 && y % 5 === 0) || (x === 3 && y === 3));
    const r = contentBounds(img, 200, 100)!;
    expect(r.x).toBeGreaterThan(40);
  });
  it('kein Rand bzw. leere Seite → kein Vorschlag', () => {
    expect(contentBounds(image(100, 100, (x, y) => x < 2 || y < 2 || x > 97 || y > 97), 100, 100)).toBeNull();
    expect(contentBounds(image(100, 100, () => false), 100, 100)).toBeNull();
  });
});
