/**
 * AWS-Signatur Version 4 für S3-kompatible Ablagen (Hetzner Object Storage) – ohne Zusatzpaket, nur Web Crypto.
 * Läuft im Browser, in Node (Tests) und in Deno (Supabase-Funktion „storage“, dort als Kopie eingebettet).
 *
 * Zwei Verwendungen:
 * - presign(): kurzlebiger Link, mit dem der Browser eine Datei direkt hoch- oder herunterlädt (PUT/GET)
 * - signHeaders(): Kopfzeilen für Anfragen, die die Funktion selbst stellt (Löschen, Status, CORS-Regeln)
 */

export interface S3Config {
  /** z. B. https://nbg1.your-objectstorage.com */
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

const enc = new TextEncoder();

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data);
  return hex(buf);
}
const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

async function hmac(key: ArrayBuffer | string, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

/** Zeitstempel JJJJMMTT'T'HHMMSS'Z' und Datum JJJJMMTT */
export function amzDate(d = new Date()): { stamp: string; date: string } {
  const stamp = d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { stamp, date: stamp.slice(0, 8) };
}

/** Pfadteile wie AWS kodieren (jedes Segment, „/“ bleibt) */
export const encodePath = (key: string) =>
  key
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');

const encodeQ = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeQ(k)}=${encodeQ(params[k])}`)
    .join('&');
}

async function signingKey(cfg: S3Config, date: string): Promise<ArrayBuffer> {
  const kDate = await hmac(`AWS4${cfg.secretKey}`, date);
  const kRegion = await hmac(kDate, cfg.region);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

/** Host und Pfad einer Objektadresse (virtuelles Hosting: bucket.endpoint/key) */
export function objectUrl(cfg: S3Config, key: string): { host: string; path: string; url: string } {
  const base = new URL(cfg.endpoint);
  const host = `${cfg.bucket}.${base.host}`;
  const path = `/${encodePath(key)}`;
  return { host, path, url: `${base.protocol}//${host}${path}` };
}

/**
 * Kurzlebiger, signierter Link (Query-Signatur). `expires` in Sekunden (max. 7 Tage).
 * Bei PUT kann der Inhaltstyp festgelegt werden; der Browser muss ihn dann genauso senden.
 */
export async function presign(cfg: S3Config, method: 'GET' | 'PUT' | 'HEAD', key: string, opts: { expires?: number; contentType?: string; now?: Date } = {}): Promise<string> {
  const { stamp, date } = amzDate(opts.now);
  const { host, path, url } = objectUrl(cfg, key);
  const credential = `${cfg.accessKey}/${date}/${cfg.region}/s3/aws4_request`;
  const signedHeaders = opts.contentType ? 'content-type;host' : 'host';
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
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

/**
 * Signierte Kopfzeilen für eine Anfrage der Funktion selbst (Header-Signatur mit Inhalts-Hash).
 * `path` ist der Pfad auf dem Bucket-Host (z. B. „/“ für Bucket-Operationen oder „/ordner/datei.jpg“), `query` die Abfrage.
 */
export async function signHeaders(cfg: S3Config, method: string, path: string, query: Record<string, string>, body: string | ArrayBuffer = '', extraHeaders: Record<string, string> = {}, now = new Date()): Promise<{ url: string; headers: Record<string, string> }> {
  const { stamp, date } = amzDate(now);
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
  const headers: Record<string, string> = { ...extraHeaders, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp, Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
  return { url: `${base.protocol}//${host}${path}${q ? `?${q}` : ''}`, headers };
}
