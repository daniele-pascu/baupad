import { describe, expect, it } from 'vitest';
import { legendEntries, legendLines, resolveLegend } from '../../src/lib/legend';
import type { Damage, Plan, Shape } from '../../src/lib/types';

const rect: Shape = { type: 'rect', x: 0, y: 0, w: 1, h: 1 };
const line: Shape = { type: 'line', x: 0, y: 0, w: 1, h: 0, points: [[0, 0], [1, 0]] };
const d = (p: Partial<Damage>) => ({ color: '#E03131', shape: rect, ...p }) as Damage;

describe('Farblegende im PDF', () => {
  it('ist ohne eigene Einstellung an, bleibt aus, wenn der Plan sie ausschaltet', () => {
    expect(resolveLegend({} as Plan).show).toBe(true);
    expect(resolveLegend({ showLegend: false } as Plan).show).toBe(false);
    expect(resolveLegend({ showLegend: true } as Plan).show).toBe(true);
  });

  it('unterscheidet Linien und Flächen nach Aussehen, nicht nur nach Farbe', () => {
    const e = legendEntries({}, [
      d({}),
      d({}),
      d({ kind: 'line', shape: line }),
      d({ kind: 'line', shape: line, style: { lineType: 'wave', lineWidth: 2 } }),
      d({ style: { fillType: 'hatch', hatch: { pattern: 'cross', angle: 45, spacing: 4 } } }),
    ]);
    expect(e.map((x) => [x.sample, x.count])).toEqual([['area', 2], ['line', 1], ['line', 1], ['area', 1]]);
    expect(e[0].key).toBe('#e03131'); // Standard-Fläche: alter Schlüssel, gespeicherte Bezeichnungen gelten weiter
    expect(e[2].style).toEqual({ lineType: 'wave', lineWidth: 2 });
    expect(new Set(e.map((x) => x.key)).size).toBe(4);
  });

  it('nimmt die eigene Bezeichnung des Aussehens, sonst die der Farbe', () => {
    const e = legendEntries({ legendLabels: { '#e03131': 'Beton', '#e03131|line': 'Fuge' } }, [d({}), d({ kind: 'line', shape: line }), d({ kind: 'line', shape: line, style: { lineType: 'dashed' } })]);
    expect(e.map((x) => x.label)).toEqual(['Beton', 'Fuge', 'Beton']);
  });

  it('fasst verschiedene Farben mit gleicher Bezeichnung zu einer Zeile zusammen', () => {
    const e = legendEntries({ legendLabels: { '#e03131': 'Beton', '#1c7ed6': 'beton ', '#2f9e44': 'Fuge' } }, [d({}), d({ color: '#2f9e44' }), d({ color: '#1C7ED6' })]);
    const lines = legendLines(e);
    expect(lines.map((l) => [l.label, l.looks.map((x) => x.color)])).toEqual([
      ['Beton', ['#e03131', '#1c7ed6']],
      ['Fuge', ['#2f9e44']],
    ]);
  });
});
