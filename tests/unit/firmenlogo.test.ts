import { describe, expect, it } from 'vitest';
import { logoHeaderSize, trimBox } from '../../src/lib/company';

describe('Firmenlogo in der Kopfzeile', () => {
  it('jedes Logo passt: gleiche sichtbare Fläche, Höhe 16–42 pt, Breite höchstens 170 pt', () => {
    expect(logoHeaderSize({ width: 800, height: 220 })).toEqual({ width: 99.1, height: 27.2 }); // wie Vorlage (99 × 27 pt)
    const square = logoHeaderSize({ width: 500, height: 500 });
    expect(square).toEqual({ width: 42, height: 42 }); // quadratisch: nicht höher als 42 pt
    const wide = logoHeaderSize({ width: 1200, height: 100 });
    expect(wide.width).toBeLessThanOrEqual(170);
    expect(wide.height).toBeGreaterThanOrEqual(14); // sehr breit: begrenzt durch die Breite
    const tall = logoHeaderSize({ width: 200, height: 600 });
    expect(tall.height).toBe(42);
    expect(tall.width).toBe(14);
    for (const l of [square, wide, tall]) expect(l.width / l.height).toBeGreaterThan(0); // Seitenverhältnis bleibt
    expect(wide.width / wide.height).toBeCloseTo(12, 1);
  });
  it('leere Ränder (weiß bzw. durchsichtig) werden erkannt', () => {
    const w = 20;
    const h = 10;
    const data = new Uint8ClampedArray(w * h * 4).fill(255); // weiß, deckend
    for (let y = 3; y < 6; y++) for (let x = 5; x < 12; x++) data.set([200, 0, 0, 255], (y * w + x) * 4);
    expect(trimBox(data, w, h)).toEqual({ x: 4, y: 2, w: 9, h: 5 });
    const clear = new Uint8ClampedArray(w * h * 4); // durchsichtig
    clear.set([0, 0, 0, 255], (5 * w + 10) * 4);
    expect(trimBox(clear, w, h)).toEqual({ x: 9, y: 4, w: 3, h: 3 });
    expect(trimBox(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull();
  });
});
