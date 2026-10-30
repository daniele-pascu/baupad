// Supabase Edge Function „storage“: Tor zur zentralen Ablage (Hetzner Object Storage, S3-kompatibel).
// Die App bekommt nie die Hetzner-Schlüssel. Jede Anfrage trägt die Anmeldung des Benutzers (JWT);
// die Funktion ermittelt seinen Arbeitsbereich und erlaubt nur Dateien unter ws/<arbeitsbereich>/…
//
// Aktionen (POST, JSON { action, ... }):
//   presign     { items: [{ key, method: 'GET'|'PUT'|'HEAD', contentType? }] }  → kurzlebige Links
//   upsert      { photos: [{ id, data, size, has_original, uploaded, deleted_at? }] } → Verzeichnis schreiben
//   pull        { since: ISO-Zeit | null }                                          → geänderte Einträge seit …
//   delete      { keys: [...] }                                                     → Dateien löschen (Server)
//   usage       {}                                                                  → Anzahl und Bytes
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
const ALLOWED_ORIGINS = ['https://pad-software.at', 'https://www.pad-software.at', 'http://localhost:5173', 'http://localhost:4173'];
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
async function context(req: Request): Promise<{ ws: string | null; operator: boolean; token: string } | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/my_context`, {
    method: 'POST',
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) return null;
  const ctx = (await r.json()) as { workspace_id: string | null; operator: boolean } | null;
  return { ws: ctx?.workspace_id ?? null, operator: Boolean(ctx?.operator), token };
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

const KEY_RE = /^photos\/[A-Za-z0-9_-]{4,64}\/(data|thumb|original)\.jpg$/;

Deno.serve(async (req: Request) => {
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

    if (action === 'presign') {
      const items = Array.isArray(body.items) ? (body.items as { key: string; method: Method; contentType?: string }[]) : [];
      if (!items.length || items.length > 50) return json(422, { error: 'items' }, origin);
      const out: Record<string, string> = {};
      for (const it of items) {
        if (!KEY_RE.test(String(it.key)) || !['GET', 'PUT', 'HEAD'].includes(it.method)) return json(422, { error: 'key' }, origin);
        out[`${it.method} ${it.key}`] = await presign(cfg, it.method, prefix + it.key, { expires: it.method === 'PUT' ? 900 : 3600, contentType: it.method === 'PUT' ? (it.contentType ?? 'image/jpeg') : undefined });
      }
      return json(200, { urls: out }, origin);
    }

    if (action === 'upsert') {
      const photos = Array.isArray(body.photos) ? (body.photos as Record<string, unknown>[]) : [];
      if (!photos.length || photos.length > 200) return json(422, { error: 'photos' }, origin);
      const rows = photos.map((p) => ({
        id: String(p.id),
        workspace_id: ctx.ws,
        data: p.data ?? {},
        size: Number(p.size ?? 0),
        has_original: Boolean(p.has_original),
        uploaded: Boolean(p.uploaded),
        deleted_at: p.deleted_at ? new Date(Number(p.deleted_at)).toISOString() : null,
      }));
      await rest(ctx.token, 'photos?on_conflict=id', { method: 'POST', body: JSON.stringify(rows), prefer: 'resolution=merge-duplicates,return=minimal' });
      return json(200, { ok: true }, origin);
    }

    if (action === 'pull') {
      const since = typeof body.since === 'string' && body.since ? body.since : '1970-01-01T00:00:00Z';
      const rows = (await rest(ctx.token, `photos?workspace_id=eq.${ctx.ws}&updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc&limit=500`)) as Record<string, unknown>[];
      return json(200, { photos: rows, now: new Date().toISOString() }, origin);
    }

    if (action === 'delete') {
      const keys = Array.isArray(body.keys) ? (body.keys as string[]) : [];
      if (!keys.length || keys.length > 50) return json(422, { error: 'keys' }, origin);
      const failed: string[] = [];
      for (const k of keys) {
        if (!KEY_RE.test(k)) return json(422, { error: 'key' }, origin);
        const { url, headers } = await signHeaders(cfg, 'DELETE', `/${encodePath(prefix + k)}`, {});
        const r = await fetch(url, { method: 'DELETE', headers });
        if (!r.ok && r.status !== 404) failed.push(k);
      }
      return json(failed.length ? 502 : 200, { ok: !failed.length, failed }, origin);
    }

    if (action === 'usage') {
      const u = await rest(ctx.token, 'rpc/my_storage_usage', { method: 'POST', body: '{}' });
      return json(200, u ?? { photos: 0, bytes: 0 }, origin);
    }

    return json(400, { error: 'action' }, origin);
  } catch (e) {
    console.error(action, e);
    return json(500, { error: 'failed', detail: String(e).slice(0, 300) }, origin);
  }
});
