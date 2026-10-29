import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withExifDate } from '../../tests/unit/exif-fixture';
import { freshStart } from '../../tests/e2e/helpers';

/** Screenshots für die Website (iPhone) */
const OUT = join(process.cwd(), 'test-results', 'site-shots', 'raw');
const DEMO = '/tmp/claude-0/-home-user/c9844e21-705a-5da7-8c2d-d667c8c32473/scratchpad/demo-photos';
/** Hinweise ausblenden, nach oben scrollen, dann fotografieren */
async function shot(page: Page, name: string) {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.toast').forEach((e) => (e.style.display = 'none'));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, `${name}-iphone.png`) });
}

test('Website-Bilder iPhone', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/fotos');
  await page.getByTestId('photo-new-site').tap();
  await page.getByTestId('photo-site-name').fill('Tiefgarage Parkdeck Nord');
  await page.getByTestId('photo-site-number').fill('2026-07');
  await page.getByTestId('photo-site-save').tap();
  await expect(page.getByTestId('photo-site-title')).toBeVisible();
  const names = ['riss', 'abplatzung', 'stuetze', 'decke', 'boden', 'wand'];
  const dates = ['2026:10:28 09:15:00', '2026:10:28 09:42:00', '2026:10:28 11:05:00', '2026:10:27 14:20:00', '2026:10:21 08:30:00', '2026:10:21 10:10:00'];
  await page.getByTestId('photo-file-input').setInputFiles(names.map((n, i) => ({ name: `IMG_${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(withExifDate(new Uint8Array(readFileSync(join(DEMO, `${n}.jpg`))), dates[i])) })));
  const dlg = page.getByTestId('photo-save-dialog');
  await dlg.getByTestId('photo-user').fill('Max Muster');
  await dlg.getByTestId('photo-pending-description').first().fill('Riss Stütze B4');
  await dlg.getByTestId('photo-save').tap();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(6);
  await page.waitForTimeout(3800);
  await shot(page, 'fotos-baustelle');
  await page.getByTestId('photo-thumb').first().tap();
  await expect(page.getByTestId('lightbox-image')).toBeVisible();
  await page.waitForTimeout(400);
  await shot(page, 'fotos-gross');
  await page.getByTestId('lightbox-close').tap();
  // Kamera-Modus (Testbild des Browsers)
  await page.goto('./#/fotos/kamera');
  await expect(page.getByTestId('camera-page')).toHaveAttribute('data-ready', 'true');
  // fürs Website-Bild: Demo-Foto anstelle des Testbilds der Browser-Kamera
  const demo = readFileSync(join(DEMO, 'stuetze.jpg')).toString('base64');
  await page.evaluate((src) => {
    const v = document.querySelector<HTMLVideoElement>('[data-testid="cam-video"]');
    if (!v) return;
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${src}`;
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
    v.style.visibility = 'hidden';
    v.parentElement!.insertBefore(img, v);
  }, demo);
  await page.waitForTimeout(800);
  await shot(page, 'kamera');
  // Berichte: Regieliste am Handy
  await page.goto('./#/berichte');
  await page.getByTestId('report-new').tap();
  const d = page.getByTestId('report-new-dialog');
  await d.getByTestId('report-type-regie').tap();
  if (await d.getByTestId('report-site-name').isVisible()) await d.getByTestId('report-site-name').fill('Tiefgarage Parkdeck Nord');
  await d.getByTestId('report-date').fill('2026-10-28');
  await d.getByTestId('report-create').tap();
  await expect(page.getByTestId('report-title')).toBeVisible();
  await page.getByTestId('crew-add').selectOption('frei');
  await page.locator('.rp-name').first().fill('Max Muster');
  await page.getByTestId('rp-worker-hours').first().fill('8,5');
  await page.getByTestId('rp-work').fill('Betonabplatzungen an Stütze B4 ausgebessert.');
  await page.waitForTimeout(600);
  await shot(page, 'berichte-regie');
  // Arbeitereinteilung am Handy
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').tap();
  const wd = page.getByTestId('workers-dialog');
  for (const [n, role] of [
    ['Max Muster', 'Polier'],
    ['Peter Huber', 'Facharbeiter'],
  ]) {
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-role').fill(role);
    await wd.getByTestId('worker-save').tap();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').tap();
  const sd = page.getByTestId('site-dialog');
  if (await sd.getByTestId('site-source-new').isVisible()) await sd.getByTestId('site-source-new').tap();
  await sd.getByTestId('site-name-input').fill('Tiefgarage Parkdeck Nord');
  await sd.getByTestId('site-save').tap();
  await page.locator('[data-site="Tiefgarage Parkdeck Nord"] [data-day="0"] [data-testid="day-add"]').tap();
  const ad = page.getByTestId('assign-dialog');
  for (const n of ['Max Muster', 'Peter Huber']) await ad.locator(`[data-worker="${n}"] input`).check();
  await ad.getByTestId('assign-save').tap();
  await page.waitForTimeout(500);
  await shot(page, 'arbeiter-woche');
  await page.goto('./#/tools');
  await page.waitForTimeout(400);
  await shot(page, 'tools');
});
