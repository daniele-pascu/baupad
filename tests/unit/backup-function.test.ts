import { describe, expect, it } from 'vitest';
import { gunzip, handle, keepDates } from '../../supabase/functions/backup/index';

/** Nachgebildete Hetzner-Ablage (S3) und Datenbank (PostgREST) */
function fakeServices(tables: Record<string, Record<string, unknown>[]>) {
  const objects = new Map<string, Uint8Array>();
  const upserts: { table: string; rows: Record<string, unknown>[] }[] = [];
  const auth: string[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.host.endsWith('supabase.co')) {
      auth.push(String((init.headers as Record<string, string>).apikey));
      const table = u.pathname.replace('/rest/v1/', '');
      if (init.method === 'POST') {
        upserts.push({ table, rows: JSON.parse(String(init.body)) });
        return new Response(null, { status: 201 });
      }
      if (!(table in tables)) return new Response('{}', { status: 404 });
      const off = Number(u.searchParams.get('offset'));
      const lim = Number(u.searchParams.get('limit'));
      return new Response(JSON.stringify(tables[table].slice(off, off + lim)));
    }
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\//);
    const key = decodeURIComponent(u.pathname.slice(1));
    if (init.method === 'PUT') {
      objects.set(key, new Uint8Array(init.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    if (init.method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    if (u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') ?? '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      return new Response(`<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    }
    const o = objects.get(key);
    return o ? new Response(o as BodyInit) : new Response('', { status: 404 });
  };
  return { objects, upserts, auth, fetchFn };
}

const ENV: Record<string, string> = {
  BACKUP_TOKEN: 'geheim-geheim-geheim-1234',
  HETZNER_S3_ENDPOINT: 'https://nbg1.your-objectstorage.com',
  HETZNER_S3_BUCKET: 'baupad-dateien',
  HETZNER_S3_KEY: 'AK',
  HETZNER_S3_SECRET: 'SK',
  SUPABASE_URL: 'https://ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJservice',
};
const call = (fetchFn: ReturnType<typeof fakeServices>['fetchFn'], body: unknown, token = ENV.BACKUP_TOKEN, env = ENV) =>
  handle(new Request('https://x/functions/v1/backup', { method: 'POST', headers: { 'x-backup-token': token }, body: JSON.stringify(body) }), (n) => env[n], fetchFn);

describe('Supabase-Funktion „backup“ (Sicherung nach Hetzner)', () => {
  it('Aufbewahrung: 30 Tage täglich plus der 1. jedes Monats für 12 Monate', () => {
    const dates: string[] = [];
    for (let d = new Date('2025-06-01T00:00:00Z'); d <= new Date('2026-11-05T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
    const keep = [...keepDates(dates, '2026-11-05')].sort();
    expect(keep.filter((d) => d >= '2026-10-07')).toHaveLength(30);
    expect(keep.filter((d) => d < '2026-10-07')).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01']);
  });

  it('ohne richtiges Geheimwort oder ohne Einrichtung passiert nichts', async () => {
    const s = fakeServices({ records: [] });
    expect((await call(s.fetchFn, {}, 'falsch-falsch-falsch-1234')).status).toBe(401);
    expect((await call(s.fetchFn, {}, ENV.BACKUP_TOKEN, { ...ENV, BACKUP_TOKEN: '' })).status).toBe(501);
    expect(s.objects.size).toBe(0);
  });

  it('sichert alle Tabellen gepackt nach backups/<Datum>/, räumt alte Stände auf, stellt eine Firma wieder her', async () => {
    const records = Array.from({ length: 2300 }, (_, i) => ({ workspace_id: i % 2 ? 'ws-a' : 'ws-b', store: 'projects', id: `p${i}`, data: { name: `Projekt ${i}` }, rev: 1, updated_at: '2026-11-01T00:00:00Z' }));
    const s = fakeServices({ workspaces: [{ id: 'ws-a' }, { id: 'ws-b' }], profiles: [], memberships: [], operators: [], invitations: [], photos: [{ id: 'f1', workspace_id: 'ws-a' }], records });
    // 31 ältere Sicherungen (gestern … vor 31 Tagen): mit der neuen bleiben 30 – die zwei ältesten fallen weg,
    // außer es ist der 1. eines Monats (Monatsstand)
    const older: string[] = [];
    for (let i = 1; i <= 31; i++) older.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
    for (const d of older) {
      s.objects.set(`backups/${d}/records.ndjson.gz`, new Uint8Array([1]));
      s.objects.set(`backups/${d}/manifest.json`, new Uint8Array([1]));
    }
    const expectRemoved = older.slice(29).filter((d) => !d.endsWith('-01')).sort();
    const r = await call(s.fetchFn, { action: 'run' });
    expect(r.status).toBe(200);
    const res = await r.json();
    const today = new Date().toISOString().slice(0, 10);
    expect(res.date).toBe(today);
    expect(res.counts).toMatchObject({ workspaces: 2, photos: 1, records: 2300 }); // über 3 Seiten gelesen
    expect(res.counts.contact_messages).toBeUndefined(); // Tabelle fehlt → übersprungen
    expect(res.removed.sort()).toEqual(expectRemoved);
    for (const d of expectRemoved) expect(s.objects.has(`backups/${d}/manifest.json`)).toBe(false);
    expect(s.objects.has(`backups/${older[0]}/manifest.json`)).toBe(true);
    const text = await gunzip(s.objects.get(`backups/${today}/records.ndjson.gz`)!);
    expect(text.split('\n')).toHaveLength(2300);
    expect(JSON.parse(text.split('\n')[5])).toMatchObject({ id: 'p5', data: { name: 'Projekt 5' } });
    expect(s.auth.every((k) => k === 'eyJservice')).toBe(true);

    const listed = (await (await call(s.fetchFn, { action: 'list' })).json()).dates as string[];
    expect(listed[0]).toBe(today);
    expect(listed).toHaveLength(32 - expectRemoved.length);

    const back = await (await call(s.fetchFn, { action: 'restore', date: today, workspace: 'ws-a' })).json();
    expect(back.restored).toEqual({ photos: 1, records: 1150 });
    const rows = s.upserts.filter((u) => u.table === 'records').flatMap((u) => u.rows);
    expect(rows).toHaveLength(1150);
    expect(rows.every((x) => x.workspace_id === 'ws-a' && !('updated_at' in x))).toBe(true); // neuer Zeitstempel → Geräte holen den Stand
  });
});
