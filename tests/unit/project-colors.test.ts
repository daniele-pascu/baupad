import { describe, expect, it } from 'vitest';
import { PROJECT_COLORS, hashColor, nextProjectColor, projectColor, siteColor } from '../../src/lib/project-colors';

const ids = PROJECT_COLORS.map((c) => c.id);

describe('Projektfarben', () => {
  it('kein Rot/Orange, 12 verschiedene Farben', () => {
    expect(new Set(ids).size).toBe(12);
    for (const c of ids) {
      const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
      expect(r > 180 && g < 140 && b < 100).toBe(false);
    }
  });
  it('gespeicherte Farbe gilt, sonst feste Farbe aus der ID', () => {
    expect(projectColor({ id: 'a', color: ids[3] })).toBe(ids[3]);
    expect(projectColor({ id: 'a' })).toBe(hashColor('a'));
    expect(projectColor({ id: 'a', color: '#ff0000' })).toBe(hashColor('a'));
  });
  it('neues Projekt bekommt die am seltensten benutzte Farbe', () => {
    expect(nextProjectColor([])).toBe(ids[0]);
    const used = ids.slice(0, 5).map((color, i) => ({ id: `p${i}`, color, deletedAt: null }));
    expect(nextProjectColor(used)).toBe(ids[5]);
    expect(nextProjectColor([...used, { id: 'x', color: ids[5], deletedAt: Date.now() }])).toBe(ids[5]);
  });
  it('Baustellen-Schlüssel: p:<id> über das Register, freie Baustellen fest aus dem Namen', () => {
    const m = new Map([['abc', ids[7]]]);
    expect(siteColor('p:abc', m)).toBe(ids[7]);
    expect(siteColor('abc', m)).toBe(ids[7]);
    expect(siteColor('n:lager', m)).toBe(siteColor('n:lager', new Map()));
  });
});
