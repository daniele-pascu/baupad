import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/lib/auth';
import { mergeHiddenLines, timesScope, visibleDays } from '../../src/lib/times-access';
import type { TimeDay } from '../../src/lib/times';

const session = (role: Session['role'], extra: Partial<Session> = {}) => ({ userId: 'u', email: 'Max@Firma.at', name: 'Max', role, companyId: 'ws', companyName: 'F', operator: false, tools: [], sites: [], toolSites: {}, ...extra }) as unknown as Session;
const day = (workerId: string, lines: [string | null, string, number][]): TimeDay => ({ id: `${workerId}|2026-11-04`, workerId, date: '2026-11-04', month: '2026-11', lines: lines.map(([projectId, siteName, hours]) => ({ projectId, siteName, hours })), updatedAt: 0, updatedBy: '' });

describe('Zeitaufzeichnung: wer sieht welche Stunden', () => {
  it('Rollen: Admin/Büro alles, Polier seine Projekte (Zeitaufzeichnung, sonst Einteilung), Arbeiter nur eigene', () => {
    expect(timesScope(session('admin'))).toEqual({ level: 'office' });
    expect(timesScope(session('buero'))).toEqual({ level: 'office' });
    expect(timesScope(session('polier', { toolSites: { times: ['p:a'] } }))).toEqual({ level: 'site', sites: ['p:a'] });
    expect(timesScope(session('polier', { toolSites: { workers: ['p:b'] } }))).toEqual({ level: 'site', sites: ['p:b'] });
    expect(timesScope(session('arbeiter'))).toEqual({ level: 'own', email: 'max@firma.at' });
    expect(timesScope(session('polier', { operator: true }))).toEqual({ level: 'office' });
  });

  it('Polier: nur Zeilen seiner Projekte; Tage ohne solche Zeilen entfallen', () => {
    const days = [day('w1', [['a', 'Parkring', 4], ['b', 'Hauptplatz', 4]]), day('w2', [['b', 'Hauptplatz', 8]]), day('w3', [[null, 'Lager', 2]])];
    const v = visibleDays(days, { level: 'site', sites: ['p:a', 'n:lager'] }, []);
    expect(v.map((d) => [d.workerId, d.lines.map((l) => l.siteName)])).toEqual([['w1', ['Parkring']], ['w3', ['Lager']]]);
    expect(visibleDays(days, { level: 'site', sites: [] }, [])).toHaveLength(3); // keine Einschränkung = alle Projekte
  });

  it('Arbeiter: nur Tage der Arbeiter, die mit seiner E-Mail verknüpft sind', () => {
    const days = [day('w1', [['a', 'Parkring', 8]]), day('w2', [['a', 'Parkring', 8]])];
    const workers = [{ id: 'w1', userEmail: 'max@firma.at' }, { id: 'w2', userEmail: 'peter@firma.at' }];
    expect(visibleDays(days, { level: 'own', email: 'max@firma.at' }, workers).map((d) => d.workerId)).toEqual(['w1']);
    expect(visibleDays(days, { level: 'own', email: 'neu@firma.at' }, workers)).toEqual([]);
  });

  it('Speichern durch den Polier: Zeilen anderer Projekte bleiben erhalten, fremde Eingaben werden verworfen', () => {
    const prev = day('w1', [['a', 'Parkring', 4], ['b', 'Hauptplatz', 4]]).lines;
    const next = mergeHiddenLines(prev, [{ projectId: 'a', siteName: 'Parkring', hours: 6 }, { projectId: 'b', siteName: 'Hauptplatz', hours: 1 }], { level: 'site', sites: ['p:a'] });
    expect(next.map((l) => [l.siteName, l.hours])).toEqual([['Hauptplatz', 4], ['Parkring', 6]]);
  });
});
