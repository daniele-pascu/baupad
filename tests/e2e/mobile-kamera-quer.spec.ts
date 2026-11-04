import { join } from 'node:path';
import { expect, test } from './fixtures';
import { freshStart, OUT } from './helpers';

/** Handy quer gedreht: Kamerabild füllt den Bildschirm, Auslöser rechts, Foto wird quer gespeichert */
test('Kamera quer: Kamera-Modus mit Auslöser rechts, Foto quer gespeichert', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'nur Handy');
  await freshStart(page);
  await page.goto('./#/fotos');
  await page.getByTestId('photo-new-site').tap();
  await page.getByTestId('project-picker').getByTestId('picker-new').tap();
  await page.getByTestId('project-name').fill('Parkring');
  await page.getByTestId('project-save').tap();
  await expect(page.getByTestId('photo-site-title')).toHaveText('Parkring');
  await page.setViewportSize({ width: 844, height: 390 }); // iPhone quer
  await page.goto('./#/fotos/kamera?s=n%3Aparkring');
  await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
  await expect.poll(() => page.getByTestId('cam-video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  const video = (await page.getByTestId('cam-video').boundingBox())!;
  const shutter = (await page.getByTestId('cam-shutter').boundingBox())!;
  // Auslöser rechts neben dem Bild, vertikal mittig; Bild nutzt fast die ganze Höhe
  expect(shutter.x).toBeGreaterThanOrEqual(video.x + video.width - 2);
  expect(Math.abs(shutter.y + shutter.height / 2 - 195)).toBeLessThan(40);
  expect(video.height).toBeGreaterThan(300);
  await page.screenshot({ path: join(OUT, 'kamera-quer.png') });
  await page.getByTestId('cam-shutter').tap();
  await expect(page.getByTestId('cam-counter')).toHaveText('1');
  const dims = await page.evaluate(
    () =>
      new Promise<{ w: number; h: number }>((res) => {
        const r = indexedDB.open('schadstellen-aufmass');
        r.onsuccess = () => {
          const g = r.result.transaction('photos').objectStore('photos').getAll();
          g.onsuccess = () => {
            r.result.close();
            const p = g.result[0] as { width: number; height: number };
            res({ w: p.width, h: p.height });
          };
        };
      }),
  );
  expect(dims.w).toBeGreaterThan(dims.h); // quer gespeichert
  await page.setViewportSize({ width: 390, height: 844 });
});
