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
  // Kamera-Modus (in der installierten App über „Foto aufnehmen“; im Browser gibt es den Knopf nicht)
  await expect(page.getByTestId('photo-shoot')).toHaveCount(0);
  await page.goto('./#/fotos/kamera?s=n%3Agarage%20jagdschlossgasse');
  await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('cam-site')).toHaveValue('|Garage Jagdschlossgasse');
  await expect.poll(() => page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  await page.getByTestId('cam-desc').click();
  await page.getByTestId('cam-desc-input').fill('Rampe Einfahrt');
  await page.getByTestId('cam-desc-save').click();
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('1');
  // Format: 16:9 quer → Testkamera 640×480 wird auf 640×360 zugeschnitten; „Hoch“ dreht auf 480×640
  await page.getByTestId('cam-format').click();
  await page.getByTestId('cam-ratio-16:9').click();
  await page.getByTestId('cam-orient-landscape').click();
  await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByTestId('cam-mask')).toHaveAttribute('data-rot', '0');
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('2');
  await page.getByTestId('cam-format').click();
  await page.getByTestId('cam-ratio-4:3').click();
  await page.getByTestId('cam-orient-portrait').click();
  await page.getByTestId('cam-format-sheet').getByRole('button', { name: 'Fertig' }).click();
  await expect(page.getByTestId('cam-mask')).toHaveAttribute('data-rot', '90');
  await page.getByTestId('cam-shutter').click();
  await expect(page.getByTestId('cam-counter')).toHaveText('3');
  await expect(page.getByTestId('cam-last').locator('img')).toBeVisible();
  // Menü: Fotos der Baustelle
  await page.getByTestId('cam-menu').click();
  await page.getByTestId('cam-drawer').getByRole('link', { name: 'Fotos der Baustelle' }).click();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Garage Jagdschlossgasse');
  await expect(page.getByTestId('photo-thumb')).toHaveCount(3);
  await expect(page.getByTestId('photo-thumb').first()).toContainText('Rampe Einfahrt');
  await page.getByTestId('photo-thumb').first().click();
  await expect(page.getByTestId('lightbox')).toContainText('beim Speichern erfasst');
  const ratio = async () => {
    const m = /(\d+) × (\d+)/.exec(await page.getByTestId('lightbox').innerText());
    return Number(m![1]) / Number(m![2]);
  };
  expect(await ratio()).toBeCloseTo(4 / 3, 2); // Sensorbild der Testkamera (quer, 4:3)
  await page.getByTestId('lightbox-next').click();
  expect(await ratio()).toBeCloseTo(16 / 9, 2); // 16:9 quer
  await page.getByTestId('lightbox-next').click();
  expect(await ratio()).toBeCloseTo(3 / 4, 2); // „Hoch“ → gedreht, 4:3 hochkant
});
