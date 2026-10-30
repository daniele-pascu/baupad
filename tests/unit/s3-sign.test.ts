import { describe, expect, it } from 'vitest';
import { amzDate, encodePath, objectUrl, presign, signHeaders, type S3Config } from '../../src/lib/s3-sign';

const cfg: S3Config = { endpoint: 'https://nbg1.your-objectstorage.com', bucket: 'baupad-dateien', region: 'eu-central', accessKey: 'AKIAEXAMPLE', secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const now = new Date('2026-10-30T12:00:00Z');

describe('S3-Signatur (Version 4)', () => {
  it('Zeitstempel und Pfadkodierung', () => {
    expect(amzDate(now)).toEqual({ stamp: '20261030T120000Z', date: '20261030' });
    expect(encodePath('ws/abc/photos/x y/data.jpg')).toBe('ws/abc/photos/x%20y/data.jpg');
    expect(objectUrl(cfg, 'ws/a/photos/1/data.jpg').url).toBe('https://baupad-dateien.nbg1.your-objectstorage.com/ws/a/photos/1/data.jpg');
  });

  it('presign: Link mit allen Pflichtparametern, deterministisch, abhängig von Schlüssel und Inhalt', async () => {
    const a = await presign(cfg, 'PUT', 'ws/a/photos/1/data.jpg', { expires: 900, contentType: 'image/jpeg', now });
    const u = new URL(a);
    expect(u.host).toBe('baupad-dateien.nbg1.your-objectstorage.com');
    expect(u.pathname).toBe('/ws/a/photos/1/data.jpg');
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Credential')).toBe('AKIAEXAMPLE/20261030/eu-central/s3/aws4_request');
    expect(u.searchParams.get('X-Amz-Date')).toBe('20261030T120000Z');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    // gleich bei gleicher Eingabe, anders bei anderem Schlüssel, Pfad oder Methode
    expect(await presign(cfg, 'PUT', 'ws/a/photos/1/data.jpg', { expires: 900, contentType: 'image/jpeg', now })).toBe(a);
    const other = await presign({ ...cfg, secretKey: 'anders' }, 'PUT', 'ws/a/photos/1/data.jpg', { expires: 900, contentType: 'image/jpeg', now });
    expect(new URL(other).searchParams.get('X-Amz-Signature')).not.toBe(u.searchParams.get('X-Amz-Signature'));
    const get = await presign(cfg, 'GET', 'ws/a/photos/1/data.jpg', { now });
    expect(new URL(get).searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(new URL(get).searchParams.get('X-Amz-Signature')).not.toBe(u.searchParams.get('X-Amz-Signature'));
  });

  it('presign: Signatur entspricht der AWS-Rechenvorschrift (unabhängig nachgerechnet)', async () => {
    // Nachrechnung mit Node-Crypto: HMAC-Kette und Hash der kanonischen Anfrage
    const { createHmac, createHash } = await import('node:crypto');
    const key = 'ws/a/photos/1/thumb.jpg';
    const url = new URL(await presign(cfg, 'GET', key, { expires: 3600, now }));
    const query = [...url.searchParams.entries()]
      .filter(([k]) => k !== 'X-Amz-Signature')
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonical = ['GET', '/ws/a/photos/1/thumb.jpg', query, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', '20261030T120000Z', '20261030/eu-central/s3/aws4_request', createHash('sha256').update(canonical).digest('hex')].join('\n');
    const h = (k: Uint8Array | string, m: string) => createHmac('sha256', k).update(m).digest();
    const kSigning = h(h(h(h(`AWS4${cfg.secretKey}`, '20261030'), 'eu-central'), 's3'), 'aws4_request');
    expect(url.searchParams.get('X-Amz-Signature')).toBe(createHmac('sha256', kSigning).update(toSign).digest('hex'));
  });

  it('signHeaders: Kopfzeilen mit Inhalts-Hash und Authorization', async () => {
    const { url, headers } = await signHeaders(cfg, 'GET', '/', { 'list-type': '2', 'max-keys': '1' }, '', {}, now);
    expect(url).toBe('https://baupad-dateien.nbg1.your-objectstorage.com/?list-type=2&max-keys=1');
    expect(headers['x-amz-content-sha256']).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); // SHA-256 von ""
    expect(headers['x-amz-date']).toBe('20261030T120000Z');
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261030\/eu-central\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });
});
