import { describe, expect, it } from 'vitest';

describe('cornerIndices – Knicke bei Flächen mit vielen Punkten', () => {
  it('Quadrat aus 120 Punkten: genau die 4 Ecken als Anfasser', async () => {
    const { cornerIndices } = await import('../../src/lib/geometry');
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 30; i++) pts.push({ x: i * 10, y: 0 });
    for (let i = 0; i < 30; i++) pts.push({ x: 300, y: i * 10 });
    for (let i = 0; i < 30; i++) pts.push({ x: 300 - i * 10, y: 300 });
    for (let i = 0; i < 30; i++) pts.push({ x: 0, y: 300 - i * 10 });
    expect(cornerIndices(pts, true)).toEqual([0, 30, 60, 90]);
  });
  it('bis 40 Punkte: alle Punkte', async () => {
    const { cornerIndices } = await import('../../src/lib/geometry');
    const pts = Array.from({ length: 12 }, (_, i) => ({ x: i * 5, y: (i % 2) * 5 }));
    expect(cornerIndices(pts, false)).toHaveLength(12);
  });
  it('dicht liegende Knicke werden ausgedünnt (mehr beim Hineinzoomen)', async () => {
    const { cornerIndices } = await import('../../src/lib/geometry');
    // Zickzack aus 60 Punkten, 4 px Abstand: klein dargestellt wenige, 10-fach vergrößert alle
    const zig = (k: number) => Array.from({ length: 60 }, (_, i) => ({ x: i * 4 * k, y: (i % 2) * 4 * k }));
    expect(cornerIndices(zig(1), false).length).toBeLessThan(20);
    expect(cornerIndices(zig(10), false).length).toBe(60);
  });
});
