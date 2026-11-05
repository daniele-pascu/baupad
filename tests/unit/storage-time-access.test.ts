import { describe, expect, it } from 'vitest';
import { filterTimeRow, mergeTimeDay, timeScopeOf } from '../../supabase/functions/storage/index';

const row = (store: string, id: string, data: Record<string, unknown>) => ({ store, id, data, updated_at: '2026-11-05T10:00:00+00:00', deleted_at: null });
const lines = (...l: [string | null, string][]) => l.map(([projectId, siteName]) => ({ projectId, siteName, hours: 4 }));

describe('Funktion „storage“: Zeitaufzeichnung am Server geschützt', () => {
  const base = { operator: false, email: 'max@firma.at', sites: [], toolSites: {} };

  it('Rollen → Umfang (wie in der App)', () => {
    expect(timeScopeOf({ ...base, role: 'buero' })).toEqual({ level: 'office' });
    expect(timeScopeOf({ ...base, role: 'polier', toolSites: { times: ['p:a'] } })).toEqual({ level: 'site', sites: ['p:a'] });
    expect(timeScopeOf({ ...base, role: 'polier', sites: ['p:c'] })).toEqual({ level: 'site', sites: ['p:c'] });
    expect(timeScopeOf({ ...base, role: 'arbeiter' })).toEqual({ level: 'own', email: 'max@firma.at' });
    expect(timeScopeOf({ ...base, role: 'arbeiter', operator: true })).toEqual({ level: 'office' });
  });

  it('Polier bekommt nur Zeilen seiner Projekte; fremde Tage und Monatsfreigaben als „gelöscht“', () => {
    const scope = { level: 'site' as const, sites: ['p:a'] };
    const mixed = filterTimeRow(row('timeDays', 'w1|2026-11-04', { workerId: 'w1', lines: lines(['a', 'Parkring'], ['b', 'Hauptplatz']) }), scope, new Set());
    expect((mixed.data.lines as { siteName: string }[]).map((l) => l.siteName)).toEqual(['Parkring']);
    const other = filterTimeRow(row('timeDays', 'w2|2026-11-04', { workerId: 'w2', lines: lines(['b', 'Hauptplatz']) }), scope, new Set());
    expect(other).toMatchObject({ data: {}, deleted_at: '2026-11-05T10:00:00+00:00' });
    expect(filterTimeRow(row('timeMonths', 'w1|2026-11', { workerId: 'w1' }), scope, new Set()).deleted_at).not.toBeNull();
  });

  it('Arbeiter bekommt nur seine eigenen Tage', () => {
    const scope = { level: 'own' as const, email: 'max@firma.at' };
    expect(filterTimeRow(row('timeDays', 'w1|d', { workerId: 'w1', lines: lines(['a', 'X']) }), scope, new Set(['w1'])).deleted_at).toBeNull();
    expect(filterTimeRow(row('timeDays', 'w2|d', { workerId: 'w2', lines: lines(['a', 'X']) }), scope, new Set(['w1'])).deleted_at).not.toBeNull();
  });

  it('Speichern durch den Polier: Zeilen anderer Projekte bleiben am Server erhalten, auch beim Löschen', () => {
    const scope = { level: 'site' as const, sites: ['p:a'] };
    const existing = { workerId: 'w1', lines: lines(['a', 'Parkring'], ['b', 'Hauptplatz']) };
    const m = mergeTimeDay(existing, { workerId: 'w1', lines: [{ projectId: 'a', siteName: 'Parkring', hours: 8 }, { projectId: 'b', siteName: 'Hauptplatz', hours: 1 }] }, false, scope);
    expect((m.data.lines as { siteName: string; hours: number }[]).map((l) => [l.siteName, l.hours])).toEqual([['Hauptplatz', 4], ['Parkring', 8]]);
    expect(mergeTimeDay(existing, {}, true, scope)).toMatchObject({ deleted: false, data: { lines: [{ siteName: 'Hauptplatz' }] } });
    expect(mergeTimeDay({ lines: lines(['a', 'Parkring']) }, {}, true, scope)).toEqual({ data: {}, deleted: true });
  });
});
