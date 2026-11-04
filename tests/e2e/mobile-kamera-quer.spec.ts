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

test('Fotodokumentation: Taste „Foto aufnehmen“ auch in der Projektliste (installierte App)', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'nur Handy');
  await freshStart(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await page.goto('./#/tools');
  await page.getByTestId('tool-photos').tap();
  await expect(page.getByTestId('photos-title')).toBeVisible();
  const btn = page.getByTestId('photos-camera');
  await expect(btn).toContainText('Foto aufnehmen');
  const head = (await page.getByTestId('photos-title').boundingBox())!;
  expect((await btn.boundingBox())!.y).toBeGreaterThan(head.y);
  await page.screenshot({ path: join(OUT, 'fotos-foto-aufnehmen.png') });
  await btn.tap();
  await expect(page.getByTestId('camera-page')).toBeVisible();
});

test('Foto bearbeiten am Handy: Editor passt auf den Bildschirm, Foto groß', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'nur Handy');
  await freshStart(page);
  await page.goto('./#/fotos');
  await page.getByTestId('photo-new-site').tap();
  await page.getByTestId('project-picker').getByTestId('picker-new').tap();
  await page.getByTestId('project-name').fill('Parkring');
  await page.getByTestId('project-save').tap();
  await page.getByTestId('photo-file-input').setInputFiles(join(process.cwd(), 'tests', 'fixtures', 'foto.jpg'));
  await page.getByTestId('photo-save-dialog').getByTestId('photo-save').tap();
  await page.getByTestId('photo-thumb').first().tap();
  await page.getByTestId('lightbox-edit').tap();
  const ed = page.getByTestId('photo-editor');
  await expect(ed).toBeVisible();
  const img = (await page.locator('[data-testid="pe-canvas"] image').boundingBox())!;
  expect(img.height).toBeGreaterThan(300);
  for (const id of ['pe-save', 'pe-undo', 'pe-tool-free', 'pe-tool-ellipse', 'pe-opacity']) {
    const b = (await ed.getByTestId(id).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(391);
  }
  await page.screenshot({ path: join(OUT, 'foto-bearbeiten-handy.png') });
  // zwei Finger: auseinander = Foto vergrößern (wie beim Plan)
  const pinch = (cx: number, cy: number, d0: number, d1: number) =>
    page.evaluate(
      ({ cx, cy, d0, d1 }) => {
        const el = document.querySelector('[data-testid="pe-canvas"]')!;
        const ev = (type: string, id: number, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
        ev('pointerdown', 1, cx - d0, cy);
        ev('pointerdown', 2, cx + d0, cy);
        for (let i = 1; i <= 5; i++) {
          const d = d0 + ((d1 - d0) * i) / 5;
          ev('pointermove', 1, cx - d, cy);
          ev('pointermove', 2, cx + d, cy);
        }
        ev('pointerup', 1, cx - d1, cy);
        ev('pointerup', 2, cx + d1, cy);
      },
      { cx, cy, d0, d1 },
    );
  const cv = ed.getByTestId('pe-canvas');
  await pinch(img.x + img.width / 2, img.y + img.height / 2, 40, 100);
  await expect.poll(async () => Number(await cv.getAttribute('data-zoom'))).toBeGreaterThan(2);
  await ed.getByTestId('pe-zoom-fit').tap();
  await expect(cv).toHaveAttribute('data-zoom', '1.00');
});
