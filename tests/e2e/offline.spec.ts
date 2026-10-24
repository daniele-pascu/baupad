import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  FIXTURES,
  catchDownload,
  createProject,
  drawRect,
  fillMeasures,
  planBox,
  readXlsx,
  saveDownload,
  tableRows,
  waitForPlan,
  waitSaved,
} from './helpers';

/**
 * Offline-Betrieb: Nach dem ersten Laden muss die App inklusive PDF-Darstellung (pdf.js-Worker,
 * Schriften), Import, Einzeichnen, Speichern und Exporten ohne Netzwerk funktionieren.
 */
test('Offline: Projekt anlegen, PDF importieren, Schadstellen erfassen, exportieren', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true, locale: 'de-DE' });
  const page = await context.newPage();
  const failed: string[] = [];
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));

  // Erster Besuch online: Service Worker installiert und speichert die App
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole('img', { name: 'BauPad' })).toBeVisible();

  // Ab jetzt ohne Netzwerk
  await context.setOffline(true);
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  await page.reload();
  await expect(page.getByRole('img', { name: 'BauPad' })).toBeVisible();
  await expect(page.getByTestId('offline-badge')).toBeVisible();
  // Startseite und Navigation funktionieren offline
  await page.getByTestId('cta-projects').click();
  await expect(page.getByTestId('projects-title')).toHaveText('Projektverwaltung');

  await createProject(page, 'Offline-Baustelle', {}, ['Untergeschoss']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await expect(wiz.getByTestId('page-tile')).toHaveCount(4);
  await wiz.getByTestId('page-tile').nth(1).click();
  await wiz.getByTestId('pages-next').click();
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('A-101');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);

  // Plan wird offline gerendert (Canvas ist nicht leer)
  const inked = await page.evaluate(() => {
    const c = document.querySelector('.viewer-canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return dark;
  });
  expect(inked).toBeGreaterThan(1000);

  const box = await planBox(page);
  await page.getByTestId('tool-rect').click();
  await drawRect(page, box.x + box.width * 0.3, box.y + box.height * 0.3, box.x + box.width * 0.4, box.y + box.height * 0.4);
  await fillMeasures(page, '1,5', '0,8', '0,05');
  await waitSaved(page);

  const x = await catchDownload(page, () => page.getByTestId('export-xlsx-plan').click());
  const wb = readXlsx(await saveDownload(x, 'offline.xlsx'));
  expect(wb['A-101'][2].map((c) => c?.v)).toEqual([1, 1.5, 0.8, 0.05, 1.2]);

  const p = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(p, 'offline.pdf');
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Pages:\s+1/);

  // Neu laden ohne Netz: Daten sind vollständig vorhanden
  await page.reload();
  await waitForPlan(page);
  expect((await tableRows(page)).map((r) => r[4])).toEqual(['1,20']);

  // Keine fehlgeschlagenen Anfragen (alles kam aus dem Offline-Speicher)
  expect(failed).toEqual([]);

  await context.setOffline(false);
  await expect(page.getByTestId('offline-badge')).toBeHidden();
  await context.close();
});
