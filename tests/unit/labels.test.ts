import { describe, expect, it } from 'vitest';
import { distToRect, layoutLabels, leaderLine, outlineParts, rectToOutline, rectsOverlap, type LabelInput } from '../../src/lib/geometry';
import type { Rect } from '../../src/lib/types';

const L = (id: string, x: number, y: number, w: number, h: number): LabelInput => ({
  id,
  bounds: { x, y, w, h },
  w: 16,
  h: 14,
  offset: null,
});

function check(items: LabelInput[], res: Map<string, Rect>) {
  const ids = items.map((i) => i.id);
  // 1. Keine Nummer verdeckt eine andere
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      expect(rectsOverlap(res.get(ids[i])!, res.get(ids[j])!), `Nummern ${ids[i]} und ${ids[j]} überlappen`).toBe(false);
  for (const it of items) {
    const r = res.get(it.id)!;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const own = distToRect(c, it.bounds);
    for (const o of items) {
      if (o === it) continue;
      // 2. Keine Nummer liegt auf einer fremden Schadstelle
      expect(rectsOverlap(r, o.bounds), `Nummer ${it.id} liegt auf Schadstelle ${o.id}`).toBe(false);
      // 3. Eindeutige Zuordnung: eigene Schadstelle ist am nächsten
      expect(distToRect(c, o.bounds), `Nummer ${it.id} steht näher an ${o.id}`).toBeGreaterThan(own);
    }
  }
}

describe('Platzierung der Schadstellennummern', () => {
  it('mehrere Schadstellen dicht nebeneinander in einer Reihe', () => {
    const items = Array.from({ length: 8 }, (_, i) => L(String(i), 100 + i * 26, 100, 22, 22));
    check(items, layoutLabels(items, 3));
  });

  it('Block aus 3 × 3 Schadstellen mit kleinen Abständen', () => {
    const items: LabelInput[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) items.push(L(`${r}${c}`, 200 + c * 34, 200 + r * 34, 28, 28));
    const res = layoutLabels(items, 3);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) expect(rectsOverlap(res.get(items[i].id)!, res.get(items[j].id)!)).toBe(false);
    for (const it of items) for (const o of items) if (o !== it) expect(rectsOverlap(res.get(it.id)!, o.bounds)).toBe(false);
  });

  it('40 zufällig verteilte Schadstellen ohne überlappende Nummern', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const items: LabelInput[] = [];
    while (items.length < 40) {
      const w = 12 + rnd() * 50;
      const h = 12 + rnd() * 50;
      const b = { x: rnd() * 900, y: rnd() * 600, w, h };
      if (items.some((o) => rectsOverlap({ x: b.x - 4, y: b.y - 4, w: w + 8, h: h + 8 }, o.bounds))) continue;
      items.push(L(String(items.length), b.x, b.y, w, h));
    }
    const res = layoutLabels(items, 3);
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) expect(rectsOverlap(res.get(items[i].id)!, res.get(items[j].id)!)).toBe(false);
  });

  it('frei stehende Schadstelle: Nummer direkt oben rechts, ohne Verbindungslinie', () => {
    const it = L('a', 100, 100, 40, 30);
    const r = layoutLabels([it], 3).get('a')!;
    expect(r.x).toBe(143);
    expect(r.y).toBe(100 - 14 - 3);
    expect(leaderLine({ type: 'rect', x: 100, y: 100, w: 40, h: 30 }, r, 5)).toBeNull(); // diagonal ≈ 4,2 px
  });

  it('manuell verschobene Nummer bleibt fest, andere weichen aus', () => {
    const a = { ...L('a', 100, 100, 30, 30), offset: { dx: 3, dy: -3 } };
    const b = L('b', 136, 60, 30, 30);
    const res = layoutLabels([a, b], 3);
    expect(res.get('a')).toEqual({ x: 133, y: 83, w: 16, h: 14 });
    expect(rectsOverlap(res.get('a')!, res.get('b')!)).toBe(false);
  });

  it('Verbindungslinie endet auf dem Kreisumriss', () => {
    const line = leaderLine({ type: 'ellipse', x: 0, y: 0, w: 100, h: 100 }, { x: 200, y: 40, w: 16, h: 14 }, 4)!;
    expect(Math.hypot(line.to.x - 50, line.to.y - 50)).toBeCloseTo(50, 6);
  });
});

describe('Verbindungslinie zum echten Umriss', () => {
  it('Nummer an der Ecke eines Kreises erhält eine Linie', () => {
    // Rechteck-Ecke ist frei, der Kreisumriss aber deutlich entfernt
    const line = leaderLine({ type: 'ellipse', x: 0, y: 0, w: 100, h: 100 }, { x: 102, y: -16, w: 16, h: 14 }, 7);
    expect(line).not.toBeNull();
  });
  it('Nummer direkt am Rechteck erhält keine Linie', () => {
    expect(leaderLine({ type: 'rect', x: 0, y: 0, w: 100, h: 100 }, { x: 103, y: 40, w: 16, h: 14 }, 7)).toBeNull();
  });
  it('Nummer in der Fläche: keine Verbindungslinie – außerhalb schon', () => {
    const flaeche = { type: 'rect' as const, x: 0, y: 0, w: 200, h: 120 };
    expect(leaderLine(flaeche, { x: 92, y: 53, w: 16, h: 14 }, 5)).toBeNull(); // mittig in der Fläche
    expect(leaderLine(flaeche, { x: 20, y: 20, w: 16, h: 14 }, 5)).toBeNull(); // innen, weit vom Rand
    expect(leaderLine(flaeche, { x: 240, y: 53, w: 16, h: 14 }, 5)).not.toBeNull(); // außerhalb
    // Kreis: innen keine Linie
    expect(leaderLine({ type: 'ellipse', x: 0, y: 0, w: 100, h: 100 }, { x: 42, y: 43, w: 16, h: 14 }, 4)).toBeNull();
  });
});

describe('Übersicht (Plan verkleinert): Nummern dicht an der Messung, sonst ausgeblendet', () => {
  // 30 winzige Messungen dicht gedrängt – wie ein ganzer Plan mit vielen Schadstellen von weitem
  const crowd = Array.from({ length: 30 }, (_, i) => L(String(i + 1), 100 + (i % 6) * 6, 100 + Math.floor(i / 6) * 6, 4 + (i % 3), 4));

  it('keine Nummer liegt auf einer anderen, keine steht weit weg', () => {
    const res = layoutLabels(crowd, 3, { overview: {} });
    const shown = crowd.filter((it) => res.has(it.id));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(crowd.length); // ausgedünnt
    for (let i = 0; i < shown.length; i++)
      for (let j = i + 1; j < shown.length; j++) expect(rectsOverlap(res.get(shown[i].id)!, res.get(shown[j].id)!)).toBe(false);
    // jede Nummer steht direkt an ihrer Messung (keine Linien quer über den Plan), aber nie auf deren Rand
    for (const it of shown) {
      const r = res.get(it.id)!;
      const d = rectToOutline(r, outlineParts({ type: 'rect', ...it.bounds }));
      expect(d).toBeGreaterThan(1);
      expect(d).toBeLessThanOrEqual(3 + 1e-6);
    }
  });

  it('die ausgewählte Messung zeigt ihre Nummer immer', () => {
    const hidden = crowd.find((it) => !layoutLabels(crowd, 3, { overview: {} }).has(it.id))!;
    expect(layoutLabels(crowd, 3, { overview: { keep: hidden.id } }).has(hidden.id)).toBe(true);
  });

  it('genug Platz: alle Nummern bleiben sichtbar', () => {
    const spread = Array.from({ length: 6 }, (_, i) => L(String(i), 100 + i * 120, 100, 30, 30));
    expect(layoutLabels(spread, 3, { overview: {} }).size).toBe(6);
  });

  it('offene Linie (Winkel): Nummer direkt neben der Linie – nie darauf, nicht in der leeren Mitte', () => {
    const shape = { type: 'freehand' as const, closed: false, x: 0, y: 0, w: 100, h: 100, points: [[0, 0], [1, 0], [1, 1]] as [number, number][] };
    const line: LabelInput = { id: 'l', bounds: { x: 0, y: 0, w: 100, h: 100 }, shape, w: 16, h: 14, offset: null };
    const r = layoutLabels([line], 3, { overview: {} }).get('l')!;
    const d = rectToOutline(r, outlineParts(shape));
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThanOrEqual(3 + 1e-6);
    expect(leaderLine(shape, r, 5)).toBeNull(); // direkt daneben: keine Bezugslinie
  });

  it('vergrößert (ohne Übersicht) bekommt jede Messung eine Nummer', () => {
    expect(layoutLabels(crowd, 3).size).toBe(crowd.length);
  });
});

describe('Nummern nie auf der Linie', () => {
  const diag = { type: 'line' as const, x: 0, y: 0, w: 200, h: 150, points: [[0, 1], [1, 0]] as [number, number][] };
  const poly = { type: 'freehand' as const, closed: false, x: 0, y: 0, w: 300, h: 200, points: [[0, 1], [0.3, 0], [0.6, 1], [1, 0.2]] as [number, number][] };
  const item = (id: string, shape: typeof diag | typeof poly): LabelInput => ({ id, bounds: { x: shape.x, y: shape.y, w: shape.w, h: shape.h }, shape, w: 22, h: 15, offset: null });

  for (const overview of [false, true]) {
    it(`schräge Linie und Polylinie${overview ? ' (Übersicht)' : ''}: direkt daneben, keine Bezugslinie`, () => {
      for (const shape of [diag, poly]) {
        const r = layoutLabels([item('a', shape)], 3, overview ? { overview: {} } : {}).get('a')!;
        const d = rectToOutline(r, outlineParts(shape));
        expect(d, 'Nummer liegt auf der Linie').toBeGreaterThan(1.5);
        expect(d, 'Nummer steht nicht direkt daneben').toBeLessThanOrEqual(3 + 1e-6);
        expect(leaderLine(shape, r, 5)).toBeNull();
      }
    });
  }

  it('Nummer weiter weg: Bezugslinie; direkt daneben (auch schräg): keine', () => {
    // Feld schräg neben der Diagonale, Ecke 2 Einheiten von der Linie entfernt
    const nx = 150 / 250;
    const ny = 200 / 250;
    const d = 2 + 11 * nx + 7.5 * ny;
    const near = { x: 100 + nx * d - 11, y: 75 + ny * d - 7.5, w: 22, h: 15 };
    expect(rectToOutline(near, outlineParts(diag))).toBeCloseTo(2, 6);
    expect(leaderLine(diag, near, 5)).toBeNull();
    const far = { ...near, x: near.x + 40, y: near.y + 40 };
    expect(leaderLine(diag, far, 5)).not.toBeNull();
  });

  it('fremde Linie: keine Nummer liegt auf einer anderen Linie', () => {
    // zwei sich kreuzende Linien und eine Fläche dicht daneben
    const a = item('a', diag);
    const b = item('b', { ...diag, points: [[0, 0], [1, 1]] });
    const c: LabelInput = { id: 'c', bounds: { x: 210, y: 60, w: 30, h: 30 }, w: 22, h: 15, offset: null };
    const all = [a, b, c];
    const res = layoutLabels(all, 3);
    for (const it of all) {
      const r = res.get(it.id)!;
      for (const o of all) expect(rectToOutline(r, outlineParts(o.shape ?? { type: 'rect', ...o.bounds })), `${it.id} auf ${o.id}`).toBeGreaterThan(1.5);
    }
  });
});
