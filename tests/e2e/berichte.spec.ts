import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { catchDownload, createProject, freshStart, OUT, saveDownload } from './helpers';

/**
 * Berichte & Formulare: Regieliste, Bautagesbericht und Bauwochenbericht – Kopfdaten aus dem Projekt,
 * Mannschaft aus der Arbeitereinteilung (Vorschlag), Übersicht nach Baustelle, PDF, Kopieren.
 */

/** Projekt + Arbeitereinteilung: Max und Peter Mo–Fr auf der Baustelle des Projekts (KW 44/2026) */
async function setup(page: Page) {
  await freshStart(page);
  await createProject(page, 'Wohnanlage Sonnenhof', { number: '2026-04', address: 'Musterstraße 1, 4020 Linz', client: 'Muster GmbH' }, [{ number: '91092', name: 'Tiefgarage' }]);
  await page.goto('./#/arbeitereinteilung');
  await page.getByTestId('week-date').fill('2026-10-26');
  await page.getByTestId('crew-workers').click();
  const wd = page.getByTestId('workers-dialog');
  for (const [n, role] of [
    ['Max', 'Polier'],
    ['Peter', 'Facharbeiter'],
  ]) {
    await wd.getByTestId('worker-firstName').fill(n);
    await wd.getByTestId('worker-role').fill(role);
    await wd.getByTestId('worker-save').click();
    await expect(wd.getByTestId('worker-row').filter({ hasText: n })).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await page.getByTestId('add-site').click();
  const sd = page.getByTestId('site-dialog');
  await sd.getByTestId('site-project').selectOption({ label: '2026-04 · Wohnanlage Sonnenhof' });
  await sd.getByTestId('site-save').click();
  await page.locator('[data-site="Wohnanlage Sonnenhof"] [data-day="0"] [data-testid="day-add"]').click();
  const ad = page.getByTestId('assign-dialog');
  for (const n of ['Max', 'Peter']) await ad.locator(`[data-worker="${n}"] input`).check();
  await ad.getByTestId('assign-save').click();
  await expect(page.locator('[data-site="Wohnanlage Sonnenhof"] [data-day="2"] [data-testid="crew-chip"]')).toHaveText(['Max', 'Peter']);
}

async function newReport(page: Page, type: 'regie' | 'tag' | 'woche', date = '2026-10-28', fromGroup = false) {
  if (fromGroup) await page.getByTestId('report-group-new').first().click();
  else await page.getByTestId('report-new').click();
  const d = page.getByTestId('report-new-dialog');
  await d.getByTestId(`report-type-${type}`).click();
  await d.getByTestId('report-date').fill(date);
  await d.getByTestId('report-create').click();
  await expect(page.getByTestId('report-title')).toBeVisible();
}

test('Regieliste, Bautagesbericht und Wochenbericht: Übernahme aus Projekt und Arbeitereinteilung, Übersicht, PDF, Kopie', async ({ page }) => {
  test.setTimeout(120_000);
  await setup(page);

  // Tools → Berichte & Formulare (leer)
  await page.goto('./#/tools');
  await page.getByTestId('tool-reports').click();
  await expect(page.getByTestId('reports-title')).toHaveText('Berichte & Formulare');
  await expect(page.getByTestId('reports-empty')).toBeVisible();

  // 1) Regieliste – Kopf aus dem Projekt
  await newReport(page, 'regie');
  await expect(page.getByTestId('report-title')).toHaveText('Regieliste Nr. 1');
  await expect(page.getByTestId('rp-project')).toHaveValue('Wohnanlage Sonnenhof');
  await expect(page.getByTestId('rp-address')).toHaveValue('Musterstraße 1, 4020 Linz');
  await expect(page.getByTestId('rp-client')).toHaveValue('Muster GmbH');
  await expect(page.getByTestId('rp-number')).toHaveValue('2026-04');
  await expect(page.getByTestId('rp-costcenter')).toHaveValue('91092 – Tiefgarage');
  // Mannschaft aus der Arbeitereinteilung (Vorschlag, Auswahl)
  await page.getByTestId('crew-import').click();
  await expect(page.getByTestId('crew-suggest-row')).toHaveCount(2);
  await page.getByTestId('crew-suggest-apply').click();
  const rows = page.getByTestId('rp-worker');
  await expect(rows.nth(0).getByTestId('rp-worker-name')).toHaveValue('Max');
  await expect(rows.nth(1).getByTestId('rp-worker-name')).toHaveValue('Peter');
  // Stunden: Max aus Beginn/Ende/Pause, Peter von Hand
  await rows.nth(0).getByTestId('rp-worker-from').fill('07:00');
  await rows.nth(0).getByTestId('rp-worker-to').fill('16:00');
  await rows.nth(0).getByTestId('rp-worker-pause').fill('30');
  await expect(rows.nth(0).getByTestId('rp-worker-hours')).toHaveAttribute('placeholder', '8,5');
  await rows.nth(1).getByTestId('rp-worker-hours').fill('4');
  await expect(page.getByTestId('rp-total')).toContainText('12,5 Std.');
  await page.getByTestId('rp-work').fill('Betonabplatzungen an Stütze B4 ausgebessert, auf Anordnung der Bauleitung.');
  await page.getByTestId('rp-materials-add').click();
  await page.getByTestId('rp-materials-row').locator('input').nth(0).fill('3');
  await page.getByTestId('rp-materials-row').locator('input').nth(1).fill('Sack');
  await page.getByTestId('rp-materials-row').locator('input').nth(2).fill('Reparaturmörtel');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');
  await page.screenshot({ path: join(OUT, 'bericht-regie.png'), fullPage: true });
  // PDF-Vorschau
  await page.getByTestId('report-pdf-btn').click();
  await expect(page.getByTestId('pdf-preview')).toBeVisible();
  await expect(page.getByTestId('pdf-file-name')).toHaveValue(/^Regieliste_Wohnanlage_Sonnenhof_Nr1_2026-10-28$/);
  await page.getByTestId('preview-back').click();
  await page.getByTestId('report-status-toggle').click();
  await expect(page.getByTestId('report-status-toggle')).toContainText('Fertig');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');

  // nach dem Neuladen alles da
  await page.reload();
  await expect(page.getByTestId('rp-worker')).toHaveCount(2);
  await expect(page.getByTestId('rp-total')).toContainText('12,5 Std.');

  // 2) Bautagesbericht – geplant vs. anwesend
  await page.getByTestId('to-reports').click();
  await newReport(page, 'tag', '2026-10-28', true);
  await expect(page.getByTestId('report-title')).toHaveText('Bautagesbericht Nr. 1');
  await page.getByTestId('crew-import').click();
  await page.getByTestId('crew-suggest-apply').click();
  await expect(page.getByTestId('rp-unconfirmed')).toContainText('2 laut Einteilung');
  await expect(page.getByTestId('rp-present-count')).toContainText('Anwesend: 0');
  await page.getByTestId('rp-all-present').click();
  await expect(page.getByTestId('rp-unconfirmed')).toHaveCount(0);
  await page.getByTestId('rp-crew-row').nth(1).getByTestId('rp-crew-present').uncheck(); // Peter war doch nicht da
  await expect(page.getByTestId('rp-present-count')).toContainText('Anwesend: 1 Person');
  await page.getByTestId('rp-weather').fill('bewölkt');
  await page.getByTestId('rp-work').fill('Schalung Stützen Achse 3.');
  await page.getByTestId('rp-incidents').fill('Betonlieferung 2 Std. verspätet.');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');

  // 3) Wochenbericht – aus Tagesberichten derselben Baustelle
  await page.getByTestId('to-reports').click();
  await newReport(page, 'woche', '2026-10-29', true);
  await expect(page.getByTestId('report-title')).toHaveText('Bauwochenbericht Nr. 1');
  await page.getByTestId('rp-from-daily').click();
  const wed = page.locator('[data-testid="rp-day"][data-date="2026-10-28"]');
  await expect(wed.getByTestId('rp-day-count')).toHaveValue('1');
  await expect(wed.getByTestId('rp-day-names')).toHaveValue('Max');
  await expect(wed.getByTestId('rp-day-work')).toHaveValue('Schalung Stützen Achse 3.');
  await expect(page.getByTestId('rp-events')).toHaveValue(/Betonlieferung 2 Std\. verspätet\./);
  // Mannschaft der übrigen Tage aus der Einteilung (bereits ausgefüllte Tage bleiben)
  await page.getByTestId('rp-from-crew').click();
  const mon = page.locator('[data-testid="rp-day"][data-date="2026-10-26"]');
  await expect(mon.getByTestId('rp-day-count')).toHaveValue('2');
  await expect(wed.getByTestId('rp-day-count')).toHaveValue('1');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');

  // Baustelle: drei Listen (Regielisten, Tagesberichte, Wochenberichte) mit je einem Bericht; Auswahl → ein PDF
  await page.getByTestId('to-reports').click();
  await expect(page.getByTestId('report-site-page')).toHaveAttribute('data-site', 'Wohnanlage Sonnenhof');
  await expect(page.getByTestId('report-section')).toHaveCount(3);
  await expect(page.getByTestId('report-item')).toHaveCount(3);
  for (const [i, type] of ['regie', 'tag', 'woche'].entries()) await expect(page.getByTestId('report-section').nth(i).getByTestId('report-item')).toHaveAttribute('data-type', type);
  await expect(page.locator('[data-testid="report-item"][data-type="regie"] [data-testid="report-status"]')).toHaveText('Fertig');
  await page.screenshot({ path: join(OUT, 'berichte-baustelle.png'), fullPage: true });
  await page.getByTestId('report-select').click();
  await expect(page.getByTestId('report-selected-pdf')).toBeDisabled();
  await page.getByTestId('report-section').nth(0).getByTestId('report-section-all').check();
  await page.locator('[data-testid="report-item"][data-type="tag"] .report-link').click();
  await expect(page.getByTestId('report-selection-bar')).toContainText('2 ausgewählt');
  await page.getByTestId('report-selected-pdf').click();
  await expect(page.getByTestId('pdf-preview')).toBeVisible();
  await expect(page.getByTestId('pdf-file-name')).toHaveValue(/^Berichte_Wohnanlage_Sonnenhof_\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId('preview-page')).toHaveCount(2); // Regieliste + Tagesbericht in einem PDF
  await page.getByTestId('preview-back').click();
  await page.getByTestId('report-select').click(); // Fertig
  // Teilen ohne Umweg: alle Berichte der Baustelle als ein PDF (am PC wird die Datei heruntergeladen)
  const shared = await catchDownload(page, () => page.getByTestId('report-share-all').click());
  expect(shared.suggestedFilename()).toMatch(/^Berichte_Wohnanlage_Sonnenhof_.*\.pdf$/);
  // Übersicht: eine Baustelle mit Anzahl je Typ; zurück zur Baustelle, Kopie
  await page.getByTestId('to-reports-overview').click();
  await expect(page.getByTestId('report-site')).toHaveCount(1);
  await expect(page.getByTestId('report-site')).toContainText('3 Berichte');
  await page.getByTestId('report-search').fill('Halle');
  await expect(page.getByTestId('report-site')).toHaveCount(0);
  await page.getByTestId('report-search').fill('');
  await page.screenshot({ path: join(OUT, 'berichte-uebersicht.png'), fullPage: true });
  await page.getByTestId('report-site').click();
  await page.locator('[data-testid="report-item"][data-type="regie"]').getByTestId('report-actions').click();
  await page.getByTestId('report-copy').click();
  await expect(page.getByTestId('report-title')).toHaveText('Regieliste Nr. 2');
  await expect(page.getByTestId('rp-worker')).toHaveCount(2);
  await expect(page.getByTestId('report-status-toggle')).not.toContainText('Fertig');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');

  // Projektsicherung enthält die Berichte des Projekts → auf „neuem Gerät“ wieder da
  await page.goto('./#/projekte');
  await page.getByTestId('project-card').click();
  const dl = await catchDownload(page, () => page.getByTestId('backup-project').click());
  const file = await saveDownload(dl, 'projekt-mit-berichten.zip');
  await freshStart(page);
  await page.goto('./#/projekte');
  await page.getByTestId('import-project-input').setInputFiles(file);
  await expect(page.getByTestId('project-title')).toHaveText('Wohnanlage Sonnenhof');
  await page.goto('./#/berichte');
  await expect(page.getByTestId('report-site')).toHaveAttribute('data-site', 'Wohnanlage Sonnenhof');
  await expect(page.getByTestId('report-site')).toContainText('4 Berichte');
  await page.getByTestId('report-site').click();
  await expect(page.getByTestId('report-item')).toHaveCount(4);
});

test('Ohne Projekt und ohne Arbeitereinteilung: Baustelle frei eingeben, Arbeiter von Hand', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/berichte');
  await page.getByTestId('report-new').click();
  const d = page.getByTestId('report-new-dialog');
  await expect(d.getByTestId('report-site')).toHaveValue('');
  await d.getByTestId('report-create').click();
  await expect(d).toContainText('Bitte ein Projekt wählen.');
  await d.getByTestId('report-site').selectOption('__new');
  await page.getByTestId('photo-site-name').fill('Halle 3');
  await page.getByTestId('photo-site-save').click();
  await expect(d.getByTestId('report-site')).toHaveValue(/\|Halle 3$/);
  await d.getByTestId('report-create').click();
  await expect(page.getByTestId('report-title')).toHaveText('Regieliste Nr. 1');
  await expect(page.getByTestId('rp-site')).toHaveValue('Halle 3');
  await page.getByTestId('crew-import').click();
  await expect(page.getByTestId('crew-suggest')).toContainText('niemand eingeteilt');
  await page.getByTestId('crew-add').selectOption('frei');
  await page.getByTestId('rp-worker-name').fill('Hans Huber');
  await page.getByTestId('rp-worker-hours').fill('6');
  await expect(page.getByTestId('rp-total')).toContainText('6 Std.');
  await expect(page.getByTestId('save-state')).toHaveText('gespeichert');
  await page.getByTestId('to-reports').click();
  await expect(page.getByTestId('report-site-page')).toHaveAttribute('data-site', 'Halle 3');
  await page.getByTestId('to-reports-overview').click();
  await expect(page.getByTestId('report-site')).toHaveAttribute('data-site', 'Halle 3');

  // Sicherung aller Berichte speichern und auf „neuem Gerät“ wiederherstellen
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('reports-more').click();
    await page.getByTestId('reports-backup').click();
  });
  expect(dl.suggestedFilename()).toMatch(/^BauPad_Berichte_\d{4}-\d{2}-\d{2}\.json$/);
  const file = await saveDownload(dl, 'berichte-sicherung.json');
  await freshStart(page);
  await page.goto('./#/berichte');
  await expect(page.getByTestId('reports-empty')).toBeVisible();
  await page.getByTestId('reports-restore-input').setInputFiles(file);
  await expect(page.locator('.toast', { hasText: '1 Bericht(e) übernommen' })).toHaveCount(1);
  await page.getByTestId('report-site').click();
  await expect(page.getByTestId('report-item')).toHaveCount(1);
  await page.getByTestId('report-item').locator('a').click();
  await expect(page.getByTestId('rp-worker-name')).toHaveValue('Hans Huber');
});
