// Supabase Edge Function „storage“: Tor zur zentralen Ablage (Hetzner Object Storage, S3-kompatibel).
// Die App bekommt nie die Hetzner-Schlüssel. Jede Anfrage trägt die Anmeldung des Benutzers (JWT);
// die Funktion ermittelt seinen Arbeitsbereich und erlaubt nur Dateien unter ws/<arbeitsbereich>/…
//
// Aktionen (POST, JSON { action, ... }):
//   presign     { items: [{ key, method: 'GET'|'PUT'|'HEAD', contentType? }] }  → kurzlebige Links
//               (Schlüssel photos/<id>/… für Fotos, files/<id>/… für Originalpläne, Planbilder, Formular-PDFs)
//   upsert      { photos: [{ id, data, size, has_original, uploaded, deleted_at? }] } → Verzeichnis schreiben
//   pull        { since: ISO-Zeit | null }                                          → geänderte Einträge seit …
//   records-upsert { records: [{ store, id, data, rev, deleted_at? }] }            → Datensätze aller Werkzeuge (Tabelle records)
//   records-pull   { since: ISO-Zeit | null, after: id }                           → Datensätze seit Cursor (Zeit + Kennung), 500 je Seite;
//                  Antwort mit cursor/more. Zeitaufzeichnung: Polier nur Zeilen seiner Projekte, Arbeiter nur eigene Tage (s. TIME_STORES)
//   delete      { keys: [...] }                                                     → Dateien löschen (Server)
//   Rechte: Admin, Büro und Betreiber alles; Polier und Arbeiter nur freigegebene Projekte, firmenweite Daten nur mit dem
//           passenden Werkzeug, Preise nur mit „Preise und Summen“ (s. accessOf) – lesen, schreiben, Fotos und Dateien
//   usage       {}                                                                  → Belegung: total (alle Dateien im Bucket unter ws/<id>/
//                                                                                   + Datensätze), photoBytes, fileBytes, dataBytes; photos = Anzahl
//   status      {}  (nur Betreiber)  → prüft Zugangsdaten gegen den Bucket
//   setup-cors  {}  (nur Betreiber)  → CORS-Regeln am Bucket setzen (Browser darf direkt hoch-/herunterladen)
//
// Secrets: HETZNER_S3_ENDPOINT (https://nbg1.your-objectstorage.com), HETZNER_S3_BUCKET, HETZNER_S3_REGION (eu-central),
//          HETZNER_S3_KEY, HETZNER_S3_SECRET. „Verify JWT“ AUS (die Funktion prüft die Anmeldung selbst; sonst scheitert die Browser-Voranfrage).
// Einrichtung: docs/ablage-einrichten.md

type Method = 'GET' | 'PUT' | 'HEAD';
interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

// ---- Signatur V4 (Kopie von src/lib/s3-sign.ts – dort getestet) ---------------------------------
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
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
function objectUrl(cfg: S3Config, key: string) {
  const base = new URL(cfg.endpoint);
  const host = `${cfg.bucket}.${base.host}`;
  const path = `/${encodePath(key)}`;
  return { host, path, url: `${base.protocol}//${host}${path}` };
}
async function presign(cfg: S3Config, method: Method, key: string, opts: { expires?: number; contentType?: string } = {}) {
  const { stamp, date } = amzDate();
  const { host, path, url } = objectUrl(cfg, key);
  const signedHeaders = opts.contentType ? 'content-type;host' : 'host';
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKey}/${date}/${cfg.region}/s3/aws4_request`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(opts.expires ?? 600),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const query = canonicalQuery(params);
  const headers = (opts.contentType ? `content-type:${opts.contentType}\n` : '') + `host:${host}\n`;
  const canonical = [method, path, query, headers, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonical)].join('\n');
  const signature = hex(await hmac(await signingKey(cfg, date), toSign));
  return `${url}?${query}&X-Amz-Signature=${signature}`;
}
async function signHeaders(cfg: S3Config, method: string, path: string, query: Record<string, string>, body: string | ArrayBuffer = '', extraHeaders: Record<string, string> = {}) {
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

// ---- MD5 (Content-MD5 für PutBucketCors; Web Crypto kennt kein MD5) ----
function md5Base64(input: string): string {
  const bytes = enc.encode(input);
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
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return btoa(String.fromCharCode(...out));
}

// ---- Hilfen -----------------------------------------------------------------------------------
// https://localhost = Android-Store-App, capacitor://localhost = iOS-Store-App (Capacitor)
const ALLOWED_ORIGINS = ['https://pad-software.at', 'https://www.pad-software.at', 'https://localhost', 'capacitor://localhost', 'http://localhost:5173', 'http://localhost:4173'];
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});
const json = (status: number, body: unknown, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

function config(): S3Config | null {
  const endpoint = Deno.env.get('HETZNER_S3_ENDPOINT');
  const bucket = Deno.env.get('HETZNER_S3_BUCKET');
  const accessKey = Deno.env.get('HETZNER_S3_KEY');
  const secretKey = Deno.env.get('HETZNER_S3_SECRET');
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return { endpoint, bucket, region: Deno.env.get('HETZNER_S3_REGION') ?? 'eu-central', accessKey, secretKey };
}

/** Arbeitsbereich und Betreiber-Kennzeichen des angemeldeten Benutzers (über my_context mit seinem JWT, RLS gilt) */
export interface Ctx {
  ws: string | null;
  operator: boolean;
  token: string;
  role: string;
  email: string;
  sites: string[];
  toolSites: Record<string, string[]>;
  /** freigegebene Werkzeuge; leer = alle */
  tools: string[];
}
/** E-Mail aus dem (von my_context schon geprüften) Anmelde-Token */
function tokenEmail(token: string): string {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return String((JSON.parse(atob(part)) as { email?: string }).email ?? '').trim().toLowerCase();
  } catch {
    return '';
  }
}
async function context(req: Request): Promise<Ctx | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/my_context`, {
    method: 'POST',
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) return null;
  const ctx = (await r.json()) as { workspace_id: string | null; operator: boolean; role?: string; sites?: string[]; tool_sites?: Record<string, string[]>; tools?: string[] } | null;
  return { ws: ctx?.workspace_id ?? null, operator: Boolean(ctx?.operator), token, role: ctx?.role ?? '', email: tokenEmail(token), sites: ctx?.sites ?? [], toolSites: ctx?.tool_sites ?? {}, tools: ctx?.tools ?? [] };
}

/** Belegung der Ablage: Größe aller Dateien unter `prefix` (ListObjectsV2, 1000 je Seite), davon unter photos/ */
export async function bucketBytes(cfg: S3Config, prefix: string): Promise<{ total: number; photos: number; count: number }> {
  let token = '';
  let total = 0;
  let photos = 0;
  let count = 0;
  for (let page = 0; page < 200; page++) {
    const q: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
    if (token) q['continuation-token'] = token;
    const { url, headers } = await signHeaders(cfg, 'GET', '/', q);
    const r = await fetch(url, { headers });
    const xml = await r.text();
    if (!r.ok) throw new Error(`list ${r.status} ${xml.slice(0, 200)}`);
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1] ?? '';
      const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0);
      total += size;
      count++;
      if (key.startsWith(`${prefix}photos/`)) photos += size;
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    token = (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '').replace(/&amp;/g, '&');
    if (!token) break;
  }
  return { total, photos, count };
}

/** Datenbankzugriff mit der Anmeldung des Benutzers (Zugriffsregeln der Tabelle gelten) */
async function rest(token: string, path: string, init: RequestInit & { prefer?: string } = {}) {
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.prefer ? { Prefer: init.prefer } : {}), ...(init.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// ---- Zeitaufzeichnung: wer bekommt welche Stunden ------------------------------------------------
// Büro (Admin, Büro, Betreiber): alles. Polier: nur Zeilen auf seinen Projekten (Freigabe „Zeitaufzeichnung“, sonst
// „Arbeitereinteilung“, sonst Baustellenliste; leer = alle). Arbeiter: nur Tage der Arbeiter, deren hinterlegte
// Konto-E-Mail (Personalliste, userEmail) zu seiner Anmeldung passt; er trägt auch nur diese Tage ein – nicht in einem
// vom Büro freigegebenen Monat (ownTimeDayAllowed).
// Die Tabelle `records` lässt Zeitdaten nur für das Büro zu (docs/supabase/time-access.sql) – Polier und Arbeiter
// bekommen sie ausschließlich gefiltert über diese Funktion (mit dem Dienstschlüssel).
export const TIME_STORES = ['timeDays', 'timeMonths'];
type TimeLine = { projectId: string | null; siteName: string; [k: string]: unknown };
export type TimeScope = { level: 'office' } | { level: 'site'; sites: string[] } | { level: 'own'; email: string };
export function timeScopeOf(c: Pick<Ctx, 'operator' | 'role' | 'email' | 'sites' | 'toolSites'>): TimeScope {
  if (c.operator || c.role === 'admin' || c.role === 'buero' || !c.role) return { level: 'office' };
  if (c.role === 'polier') {
    const t = c.toolSites?.times ?? [];
    const w = c.toolSites?.workers ?? [];
    return { level: 'site', sites: t.length ? t : w.length ? w : (c.sites ?? []) };
  }
  return { level: 'own', email: c.email };
}
const siteKey = (l: TimeLine) => (l.projectId ? `p:${l.projectId}` : `n:${String(l.siteName ?? '').trim().toLowerCase()}`);
const lineOk = (l: TimeLine, scope: TimeScope) => scope.level === 'office' || (scope.level === 'site' && (!scope.sites.length || scope.sites.includes(siteKey(l))));
type Row = { store: string; id: string; data: Record<string, unknown>; updated_at: string; deleted_at: string | null; [k: string]: unknown };
/** Zeit-Datensatz für eine eingeschränkte Person: zugeschnitten, oder als „gelöscht“ (damit alte Kopien verschwinden) */
export function filterTimeRow(row: Row, scope: TimeScope, ownWorkers: Set<string>): Row {
  if (scope.level === 'office' || row.deleted_at) return row;
  const gone = { ...row, data: {}, deleted_at: row.updated_at };
  if (scope.level === 'own') return ownWorkers.has(String(row.data.workerId ?? '')) ? row : gone;
  if (row.store !== 'timeDays') return gone; // Monatsfreigaben nur für das Büro
  const lines = ((row.data.lines as TimeLine[]) ?? []).filter((l) => lineOk(l, scope));
  return lines.length ? { ...row, data: { ...row.data, lines } } : gone;
}
/** Speichern durch den Polier: seine Zeilen ersetzen, Zeilen anderer Projekte aus dem gespeicherten Stand bleiben */
export function mergeTimeDay(existing: Record<string, unknown> | null, incoming: Record<string, unknown>, deleted: boolean, scope: TimeScope): { data: Record<string, unknown>; deleted: boolean } {
  const hidden = ((existing?.lines as TimeLine[]) ?? []).filter((l) => !lineOk(l, scope));
  const mine = deleted ? [] : ((incoming.lines as TimeLine[]) ?? []).filter((l) => lineOk(l, scope));
  if (deleted && !hidden.length) return { data: {}, deleted: true };
  return { data: { ...(existing ?? {}), ...(deleted ? {} : incoming), lines: [...hidden, ...mine] }, deleted: false };
}
/**
 * Speichern durch den Arbeiter: nur Tage der eigenen Person (Kennung „<Arbeiter>|<Datum>“, Angaben passend dazu) und
 * nicht in einem vom Büro freigegebenen Monat (`approved`: Kennungen „<Arbeiter>|<Monat>“).
 */
export function ownTimeDayAllowed(id: string, data: Record<string, unknown>, deleted: boolean, own: Set<string>, approved: Set<string>): boolean {
  const [workerId, date = '', ...rest] = id.split('|');
  if (rest.length || !own.has(workerId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (!deleted && (String(data.workerId ?? '') !== workerId || String(data.date ?? '') !== date)) return false;
  return !approved.has(`${workerId}|${date.slice(0, 7)}`);
}

// ---- Rechte je Projekt, Werkzeug und Preise (am Server wie in der App: src/lib/access.ts, src/lib/price-access.ts) --------
// Admin, Büro und Betreiber („Büro“) sehen und ändern alles. Polier und Arbeiter:
//  - Datensätze eines Projekts nur, wenn das Projekt für sie freigegeben ist (gemeinsame Liste „sites“ oder bei einem
//    Werkzeug ausgewählt); sonst bekommen sie ihn als „gelöscht“ (alte Kopien verschwinden vom Gerät) und dürfen ihn
//    nicht speichern. Projekte anlegen und löschen: nur das Büro (wie in der App).
//  - firmenweite Daten nur mit einem passenden Werkzeug: Personalliste mit Team, Zeiten oder Berichte (Mannschaft im
//    Tagesbericht; Arbeiter mit nur „Zeiten“ sehen nur sich selbst), Wochen-Einteilung mit Team, Zeiten, Berichte oder
//    Fotos, Materialstamm und Lieferanten mit Material, Formularvorlagen (nur lesen) mit Berichte
//  - SV-Nummer der Arbeiter nur für das Büro: Polier und Arbeiter bekommen sie nicht, beim Speichern bleibt die gespeicherte
//  - Preise (LV, Material) nur mit der Freigabe „Preise und Summen“; ohne sie kommen Preise leer, und beim Speichern
//    bleiben die gespeicherten Preise erhalten (sie können sie weder sehen noch ändern)
// Die Tabellen records und photos lassen Polier und Arbeiter nicht direkt zu (docs/supabase/records-access.sql) – sie
// lesen und schreiben ausschließlich über diese Funktion (Dienstschlüssel, gefiltert).
export const PRICES_PERM = 'perm:prices';
export interface Access {
  office: boolean;
  role: string;
  email: string;
  tools: string[];
  sites: string[];
  toolSites: Record<string, string[]>;
  prices: boolean;
}
export function accessOf(c: Pick<Ctx, 'operator' | 'role' | 'email' | 'sites' | 'toolSites'> & { tools?: string[] | null }): Access {
  const office = c.operator || c.role === 'admin' || c.role === 'buero' || !c.role;
  const toolSites = c.toolSites ?? {};
  return { office, role: c.role, email: (c.email ?? '').toLowerCase(), tools: c.tools ?? [], sites: c.sites ?? [], toolSites, prices: office || (toolSites[PRICES_PERM]?.length ?? 0) > 0 };
}
/** Werkzeug freigegeben (leere Liste = alle; Zeiten gehörten früher zur Einteilung) */
export const hasTool = (a: Access, tool: string) => a.office || a.tools.length === 0 || a.tools.includes(tool) || (tool === 'times' && a.tools.includes('workers'));
const anyTool = (a: Access, tools: string[]) => tools.some((t) => hasTool(a, t));
/**
 * Projekt freigegeben: in der gemeinsamen Liste oder bei irgendeinem Werkzeug ausgewählt. Einträge ohne Projekt (frei
 * eingegebene Baustelle): wie in der App – ohne Auswahl sichtbar, sonst nur, wenn der Name ausgewählt ist.
 */
export function canProject(a: Access, projectId: string | null | undefined, name = '', tool?: string): boolean {
  if (a.office) return true;
  if (projectId) {
    const k = `p:${projectId}`;
    return a.sites.includes(k) || Object.entries(a.toolSites).some(([t, l]) => t !== PRICES_PERM && (l ?? []).includes(k));
  }
  const own = tool ? (a.toolSites[tool] ?? []) : [];
  const list = own.length ? own : a.sites;
  return list.length === 0 || list.includes(`n:${name.trim().toLowerCase()}`);
}
/** Datenarten, die zu einem Projekt gehören (Feld projectId; beim Projekt selbst die Kennung) */
export const PROJECT_STORES = ['projects', 'costCenters', 'files', 'plans', 'damages', 'components', 'elements', 'lvDocs', 'reports', 'defectPlans', 'formEntries', 'materialItems', 'materialUses', 'materialPlans'];
/** firmenweite Datenarten: lesen mit einem dieser Werkzeuge … */
const READ_TOOLS: Record<string, string[]> = { workers: ['workers', 'times', 'reports'], weeks: ['workers', 'times', 'reports', 'photos'], materials: ['materials'], suppliers: ['materials'], formTemplates: ['reports'] };
/** … speichern mit einem dieser (Formularvorlagen: nur das Büro) */
const WRITE_TOOLS: Record<string, string[]> = { workers: ['workers'], weeks: ['workers', 'times', 'reports'], materials: ['materials'], suppliers: ['materials'], formTemplates: [] };
/** Werkzeug je Datenart (für Einträge ohne Projekt: Auswahl bei diesem Werkzeug) */
const STORE_TOOL: Record<string, string> = { reports: 'reports', formEntries: 'reports', defectPlans: 'defects', materialItems: 'materials', materialUses: 'materials', materialPlans: 'materials' };
/** Firmen-Einstellungen, die Polier und Arbeiter speichern dürfen (Team und Zeiten); Firmendaten, Logo, gelöschte Projekte: nur das Büro */
const META_WRITE = ['absences', 'timeDefaults', 'workTimes', 'crewSiteLabel', 'pdfShowGrades', 'pdfShowTimes'];
const projectOfRow = (store: string, id: string, data: Record<string, unknown> | null | undefined) => (store === 'projects' ? id : ((data?.projectId as string | null | undefined) ?? null));
/** Baustellenname eines Eintrags ohne Projekt (Berichte: Kopf, sonst siteName) */
function nameOfRow(store: string, data: Record<string, unknown> | null | undefined): string {
  if (store === 'reports') {
    const h = (data?.head ?? {}) as { site?: string; project?: string };
    return String(h.site || h.project || '');
  }
  return String(data?.siteName ?? '');
}
const rowAllowed = (a: Access, store: string, id: string, data: Record<string, unknown> | null | undefined) => canProject(a, projectOfRow(store, id, data), nameOfRow(store, data), STORE_TOOL[store]);
/** Personalliste: alle (Team, Berichte, Polier mit Zeiten) oder nur der eigene Eintrag (Arbeiter mit Zeiten) */
const allWorkers = (a: Access) => hasTool(a, 'workers') || hasTool(a, 'reports') || (a.role === 'polier' && hasTool(a, 'times'));
const ownWorker = (a: Access, data: Record<string, unknown> | null | undefined) => !!a.email && String(data?.userEmail ?? '').toLowerCase() === a.email;
const goneRow = (row: Row): Row => ({ ...row, data: {}, deleted_at: row.updated_at });
/** Mängelplan: Projekt und Baustellenname (Mängelpunkte gehören zu ihrem Plan) */
export type PlanSite = { projectId: string | null; siteName: string };
const markAllowed = (a: Access, data: Record<string, unknown> | null | undefined, plans: Map<string, PlanSite>) => {
  const plan = plans.get(String(data?.planId ?? ''));
  return !!plan && canProject(a, plan.projectId, plan.siteName, 'defects');
};

/** Preise entfernen (LV: Einheits- und Positionspreise; Material und Positionen: Preis je Einheit) */
export function stripPrices(store: string, data: Record<string, unknown>): Record<string, unknown> {
  if (store === 'lvDocs') return { ...data, positions: ((data.positions as Record<string, unknown>[]) ?? []).map((p) => ({ ...p, unitPrice: null, totalPrice: null })) };
  if (store === 'materials' || store === 'materialItems') return { ...data, price: null };
  return data;
}
/** SV-Nummer der Arbeiter: nur Admin und Büro – für Polier und Arbeiter kommt sie nicht mit */
export function stripSv(data: Record<string, unknown>): Record<string, unknown> {
  if (!('svNumber' in data)) return data;
  const { svNumber: _, ...rest } = data;
  return rest;
}
/** Speichern durch Polier/Arbeiter: die gespeicherte SV-Nummer bleibt (sie können sie weder sehen noch ändern) */
export function keepSv(incoming: Record<string, unknown>, existing: Record<string, unknown> | null): Record<string, unknown> {
  const rest = stripSv(incoming);
  return existing?.svNumber ? { ...rest, svNumber: existing.svNumber } : rest;
}
/** ohne Preis-Freigabe gespeichert: Preise aus dem gespeicherten Stand übernehmen (neue Positionen ohne Preis) */
export function keepPrices(store: string, incoming: Record<string, unknown>, existing: Record<string, unknown> | null): Record<string, unknown> {
  if (store === 'lvDocs') {
    const old = new Map(((existing?.positions as Record<string, unknown>[]) ?? []).map((p) => [String(p.id), p]));
    return {
      ...incoming,
      positions: ((incoming.positions as Record<string, unknown>[]) ?? []).map((p) => {
        const o = old.get(String(p.id));
        return { ...p, unitPrice: (o?.unitPrice as number | null | undefined) ?? null, totalPrice: (o?.totalPrice as number | null | undefined) ?? null };
      }),
    };
  }
  if (store === 'materials' || store === 'materialItems') return { ...incoming, price: (existing?.price as number | null | undefined) ?? null };
  return incoming;
}

/** Datensatz für Polier/Arbeiter: unverändert, ohne Preise oder als „gelöscht“; Mängelpunkte über ihren Mängelplan */
export function visibleRecord(row: Row, a: Access, plans: Map<string, PlanSite> = new Map()): Row {
  if (a.office || row.deleted_at) return row;
  const s = row.store;
  if (s === 'meta') return row.id === 'absences' && !anyTool(a, ['workers', 'times', 'reports']) ? goneRow(row) : row;
  if (READ_TOOLS[s]) {
    if (!anyTool(a, READ_TOOLS[s])) return goneRow(row);
    if (s === 'workers') return allWorkers(a) || ownWorker(a, row.data) ? { ...row, data: stripSv(row.data) } : goneRow(row);
    return a.prices ? row : { ...row, data: stripPrices(s, row.data) };
  }
  if (s === 'defectMarks') return markAllowed(a, row.data, plans) ? row : goneRow(row);
  if (PROJECT_STORES.includes(s)) {
    if (!rowAllowed(a, s, row.id, row.data)) return goneRow(row);
    return a.prices ? row : { ...row, data: stripPrices(s, row.data) };
  }
  return row;
}

/**
 * Darf Polier/Arbeiter diesen Datensatz speichern bzw. löschen? `existing` = gespeicherter Stand (null = neu oder
 * gelöscht). Liefert die zu speichernden Angaben (Preise ggf. aus dem gespeicherten Stand) oder null = nicht erlaubt.
 * Zeitdaten laufen getrennt (mergeTimeDay).
 */
export function writableRecord(
  a: Access,
  store: string,
  id: string,
  incoming: Record<string, unknown>,
  deleted: boolean,
  existing: Record<string, unknown> | null,
  plans: Map<string, PlanSite> = new Map(),
): Record<string, unknown> | null {
  if (a.office) return incoming;
  if (TIME_STORES.includes(store)) return null;
  if (store === 'meta') return META_WRITE.includes(id) ? incoming : null;
  if (WRITE_TOOLS[store]) {
    if (!anyTool(a, WRITE_TOOLS[store])) return null;
    if (store === 'workers' && !hasTool(a, 'workers')) return null;
  } else if (store === 'defectMarks') {
    if ((!deleted && !markAllowed(a, incoming, plans)) || (existing && !markAllowed(a, existing, plans))) return null;
  } else if (PROJECT_STORES.includes(store)) {
    // Projekte anlegen und löschen: nur das Büro
    if (store === 'projects' && (!existing || deleted)) return null;
    // in den Papierkorb legen (deletedAt setzen) ebenfalls nur das Büro; zurückholen darf jeder mit Zugriff
    if (store === 'projects' && incoming.deletedAt && !existing?.deletedAt) return null;
    if ((!deleted && !rowAllowed(a, store, id, incoming)) || (existing && !rowAllowed(a, store, id, existing))) return null;
  } else return null;
  if (deleted) return incoming;
  if (store === 'workers') return keepSv(incoming, existing);
  return a.prices ? incoming : keepPrices(store, incoming, existing);
}

/** Foto-Eintrag (Tabelle photos) für Polier/Arbeiter: unverändert oder als „gelöscht“ */
export function visiblePhoto<T extends { data: Record<string, unknown>; deleted_at: string | null; updated_at?: string }>(row: T, a: Access): T {
  if (a.office || row.deleted_at) return row;
  return photoAllowed(a, row.data) ? row : { ...row, data: {}, deleted_at: row.updated_at ?? new Date().toISOString() };
}
export const photoAllowed = (a: Access, data: Record<string, unknown> | null | undefined) =>
  a.office || (!!data && anyTool(a, ['photos', 'reports', 'defects']) && canProject(a, data.projectId as string | null, String(data.siteName ?? ''), 'photos'));

/**
 * Datei-Schlüssel: photos/<id>/… gehört zum Foto, files/<id>/… zum Originalplan (files) bzw. Mängelplan (defectPlans),
 * sonst zu einer Formularvorlage; files/zeit_… sind Monatsdateien der Zeitaufzeichnung (nur Büro).
 */
export function fileKeyOwner(key: string): { kind: 'photo' | 'file' | 'time'; id: string } {
  const [top, id] = key.split('/');
  if (top === 'photos') return { kind: 'photo', id };
  return id.startsWith('zeit_') ? { kind: 'time', id } : { kind: 'file', id };
}
/**
 * Darf Polier/Arbeiter auf diese Datei zugreifen? owner: known = gehört zu einem gespeicherten Foto, Plan oder Formular,
 * allowed = dessen Projekt ist freigegeben (Formular-PDFs: lesen mit „Berichte“). Neue Dateien (noch ohne Eintrag) dürfen
 * nur hochgeladen bzw. geprüft werden; Monatsdateien der Zeitaufzeichnung nur das Büro.
 */
export function fileAllowed(a: Access, kind: 'photo' | 'file' | 'time', method: Method | 'DELETE', owner: { known: boolean; allowed: boolean }): boolean {
  if (a.office) return true;
  if (kind === 'time') return false;
  if (owner.known) return owner.allowed;
  return method === 'PUT' || method === 'HEAD';
}
/** Datenbank mit dem Dienstschlüssel (gefilterter Zugriff für Polier und Arbeiter) */
async function service(path: string, init: RequestInit & { prefer?: string } = {}) {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!key) throw new Error('service-key');
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...(init.prefer ? { Prefer: init.prefer } : {}), ...(init.headers ?? {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
async function ownWorkerIds(ws: string, email: string): Promise<Set<string>> {
  if (!email) return new Set();
  const rows = (await service(`records?workspace_id=eq.${ws}&store=eq.workers&deleted_at=is.null&data->>userEmail=eq.${encodeURIComponent(email)}&select=id`)) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Liste für „in.(…)“ (Kennungen sind geprüft: keine Anführungszeichen, Kommas oder Klammern) */
const inList = (ids: string[]) => `(${ids.map((i) => `"${encodeURIComponent(i)}"`).join(',')})`;
const chunked = <T,>(list: T[], n = 50): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
/** gespeicherte Stände (auch gelöschte), Schlüssel „store:id“ */
async function storedRecords(ws: string, list: { store: string; id: string }[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const byStore = new Map<string, string[]>();
  for (const r of list) byStore.set(r.store, [...(byStore.get(r.store) ?? []), r.id]);
  for (const [store, ids] of byStore)
    for (const part of chunked([...new Set(ids)])) {
      const rows = (await service(`records?workspace_id=eq.${ws}&store=eq.${store}&id=in.${inList(part)}&select=store,id,data,rev,updated_at,deleted_at`)) as Row[];
      for (const r of rows) out.set(`${r.store}:${r.id}`, r);
    }
  return out;
}
/** Projekt und Baustellenname je Mängelplan (für die Mängelpunkte) */
async function planSites(ws: string, ids: string[]): Promise<Map<string, PlanSite>> {
  const out = new Map<string, PlanSite>();
  const want = [...new Set(ids.filter((i) => i && RECORD_ID_RE.test(i)))];
  for (const part of chunked(want)) {
    const rows = (await service(`records?workspace_id=eq.${ws}&store=eq.defectPlans&deleted_at=is.null&id=in.${inList(part)}&select=id,projectId:data->>projectId,siteName:data->>siteName`)) as { id: string; projectId: string | null; siteName: string | null }[];
    for (const r of rows) out.set(r.id, { projectId: r.projectId || null, siteName: r.siteName ?? '' });
  }
  return out;
}
/** Benutzer-Kennung aus dem (von my_context schon geprüften) Anmelde-Token – „angelegt von“ bei Polier/Arbeiter */
function tokenUser(token: string): string | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const sub = String((JSON.parse(atob(part)) as { sub?: string }).sub ?? '');
    return /^[0-9a-f-]{36}$/i.test(sub) ? sub : null;
  } catch {
    return null;
  }
}
/**
 * Zu welchen gespeicherten Einträgen gehören diese Dateien (Polier/Arbeiter)? Ergebnis je Schlüssel: known = Eintrag
 * vorhanden, allowed = Zugriff erlaubt (für die gewünschte Methode).
 */
async function fileOwners(ws: string, a: Access, items: { key: string; method: Method | 'DELETE' }[]): Promise<Map<string, { known: boolean; allowed: boolean }>> {
  const out = new Map<string, { known: boolean; allowed: boolean }>();
  const owners = items.map((it) => ({ ...it, ...fileKeyOwner(it.key) }));
  const photoIds = [...new Set(owners.filter((o) => o.kind === 'photo').map((o) => o.id))];
  const fileIds = [...new Set(owners.filter((o) => o.kind === 'file').map((o) => o.id))];
  const photos = new Map<string, Record<string, unknown>>();
  for (const part of chunked(photoIds)) {
    const rows = (await service(`photos?workspace_id=eq.${ws}&id=in.${inList(part)}&select=id,data`)) as { id: string; data: Record<string, unknown> }[];
    for (const r of rows) photos.set(r.id, r.data ?? {});
  }
  // Originalpläne (files) und Mängelpläne: Projekt des Eintrags; gelöschte Einträge: kein Zugriff mehr
  const plans = new Map<string, boolean>();
  const forms = new Set<string>();
  for (const part of chunked(fileIds)) {
    const rows = (await service(`records?workspace_id=eq.${ws}&store=in.(files,defectPlans)&id=in.${inList(part)}&select=store,id,data,deleted_at`)) as Row[];
    for (const r of rows) plans.set(r.id, (plans.get(r.id) ?? false) || (!r.deleted_at && rowAllowed(a, r.store, r.id, r.data)));
    // Formular-PDFs: Vorlage (Kennung oder aktuelle Datei) oder ausgefülltes Formular (Datei seiner Vorlagenversion)
    const list = inList(part);
    const f = (await service(`records?workspace_id=eq.${ws}&store=in.(formTemplates,formEntries)&or=(and(store.eq.formTemplates,id.in.${list}),data->>fileId.in.${list})&select=id,fileId:data->>fileId,store`)) as { id: string; fileId: string | null; store: string }[];
    for (const r of f) {
      if (r.store === 'formTemplates') forms.add(r.id);
      if (r.fileId) forms.add(r.fileId);
    }
  }
  for (const o of owners) {
    let owner = { known: false, allowed: false };
    if (o.kind === 'photo' && photos.has(o.id)) owner = { known: true, allowed: photoAllowed(a, photos.get(o.id)) };
    else if (o.kind === 'file' && plans.has(o.id)) owner = { known: true, allowed: plans.get(o.id)! };
    else if (o.kind === 'file' && forms.has(o.id)) owner = { known: true, allowed: (o.method === 'GET' || o.method === 'HEAD') && hasTool(a, 'reports') };
    out.set(`${o.method} ${o.key}`, owner);
  }
  return out;
}

const KEY_RE = /^(photos\/[A-Za-z0-9_-]{4,64}\/(data|thumb|original)\.jpg|files\/[A-Za-z0-9_-]{4,64}\/(data\.bin|data\.jpg|thumb\.jpg|pdf\.pdf))$/;
const STORES = ['projects', 'costCenters', 'files', 'plans', 'damages', 'components', 'elements', 'lvDocs', 'workers', 'weeks', 'reports', 'defectPlans', 'defectMarks', 'formTemplates', 'formEntries', 'timeDays', 'timeMonths', 'materials', 'suppliers', 'materialItems', 'materialUses', 'materialPlans', 'meta'];
/** Kennung eines Datensatzes; „|“ für Zeitaufzeichnung (Arbeiter|Datum) */
const RECORD_ID_RE = /^[A-Za-z0-9_:.|-]{1,80}$/;
const PHOTO_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const UPSERT = 'resolution=merge-duplicates,return=minimal';

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json(405, { error: 'method' }, origin);
  const cfg = config();
  if (!cfg) return json(501, { error: 'not-configured' }, origin);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'json' }, origin);
  }
  const ctx = await context(req);
  if (!ctx) return json(401, { error: 'unauthorized' }, origin);
  const action = String(body.action ?? '');

  try {
    // ---- Betreiber: Verbindung prüfen / CORS setzen ----
    if (action === 'status' || action === 'setup-cors') {
      if (!ctx.operator) return json(403, { error: 'forbidden' }, origin);
      if (action === 'status') {
        const { url, headers } = await signHeaders(cfg, 'GET', '/', { 'list-type': '2', 'max-keys': '1' });
        const r = await fetch(url, { headers });
        const text = await r.text();
        return json(r.ok ? 200 : 502, { ok: r.ok, status: r.status, bucket: cfg.bucket, endpoint: cfg.endpoint, region: cfg.region, detail: r.ok ? undefined : text.slice(0, 300) }, origin);
      }
      const rules = `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${ALLOWED_ORIGINS.map(
        (o) => `<CORSRule><AllowedOrigin>${o}</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule>`,
      ).join('')}</CORSConfiguration>`;
      const extra: Record<string, string> = { 'content-type': 'application/xml', 'content-md5': md5Base64(rules) };
      const { url, headers } = await signHeaders(cfg, 'PUT', '/', { cors: '' }, rules, extra);
      const r = await fetch(url, { method: 'PUT', headers, body: rules });
      const text = await r.text();
      return json(r.ok ? 200 : 502, { ok: r.ok, status: r.status, detail: r.ok ? undefined : text.slice(0, 300) }, origin);
    }

    // ---- Benutzer mit Arbeitsbereich ----
    if (!ctx.ws) return json(403, { error: 'no-workspace' }, origin);
    const prefix = `ws/${ctx.ws}/`;
    const acc = accessOf(ctx);

    if (action === 'presign') {
      const items = Array.isArray(body.items) ? (body.items as { key: string; method: Method; contentType?: string }[]) : [];
      if (!items.length || items.length > 50) return json(422, { error: 'items' }, origin);
      const out: Record<string, string> = {};
      for (const it of items) if (!KEY_RE.test(String(it.key)) || !['GET', 'PUT', 'HEAD'].includes(it.method)) return json(422, { error: 'key' }, origin);
      // Polier/Arbeiter: nur Dateien freigegebener Projekte; neue Dateien hochladen
      const owners = acc.office ? null : await fileOwners(ctx.ws, acc, items);
      const denied: string[] = [];
      for (const it of items) {
        if (owners && !fileAllowed(acc, fileKeyOwner(it.key).kind, it.method, owners.get(`${it.method} ${it.key}`) ?? { known: false, allowed: false })) {
          denied.push(it.key);
          continue;
        }
        out[`${it.method} ${it.key}`] = await presign(cfg, it.method, prefix + it.key, { expires: it.method === 'PUT' ? 900 : 3600, contentType: it.method === 'PUT' ? (it.contentType ?? 'image/jpeg') : undefined });
      }
      if (denied.length && !Object.keys(out).length) return json(403, { error: 'forbidden', denied }, origin);
      return json(200, { urls: out, ...(denied.length ? { denied } : {}) }, origin);
    }

    if (action === 'upsert') {
      const photos = Array.isArray(body.photos) ? (body.photos as Record<string, unknown>[]) : [];
      if (!photos.length || photos.length > 200) return json(422, { error: 'photos' }, origin);
      const rows = photos.map((p) => ({
        id: String(p.id),
        workspace_id: ctx.ws,
        data: (p.data ?? {}) as Record<string, unknown>,
        size: Number(p.size ?? 0),
        has_original: Boolean(p.has_original),
        uploaded: Boolean(p.uploaded),
        deleted_at: p.deleted_at ? new Date(Number(p.deleted_at)).toISOString() : null,
      }));
      if (acc.office) {
        await rest(ctx.token, 'photos?on_conflict=id', { method: 'POST', body: JSON.stringify(rows), prefer: UPSERT });
        return json(200, { ok: true }, origin);
      }
      // Polier/Arbeiter: nur Fotos freigegebener Projekte (neu und gespeichert); fremde Arbeitsbereiche nie
      if (rows.some((r) => !PHOTO_ID_RE.test(r.id))) return json(422, { error: 'photo' }, origin);
      const stored = new Map<string, { id: string; workspace_id: string; data: Record<string, unknown>; deleted_at: string | null; updated_at: string }>();
      for (const part of chunked(rows.map((r) => r.id))) {
        const got = (await service(`photos?id=in.${inList(part)}&select=id,workspace_id,data,deleted_at,updated_at`)) as { id: string; workspace_id: string; data: Record<string, unknown>; deleted_at: string | null; updated_at: string }[];
        for (const g of got) stored.set(g.id, g);
      }
      const fresh: typeof rows = [];
      const update: typeof rows = [];
      const rejected: unknown[] = [];
      for (const r of rows) {
        const cur = stored.get(r.id);
        if (cur && cur.workspace_id !== ctx.ws) continue;
        if (!photoAllowed(acc, r.data) || (cur && !photoAllowed(acc, cur.data))) {
          if (cur) rejected.push(visiblePhoto(cur, acc));
          continue;
        }
        (cur ? update : fresh).push(r);
      }
      const uid = tokenUser(ctx.token);
      if (fresh.length) await service('photos?on_conflict=id', { method: 'POST', body: JSON.stringify(fresh.map((r) => ({ ...r, created_by: uid }))), prefer: UPSERT });
      if (update.length) await service('photos?on_conflict=id', { method: 'POST', body: JSON.stringify(update), prefer: UPSERT });
      return json(200, { ok: true, rejected }, origin);
    }

    if (action === 'pull') {
      const since = typeof body.since === 'string' && body.since ? body.since : '1970-01-01T00:00:00Z';
      const now = new Date().toISOString();
      const q = `photos?workspace_id=eq.${ctx.ws}&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=500`;
      // filtered: diese Funktion prüft die Rechte (die App gleicht dann einmal alles neu ab, s. src/lib/sync-access.ts)
      if (acc.office) return json(200, { photos: (await rest(ctx.token, q)) as Record<string, unknown>[], now, filtered: true }, origin);
      // Polier/Arbeiter: Fotos nicht freigegebener Projekte als „gelöscht“ (gleiche Anzahl – das Blättern bleibt gleich)
      const rows = (await service(q)) as { data: Record<string, unknown>; deleted_at: string | null; updated_at: string }[];
      return json(200, { photos: rows.map((r) => visiblePhoto(r, acc)), now, filtered: true }, origin);
    }

    if (action === 'records-upsert') {
      const list = Array.isArray(body.records) ? (body.records as Record<string, unknown>[]) : [];
      if (!list.length || list.length > 200) return json(422, { error: 'records' }, origin);
      for (const r of list) if (!STORES.includes(String(r.store)) || !RECORD_ID_RE.test(String(r.id))) return json(422, { error: 'record' }, origin);
      const rows = list.map((r) => ({
        store: String(r.store),
        id: String(r.id),
        workspace_id: ctx.ws,
        data: (r.data ?? {}) as Record<string, unknown>,
        rev: Number(r.rev ?? 0),
        deleted_at: r.deleted_at ? new Date(Number(r.deleted_at)).toISOString() : null,
      }));
      const scope = timeScopeOf(ctx);
      if (acc.office) {
        await rest(ctx.token, 'records?on_conflict=workspace_id,store,id', { method: 'POST', body: JSON.stringify(rows), prefer: UPSERT });
        return json(200, { ok: true }, origin);
      }
      // Polier/Arbeiter: jeden Datensatz gegen den gespeicherten Stand prüfen (Projekt, Werkzeug, Preise)
      const timeRows = rows.filter((r) => TIME_STORES.includes(r.store));
      const other = rows.filter((r) => !TIME_STORES.includes(r.store));
      const stored = await storedRecords(ctx.ws, other);
      const keyOf = (r: { store: string; id: string }) => `${r.store}:${r.id}`;
      const marks = other.filter((r) => r.store === 'defectMarks');
      const plans = await planSites(ctx.ws, [...marks.map((r) => String(r.data.planId ?? '')), ...marks.map((r) => String(stored.get(keyOf(r))?.data?.planId ?? ''))]);
      // Mängelplan im selben Paket (neu angelegt): seine Punkte gehören zu ihm
      for (const r of other) if (r.store === 'defectPlans' && !r.deleted_at) plans.set(r.id, { projectId: (r.data.projectId as string | null) || null, siteName: String(r.data.siteName ?? '') });
      const fresh: typeof rows = [];
      const update: typeof rows = [];
      const rejected: Row[] = [];
      for (const r of other) {
        const cur = stored.get(keyOf(r));
        const data = writableRecord(acc, r.store, r.id, r.data, !!r.deleted_at, cur && !cur.deleted_at ? cur.data : null, plans);
        // nicht erlaubt: gespeicherten Stand zurückgeben (so, wie die Person ihn sehen darf) – das Gerät übernimmt ihn
        if (data === null) {
          if (cur) rejected.push(visibleRecord(cur, acc, plans));
          continue;
        }
        (cur ? update : fresh).push({ ...r, data });
      }
      const uid = tokenUser(ctx.token);
      if (fresh.length) await service('records?on_conflict=workspace_id,store,id', { method: 'POST', body: JSON.stringify(fresh.map((r) => ({ ...r, created_by: uid }))), prefer: UPSERT });
      if (update.length) await service('records?on_conflict=workspace_id,store,id', { method: 'POST', body: JSON.stringify(update), prefer: UPSERT });
      // Polier mit „Zeiten“: nur Tage, zusammengeführt mit dem gespeicherten Stand; Monatsfreigaben: nichts
      if (scope.level === 'site' && hasTool(acc, 'times')) {
        for (const r of timeRows.filter((x) => x.store === 'timeDays')) {
          const cur = ((await service(`records?workspace_id=eq.${ctx.ws}&store=eq.timeDays&id=eq.${encodeURIComponent(r.id)}&select=data,deleted_at`)) as { data: Record<string, unknown>; deleted_at: string | null }[])[0];
          const m = mergeTimeDay(cur && !cur.deleted_at ? cur.data : null, r.data, !!r.deleted_at, scope);
          await service('records?on_conflict=workspace_id,store,id', { method: 'POST', body: JSON.stringify([{ ...r, data: m.data, deleted_at: m.deleted ? new Date().toISOString() : null }]), prefer: UPSERT });
        }
      }
      // Arbeiter mit „Zeiten“: nur eigene Tage in nicht freigegebenen Monaten; sonst gespeicherten Stand zurück
      const ownDays = timeRows.filter((x) => x.store === 'timeDays');
      if (scope.level === 'own' && hasTool(acc, 'times') && ownDays.length) {
        const own = await ownWorkerIds(ctx.ws, scope.email);
        const months = [...new Set(ownDays.map((r) => `${r.id.split('|')[0]}|${(r.id.split('|')[1] ?? '').slice(0, 7)}`))];
        const approved = new Set<string>();
        for (const part of chunked(months))
          for (const m of (await service(`records?workspace_id=eq.${ctx.ws}&store=eq.timeMonths&deleted_at=is.null&id=in.${inList(part)}&select=id`)) as { id: string }[]) approved.add(m.id);
        const ok = ownDays.filter((r) => ownTimeDayAllowed(r.id, r.data, !!r.deleted_at, own, approved));
        if (ok.length) await service('records?on_conflict=workspace_id,store,id', { method: 'POST', body: JSON.stringify(ok), prefer: UPSERT });
        const refused = ownDays.filter((r) => !ok.includes(r));
        if (refused.length) {
          const stored = await storedRecords(ctx.ws, refused);
          const now = new Date().toISOString();
          // nicht gespeichert (z. B. neuer Tag im freigegebenen Monat): als „gelöscht“ zurück, damit das Gerät ihn entfernt
          for (const r of refused) rejected.push(filterTimeRow(stored.get(`timeDays:${r.id}`) ?? { store: 'timeDays', id: r.id, data: {}, updated_at: now, deleted_at: now }, scope, own));
        }
      }
      return json(200, { ok: true, rejected }, origin);
    }

    if (action === 'records-pull') {
      // Cursor (updated_at, id): gleiche Zeitstempel (ein Upsert setzt sie für die ganze Gruppe) gehen nicht verloren
      const since = typeof body.since === 'string' && body.since ? body.since : '1970-01-01T00:00:00Z';
      const after = typeof body.after === 'string' ? body.after : '';
      const t = encodeURIComponent(since);
      const filter = `or=(updated_at.gt.${t},and(updated_at.eq.${t},id.gt."${encodeURIComponent(after)}"))`;
      const scope = timeScopeOf(ctx);
      if (acc.office) {
        const rows = (await rest(ctx.token, `records?workspace_id=eq.${ctx.ws}&${filter}&order=updated_at.asc,id.asc&limit=500`)) as Row[];
        const last = rows[rows.length - 1];
        return json(200, { records: rows, cursor: last ? { at: last.updated_at, id: last.id } : null, more: rows.length === 500, filtered: true }, origin);
      }
      // Polier/Arbeiter: alles mit dem Dienstschlüssel, jeder Datensatz zugeschnitten oder als „gelöscht“ (gleiche Anzahl
      // und Reihenfolge – der Cursor bleibt gültig)
      const rows = (await service(`records?workspace_id=eq.${ctx.ws}&${filter}&order=updated_at.asc,id.asc&limit=500`)) as Row[];
      const own = scope.level === 'own' ? await ownWorkerIds(ctx.ws, scope.email) : new Set<string>();
      const plans = await planSites(ctx.ws, rows.filter((r) => r.store === 'defectMarks' && !r.deleted_at).map((r) => String(r.data.planId ?? '')));
      const times = hasTool(acc, 'times');
      const out = rows.map((r) => (TIME_STORES.includes(r.store) ? (times ? filterTimeRow(r, scope, own) : r.deleted_at ? r : { ...r, data: {}, deleted_at: r.updated_at }) : visibleRecord(r, acc, plans)));
      const last = rows[rows.length - 1];
      return json(200, { records: out, cursor: last ? { at: last.updated_at, id: last.id } : null, more: rows.length === 500, filtered: true }, origin);
    }

    if (action === 'delete') {
      const keys = Array.isArray(body.keys) ? (body.keys as string[]) : [];
      if (!keys.length || keys.length > 50) return json(422, { error: 'keys' }, origin);
      const failed: string[] = [];
      for (const k of keys) if (!KEY_RE.test(k)) return json(422, { error: 'key' }, origin);
      // Polier/Arbeiter: nur Dateien von Fotos bzw. Plänen freigegebener Projekte
      const owners = acc.office ? null : await fileOwners(ctx.ws, acc, keys.map((key) => ({ key, method: 'DELETE' as const })));
      for (const k of keys) {
        if (owners && !fileAllowed(acc, fileKeyOwner(k).kind, 'DELETE', owners.get(`DELETE ${k}`) ?? { known: false, allowed: false })) {
          failed.push(k);
          continue;
        }
        const { url, headers } = await signHeaders(cfg, 'DELETE', `/${encodePath(prefix + k)}`, {});
        const r = await fetch(url, { method: 'DELETE', headers });
        if (!r.ok && r.status !== 404) failed.push(k);
      }
      return json(failed.length ? 502 : 200, { ok: !failed.length, failed }, origin);
    }

    if (action === 'usage') {
      const u = ((await rest(ctx.token, 'rpc/my_storage_usage', { method: 'POST', body: '{}' })) ?? { photos: 0, bytes: 0 }) as Record<string, number>;
      // Dateien (Pläne, Planbilder, PDFs, Fotos) direkt aus dem Bucket zählen; Datensätze (Projekte, Aufmaße …) laut Datenbank
      try {
        const files = await bucketBytes(cfg, prefix);
        const dataBytes = Number(u.data_bytes ?? 0) || 0;
        return json(200, { ...u, total: files.total + dataBytes, photoBytes: files.photos, fileBytes: files.total - files.photos, dataBytes }, origin);
      } catch (e) {
        console.error('usage', e);
        return json(200, u, origin);
      }
    }

    return json(400, { error: 'action' }, origin);
  } catch (e) {
    console.error(action, e);
    return json(500, { error: 'failed', detail: String(e).slice(0, 300) }, origin);
  }
}

// In Supabase (Deno) starten; in Tests (Node) werden nur die Hilfsfunktionen benutzt
const denoRt = (globalThis as { Deno?: { serve(h: (req: Request) => Promise<Response>): void } }).Deno;
if (denoRt) denoRt.serve(handler);
