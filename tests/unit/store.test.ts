import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingWrite } from '../../src/lib/db';

/**
 * Autospeichern: Nachbildung der Datenbank mit derselben Revisionsprüfung wie in db.ts.
 * Schreibvorgänge lassen sich anhalten, um Änderungen *während* einer laufenden
 * Speicherung exakt nachzustellen.
 */
const dbRevs = new Map<string, number>();
const calls: { baseRev: number; rev: number }[] = [];
let hold: Promise<void> | null = null;

vi.mock('../../src/lib/db', () => {
  class ConflictError extends Error {}
  return {
    ConflictError,
    getMeta: async () => undefined,
    setMeta: async () => {},
    loadProjectData: async () => ({
      project: { id: 'p', name: 'P', site: '', address: '', client: '', editor: '', date: '2026-10-24', notes: '', createdAt: 0, updatedAt: 0, rev: 1, deviceId: 'd', deletedAt: null },
      costCenters: [],
      files: [],
      plans: [],
      damages: [
        { id: 'd1', projectId: 'p', planId: 'pl', number: 1, shape: { type: 'rect', x: 0, y: 0, w: 1, h: 1 }, color: '#e03131', labelOffset: null, length: 1, width: 1, depth: 0.1, area: 1, createdAt: 0, updatedAt: 0, rev: 1, deviceId: 'd', deletedAt: null },
      ],
    }),
    writeRecords: async (writes: PendingWrite[]) => {
      if (hold) await hold;
      for (const w of writes) {
        calls.push({ baseRev: w.baseRev, rev: w.record.rev });
        const existing = dbRevs.get(w.record.id) ?? 0;
        if (existing !== w.baseRev) throw new ConflictError('Konflikt');
      }
      for (const w of writes) dbRevs.set(w.record.id, w.record.rev);
    },
  };
});

const store = await import('../../src/lib/store');

describe('Autospeichern', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    dbRevs.clear();
    dbRevs.set('d1', 1);
    dbRevs.set('p', 1);
    calls.length = 0;
    hold = null;
    await store.reloadProject();
    await store.openProject('p');
  });
  afterEach(() => vi.useRealTimers());

  const d1 = () => store.getState().data!.damages.d1;

  it('Änderung während einer laufenden Speicherung desselben Datensatzes löst keinen Fehlkonflikt aus', async () => {
    let release!: () => void;
    hold = new Promise((r) => (release = r));
    store.putRecord('damages', { ...d1(), color: '#1c7ed6' }); // rev 2
    await vi.advanceTimersByTimeAsync(300); // erste Speicherung startet und wird angehalten
    store.putRecord('damages', { ...d1(), color: '#2f9e44' }); // rev 3, während rev 2 noch gespeichert wird
    hold = null;
    release();
    await vi.advanceTimersByTimeAsync(300);
    await store.flush();
    expect(store.getState().save.status).toBe('saved');
    expect(calls).toEqual([
      { baseRev: 1, rev: 2 },
      { baseRev: 2, rev: 3 },
    ]);
    expect(dbRevs.get('d1')).toBe(3);
  });

  it('echte Änderung von außen wird weiterhin als Konflikt erkannt', async () => {
    dbRevs.set('d1', 5); // anderer Tab hat inzwischen gespeichert
    store.putRecord('damages', { ...d1(), color: '#1c7ed6' });
    await vi.advanceTimersByTimeAsync(300);
    await store.flush();
    expect(store.getState().save.status).toBe('conflict');
    expect(dbRevs.get('d1')).toBe(5); // nichts überschrieben
  });
});
