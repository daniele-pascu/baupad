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

  // Baustelle: fortlaufende Galerie – neueste Woche oben, je Woche ein Strich mit KW, darunter die Tage
  await site.click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Neubau Musterstraße');
  const weeks = page.getByTestId('photo-group');
  await expect(weeks).toHaveCount(2);
  await expect(weeks.nth(0)).toContainText('KW 45 · 02.11. – 08.11.2026');
  await expect(weeks.nth(0).getByTestId('photo-thumb')).toHaveCount(1);
  await expect(weeks.nth(1)).toContainText('KW 44');
  const day = weeks.nth(1).getByTestId('photo-day');
  await expect(day).toContainText('Dienstag, 27.10.2026');
  await expect(day.getByTestId('photo-thumb')).toHaveCount(2);
  await expect(day.getByTestId('photo-thumb').first()).toContainText('09:15');
  await expect(day.getByTestId('photo-thumb').first()).toContainText('Max Muster');
  await page.screenshot({ path: join(OUT, 'fotos-baustelle.png'), fullPage: true });

  // Gruppierung Tag / Monat / Alle; Benutzerfilter erscheint erst bei mehreren Benutzern
  await page.getByTestId('photo-mode-day').click();
  await expect(weeks).toHaveCount(2);
  await expect(weeks.nth(1)).toContainText('Dienstag, 27.10.2026');
  await page.getByTestId('photo-mode-month').click();
  await expect(weeks).toHaveCount(2);
  await expect(weeks.nth(0)).toContainText('November 2026');
  await page.getByTestId('photo-mode-all').click();
  await expect(weeks).toHaveCount(1);
  await expect(weeks.getByTestId('photo-thumb')).toHaveCount(3);
  await expect(page.getByTestId('photo-user-filter')).toContainText('Alle Benutzer (1)');
  await page.getByTestId('photo-user-filter').selectOption('Max Muster');
  await expect(weeks.getByTestId('photo-thumb')).toHaveCount(3);
  await page.getByTestId('photo-user-filter').selectOption('');
  await page.getByTestId('photo-mode-week').click();

  // Auswahl: alle der KW 44 markieren, als ZIP laden, dann abbrechen
  await page.getByTestId('photo-select').click();
  await expect(page.getByTestId('photo-selection-bar')).toContainText('0 ausgewählt');
  await weeks.nth(1).getByTestId('photo-group-all').check();
  await expect(page.getByTestId('photo-selection-bar')).toContainText('2 ausgewählt');
  await weeks.nth(0).getByTestId('photo-thumb').first().click(); // im Auswahlmodus: markieren statt öffnen
  await expect(page.getByTestId('lightbox')).toHaveCount(0);
  await expect(page.getByTestId('photo-selection-bar')).toContainText('3 ausgewählt');
  await weeks.nth(0).getByTestId('photo-thumb').first().click();
  const selDownload = page.waitForEvent('download');
  await page.getByTestId('photo-selected-download').click();
  const selZip = await saveDownload(await selDownload, 'fotos-auswahl.zip');
  const { unzipSync: unzipSel } = await import('fflate');
  expect(Object.keys(unzipSel(new Uint8Array(readFileSync(selZip)))).sort()).toEqual(['2026-10-27_0915_001.jpg', '2026-10-27_1440_002.jpg']);
  await page.getByTestId('photo-select').click(); // Fertig
  await expect(page.getByTestId('photo-selection-bar')).toHaveCount(0);

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
  // Vergrößern: Knöpfe, Mausrad, Doppelklick; Blättern setzt zurück
  await expect(lb.getByTestId('lightbox-zoom')).toHaveText('100 %');
  await lb.getByTestId('lightbox-zoom-in').click();
  await expect(lb.getByTestId('lightbox-zoom')).toHaveText('150 %');
  await lb.getByTestId('lightbox-image').hover();
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => Number(await lb.locator('.lightbox-body').getAttribute('data-zoom'))).toBeGreaterThan(1.5);
  await lb.getByTestId('lightbox-image').dblclick();
  await expect(lb.getByTestId('lightbox-zoom')).toHaveText('100 %');
  await lb.getByTestId('lightbox-image').dblclick();
  await expect(lb.getByTestId('lightbox-zoom')).toHaveText('250 %');
  await page.keyboard.press('ArrowLeft');
  await expect(lb.getByTestId('lightbox-zoom')).toHaveText('100 %');
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

  // ZIP: alle Fotos in einem Ordner, nach Datum und Uhrzeit benannt
  await page.getByTestId('photo-site').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('photo-zip').click();
  const dl = await download;
  expect(dl.suggestedFilename()).toBe('Fotos_Neubau_Musterstrasse.zip');
  const zipPath = await saveDownload(dl, 'fotos.zip');
  const { unzipSync } = await import('fflate');
  const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
  expect(Object.keys(entries).sort()).toEqual(['2026-10-27_0915_001.jpg', '2026-10-27_1440_002.jpg', '2026-10-28_1000_003.jpg', '2026-11-02_0805_004.jpg']);

  // Löschen mit Bestätigung; nach dem Neuladen bleibt der Rest
  await page.getByTestId('photo-group').nth(0).getByTestId('photo-thumb').first().click();
  await page.getByTestId('lightbox-delete').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('endgültig gelöscht');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Löschen' }).click();
  await expect(page.locator('.toast', { hasText: 'Foto gelöscht' })).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Neubau Musterstraße');
  await expect(page.getByTestId('photo-group')).toHaveCount(1);
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

test('Neue Baustelle unter Fotos (Übersicht und Speichern-Dialog), Verschieben, PDF mit Optionen', async ({ page }) => {
  test.setTimeout(120_000);
  await freshStart(page);
  await page.goto('./#/fotos');
  // Baustelle über die Übersicht anlegen → direkt auf ihrer Seite
  await page.getByTestId('photo-new-site').click();
  const sd = page.getByTestId('photo-site-dialog');
  await sd.getByTestId('photo-site-name').fill('Garage Jagdschlossgasse');
  await sd.getByTestId('photo-site-number').fill('91574');
  await sd.getByTestId('photo-site-address').fill('1130 Wien, Jagdschlossgasse 77-79');
  await sd.getByTestId('photo-site-save').click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Garage Jagdschlossgasse');
  await expect(page.getByTestId('photo-site-empty')).toBeVisible();
  await page.getByTestId('photo-file-input').setInputFiles([shot('A.jpg', '2026:10:27 09:15:30'), shot('B.jpg', '2026:10:27 10:00:00')]);
  const dlg = page.getByTestId('photo-save-dialog');
  await expect(dlg.getByTestId('photo-site')).toHaveValue('|Garage Jagdschlossgasse');
  await dlg.getByTestId('photo-user').fill('Max');
  await dlg.getByTestId('photo-save').click();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(2);

  // Übersicht: Baustelle mit Nummer; im Speichern-Dialog eine weitere Baustelle anlegen
  await page.getByTestId('to-photos').click();
  const cards = page.locator('a[data-testid="photo-site"]');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('91574');
  await page.getByTestId('photo-file-input').setInputFiles([shot('C.jpg', '2026:10:28 08:00:00')]);
  await dlg.getByTestId('photo-site').selectOption('__new');
  await sd.getByTestId('photo-site-name').fill('Halle 3');
  await sd.getByTestId('photo-site-save').click();
  await expect(dlg.getByTestId('photo-site')).toHaveValue('|Halle 3');
  await dlg.getByTestId('photo-save').click();
  await expect(dlg).toHaveCount(0);
  await expect(cards).toHaveCount(2);

  // Baustelle nachträglich bearbeiten: Name, Nummer, Adresse – Fotos bleiben, Adresse ändert sich
  await cards.filter({ hasText: 'Garage' }).click();
  await page.getByTestId('photo-site-edit').click();
  await sd.getByTestId('photo-site-name').fill('Garage Jagdschlossgasse 77');
  await sd.getByTestId('photo-site-number').fill('91574-A');
  await sd.getByTestId('photo-site-save').click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Garage Jagdschlossgasse 77');
  await expect(page.getByTestId('photo-thumb')).toHaveCount(2);
  await page.getByTestId('to-photos').click();
  await expect(cards.filter({ hasText: 'Garage Jagdschlossgasse 77' })).toContainText('91574-A');
  await expect(cards).toHaveCount(2);

  // Verschieben: ein Foto von der Garage nach Halle 3
  await cards.filter({ hasText: 'Garage' }).click();
  await page.getByTestId('photo-select').click();
  await page.getByTestId('photo-thumb').first().click();
  await page.getByTestId('photo-selected-move').click();
  const mv = page.getByTestId('photo-move-dialog');
  await mv.getByTestId('photo-move-site').selectOption('|Halle 3');
  await mv.getByTestId('photo-move-save').click();
  await expect(page.locator('.toast', { hasText: 'nach „Halle 3“ verschoben' })).toHaveCount(1);
  await expect(page.getByTestId('photo-thumb')).toHaveCount(1);
  await page.getByTestId('to-photos').click();
  await expect(cards.filter({ hasText: 'Halle 3' })).toContainText('2 Fotos');

  // PDF: zuerst Fotos auswählen (Knopf „PDF“ startet die Auswahl), dann 1 Foto je Seite, Logo links, fortlaufend → 2 Seiten
  await cards.filter({ hasText: 'Halle 3' }).click();
  await page.getByTestId('photo-pdf').click();
  await expect(page.getByTestId('photo-selection-hint')).toContainText('dann „PDF“');
  await expect(page.getByTestId('photo-selected-pdf')).toBeDisabled();
  await page.getByTestId('photo-group-all').check(); // beide liegen in KW 44
  await expect(page.getByTestId('photo-selection-bar')).toContainText('2 ausgewählt');
  await page.getByTestId('photo-selected-pdf').click();
  const pd = page.getByTestId('photo-pdf-dialog');
  await pd.getByTestId('pdf-per-page').selectOption('1');
  await pd.getByTestId('pdf-logo').selectOption('links');
  await pd.getByTestId('pdf-group').selectOption('none');
  await pd.getByTestId('pdf-quality-klein').check();
  const dl = page.waitForEvent('download');
  await pd.getByTestId('photo-pdf-create').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/^Fotos_Halle_3_\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdfPath = await saveDownload(d, 'fotos.pdf');
  const { PDFDocument } = await import('pdf-lib');
  expect((await PDFDocument.load(readFileSync(pdfPath))).getPageCount()).toBe(2);
  await expect(pd).toHaveCount(0);

  // Drehen in der Großansicht: wird sofort gespeichert (Breite und Höhe tauschen, bleibt nach dem Neuladen)
  await page.getByTestId('photo-select').click(); // Fertig
  await page.getByTestId('photo-thumb').first().click();
  const img = page.getByTestId('lightbox-image');
  await expect(img).toBeVisible();
  const [w, h] = await img.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
  await page.getByTestId('lightbox-rotate-right').click();
  await expect(page.locator('.toast', { hasText: 'Gedreht und gespeichert' })).toHaveCount(1);
  await expect(page.getByTestId('lightbox')).toContainText(`${h} × ${w}`);
  await page.reload(); // Großansicht bleibt über die Adresse (?f=) offen
  await expect(page.getByTestId('lightbox')).toContainText(`${h} × ${w}`);
  await expect.poll(() => page.getByTestId('lightbox-image').evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight])).toEqual([h, w]);
});
