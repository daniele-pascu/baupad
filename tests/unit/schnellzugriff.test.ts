import { describe, expect, it } from 'vitest';
import { crewToday } from '../../src/lib/crew-today';
import { DEFAULT_WORK_TIMES } from '../../src/lib/crew';
import { applyAccountPins, pushPins, quickItems, quickOfRoute, readPins, togglePin, withRecent, RECENT_MAX, type RecentEntry } from '../../src/lib/quick-access';
import { parseQuickPins } from '../../src/lib/auth';
import type { Absence, WeekPlan, Worker } from '../../src/lib/types';

const e = (tool: RecentEntry['tool'], key: string, at: number): RecentEntry => ({ tool, key, at });

describe('Schnellzugriff', () => {
  it('erkennt Tool und Baustelle der Seite', () => {
    expect(quickOfRoute({ name: 'project', projectId: 'a' })).toEqual({ tool: 'projects', key: 'p:a' });
    expect(quickOfRoute({ name: 'plan', projectId: 'a', planId: 'x', damageId: null })).toEqual({ tool: 'projects', key: 'p:a' });
    expect(quickOfRoute({ name: 'photoSite', siteKey: 'p:b', week: null, photoId: null })).toEqual({ tool: 'photos', key: 'p:b' });
    expect(quickOfRoute({ name: 'defectSite', siteKey: 'n:halle' })).toEqual({ tool: 'defects', key: 'n:halle' });
    expect(quickOfRoute({ name: 'materialSite', projectId: 'c' })).toEqual({ tool: 'materials', key: 'p:c' });
    expect(quickOfRoute({ name: 'tools' })).toBeNull();
    expect(quickOfRoute({ name: 'workers' })).toBeNull();
  });

  it('zuletzt geöffnet: neueste vorn, ohne Doppelte, begrenzt', () => {
    let list: RecentEntry[] = [];
    list = withRecent(list, e('projects', 'p:a', 1));
    list = withRecent(list, e('photos', 'p:a', 2));
    list = withRecent(list, e('projects', 'p:a', 3));
    expect(list.map((x) => `${x.tool}|${x.key}`)).toEqual(['projects|p:a', 'photos|p:a']);
    for (let i = 0; i < 40; i++) list = withRecent(list, e('reports', `p:${i}`, 10 + i));
    expect(list).toHaveLength(RECENT_MAX);
  });

  it('angeheftet zuerst (im zuletzt genutzten Tool), dann zuletzt geöffnet; nur Erlaubtes', () => {
    const names: Record<string, string> = { 'p:a': 'Rohbau Müller', 'p:b': 'Halle Nord', 'p:c': 'Lindenstr. 8' };
    const items = quickItems({
      recent: [e('photos', 'p:b', 5), e('defects', 'p:c', 4), e('materials', 'p:a', 3), e('projects', 'p:x', 2)],
      pins: ['a', 'c'],
      nameOf: (k) => names[k] ?? null,
      toolsOf: () => ['projects'],
      canTool: (t) => t !== 'materials',
    });
    // a: zuletzt in Material (nicht erlaubt) → erstes Tool laut Register; c: zuletzt in Mängel
    expect(items.map((x) => [x.tool, x.name, x.pinned])).toEqual([
      ['projects', 'Rohbau Müller', true],
      ['defects', 'Lindenstr. 8', true],
      ['photos', 'Halle Nord', false],
    ]);
    expect(items[0].href).toContain('/aufmass-und-abrechnung/p/a');
  });
});

const W = (id: string, last: string, extra: Partial<Worker> = {}): Worker => ({ id, firstName: 'X', lastName: last, active: true, createdAt: 0, updatedAt: 0, ...extra });

describe('Heute auf der Baustelle', () => {
  // Dienstag 24.11.2026 (Woche ab Montag 23.11.)
  const week: WeekPlan = {
    id: '2026-11-23',
    sites: [
      { id: 's1', projectId: null, name: 'A', days: [[], ['w1', 'w2', 'w3'], [], [], [], [], []] },
      { id: 's2', projectId: null, name: 'B', paused: true, days: [[], ['w5'], [], [], [], [], []] },
    ],
    vacation: [[], ['w4'], [], [], [], [], []],
    createdAt: 0,
    updatedAt: 0,
  };
  const workers = [W('w1', 'Huber'), W('w2', 'Maier'), W('w3', 'Berger'), W('w4', 'Gruber'), W('w5', 'Wolf'), W('w6', 'Leiter', { grade: 'projektleiter' })];
  const sick: Absence[] = [{ id: 'a', workerId: 'w2', kind: 'krank', from: '2026-11-20', to: '2026-11-25', createdAt: 1 }];

  it('zählt Eingeteilte, Krank, Urlaub und noch Freie; Arbeitszeit des Tages', () => {
    const t = crewToday(week, workers, sick, DEFAULT_WORK_TIMES, '2026-11-24');
    expect(t.workday).toBe(true);
    expect(t.present.map((w) => w.lastName)).toEqual(['Berger', 'Huber']);
    expect(t.sick.map((w) => w.lastName)).toEqual(['Maier']);
    expect(t.vacation.map((w) => w.lastName)).toEqual(['Gruber']);
    // pausierte Baustelle zählt nicht, Projektleiter nie
    expect(t.open.map((w) => w.lastName)).toEqual(['Wolf']);
    expect(t.time).toBe('07:00–16:00');
  });

  it('Wochenende und Feiertag: kein Arbeitstag', () => {
    expect(crewToday(week, workers, [], DEFAULT_WORK_TIMES, '2026-11-28').workday).toBe(false);
    const h = crewToday(null, workers, [], DEFAULT_WORK_TIMES, '2026-12-08');
    expect(h.workday).toBe(false);
    expect(h.holiday).toBeTruthy();
    expect(h.open).toEqual([]);
  });
});

describe('Angeheftete Projekte je Person (Konto)', () => {
  const mem = new Map<string, string>();
  const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear() };
  (globalThis as { localStorage?: unknown }).localStorage = ls;

  it('liest die Liste aus den Benutzerdaten (JSON-Text oder Liste)', () => {
    expect(parseQuickPins('["a","b"]')).toEqual(['a', 'b']);
    expect(parseQuickPins(['a', 3, ''])).toEqual(['a']);
    expect(parseQuickPins('kaputt')).toBeUndefined();
    expect(parseQuickPins(undefined)).toBeUndefined();
  });

  it('Anheften gilt sofort; das Konto übernimmt nur, wenn hier nichts offen ist', async () => {
    mem.clear();
    expect(togglePin('anna', 'p1')).toBe(true);
    expect(readPins('anna')).toEqual(['p1']);
    // noch nicht im Konto gespeichert → wird nachgetragen statt überschrieben
    expect(applyAccountPins('anna', ['alt'])).toBe('push');
    expect(await pushPins('anna')).toBe(true); // ohne Anmeldedienst: gilt als gespeichert
    // anderes Gerät hat geändert → Liste aus dem Konto gilt
    expect(applyAccountPins('anna', ['p2', 'p1'])).toBe('take');
    expect(readPins('anna')).toEqual(['p2', 'p1']);
    expect(applyAccountPins('anna', ['p2', 'p1'])).toBe('same');
    // jede Person hat ihre eigene Liste
    expect(readPins('tom')).toEqual([]);
  });
});
