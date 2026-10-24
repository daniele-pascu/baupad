import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, planBox, waitForPlan, waitSaved } from './helpers';

/** Phase 4: LV/MFK aus PDF importieren, prüfen, durchsuchen, Messungen zuordnen, Mengen. */
test('LV importieren, Prüfansicht, Suche, Messungen zuordnen und Aufmaßmengen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'LV-Test', {}, ['Garage']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('P-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();

  // Import mit Prüfansicht
  await page.getByTestId('tab-lv').click();
  await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, 'lv-beispiel.pdf'));
  const review = page.getByTestId('lv-review');
  await expect(review.getByTestId('lv-review-summary')).toContainText('4 Positionen');
  await expect(review.getByTestId('lv-review-summary')).toContainText('6.010,00 €');
  await expect(review.getByTestId('lv-review-summary')).toContainText('alle 2 Gruppensummen stimmen');
  await expect(review.getByTestId('lv-review-summary')).toContainText('1 Position(en) mit unsicheren Angaben');
  await expect(review.getByTestId('lv-name')).toHaveValue('Sanierung Tiefgarage Musterstrasse');
  await review.getByTestId('lv-review-save').click();
  await expect(page.getByTestId('lv-row')).toHaveCount(4);
  await expect(page.getByTestId('lv-flagged')).toContainText('1 Position');

  // Suche
  await page.getByTestId('lv-search').fill('sperr');
  await expect(page.getByTestId('lv-row')).toHaveCount(1);
  await page.getByTestId('lv-search').fill('');

  // Unsichere Position prüfen und bestätigen
  await page.locator('[data-testid="lv-row"][data-number="92 01 01 C"]').click();
  await page.getByTestId('lv-edit-position').click();
  await page.getByTestId('position-dialog').getByTestId('pos-save').click();
  await expect(page.getByTestId('lv-flagged')).toHaveCount(0);

  // Messungen im Plan den Positionen zuordnen
  await page.getByRole('tab', { name: /Liste/ }).click();
  await page.getByTestId('plan-open').first().click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  await page.getByTestId('tool-rect').click();
  await drawRect(page, box.x + box.width * 0.2, box.y + box.height * 0.3, box.x + box.width * 0.35, box.y + box.height * 0.45);
  await dlg.getByTestId('input-length').fill('4');
  await dlg.getByTestId('input-width').fill('2,5');
  await dlg.getByTestId('input-position').selectOption({ label: '92 01 01 B Sperrflaeche (m²)' });
  await dlg.getByTestId('damage-save').click();
  await expect(page.locator('[data-testid="aufmass-row"][data-number="1"] [data-testid="row-position"]')).toHaveText('92 01 01 B');
  await page.getByTestId('tool-line').click();
  await drawRect(page, box.x + box.width * 0.5, box.y + box.height * 0.3, box.x + box.width * 0.7, box.y + box.height * 0.35);
  await dlg.getByTestId('input-length').fill('12');
  await dlg.getByTestId('input-position').selectOption({ label: '92 01 01 A Linienmarkierung weiss (m)' });
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);

  // Planliste zeigt die Leistungen, LV die Aufmaßmengen: 10 m² × 25 € + 12 m × 3 € = 286 €
  await page.getByRole('link', { name: 'Zurück zur Planliste' }).click();
  await expect(page.getByTestId('plan-services')).toContainText('92 01 01 A');
  await expect(page.getByTestId('plan-services')).toContainText('92 01 01 B');
  await page.getByTestId('tab-lv').click();
  await expect(page.locator('[data-testid="lv-row"][data-number="92 01 01 B"] [data-testid="lv-measured"]')).toHaveText('10,00');
  await expect(page.locator('[data-testid="lv-row"][data-number="92 01 01 A"] [data-testid="lv-measured"]')).toHaveText('12,00');
  await expect(page.getByTestId('lv-measured-total')).toHaveText('286,00 €');

  // Nach dem Neuladen bleibt alles erhalten
  await page.reload();
  await page.getByTestId('tab-lv').click();
  await expect(page.getByTestId('lv-row')).toHaveCount(4);
  await expect(page.getByTestId('lv-measured-total')).toHaveText('286,00 €');
  await page.screenshot({ path: join(process.cwd(), 'tests', 'output', 'lv-pc.png'), fullPage: true });
});
