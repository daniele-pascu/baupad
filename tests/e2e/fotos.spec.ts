import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withExifDate } from '../unit/exif-fixture';
import { createProject, freshStart, FIXTURES, OUT, saveDownload } from './helpers';

/**
 * Fotodokumentation (Phase 1, lokale Ablage): Fotos aufnehmen/auswählen, Baustelle und Aufnahmezeit prüfen,
 * Struktur Baustelle → KW → Tag, Suche, Großansicht mit Blättern, Beschreibung, Löschen, ZIP, Duplikate.
 */

const jpeg = new Uint8Array(readFileSync(join(FIXTURES, 'foto.jpg')));
const shot = (name: string, dateTime: string) => ({ name, mimeType: 'image/jpeg', buffer: Buffer.from(withExifDate(jpeg, dateTime)) });

test('Fotos je Baustelle, KW und Tag; Großansicht; Beschreibung; Suche; Duplikat; ZIP; Löschen', async ({ page }) => {
  test.setTimeout(120_000);
  await freshStart(page);
  await createProject(page, 'Neubau Musterstraße', { number: '2026-04', address: 'Musterstraße 1, 4020 Linz' });
  await page.goto('./#/tools');
  await page.getByTestId('tool-photos').click();
  await expect(page.getByTestId('photos-title')).toHaveText('Fotodokumentation');
  await expect(page.getByTestId('photos-empty')).toBeVisible();

  // drei Fotos aus der Galerie: Di 27.10. (zwei), Mo 02.11. – Baustelle aus dem Projekt
  await page.getByTestId('photo-file-input').setInputFiles([shot('IMG_1.jpg', '2026:10:27 09:15:30'), shot('IMG_2.jpg', '2026:10:27 14:40:00'), shot('IMG_3.jpg', '2026:11:02 08:05:00')]);
  const dlg = page.getByTestId('photo-save-dialog');
  await expect(dlg).toContainText('3 Fotos speichern');
  await expect(dlg.getByTestId('photo-site')).toHaveValue(/Neubau/);
  await expect(dlg.getByTestId('photo-pending-item').first()).toContainText('27.10.2026, 09:15 (aus dem Foto)');
  await dlg.getByTestId('photo-user').fill('Max Muster');
  await dlg.getByTestId('photo-pending-description').first().fill('Riss Stütze B4');
  await dlg.getByTestId('photo-save').click();
  await expect(page.locator('.toast', { hasText: '3 Fotos gespeichert' })).toHaveCount(1);
  await expect(page.getByTestId('photos-local-banner')).toContainText('3 Fotos liegen nur auf diesem Gerät');

  // Übersicht: Baustelle mit Anzahl, Zeitraum und Kalenderwochen
  const site = page.getByTestId('photo-site');
  await expect(site).toHaveCount(1);
  await expect(site).toContainText('Neubau Musterstraße');
  await expect(site).toContainText('3 Fotos · 27.10.2026 – 02.11.2026');
  await expect(site.locator('.photo-week-chip')).toHaveText([/KW 45/, /KW 44/]);
  await page.screenshot({ path: join(OUT, 'fotos-uebersicht.png'), fullPage: true });

  // Baustelle: KW 45 (neueste) offen, KW 44 zuklappbar; Tage mit Fotos
  await site.click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Neubau Musterstraße');
  const weeks = page.getByTestId('photo-week');
  await expect(weeks).toHaveCount(2);
  await expect(weeks.nth(0)).toContainText('KW 45 · 02.11. – 08.11.2026');
  await expect(weeks.nth(0).getByTestId('photo-thumb')).toHaveCount(1);
  await expect(weeks.nth(1)).toContainText('KW 44');
  await expect(weeks.nth(1).getByTestId('photo-thumb')).toHaveCount(0); // zu
  await weeks.nth(1).getByTestId('photo-week-toggle').click();
  const day = weeks.nth(1).getByTestId('photo-day');
  await expect(day).toContainText('Dienstag, 27.10.2026');
  await expect(day.getByTestId('photo-thumb')).toHaveCount(2);
  await expect(day.getByTestId('photo-thumb').first()).toContainText('09:15');
  await expect(day.getByTestId('photo-thumb').first()).toContainText('Max Muster');
  await page.screenshot({ path: join(OUT, 'fotos-baustelle.png'), fullPage: true });

  // Großansicht: Angaben, Blättern, Beschreibung bearbeiten
  await day.getByTestId('photo-thumb').first().click();
  const lb = page.getByTestId('lightbox');
  await expect(lb).toContainText('Dienstag, 27.10.2026 · 09:15 Uhr · Max Muster');
  await expect(lb.getByTestId('lightbox-image')).toBeVisible();
  await expect(lb.getByTestId('lightbox-description')).toContainText('Riss Stütze B4');
  await expect(lb.getByTestId('lightbox-sync')).toHaveText('nur auf diesem Gerät');
  await lb.getByTestId('lightbox-next').click();
  await expect(lb).toContainText('14:40 Uhr');
  await lb.getByTestId('lightbox-description').click();
  await lb.getByTestId('lightbox-description-input').fill('Abplatzung Decke');
  await lb.getByTestId('lightbox-description-save').click();
  await expect(lb.getByTestId('lightbox-description')).toContainText('Abplatzung Decke');
  await page.keyboard.press('ArrowRight');
  await expect(lb).toContainText('Montag, 02.11.2026');
  await page.keyboard.press('Escape');
  await expect(lb).toHaveCount(0);

  // Suche in der Übersicht: Beschreibung, Benutzer, KW, Datum
  await page.getByTestId('to-photos').click();
  for (const [q, n] of [
    ['Abplatzung', 1],
    ['KW 45', 1],
    ['28.10.', 0],
    ['27.10.', 1],
    ['Max', 1],
    ['Thomas', 0],
  ] as const) {
    await page.getByTestId('photo-search').fill(q);
    await expect(page.getByTestId('photo-site')).toHaveCount(n);
  }
  await page.getByTestId('photo-search').fill('');

  // dasselbe Foto noch einmal → als Duplikat erkannt und übersprungen
  await page.getByTestId('photo-file-input').setInputFiles([shot('IMG_1.jpg', '2026:10:27 09:15:30'), shot('IMG_4.jpg', '2026:10:28 10:00:00')]);
  await expect(dlg.getByTestId('photo-duplicate')).toHaveCount(1);
  await expect(dlg.getByTestId('photo-save')).toHaveText('1 speichern');
  await dlg.getByTestId('photo-save').click();
  await expect(page.locator('.toast', { hasText: '1 Foto gespeichert' })).toHaveCount(1);
  await expect(page.getByTestId('photo-site')).toContainText('4 Fotos');

  // ZIP mit Ordnern je KW und Tag + Liste
  await page.getByTestId('photo-site').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('photo-zip').click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('Fotos_Neubau_Musterstrasse.zip');
  const zipPath = await saveDownload(dl, 'fotos.zip');
  const { unzipSync, strFromU8 } = await import('fflate');
  const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
  expect(Object.keys(entries).sort()).toEqual(['KW44/2026-10-27/2026-10-27_0915_01.jpg', 'KW44/2026-10-27/2026-10-27_1440_02.jpg', 'KW44/2026-10-28/2026-10-28_1000_01.jpg', 'KW45/2026-11-02/2026-11-02_0805_01.jpg', 'fotos.csv']);
  expect(strFromU8(entries['fotos.csv'])).toContain('Abplatzung Decke');

  // Löschen mit Bestätigung; nach dem Neuladen bleibt der Rest
  await page.getByTestId('photo-week').nth(0).getByTestId('photo-thumb').first().click();
  await page.getByTestId('lightbox-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('endgültig gelöscht');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.locator('.toast', { hasText: 'Foto gelöscht' })).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Neubau Musterstraße');
  await expect(page.getByTestId('photo-week')).toHaveCount(1);
  await expect(page.getByTestId('photo-site-title').locator('..')).toContainText('3 Fotos');
});

test('Ohne Projekt: Baustelle aus der Arbeitereinteilung bzw. Berichten; Foto ohne EXIF bekommt das Dateidatum', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('add-site').click();
  await page.getByTestId('site-dialog').getByTestId('site-name-input').fill('Halle 3');
  await page.getByTestId('site-dialog').getByTestId('site-save').click();
  await page.goto('./#/fotos');
  await page.getByTestId('photo-file-input').setInputFiles(join(FIXTURES, 'foto.jpg'));
  const dlg = page.getByTestId('photo-save-dialog');
  await expect(dlg.getByTestId('photo-site')).toHaveValue('|Halle 3'); // einzige Baustelle vorgewählt
  await expect(dlg.getByTestId('photo-pending-item')).toContainText(/\(Dateidatum\)|\(jetzt\)/);
  await dlg.getByTestId('photo-save').click();
  await expect(page.getByTestId('photo-site')).toHaveAttribute('data-site', 'Halle 3');
});
