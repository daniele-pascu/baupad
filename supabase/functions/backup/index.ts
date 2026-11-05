// Supabase Edge Function „backup“: nächtliche Sicherung der Datenbank in die Hetzner-Ablage (S3-kompatibel).
// Läuft getrennt von der Funktion „storage“; die App ruft sie nie auf. Gestartet wird sie jede Nacht von pg_cron
// (docs/supabase/backup.sql) bzw. von Hand – immer mit dem Geheimwort BACKUP_TOKEN im Kopf „x-backup-token“.
//
// Aktionen (POST, JSON { action, ... }):
//   run      {}                                   → alle Tabellen als NDJSON (gzip) nach backups/<JJJJ-MM-TT>/<tabelle>.ndjson.gz,
//                                                    dazu manifest.json; danach alte Stände aufräumen
//   list     {}                                   → vorhandene Sicherungen (Datum)
//   restore  { date, workspace?, tables? }        → Datensätze (records) und Foto-Verzeichnis (photos) aus einer Sicherung
//                                                    zurückschreiben (nur Einfügen/Überschreiben, nichts wird gelöscht);
//                                                    workspace = nur diese Firma
//
// Aufbewahrung: die letzten 30 Tage täglich, dazu der Stand vom 1. jedes Monats für 12 Monate.
// Gesichert werden: workspaces, profiles, memberships, operators, invitations, photos, records, contact_messages.
// Nicht enthalten: Anmeldekonten (Supabase Auth) und die Dateien selbst (Fotos/PDFs liegen bereits bei Hetzner).
//
// Secrets: HETZNER_S3_ENDPOINT, HETZNER_S3_BUCKET, HETZNER_S3_REGION, HETZNER_S3_KEY, HETZNER_S3_SECRET (wie „storage“),
//          BACKUP_TOKEN (frei gewähltes langes Geheimwort), optional BACKUP_SERVICE_KEY (Secret Key „sb_secret_…“,
//          nur nötig, wenn der Standard-Schlüssel SUPABASE_SERVICE_ROLE_KEY abgeschaltet ist). „Verify JWT“ AUS.
// Einrichtung: docs/backup-einrichten.md

interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface BackupEnv {
  s3: S3Config;
  /** Supabase-Adresse, z. B. https://<ref>.supabase.co */
  url: string;
  /** Schlüssel mit vollem Lesezugriff (service_role bzw. sb_secret_…) */
  key: string;
  fetch: FetchLike;
  now?: Date;
}

/** Tabellen mit Sortierung (Primärschlüssel) und Konfliktspalten für die Wiederherstellung */
export const TABLES: { name: string; order: string; conflict: string; restorable?: boolean }[] = [
  { name: 'workspaces', order: 'id', conflict: 'id' },
  { name: 'profiles', order: 'id', conflict: 'id' },
  { name: 'memberships', order: 'workspace_id,user_id', conflict: 'workspace_id,user_id' },
  { name: 'operators', order: 'email', conflict: 'email' },
  { name: 'invitations', order: 'workspace_id,email', conflict: 'workspace_id,email' },
  { name: 'photos', order: 'id', conflict: 'id', restorable: true },
  { name: 'records', order: 'workspace_id,store,id', conflict: 'workspace_id,store,id', restorable: true },
  { name: 'contact_messages', order: 'id', conflict: 'id' },
];
const PREFIX = 'backups/';
const PAGE = 1000;

// ---- Signatur V4 (wie in der Funktion „storage“, dort und in src/lib/s3-sign.ts getestet) ------------------
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', (typeof data === 'string' ? enc.encode(data) : data) as BufferSource));
}
async function hmac(key: ArrayBuffer | string, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}
function amzDate(d = new Date()) {
  const stamp = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}
const encodeQ = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (key: string) => key.split('/').map(encodeQ).join('/');
const canonicalQuery = (params: Record<string, string>) =>
  Object.keys(params)
    .sort()
    .map((k) => `${encodeQ(k)}=${encodeQ(params[k])}`)
    .join('&');
async function signingKey(cfg: S3Config, date: string) {
  const kDate = await hmac(`AWS4${cfg.secretKey}`, date);
  const kRegion = await hmac(kDate, cfg.region);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}
async function signHeaders(cfg: S3Config, method: string, path: string, query: Record<string, string>, body: string | Uint8Array = '', extraHeaders: Record<string, string> = {}) {
  const { stamp, date } = amzDate();
  const base = new URL(cfg.endpoint);
  const host = `${cfg.bucket}.${base.host}`;
  const payloadHash = await sha256Hex(body);
  const all: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp, ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v.trim()])) };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((n) => `${n}:${all[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const q = canonicalQuery(query);
  const canonical = [method, path, q, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonical)].join('\n');
  const signature = hex(await hmac(await signingKey(cfg, date), toSign));
  return { url: `${base.protocol}//${host}${path}${q ? `?${q}` : ''}`, headers: { ...extraHeaders, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp, Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` } };
}

// ---- S3-Zugriffe ---------------------------------------------------------------------------------------
async function s3Put(env: BackupEnv, key: string, body: Uint8Array, contentType: string) {
  const { url, headers } = await signHeaders(env.s3, 'PUT', `/${encodePath(key)}`, {}, body, { 'content-type': contentType });
  const r = await env.fetch(url, { method: 'PUT', headers, body: body as BodyInit });
  if (!r.ok) throw new Error(`Hetzner PUT ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
async function s3Get(env: BackupEnv, key: string): Promise<Uint8Array> {
  const { url, headers } = await signHeaders(env.s3, 'GET', `/${encodePath(key)}`, {});
  const r = await env.fetch(url, { headers });
  if (!r.ok) throw new Error(`Hetzner GET ${key}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
async function s3Delete(env: BackupEnv, key: string) {
  const { url, headers } = await signHeaders(env.s3, 'DELETE', `/${encodePath(key)}`, {});
  const r = await env.fetch(url, { method: 'DELETE', headers });
  if (!r.ok && r.status !== 404) throw new Error(`Hetzner DELETE ${key}: ${r.status}`);
}
/** Alle Schlüssel unter einem Präfix (ListObjectsV2, seitenweise) */
async function s3List(env: BackupEnv, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const q: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
    if (token) q['continuation-token'] = token;
    const { url, headers } = await signHeaders(env.s3, 'GET', '/', q);
    const r = await env.fetch(url, { headers });
    const xml = await r.text();
    if (!r.ok) throw new Error(`Hetzner LIST: ${r.status} ${xml.slice(0, 200)}`);
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] ?? null) : null;
  } while (token);
  return keys;
}

// ---- Packen ------------------------------------------------------------------------------------------
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = (text: string) => pipe(enc.encode(text), new CompressionStream('gzip'));
export const gunzip = async (data: Uint8Array) => new TextDecoder().decode(await pipe(data, new DecompressionStream('gzip')));

// ---- Datenbank (PostgREST mit vollem Lesezugriff) ---------------------------------------------------------
function dbHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  // alter Schlüssel (JWT „eyJ…“) zusätzlich als Bearer; neuer Secret Key nur als apikey
  return { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), ...extra };
}
async function readTable(env: BackupEnv, t: (typeof TABLES)[number]): Promise<unknown[] | null> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const r = await env.fetch(`${env.url}/rest/v1/${t.name}?select=*&order=${t.order}&limit=${PAGE}&offset=${offset}`, { headers: dbHeaders(env.key) });
    if (r.status === 404) return null; // Tabelle gibt es (noch) nicht – z. B. Kontaktformular nicht eingerichtet
    if (!r.ok) throw new Error(`Datenbank ${t.name}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const page = (await r.json()) as unknown[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** Welche Sicherungsdaten bleiben: die neuesten 30 Tage und der 1. jedes Monats aus den letzten 12 Monaten */
export function keepDates(dates: string[], today: string, days = 30, months = 12): Set<string> {
  const sorted = [...new Set(dates)].sort().reverse();
  const keep = new Set(sorted.slice(0, days));
  const t = new Date(`${today}T00:00:00Z`);
  const limit = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - months, 1)).toISOString().slice(0, 10);
  for (const d of sorted) if (d.endsWith('-01') && d >= limit) keep.add(d);
  return keep;
}
const dateOfKey = (k: string) => k.slice(PREFIX.length, PREFIX.length + 10);

/** Sicherung erstellen; liefert Anzahl Zeilen je Tabelle und gelöschte alte Stände */
export async function runBackup(env: BackupEnv) {
  const now = env.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const counts: Record<string, number> = {};
  let bytes = 0;
  for (const t of TABLES) {
    const rows = await readTable(env, t);
    if (!rows) continue;
    const data = await gzip(rows.map((x) => JSON.stringify(x)).join('\n'));
    await s3Put(env, `${PREFIX}${day}/${t.name}.ndjson.gz`, data, 'application/gzip');
    counts[t.name] = rows.length;
    bytes += data.length;
  }
  // Manifest zuletzt: nur vollständige Sicherungen haben eines
  await s3Put(env, `${PREFIX}${day}/manifest.json`, enc.encode(JSON.stringify({ createdAt: now.toISOString(), counts, bytes }, null, 1)), 'application/json');
  const keys = await s3List(env, PREFIX);
  const keep = keepDates(keys.map(dateOfKey), day);
  const old = keys.filter((k) => !keep.has(dateOfKey(k)));
  for (const k of old) await s3Delete(env, k);
  return { date: day, counts, bytes, removed: [...new Set(old.map(dateOfKey))] };
}

/** Vorhandene vollständige Sicherungen (mit Manifest), neueste zuerst */
export async function listBackups(env: BackupEnv): Promise<string[]> {
  const keys = await s3List(env, PREFIX);
  return [...new Set(keys.filter((k) => k.endsWith('/manifest.json')).map(dateOfKey))].sort().reverse();
}

/** Datensätze und Foto-Verzeichnis aus einer Sicherung zurückschreiben (Einfügen/Überschreiben, kein Löschen) */
export async function restoreBackup(env: BackupEnv, date: string, opts: { workspace?: string; tables?: string[] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Datum JJJJ-MM-TT angeben');
  const wanted = TABLES.filter((t) => t.restorable && (!opts.tables?.length || opts.tables.includes(t.name)));
  const restored: Record<string, number> = {};
  for (const t of wanted) {
    const text = await gunzip(await s3Get(env, `${PREFIX}${date}/${t.name}.ndjson.gz`));
    let rows = text ? text.split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) : [];
    if (opts.workspace) rows = rows.filter((r) => r.workspace_id === opts.workspace);
    for (let i = 0; i < rows.length; i += 500) {
      // updated_at wird von der Datenbank neu gesetzt – so holen alle Geräte den wiederhergestellten Stand
      const batch = rows.slice(i, i + 500).map(({ updated_at: _u, ...rest }) => rest);
      const r = await env.fetch(`${env.url}/rest/v1/${t.name}?on_conflict=${t.conflict}`, {
        method: 'POST',
        headers: dbHeaders(env.key, { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(batch),
      });
      if (!r.ok) throw new Error(`Wiederherstellen ${t.name}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    restored[t.name] = rows.length;
  }
  return { date, workspace: opts.workspace ?? null, restored };
}

// ---- Einstieg ------------------------------------------------------------------------------------------
/** Zeichenketten in konstanter Zeit vergleichen (Geheimwort) */
function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handle(req: Request, getEnv: (name: string) => string | undefined, fetchFn: FetchLike): Promise<Response> {
  if (req.method !== 'POST') return reply(405, { error: 'method' });
  const token = getEnv('BACKUP_TOKEN');
  const endpoint = getEnv('HETZNER_S3_ENDPOINT');
  const bucket = getEnv('HETZNER_S3_BUCKET');
  const accessKey = getEnv('HETZNER_S3_KEY');
  const secretKey = getEnv('HETZNER_S3_SECRET');
  const url = getEnv('SUPABASE_URL');
  const key = getEnv('BACKUP_SERVICE_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!token || token.length < 16 || !endpoint || !bucket || !accessKey || !secretKey || !url || !key) return reply(501, { error: 'not-configured' });
  if (!sameSecret(req.headers.get('x-backup-token') ?? '', token)) return reply(401, { error: 'token' });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* leer = run */
  }
  const env: BackupEnv = { s3: { endpoint, bucket, accessKey, secretKey, region: getEnv('HETZNER_S3_REGION') ?? 'eu-central' }, url, key, fetch: fetchFn };
  try {
    const action = (body.action as string) ?? 'run';
    if (action === 'run') return reply(200, await runBackup(env));
    if (action === 'list') return reply(200, { dates: await listBackups(env) });
    if (action === 'restore') return reply(200, await restoreBackup(env, String(body.date ?? ''), { workspace: body.workspace as string | undefined, tables: body.tables as string[] | undefined }));
    return reply(422, { error: 'action' });
  } catch (e) {
    return reply(502, { error: e instanceof Error ? e.message : String(e) });
  }
}

// In Supabase (Deno) starten; in Tests (Node) wird nur handle() benutzt
const deno = (globalThis as { Deno?: { serve(h: (req: Request) => Promise<Response>): void; env: { get(name: string): string | undefined } } }).Deno;
if (deno) deno.serve((req) => handle(req, (n) => deno.env.get(n), (u, i) => fetch(u, i)));
