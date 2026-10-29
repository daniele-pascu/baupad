import { expect, test, type Page } from '../../tests/e2e/fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withExifDate } from '../../tests/unit/exif-fixture';
import { catchDownload, createProject, drawRect, excelExport, fillMeasures, FIXTURES, freshStart, pickTool, planBox, saveDownload, waitForPlan, waitSaved } from '../../tests/e2e/helpers';

/** Screenshots und Beispiel-Exporte für die Website (PC) – Demodaten, nichts Echtes */
const OUT = join(process.cwd(), 'test-results', 'site-shots', 'raw');
const DEMO = '/tmp/claude-0/-home-user/c9844e21-705a-5da7-8c2d-d667c8c32473/scratchpad/demo-photos';
/** Hinweise ausblenden, nach oben scrollen, dann fotografieren */
async function shot(page: Page, name: string) {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.toast').forEach((e) => (e.style.display = 'none'));
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

async function workersAndWeek(page: Page) {
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('workers-dialog');
  for (const [n, role] of [
    ['Max Muster', 'Polier'],
    ['Peter Huber', 'Facharbeiter'],
    ['Thomas Berger', 'Facharbeiter'],
    ['Ali Demir', 'Helfer'],
  ]) {
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-role').fill(role);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  let sd = page.getByTestId('site-dialog');
  await sd.getByTestId('site-project').selectOption({ label: '2026-07 · Tiefgarage Parkdeck Nord' });
  await sd.getByTestId('site-save').click();
  await page.getByTestId('add-site').click();
  sd = page.getByTestId('site-dialog');
  if (await sd.getByTestId('site-source-new').isVisible()) await sd.getByTestId('site-source-new').click();
  await sd.getByTestId('site-name-input').fill('Sanierung Hauptplatz');
  await sd.getByTestId('site-save').click();
  const assign = async (site: string, day: number, names: string[]) => {
    await page.locator(`[data-site="${site}"] [data-day="${day}"] [data-testid="day-add"]`).click();
    const ad = page.getByTestId('assign-dialog');
    for (const n of names) await ad.locator(`[data-worker="${n}"] input`).check();
    await ad.getByTestId('assign-save').click();
  };
  await assign('Tiefgarage Parkdeck Nord', 0, ['Max Muster', 'Peter Huber']);
  await assign('Sanierung Hauptplatz', 0, ['Thomas Berger', 'Ali Demir']);
  await expect(page.locator('[data-site="Tiefgarage Parkdeck Nord"] [data-day="4"] [data-testid="crew-chip"]')).toHaveCount(2);
}

test('Website-Bilder PC', async ({ page }) => {
  await freshStart(page);
  // Firmenname fürs PDF
  await page.goto('./#/konto');
  await page.getByTestId('company-name').fill('Muster Bau GmbH');
  await page.getByTestId('company-lines').fill('Industriestraße 12, 1230 Wien\nTel. 01 234 56 78\noffice@musterbau.at');
  await page.getByTestId('company-save').click();

  // ── Aufmaß & Abrechnung ──
  await page.goto('./#/projekte');
  await createProject(page, 'Tiefgarage Parkdeck Nord', { number: '2026-07', address: 'Industriestraße 12, 1230 Wien', client: 'Muster Immobilien GmbH' }, [{ number: '91102', name: 'Tiefgarage' }]);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('A-101');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const rects: [number, number, number, number, string, string, string][] = [
    [0.18, 0.3, 0.3, 0.38, '2,4', '1,2', '0,04'],
    [0.45, 0.52, 0.6, 0.6, '3,1', '0,8', '0,05'],
    [0.66, 0.26, 0.8, 0.4, '1,6', '1,6', '0,03'],
  ];
  for (const [x1, y1, x2, y2, l, b, t] of rects) {
    await pickTool(page, 'tool-rect');
    await drawRect(page, box.x + box.width * x1, box.y + box.height * y1, box.x + box.width * x2, box.y + box.height * y2);
    await fillMeasures(page, l, b, t);
  }
  await waitSaved(page);
  await page.mouse.click(box.x + 5, box.y + 5);
  await page.waitForTimeout(500);
  await shot(page, 'aufmass-editor');
  // Excel + PDF
  const xdl = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  await saveDownload(xdl, join('site-shots', 'aufmass.xlsx'));
  await page.getByTestId('export-pdf-plan').click();
  await page.getByTestId('pdf-export-run').click();
  const pv = page.getByTestId('pdf-preview');
  await expect(pv.getByTestId('preview-page').first()).toBeVisible();
  const [pdl] = await Promise.all([page.waitForEvent('download'), pv.getByTestId('preview-download').click()]);
  await saveDownload(pdl, join('site-shots', 'aufmass-plan.pdf'));
  await page.goto('./#/projekte');
  await page.getByTestId('project-card').click();
  await expect(page.getByTestId('project-title')).toHaveText('Tiefgarage Parkdeck Nord');
  await page.waitForTimeout(400);
  await shot(page, 'aufmass-projekt');

  // ── Arbeitereinteilung ──
  await workersAndWeek(page);
  await page.waitForTimeout(400);
  await shot(page, 'arbeiter-woche');
  const cdl = await catchDownload(page, () => page.getByTestId('crew-pdf').click());
  await saveDownload(cdl, join('site-shots', 'arbeiter-kw.pdf'));

  // ── Berichte ──
  await page.goto('./#/berichte');
  await page.getByTestId('report-new').click();
  let d = page.getByTestId('report-new-dialog');
  await d.getByTestId('report-type-regie').click();
  await d.getByTestId('report-date').fill('2026-10-28');
  await d.getByTestId('report-create').click();
  await expect(page.getByTestId('report-title')).toHaveText('Regieliste Nr. 1');
  await page.getByTestId('crew-import').click();
  await page.getByTestId('crew-suggest-apply').click();
  await expect(page.getByTestId('rp-worker')).toHaveCount(2);
  await page.getByTestId('rp-work').fill('Betonabplatzungen an Stütze B4 ausgebessert, Haftbrücke und Reparaturmörtel PCC; Baustelle nach Starkregen gereinigt. Anordnung ÖBA Hr. Mayer.');
  const hours = page.getByTestId('rp-worker-hours');
  await hours.nth(0).fill('8,5');
  await hours.nth(1).fill('8,5');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');
  await page.waitForTimeout(300);
  await shot(page, 'berichte-regie-editor');
  await page.getByTestId('report-pdf-btn').click();
  await expect(page.getByTestId('pdf-preview').getByTestId('preview-page').first()).toBeVisible();
  const [rdl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pdf-preview').getByTestId('preview-download').click()]);
  await saveDownload(rdl, join('site-shots', 'berichte-regie.pdf'));
  // Tagesbericht
  await page.getByTestId('to-reports').click();
  await page.getByTestId('report-group-new').click();
  d = page.getByTestId('report-new-dialog');
  await d.getByTestId('report-type-tag').click();
  await d.getByTestId('report-date').fill('2026-10-28');
  await d.getByTestId('report-create').click();
  await expect(page.getByTestId('report-title')).toHaveText('Bautagesbericht Nr. 1');
  await page.getByTestId('crew-import').click();
  await page.getByTestId('crew-suggest-apply').click();
  await page.getByTestId('rp-all-present').click();
  await page.getByTestId('rp-weather').fill('bewölkt, trocken, 8–14 °C');
  await page.getByTestId('rp-work').fill('Schalung Decke über 1. UG Achse 3–5 gestellt.\nBewehrung verlegt und abgenommen.\nBetonage 12 m³ C25/30.');
  await page.getByTestId('rp-incidents').fill('Kran bis 10:00 wegen Wind gesperrt.');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');
  await page.getByTestId('report-pdf-btn').click();
  await expect(page.getByTestId('pdf-preview').getByTestId('preview-page').first()).toBeVisible();
  const [tdl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('pdf-preview').getByTestId('preview-download').click()]);
  await saveDownload(tdl, join('site-shots', 'berichte-tag.pdf'));
  await page.getByTestId('to-reports').click();
  await expect(page.getByTestId('report-site-page')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, 'berichte-baustelle');

  // ── Fotodokumentation ──
  await page.goto('./#/fotos');
  await page.getByTestId('photo-new-site').click();
  await page.getByTestId('photo-site-name').fill('Tiefgarage Parkdeck Nord');
  await page.getByTestId('photo-site-number').fill('2026-07');
  await page.getByTestId('photo-site-address').fill('Industriestraße 12, 1230 Wien');
  await page.getByTestId('photo-site-save').click();
  await expect(page.getByTestId('photo-site-title')).toBeVisible();
  const names = ['riss', 'abplatzung', 'stuetze', 'decke', 'boden', 'wand'];
  const dates = ['2026:10:28 09:15:00', '2026:10:28 09:42:00', '2026:10:28 11:05:00', '2026:10:27 14:20:00', '2026:10:21 08:30:00', '2026:10:21 10:10:00'];
  const files = names.map((n, i) => ({ name: `IMG_${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(withExifDate(new Uint8Array(readFileSync(join(DEMO, `${n}.jpg`))), dates[i])) }));
  await page.getByTestId('photo-file-input').setInputFiles(files);
  const dlg = page.getByTestId('photo-save-dialog');
  await dlg.getByTestId('photo-user').fill('Max Muster');
  const descs = ['Riss Stütze B4', 'Abplatzung Decke Achse 3', 'Stütze C2 freigelegt', 'Decke 1. UG vor Betonage', 'Bodenplatte Feld 7', 'Wand Achse A'];
  for (const [i, t] of descs.entries()) await dlg.getByTestId('photo-pending-description').nth(i).fill(t);
  await dlg.getByTestId('photo-save').click();
  await expect(page.getByTestId('photo-thumb')).toHaveCount(6);
  await page.waitForTimeout(1200);
  await shot(page, 'fotos-baustelle');
  await page.getByTestId('photo-thumb').first().click();
  await expect(page.getByTestId('lightbox-image')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, 'fotos-gross');
  await page.getByTestId('lightbox-close').click();
  await page.getByTestId('photo-pdf').click();
  for (const a of await page.getByTestId('photo-group-all').all()) await a.check();
  await page.getByTestId('photo-selected-pdf').click();
  await page.getByTestId('pdf-per-page').selectOption('4');
  await page.getByTestId('pdf-title').fill('Fotodokumentation');
  const [fdl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('photo-pdf-create').click()]);
  await saveDownload(fdl, join('site-shots', 'fotos.pdf'));
  await page.getByTestId('to-photos').click();
  await page.waitForTimeout(600);
  await shot(page, 'fotos-uebersicht');
  // Tools-Übersicht
  await page.goto('./#/tools');
  await page.waitForTimeout(400);
  await shot(page, 'tools');
});
