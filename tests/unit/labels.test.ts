import { describe, expect, it } from 'vitest';
import { clusterText, distToRect, layoutLabels, leaderLine, overviewLabels, rectsOverlap, type LabelInput } from '../../src/lib/geometry';
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
    // jede Nummer steht direkt auf ihrer Messung (keine Linien quer über den Plan)
    for (const it of shown) {
      const r = res.get(it.id)!;
      expect(distToRect({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, it.bounds)).toBe(0);
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

  it('offene Linie (Winkel): Nummer auf der Linie, nicht in der leeren Mitte', () => {
    const line: LabelInput = { id: 'l', bounds: { x: 0, y: 0, w: 100, h: 100 }, shape: { type: 'freehand', closed: false, x: 0, y: 0, w: 100, h: 100, points: [[0, 0], [1, 0], [1, 1]] }, w: 16, h: 14, offset: null };
    const r = layoutLabels([line], 3, { overview: {} }).get('l')!;
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    expect(Math.min(Math.abs(c.y), Math.abs(c.x - 100))).toBeLessThan(1);
  });

  it('vergrößert (ohne Übersicht) bekommt jede Messung eine Nummer', () => {
    expect(layoutLabels(crowd, 3).size).toBe(crowd.length);
  });
});

describe('Sammelblase: nur wo sich Nummern verdecken würden', () => {
  const T = (id: string, x: number, y: number, w = 6, h = 6) => ({ ...L(id, x, y, w, h), text: id });
  it('dicht gedrängt → eine Blase „1–6“, einzelne Messungen behalten ihre Nummer', () => {
    const items = [...Array.from({ length: 6 }, (_, i) => T(String(i + 1), 100 + i * 5, 100)), T('7', 400, 100), T('8', 100, 400)];
    const { labels, clusters } = overviewLabels(items, 3);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].text).toBe('1–6');
    expect(clusters[0].ids.sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    expect([...labels.keys()].sort()).toEqual(['7', '8']);
    // keine Nummer verschwindet: jede steht einzeln oder in einer Blase
    expect(labels.size + clusters.reduce((n, c) => n + c.ids.length, 0)).toBe(items.length);
  });
  it('genug Platz → keine Blase', () => {
    const items = Array.from({ length: 5 }, (_, i) => T(String(i + 1), 100 + i * 80, 100, 30, 30));
    const { labels, clusters } = overviewLabels(items, 3);
    expect(clusters).toHaveLength(0);
    expect(labels.size).toBe(5);
  });
  it('ausgewählte Messung bleibt einzeln, auch mitten in einer Gruppe', () => {
    const items = Array.from({ length: 4 }, (_, i) => T(String(i + 1), 100 + i * 5, 100));
    const { labels, clusters } = overviewLabels(items, 3, '2');
    expect(labels.has('2')).toBe(true);
    expect(clusters[0].ids).not.toContain('2');
  });
  it('Text: fortlaufend „von–bis“, zwei Teile, sonst Anzahl', () => {
    expect(clusterText(['3', '1', '2'])).toBe('1–3');
    expect(clusterText(['1', '2', '5'])).toBe('1–2, 5');
    expect(clusterText(['1', '3', '5'])).toBe('3 Messungen');
    expect(clusterText(['A1', '2'])).toBe('2 Messungen');
  });
});
