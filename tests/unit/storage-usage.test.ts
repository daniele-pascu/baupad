import { afterEach, describe, expect, it, vi } from 'vitest';
import { bucketBytes } from '../../supabase/functions/storage/index';
import { fmtMb } from '../../src/components/InstallApp';

const cfg = { endpoint: 'https://nbg1.your-objectstorage.com', bucket: 'baupad-dateien', region: 'eu-central', accessKey: 'k', secretKey: 's' };
const obj = (key: string, size: number) => `<Contents><Key>${key}</Key><Size>${size}</Size></Contents>`;

describe('Belegung der zentralen Ablage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('zählt alle Dateien des Arbeitsbereichs über mehrere Seiten, davon Fotos', async () => {
    const pages = [
      `<ListBucketResult>${obj('ws/A/files/p1/original.pdf', 5_000_000)}${obj('ws/A/photos/f1/data.jpg', 2_000_000)}<IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;2</NextContinuationToken></ListBucketResult>`,
      `<ListBucketResult>${obj('ws/A/photos/f1/thumb.jpg', 50_000)}${obj('ws/A/files/p1/plan.png', 1_000_000)}<IsTruncated>false</IsTruncated></ListBucketResult>`,
    ];
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(pages[urls.length - 1], { status: 200 });
    });
    const r = await bucketBytes(cfg, 'ws/A/');
    expect(r).toEqual({ total: 8_050_000, photos: 2_050_000, count: 4 });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('prefix=ws%2FA%2F');
    expect(urls[1]).toContain('continuation-token=t%262');
  });

  it('Anzeige: Megabyte mit zwei Nachkommastellen, ab 1 GB in GB', () => {
    expect(fmtMb(8_050_000)).toBe('7,68 MB');
    expect(fmtMb(0)).toBe('0,00 MB');
    expect(fmtMb(3 * 1024 ** 3)).toBe('3,00 GB');
  });
});
