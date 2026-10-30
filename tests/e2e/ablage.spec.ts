import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshStart, FIXTURES } from './helpers';

/**
 * Zentrale Ablage (Phase 1, Fotos): Die Supabase-Funktion „storage“ und die Hetzner-Links werden im Test
 * nachgebaut (Verzeichnis + Dateien im Speicher des Tests). Geprüft: Upload nach dem Speichern, Status
 * „zentral gespeichert“, Konto-Anzeige, Abgleich von Fotos eines anderen Geräts samt Nachladen der Bilder,
 * Löschen für alle Geräte – und der Rückfall auf das Gerät, wenn die Ablage nicht eingerichtet ist.
 */

const jpeg = readFileSync(join(FIXTURES, 'foto.jpg'));
const CONTEXT = { workspace_id: '11111111-1111-4111-8111-111111111111', workspace_name: 'Testfirma', role: 'admin', pkg: 'pro', tools: [], sites: [], operator: true, name: 'Test Nutzer', phone: '' };

interface Row {
  id: string;
  data: Record<string, unknown>;
  size: number;
  has_original: boolean;
  uploaded: boolean;
  updated_at: string;
  deleted_at: string | null;
}

/** Nachbau der Funktion „storage“ und des Buckets */
function fakeCloud() {
  const rows = new Map<string, Row>();
  const files = new Map<string, Buffer>();
  const calls: string[] = [];
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 30, 12, 0, ++tick)).toISOString();
  const install = async (page: Page) => {
    await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONTEXT) }));
    await page.route('**/functions/v1/storage', async (r) => {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      const action = String(body.action);
      calls.push(action);
      const ok = (o: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (!r.request().headers()['authorization']?.startsWith('Bearer ')) return r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' });
      if (action === 'presign') {
        const items = body.items as { key: string; method: string }[];
        return ok({ urls: Object.fromEntries(items.map((i) => [`${i.method} ${i.key}`, `https://ablage.test/${i.key}?sig=1`])) });
      }
      if (action === 'upsert') {
        for (const p of body.photos as Record<string, unknown>[]) {
          rows.set(String(p.id), { id: String(p.id), data: p.data as Record<string, unknown>, size: Number(p.size), has_original: Boolean(p.has_original), uploaded: Boolean(p.uploaded), updated_at: now(), deleted_at: p.deleted_at ? new Date(Number(p.deleted_at)).toISOString() : null });
        }
        return ok({ ok: true });
      }
      if (action === 'pull') {
        const since = typeof body.since === 'string' ? body.since : '';
        return ok({ photos: [...rows.values()].filter((x) => x.updated_at > since).sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1)), now: now() });
      }
      if (action === 'delete') {
        for (const k of body.keys as string[]) files.delete(k);
        return ok({ ok: true, failed: [] });
      }
      if (action === 'usage') {
        const live = [...rows.values()].filter((x) => !x.deleted_at);
        return ok({ photos: live.length, bytes: live.reduce((s, x) => s + x.size, 0) });
      }
      if (action === 'status') return ok({ ok: true, bucket: 'baupad-dateien', endpoint: 'https://nbg1.your-objectstorage.com', region: 'eu-central' });
      return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"action"}' });
    });
    await page.route('https://ablage.test/**', (r) => {
      const key = new URL(r.request().url()).pathname.slice(1);
      if (r.request().method() === 'PUT') {
        files.set(key, r.request().postDataBuffer() ?? Buffer.alloc(0));
        return r.fulfill({ status: 200, body: '' });
      }
      const f = files.get(key);
      return f ? r.fulfill({ status: 200, contentType: 'image/jpeg', body: f }) : r.fulfill({ status: 404, body: 'NoSuchKey' });
    });
  };
  return { rows, files, calls, install, now };
}

test('Fotos werden hochgeladen, abgeglichen und für alle Geräte gelöscht', async ({ page }) => {
  test.setTimeout(90_000);
  const cloud = fakeCloud();
  await cloud.install(page);
  await freshStart(page);
  await page.goto('./fotos');
  await expect(page.getByTestId('photos-title')).toHaveText('Fotodokumentation');

  // Foto speichern → Warteschlange → Upload (Bilddaten per Link, dann Verzeichnis) → zentral gespeichert
  await page.getByTestId('photo-file-input').setInputFiles([{ name: 'IMG_1.jpg', mimeType: 'image/jpeg', buffer: jpeg }]);
  const dlg = page.getByTestId('photo-save-dialog');
  await dlg.getByTestId('photo-site').selectOption('__new');
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('Baustelle Ablage');
  await sd.getByTestId('photo-site-save').click();
  await expect(dlg.getByTestId('photo-site')).toHaveValue(/\|Baustelle Ablage$/);
  await dlg.getByTestId('photo-user').fill('Max Muster');
  await dlg.getByTestId('photo-save').click();
  await expect(page.locator('.toast', { hasText: '1 Foto gespeichert' })).toHaveCount(1);
  await expect(page.getByTestId('photos-local-banner')).toHaveCount(0);
  await expect.poll(() => cloud.rows.size, { timeout: 15_000 }).toBe(1);
  const [row] = [...cloud.rows.values()];
  expect(row.uploaded).toBe(true);
  expect(row.data).toMatchObject({ siteName: 'Baustelle Ablage', userName: 'Max Muster', fileName: 'IMG_1.jpg' });
  expect(row.data).not.toHaveProperty('sync');
  expect([...cloud.files.keys()].sort()).toEqual([`photos/${row.id}/data.jpg`, `photos/${row.id}/thumb.jpg`]);
  expect(cloud.files.get(`photos/${row.id}/thumb.jpg`)!.length).toBeGreaterThan(100);

  await page.getByTestId('photo-site').click();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(1);
  await expect(page.locator('.photo-sync')).toHaveCount(0); // kein Hinweis mehr = zentral gespeichert
  await page.getByTestId('photo-thumb').click();
  await expect(page.getByTestId('lightbox').getByTestId('lightbox-sync')).toHaveText('zentral gespeichert');
  await page.keyboard.press('Escape');

  // Konto: Ablage verbunden, Belegung aus dem Verzeichnis
  await page.goto('./konto');
  await expect(page.getByTestId('cloud-status')).toHaveText('Verbunden');
  await expect(page.getByTestId('cloud-usage')).toContainText('1 Foto');
  await page.getByTestId('cloud-check').click();
  await expect(page.locator('.toast', { hasText: 'Bucket baupad-dateien (eu-central)' })).toHaveCount(1);

  // Anderes Gerät legt ein Foto ab → „Jetzt abgleichen“ holt den Eintrag, das Bild wird beim Öffnen nachgeladen
  const other = { ...row.data, fileName: 'IMG_other.jpg', description: 'Vom zweiten Gerät', hash: 'hash-other', takenAt: Date.UTC(2026, 9, 28, 8, 0), day: '2026-10-28', uploadedAt: Date.UTC(2026, 9, 28, 8, 1) };
  cloud.rows.set('other-1', { id: 'other-1', data: other, size: 1234, has_original: false, uploaded: true, updated_at: cloud.now(), deleted_at: null });
  cloud.files.set('photos/other-1/data.jpg', jpeg);
  cloud.files.set('photos/other-1/thumb.jpg', jpeg);
  await page.getByTestId('cloud-sync').click();
  await expect(page.locator('.toast', { hasText: 'Abgleich abgeschlossen' })).toHaveCount(1);
  await expect(page.getByTestId('cloud-usage')).toContainText('2 Fotos');

  await page.goto('./fotos');
  await expect(page.getByTestId('photo-site')).toContainText('2 Fotos');
  await page.getByTestId('photo-site').click();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(2);
  const foreign = page.locator('[data-testid="photo-thumb"][data-photo="other-1"]');
  await expect(foreign).toHaveCount(1);

  await expect(foreign.locator('img')).toHaveAttribute('src', /^blob:/); // Vorschau aus der Ablage nachgeladen
  await expect.poll(() => foreign.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(1000);
  await foreign.getByRole('button').click();
  const lb = page.getByTestId('lightbox');
  await expect(lb).toBeVisible();
  await expect(lb).toContainText('Vom zweiten Gerät');
  await expect(lb.getByTestId('lightbox-sync')).toHaveText('zentral gespeichert');
  await expect.poll(() => lb.getByTestId('lightbox-image').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(1000);

  // Löschen: Verzeichnis als gelöscht markiert, Dateien entfernt, Eintrag weg
  await lb.getByTestId('lightbox-delete').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.locator('.toast', { hasText: 'Foto gelöscht' })).toHaveCount(1);
  await expect(page.getByTestId('photo-thumb')).toHaveCount(1);
  await expect.poll(() => cloud.rows.get('other-1')?.deleted_at, { timeout: 15_000 }).toBeTruthy();
  await expect.poll(() => cloud.files.has('photos/other-1/data.jpg')).toBe(false);
  expect(cloud.calls).toContain('delete');
});

test('Ablage nicht eingerichtet: Fotos bleiben auf dem Gerät, Konto zeigt den Hinweis', async ({ page }) => {
  await page.route('**/rest/v1/rpc/my_context', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONTEXT) }));
  await page.route('**/functions/v1/storage', (r) => r.fulfill({ status: 501, contentType: 'application/json', body: '{"error":"not-configured"}' }));
  await freshStart(page);
  await page.goto('./konto');
  await expect(page.getByTestId('cloud-status')).toHaveText('Noch nicht eingerichtet');
  await expect(page.getByTestId('cloud-message')).toContainText('noch nicht eingerichtet');
  await expect(page.getByTestId('cloud-retry')).toBeVisible();

  await page.goto('./fotos');
  await page.getByTestId('photo-file-input').setInputFiles([{ name: 'IMG_1.jpg', mimeType: 'image/jpeg', buffer: jpeg }]);
  const dlg = page.getByTestId('photo-save-dialog');
  await dlg.getByTestId('photo-site').selectOption('__new');
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('Baustelle Lokal');
  await sd.getByTestId('photo-site-save').click();
  await expect(dlg.getByTestId('photo-site')).toHaveValue(/\|Baustelle Lokal$/);
  await dlg.getByTestId('photo-save').click();
  await expect(page.getByTestId('photos-local-banner')).toContainText('1 Foto liegt nur auf diesem Gerät');
});
