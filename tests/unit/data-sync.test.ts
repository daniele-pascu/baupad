import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEntry } from '../../src/lib/db';

/**
 * Datenabgleich: Warteschlange → Server (Dateien vor Datensätzen), Änderungen anderer Geräte → Gerät,
 * lokale offene Änderungen gewinnen, Cursor (Zeit + Kennung) wird fortgeschrieben.
 * Datenbank und Server sind nachgebildet.
 */
const outbox = new Map<string, OutboxEntry>();
const records = new Map<string, Record<string, unknown>>(); // "store:id"
const meta = new Map<string, unknown>();
const files = new Map<string, Record<string, ArrayBuffer>>();
const applied: { store: string; id: string; data: unknown }[] = [];
const deletedProjects: string[] = [];

vi.mock('../../src/lib/db', () => ({
  listOutbox: async () => [...outbox.values()],
  clearOutbox: async (entries: OutboxEntry[]) => {
    for (const e of entries) {
      const cur = outbox.get(e.id);
      if (cur && cur.updatedAt === e.updatedAt) outbox.delete(e.id);
    }
  },
  readSyncRecord: async (store: string, id: string) => (store === 'meta' ? (meta.has(id) ? { value: meta.get(id) } : undefined) : records.get(`${store}:${id}`)),
  readSyncFile: async (store: string, id: string) => files.get(`${store}:${id}`),
  writeSyncFile: async (store: string, id: string, parts: Record<string, ArrayBuffer>) => void files.set(`${store}:${id}`, parts),
  applyRemoteRecord: async (store: string, id: string, data: unknown) => void applied.push({ store, id, data }),
  deleteProjectCompletely: async (id: string) => void deletedProjects.push(id),
  deleteDefectPlanCompletely: async () => {},
  enqueueAll: async () => 0,
  getMeta: async (k: string) => meta.get(k),
  setMeta: async (k: string, v: unknown) => void meta.set(k, v),
  setSyncChangeHook: () => {},
  setSyncFileFetcher: () => {},
  getDB: async () => ({
    getAll: async (store: string) => [...records.entries()].filter(([k]) => k.startsWith(`${store}:`)).map(([, v]) => v),
    getKey: async (store: string, id: string) => (files.has(`${store}:${id}`) ? id : undefined),
  }),
}));
vi.mock('../../src/lib/store', () => ({
  getState: () => ({ projectId: 'p1' }),
  hasUnsavedChanges: () => false,
  flush: async () => {},
  reloadProject: vi.fn(async () => {}),
}));
vi.mock('../../src/lib/remote', () => ({ accessToken: async () => 'token' }));

const { DataSync } = await import('../../src/lib/data-sync');
const store = await import('../../src/lib/store');

/** nachgebildeter Server: Tabelle records + signierte Links; S3-Uploads/-Downloads über globalThis.fetch */
const server = new Map<string, { store: string; id: string; data: unknown; rev: number; updated_at: string; deleted_at: string | null }>();
const calls: string[] = [];
const rejectStores = new Set<string>();
/** Rechte am Server nachstellen: Änderungen dieser Datenarten lehnt der Server ab und schickt seinen Stand */
const forbidStores = new Set<string>();
/** Funktion prüft die Rechte schon (Antwort `filtered`) */
let serverFilters = false;
let clock = 0;
const stamp = () => `2026-10-31T19:00:00.${String(++clock).padStart(6, '0')}+00:00`;
const fakeFetch = async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body)) as Record<string, unknown>;
  calls.push(String(body.action));
  if (body.action === 'presign') {
    const urls: Record<string, string> = {};
    for (const it of body.items as { key: string; method: string }[]) urls[`${it.method} ${it.key}`] = `https://s3.test/${it.key}`;
    return new Response(JSON.stringify({ urls }), { status: 200 });
  }
  if (body.action === 'records-upsert') {
    // veraltete Funktion nachstellen: kennt manche Datenarten nicht → ganze Lieferung 422
    if ((body.records as { store: string }[]).some((r) => rejectStores.has(r.store))) return new Response(JSON.stringify({ error: 'record' }), { status: 422 });
    const at = stamp(); // ein Upsert → gleiche Zeit für die ganze Gruppe
    const rejected: unknown[] = [];
    for (const r of body.records as { store: string; id: string; data: unknown; rev: number; deleted_at: number | null }[]) {
      if (forbidStores.has(r.store)) {
        const cur = server.get(`${r.store}:${r.id}`);
        if (cur) rejected.push(cur);
        continue;
      }
      server.set(`${r.store}:${r.id}`, { ...r, updated_at: at, deleted_at: r.deleted_at ? new Date(r.deleted_at).toISOString() : null });
    }
    return new Response(JSON.stringify({ ok: true, rejected }), { status: 200 });
  }
  if (body.action === 'records-pull') {
    const since = (body.since as string | null) ?? '';
    const after = (body.after as string) ?? '';
    const rows = [...server.values()].filter((r) => r.updated_at > since || (r.updated_at === since && r.id > after)).sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id));
    return new Response(JSON.stringify({ records: rows, ...(serverFilters ? { filtered: true } : {}) }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'action' }), { status: 400 });
};
const s3: string[] = [];
beforeEach(() => {
  outbox.clear();
  records.clear();
  meta.clear();
  files.clear();
  server.clear();
  applied.length = 0;
  deletedProjects.length = 0;
  calls.length = 0;
  rejectStores.clear();
  forbidStores.clear();
  serverFilters = false;
  s3.length = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    s3.push(`${init?.method ?? 'GET'} ${String(url)}`);
    return new Response(new ArrayBuffer(4), { status: 200 });
  }) as typeof fetch;
});

const entry = (store: OutboxEntry['store'], recordId: string, extra: Partial<OutboxEntry> = {}): OutboxEntry => ({ id: `${store}:${recordId}`, projectId: 'p1', store, recordId, rev: 1, updatedAt: 1000, ...extra });

describe('Datenabgleich', () => {
  it('überträgt Dateien vor Datensätzen und leert die Warteschlange; Grabsteine kommen als deleted_at an', async () => {
    records.set('plans:pl1', { id: 'pl1', projectId: 'p1', title: 'EG', rev: 1 });
    meta.set('workTimes', { start: '07:00' });
    files.set('blobs:f1', { 'data.bin': new ArrayBuffer(8) });
    outbox.set('plans:pl1', entry('plans', 'pl1'));
    outbox.set('meta:workTimes', entry('meta', 'workTimes'));
    outbox.set('blobs:f1', entry('blobs', 'f1'));
    outbox.set('workers:w9', entry('workers', 'w9', { deleted: true, updatedAt: 1234 }));
    const sync = new DataSync('ws1', fakeFetch);
    await sync.push();
    expect(calls).toEqual(['presign', 'records-upsert']);
    expect(s3).toEqual(['PUT https://s3.test/files/f1/data.bin']);
    expect(server.get('plans:pl1')?.data).toEqual({ id: 'pl1', projectId: 'p1', title: 'EG', rev: 1 });
    expect(server.get('meta:workTimes')?.data).toEqual({ value: { start: '07:00' } });
    expect(server.get('workers:w9')?.deleted_at).toBe(new Date(1234).toISOString());
    expect(outbox.size).toBe(0);
  });

  it('übernimmt Änderungen anderer Geräte, lässt offene lokale Änderungen in Ruhe und schreibt den Cursor fort', async () => {
    const at = stamp();
    server.set('plans:pl2', { store: 'plans', id: 'pl2', data: { id: 'pl2', projectId: 'p1', title: 'OG' }, rev: 3, updated_at: at, deleted_at: null });
    server.set('plans:pl3', { store: 'plans', id: 'pl3', data: { id: 'pl3', projectId: 'p1', title: 'lokal neuer' }, rev: 1, updated_at: at, deleted_at: null });
    server.set('projects:p0', { store: 'projects', id: 'p0', data: {}, rev: 0, updated_at: at, deleted_at: at });
    server.set('meta:companyName', { store: 'meta', id: 'companyName', data: { value: 'Muster Bau' }, rev: 0, updated_at: at, deleted_at: null });
    outbox.set('plans:pl3', entry('plans', 'pl3')); // wartet noch auf Upload → gewinnt
    const sync = new DataSync('ws1', fakeFetch);
    await sync.pull();
    expect(applied.map((a) => `${a.store}:${a.id}`)).toEqual(['meta:companyName', 'plans:pl2']);
    expect(deletedProjects).toEqual(['p0']);
    expect(meta.get('dataSyncCursor')).toEqual({ at, id: 'pl3' }); // letzte Zeile der Seite (Sortierung Zeit, Kennung)
    // geöffnetes Projekt betroffen → neu geladen
    expect(store.reloadProject).toHaveBeenCalled();
    // zweiter Abgleich: nichts Neues
    applied.length = 0;
    await sync.pull();
    expect(applied).toEqual([]);
  });

  it('lädt fehlende Dateien aus der Ablage nach (optionaler Teil darf fehlen)', async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      s3.push(`GET ${u}`);
      return u.endsWith('pdf.pdf') ? new Response('', { status: 404 }) : new Response(new ArrayBuffer(3), { status: 200 });
    }) as typeof fetch;
    const sync = new DataSync('ws1', fakeFetch);
    expect(await sync.fetchFile('defectPlanImages', 'dp1')).toBe(true);
    expect(Object.keys(files.get('defectPlanImages:dp1')!)).toEqual(['data.jpg', 'thumb.jpg']);
    expect(await sync.fetchFile('blobs', 'missing')).toBe(true); // Server liefert (nachgebildet) – Ergebnis wird gespeichert
  });

  it('eine abgelehnte Datenart hält die anderen nicht auf: Rest wird übertragen, Abgelehntes bleibt in der Warteschlange', async () => {
    rejectStores.add('timeDays');
    records.set('plans:pl1', { id: 'pl1', projectId: 'p1', title: 'EG', rev: 1 });
    records.set('timeDays:w1|2026-11-02', { id: 'w1|2026-11-02', lines: [] });
    outbox.set('plans:pl1', entry('plans', 'pl1'));
    outbox.set('timeDays:w1|2026-11-02', entry('timeDays', 'w1|2026-11-02'));
    const sync = new DataSync('ws1', fakeFetch);
    await expect(sync.push()).rejects.toThrow('abgelehnt');
    expect(server.has('plans:pl1')).toBe(true);
    expect(server.has('timeDays:w1|2026-11-02')).toBe(false);
    expect([...outbox.keys()]).toEqual(['timeDays:w1|2026-11-02']);
    sync.stop();
  });

  it('Materialverwaltung mit noch nicht neu veröffentlichter Funktion: Materialien warten, alles andere wird übertragen, keine Fehlermeldung', async () => {
    rejectStores.add('materials');
    records.set('plans:pl1', { id: 'pl1', projectId: 'p1', title: 'EG', rev: 1 });
    records.set('materials:m1', { id: 'm1', name: 'Estrich', unit: 'm²' });
    outbox.set('plans:pl1', entry('plans', 'pl1'));
    outbox.set('materials:m1', entry('materials', 'm1'));
    const sync = new DataSync('ws1', fakeFetch);
    await sync.push();
    expect(server.has('plans:pl1')).toBe(true);
    expect([...outbox.keys()]).toEqual(['materials:m1']);
    // nach dem Veröffentlichen der Funktion geht das Material mit
    rejectStores.clear();
    await sync.push();
    expect(server.has('materials:m1')).toBe(true);
    expect(outbox.size).toBe(0);
    sync.stop();
  });
});

describe('Funktion „storage“ kennt alle Datenarten der App', () => {
  it('jede abgeglichene Datenart (SyncStore ohne Dateien) steht in STORES der Funktion; Kennungen mit „|“ erlaubt', async () => {
    const { readFileSync } = await import('node:fs');
    const fn = new TextDecoder().decode(readFileSync('supabase/functions/storage/index.ts'));
    const db = new TextDecoder().decode(readFileSync('src/lib/db.ts'));
    const types = new TextDecoder().decode(readFileSync('src/lib/types.ts'));
    const union = (src: string, name: string) => [...(new RegExp(`export type ${name} =([^;]+);`).exec(src)?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    const app = [...union(types, 'EntityStore'), ...union(db, 'SyncStore')];
    const server = [...(/const STORES = \[([^\]]+)\]/.exec(fn)?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(app.length).toBeGreaterThan(10);
    expect(app.filter((s) => !server.includes(s))).toEqual([]);
    expect(new RegExp(/const RECORD_ID_RE = (\/.+\/);/.exec(fn)![1].slice(1, -1)).test('w1|2026-11-02')).toBe(true);
  });
});

describe('Pläne auf dem Gerät', () => {
  it('lädt nach dem Abgleich alle fehlenden Pläne in voller Auflösung (Original) herunter – vorhandene und gelöschte nicht', async () => {
    records.set('files:f1', { id: 'f1', projectId: 'p1', deletedAt: null });
    records.set('files:f2', { id: 'f2', projectId: 'p1', deletedAt: null });
    records.set('files:f3', { id: 'f3', projectId: 'p1', deletedAt: 123 });
    records.set('defectPlans:d1', { id: 'd1', deletedAt: null });
    files.set('blobs:f2', { 'data.bin': new ArrayBuffer(8) }); // schon da
    const sync = new DataSync('ws1', fakeFetch);
    expect(await sync.prefetchFiles()).toBe(2);
    expect(files.has('blobs:f1')).toBe(true);
    expect(files.has('blobs:f3')).toBe(false);
    expect(files.has('defectPlanImages:d1')).toBe(true);
    expect(s3).toContain('GET https://s3.test/files/f1/data.bin');
    expect(s3.some((u) => u.includes('files/f2/'))).toBe(false);
    sync.stop();
  });
});


describe('Rechte am Server (Polier/Arbeiter)', () => {
  it('abgelehnte Änderung: der Stand des Servers wird übernommen, die Warteschlange ist trotzdem leer', async () => {
    const at = stamp();
    server.set('plans:pl5', { store: 'plans', id: 'pl5', data: { id: 'pl5', projectId: 'p1', title: 'Server' }, rev: 2, updated_at: at, deleted_at: null });
    records.set('plans:pl5', { id: 'pl5', projectId: 'p1', title: 'lokal' });
    outbox.set('plans:pl5', entry('plans', 'pl5'));
    forbidStores.add('plans');
    const sync = new DataSync('ws1', fakeFetch);
    await sync.push();
    expect(outbox.size).toBe(0);
    expect(server.get('plans:pl5')?.data).toEqual({ id: 'pl5', projectId: 'p1', title: 'Server' });
    expect(applied).toEqual([{ store: 'plans', id: 'pl5', data: { id: 'pl5', projectId: 'p1', title: 'Server' } }]);
  });

  it('geänderte Freigaben: der Abgleich beginnt einmal von vorn (neu freigegebene Projekte kommen, entzogene gehen)', async () => {
    const { setSyncAccess, accessKey } = await import('../../src/lib/sync-access');
    const polier = (sites: string[]) => ({ userId: 'u', email: 'p@f.at', name: 'P', role: 'polier', companyId: 'ws1', companyName: 'F', operator: false, phone: '', pkg: null, workspaceActive: true, pricePerUser: 0, members: 2, tools: [], sites, toolSites: {}, providers: [] }) as unknown as Parameters<typeof accessKey>[0];
    const at = stamp();
    server.set('plans:alt', { store: 'plans', id: 'alt', data: { id: 'alt', projectId: 'p1', title: 'älter als der Cursor' }, rev: 1, updated_at: at, deleted_at: null });
    meta.set('dataSyncCursor', { at: '2099-01-01T00:00:00Z', id: 'z' }); // Gerät von vor der Änderung: schon „alles“ geholt
    setSyncAccess(polier(['p:p1']));
    const sync = new DataSync('ws1', fakeFetch);
    // Funktion noch nicht neu veröffentlicht (prüft keine Rechte): kein Neu-Abgleich – er käme ungefiltert
    await sync.pull();
    expect(applied).toEqual([]);
    expect(meta.get('syncServerFilters')).toBeUndefined();
    // neu veröffentlicht: die erste Antwort meldet es, ab dem nächsten Abgleich einmal alles
    serverFilters = true;
    await sync.pull();
    expect(meta.get('syncServerFilters')).toBe(true);
    await sync.pull();
    expect(applied.map((a) => a.id)).toEqual(['alt']);
    expect((meta.get('dataSyncCursor') as { access?: string }).access).toBe(accessKey(polier(['p:p1'])));
    // gleiche Freigaben: nichts Neues
    applied.length = 0;
    await sync.pull();
    expect(applied).toEqual([]);
    // Projekt dazu freigegeben → noch einmal alles
    expect(setSyncAccess(polier(['p:p1', 'p:p2']))).toBe(true);
    await sync.pull();
    expect(applied.map((a) => a.id)).toEqual(['alt']);
  });
});
