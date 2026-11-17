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
//   status   {}                                   → Einstellungen: verschlüsselt, eigener Speicher, Sperre (Object Lock)
//   setup    {}                                   → eigener Speicher: Regel zum Aufräumen alter Versionen setzen (einmalig)
//
// Schutz der Sicherungen (17.11.2026, alles über Secrets, ohne = wie bisher):
//   BACKUP_KEY        32 Byte als Base64 (openssl rand -base64 32) → jede Datei AES-256-GCM verschlüsselt (.enc);
//                     ohne diesen Schlüssel lassen sich die Sicherungen nicht mehr lesen – zusätzlich offline aufbewahren
//   BACKUP_S3_BUCKET  eigener Bucket nur für Sicherungen (am besten in einem eigenen Hetzner-Projekt mit eigenen
//                     Schlüsseln BACKUP_S3_KEY/BACKUP_S3_SECRET, optional BACKUP_S3_ENDPOINT/BACKUP_S3_REGION);
//                     alte Sicherungen im Bucket der Ablage werden dann nur noch aufgeräumt (und bleiben lesbar)
//   BACKUP_LOCK_MODE  GOVERNANCE oder COMPLIANCE: jede Datei wird gesperrt (Object Lock), bis sie laut Aufbewahrung
//                     wegfallen darf – niemand kann sie vorher löschen oder überschreiben (Bucket mit Object Lock anlegen)
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
  /** Ziel der Sicherungen (eigener Speicher oder der Bucket der Ablage) */
  s3: S3Config;
  /** Bucket der Ablage, wenn ein eigener Speicher eingerichtet ist: ältere Sicherungen dort lesen und aufräumen */
  legacy?: S3Config | null;
  /** Schlüssel für AES-256-GCM (BACKUP_KEY); ohne = unverschlüsselt */
  cryptoKey?: CryptoKey | null;
  /** Sperre je Datei (Object Lock) */
  lockMode?: 'GOVERNANCE' | 'COMPLIANCE' | null;
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

/** MD5 (Base64) – verlangt S3 bei gesperrten Dateien und bei Bucket-Regeln (Content-MD5); WebCrypto kennt kein MD5 */
export function md5Base64(bytes: Uint8Array): string {
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const len = bytes.length;
  const padded = new Uint8Array((((len + 8) >> 6) << 6) + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true);
  ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true);
  ov.setUint32(12, d0, true);
  return btoa(String.fromCharCode(...out));
}

// ---- Verschlüsselung (AES-256-GCM): „BPK1“ + 12 Byte IV + verschlüsselte Daten mit Prüfsumme -------------------
const MAGIC = enc.encode('BPK1');
/** Schlüssel aus BACKUP_KEY (32 Byte als Base64) */
export async function importBackupKey(b64: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('BACKUP_KEY ist kein Base64');
  }
  if (raw.length !== 32) throw new Error('BACKUP_KEY muss 32 Byte lang sein (openssl rand -base64 32)');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, data as BufferSource));
  const out = new Uint8Array(MAGIC.length + iv.length + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + iv.length);
  return out;
}
export async function decryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  if (data.length < 4 + 12 + 16 || MAGIC.some((b, i) => data[i] !== b)) throw new Error('keine verschlüsselte BauPad-Sicherung');
  const iv = data.slice(4, 16);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, data.slice(16) as BufferSource));
  } catch {
    throw new Error('Entschlüsseln fehlgeschlagen – falscher BACKUP_KEY oder beschädigte Datei');
  }
}

/** Sperre bis: Tagesstände gut einen Monat, Monatsstände (1. des Monats) gut 13 Monate – passend zur Aufbewahrung */
export function retainUntil(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (day.endsWith('-01') ? 400 : 32));
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---- S3-Zugriffe ---------------------------------------------------------------------------------------
async function s3Put(env: BackupEnv, cfg: S3Config, key: string, body: Uint8Array, contentType: string, lockUntil?: string) {
  const extra: Record<string, string> = { 'content-type': contentType };
  if (env.lockMode && lockUntil) Object.assign(extra, { 'content-md5': md5Base64(body), 'x-amz-object-lock-mode': env.lockMode, 'x-amz-object-lock-retain-until-date': lockUntil });
  const { url, headers } = await signHeaders(cfg, 'PUT', `/${encodePath(key)}`, {}, body, extra);
  const r = await env.fetch(url, { method: 'PUT', headers, body: body as BodyInit });
  if (!r.ok) throw new Error(`Hetzner PUT ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
/** Datei lesen; null = nicht vorhanden */
async function s3Get(env: BackupEnv, cfg: S3Config, key: string): Promise<Uint8Array | null> {
  const { url, headers } = await signHeaders(cfg, 'GET', `/${encodePath(key)}`, {});
  const r = await env.fetch(url, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Hetzner GET ${key}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
/** Löschen; bei gesperrten Dateien (Object Lock) setzt S3 nur eine Löschmarke – die Datei bleibt bis zum Ablauf */
async function s3Delete(env: BackupEnv, cfg: S3Config, key: string) {
  const { url, headers } = await signHeaders(cfg, 'DELETE', `/${encodePath(key)}`, {});
  const r = await env.fetch(url, { method: 'DELETE', headers });
  if (!r.ok && r.status !== 404) throw new Error(`Hetzner DELETE ${key}: ${r.status}`);
}
/** Alle Schlüssel unter einem Präfix (ListObjectsV2, seitenweise) */
async function s3List(env: BackupEnv, cfg: S3Config, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | null = null;
  do {
    const q: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
    if (token) q['continuation-token'] = token;
    const { url, headers } = await signHeaders(cfg, 'GET', '/', q);
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
/** Alter Ort (nach dem Umzug in den eigenen Speicher): Tagesstände der letzten 30 Kalendertage, Monatsstände 12 Monate */
export function keepLegacyDates(dates: string[], today: string): Set<string> {
  const t = new Date(`${today}T00:00:00Z`);
  const from = new Date(t.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const monthly = keepDates(dates, today, 0);
  return new Set(dates.filter((d) => d > from || monthly.has(d)));
}
const dateOfKey = (k: string) => k.slice(PREFIX.length, PREFIX.length + 10);

/** Sicherung erstellen; liefert Anzahl Zeilen je Tabelle und gelöschte alte Stände */
export async function runBackup(env: BackupEnv) {
  const now = env.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const counts: Record<string, number> = {};
  let bytes = 0;
  const files: Record<string, string> = {};
  const lock = retainUntil(day);
  for (const t of TABLES) {
    const rows = await readTable(env, t);
    if (!rows) continue;
    const packed = await gzip(rows.map((x) => JSON.stringify(x)).join('\n'));
    const data = env.cryptoKey ? await encryptBytes(env.cryptoKey, packed) : packed;
    const file = `${t.name}.ndjson.gz${env.cryptoKey ? '.enc' : ''}`;
    await s3Put(env, env.s3, `${PREFIX}${day}/${file}`, data, env.cryptoKey ? 'application/octet-stream' : 'application/gzip', lock);
    files[t.name] = file;
    counts[t.name] = rows.length;
    bytes += data.length;
  }
  // Manifest zuletzt: nur vollständige Sicherungen haben eines (Anzahlen und Dateinamen, keine Inhalte)
  const manifest = { createdAt: now.toISOString(), counts, bytes, encrypted: !!env.cryptoKey, files, lockedUntil: env.lockMode ? lock : null };
  await s3Put(env, env.s3, `${PREFIX}${day}/manifest.json`, enc.encode(JSON.stringify(manifest, null, 1)), 'application/json', lock);
  const keys = await s3List(env, env.s3, PREFIX);
  const keep = keepDates(keys.map(dateOfKey), day);
  const old = keys.filter((k) => !keep.has(dateOfKey(k)));
  for (const k of old) await s3Delete(env, env.s3, k);
  // alter Ort (Bucket der Ablage, unverschlüsselt): läuft nach der Aufbewahrung aus
  let legacyRemoved: string[] = [];
  if (env.legacy) {
    const lk = await s3List(env, env.legacy, PREFIX);
    const lkeep = keepLegacyDates(lk.map(dateOfKey), day);
    const lold = lk.filter((k) => !lkeep.has(dateOfKey(k)));
    for (const k of lold) await s3Delete(env, env.legacy, k);
    legacyRemoved = [...new Set(lold.map(dateOfKey))];
  }
  return { date: day, counts, bytes, encrypted: !!env.cryptoKey, locked: env.lockMode ? { mode: env.lockMode, until: lock } : null, separate: !!env.legacy, removed: [...new Set(old.map(dateOfKey))], ...(env.legacy ? { legacyRemoved } : {}) };
}

const manifestDates = (keys: string[]) => keys.filter((k) => k.endsWith('/manifest.json')).map(dateOfKey);
/** Vorhandene vollständige Sicherungen (mit Manifest), neueste zuerst – eigener Speicher und alter Ort */
export async function listBackups(env: BackupEnv): Promise<string[]> {
  const dates = manifestDates(await s3List(env, env.s3, PREFIX));
  if (env.legacy) dates.push(...manifestDates(await s3List(env, env.legacy, PREFIX)));
  return [...new Set(dates)].sort().reverse();
}

interface Manifest {
  encrypted?: boolean;
  files?: Record<string, string>;
}
/** Manifest einer Sicherung und wo sie liegt (eigener Speicher zuerst, dann alter Ort) */
async function findBackup(env: BackupEnv, date: string): Promise<{ cfg: S3Config; manifest: Manifest }> {
  for (const cfg of [env.s3, env.legacy].filter(Boolean) as S3Config[]) {
    const raw = await s3Get(env, cfg, `${PREFIX}${date}/manifest.json`);
    if (!raw) continue;
    try {
      return { cfg, manifest: JSON.parse(new TextDecoder().decode(raw)) as Manifest };
    } catch {
      return { cfg, manifest: {} };
    }
  }
  throw new Error(`keine Sicherung vom ${date}`);
}

/** Datensätze und Foto-Verzeichnis aus einer Sicherung zurückschreiben (Einfügen/Überschreiben, kein Löschen) */
export async function restoreBackup(env: BackupEnv, date: string, opts: { workspace?: string; tables?: string[] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Datum JJJJ-MM-TT angeben');
  const wanted = TABLES.filter((t) => t.restorable && (!opts.tables?.length || opts.tables.includes(t.name)));
  const restored: Record<string, number> = {};
  const { cfg, manifest } = await findBackup(env, date);
  if (manifest.encrypted && !env.cryptoKey) throw new Error('Sicherung ist verschlüsselt – Secret BACKUP_KEY fehlt');
  for (const t of wanted) {
    const raw = await s3Get(env, cfg, `${PREFIX}${date}/${manifest.files?.[t.name] ?? `${t.name}.ndjson.gz`}`);
    if (!raw) throw new Error(`Sicherung ${date}: ${t.name} fehlt`);
    const text = await gunzip(manifest.encrypted ? await decryptBytes(env.cryptoKey!, raw) : raw);
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

/** Einstellungen der Sicherung und ob der Bucket Sperren (Object Lock) kann */
export async function backupStatus(env: BackupEnv) {
  const { url, headers } = await signHeaders(env.s3, 'GET', '/', { 'object-lock': '' });
  const r = await env.fetch(url, { headers });
  const xml = r.ok ? await r.text() : '';
  return {
    encrypted: !!env.cryptoKey,
    separate: !!env.legacy,
    bucket: env.s3.bucket,
    lockMode: env.lockMode ?? null,
    bucketObjectLock: /<ObjectLockEnabled>Enabled<\/ObjectLockEnabled>/.test(xml),
  };
}
/** Regel im Sicherungs-Bucket: gelöschte (abgelaufene) Versionen nach einem Tag entfernen, leere Löschmarken aufräumen */
export async function setupBucket(env: BackupEnv) {
  const rules = `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Rule><ID>baupad-alte-sicherungen</ID><Filter><Prefix>${PREFIX}</Prefix></Filter><Status>Enabled</Status><Expiration><ExpiredObjectDeleteMarker>true</ExpiredObjectDeleteMarker></Expiration><NoncurrentVersionExpiration><NoncurrentDays>1</NoncurrentDays></NoncurrentVersionExpiration></Rule></LifecycleConfiguration>`;
  const body = enc.encode(rules);
  const { url, headers } = await signHeaders(env.s3, 'PUT', '/', { lifecycle: '' }, body, { 'content-type': 'application/xml', 'content-md5': md5Base64(body) });
  const r = await env.fetch(url, { method: 'PUT', headers, body: body as BodyInit });
  const text = await r.text();
  if (!r.ok) throw new Error(`Hetzner Lifecycle: ${r.status} ${text.slice(0, 200)}`);
  return { ok: true, lifecycle: 'baupad-alte-sicherungen', ...(await backupStatus(env)) };
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
  const main: S3Config = { endpoint, bucket, accessKey, secretKey, region: getEnv('HETZNER_S3_REGION') ?? 'eu-central' };
  // eigener Speicher für Sicherungen (fehlende Angaben wie bei der Ablage)
  const sepBucket = getEnv('BACKUP_S3_BUCKET');
  const target: S3Config = sepBucket
    ? { endpoint: getEnv('BACKUP_S3_ENDPOINT') || endpoint, bucket: sepBucket, region: getEnv('BACKUP_S3_REGION') || main.region, accessKey: getEnv('BACKUP_S3_KEY') || accessKey, secretKey: getEnv('BACKUP_S3_SECRET') || secretKey }
    : main;
  const lock = (getEnv('BACKUP_LOCK_MODE') ?? '').trim().toUpperCase();
  if (lock && lock !== 'GOVERNANCE' && lock !== 'COMPLIANCE') return reply(501, { error: 'BACKUP_LOCK_MODE: GOVERNANCE oder COMPLIANCE' });
  let cryptoKey: CryptoKey | null = null;
  const rawKey = getEnv('BACKUP_KEY');
  if (rawKey) {
    try {
      cryptoKey = await importBackupKey(rawKey);
    } catch (e) {
      return reply(501, { error: e instanceof Error ? e.message : String(e) }); // lieber keine Sicherung als eine unverschlüsselte
    }
  }
  const env: BackupEnv = {
    s3: target,
    legacy: sepBucket && (target.bucket !== main.bucket || target.endpoint !== main.endpoint) ? main : null,
    cryptoKey,
    lockMode: (lock || null) as BackupEnv['lockMode'],
    url,
    key,
    fetch: fetchFn,
  };
  try {
    const action = (body.action as string) ?? 'run';
    if (action === 'run') return reply(200, await runBackup(env));
    if (action === 'list') return reply(200, { dates: await listBackups(env) });
    if (action === 'status') return reply(200, await backupStatus(env));
    if (action === 'setup') return reply(200, await setupBucket(env));
    if (action === 'restore') return reply(200, await restoreBackup(env, String(body.date ?? ''), { workspace: body.workspace as string | undefined, tables: body.tables as string[] | undefined }));
    return reply(422, { error: 'action' });
  } catch (e) {
    return reply(502, { error: e instanceof Error ? e.message : String(e) });
  }
}

// In Supabase (Deno) starten; in Tests (Node) wird nur handle() benutzt
const deno = (globalThis as { Deno?: { serve(h: (req: Request) => Promise<Response>): void; env: { get(name: string): string | undefined } } }).Deno;
if (deno) deno.serve((req) => handle(req, (n) => deno.env.get(n), (u, i) => fetch(u, i)));
