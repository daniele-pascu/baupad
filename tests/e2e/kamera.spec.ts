import { expect, test } from '@playwright/test';
import { freshStart } from './helpers';

/** Kamera-Modus mit Chromiums Testkamera: Baustelle wählen, auslösen, Foto landet in der Baustelle */
test('Kamera-Modus: Live-Bild, Auslöser speichert sofort, Zähler, letztes Foto, Beschreibung, Menü', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/fotos');
  await page.getByTestId('photo-new-site').click();
  await page.getByTestId('photo-site-name').fill('Garage Jagdschlossgasse');
  await page.getByTestId('photo-site-save').click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Garage Jagdschlossgasse');
  // „Foto aufnehmen“ öffnet den Kamera-Modus mit vorgewählter Baustelle
  await page.getByTestId('photo-shoot').click();
  await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('cam-site')).toHaveValue('|Garage Jagdschlossgasse');
  await expect.poll(() => page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  await page.getByTestId('cam-desc').click();
  await page.getByTestId('cam-desc-input').fill('Rampe Einfahrt');
  await page.getByTestId('cam-desc-save').click();
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('1');
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('2');
  await expect(page.getByTestId('cam-last').locator('img')).toBeVisible();
  // Menü: Fotos der Baustelle
  await page.getByTestId('cam-menu').click();
  await page.getByTestId('cam-drawer').getByRole('link', { name: 'Fotos der Baustelle' }).click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Garage Jagdschlossgasse');
  await expect(page.getByTestId('photo-thumb')).toHaveCount(2);
  await expect(page.getByTestId('photo-thumb').first()).toContainText('Rampe Einfahrt');
  await page.getByTestId('photo-thumb').first().click();
  await expect(page.getByTestId('lightbox')).toContainText('beim Speichern erfasst');
});
