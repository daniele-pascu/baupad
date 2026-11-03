import { expect, test } from './fixtures';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

test('Abzug im Plan zeichnen: Maße werden aus dem Plan erkannt, nummeriert und schraffiert angezeigt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Abzüge', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('page-tile').nth(1).click();
  await wiz.getByTestId('pages-next').click();
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('AB-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  // Maßstab ist erkannt (1:100) → Flächen aus dem Plan
  const confirm = page.getByTestId('scale-confirm');
  if (await confirm.isVisible()) await confirm.click();
  const box = await planBox(page);
  const at = (fx: number, fy: number) => [box.x + box.width * fx, box.y + box.height * fy] as const;
  await pickTool(page, 'tool-rect');
  await drawRect(page, ...at(0.3, 0.3), ...at(0.6, 0.6));
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg).toBeVisible();
  // Fläche aus dem Plan übernehmen
  const geo = dlg.getByTestId('use-geometry').first();
  if ((await geo.getAttribute('aria-pressed')) !== 'true') await geo.click();
  // Abzug im Plan zeichnen: Fenster blendet sich aus, Hinweis oben
  await dlg.getByTestId('deduction-draw').click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('ded-draw-bar')).toBeVisible();
  await drawRect(page, ...at(0.4, 0.4), ...at(0.45, 0.5));
  // zurück im Fenster: Zeile „Abzug 1“ mit erkannten Maßen
  await expect(dlg).toBeVisible();
  await expect(page.getByTestId('ded-draw-bar')).toHaveCount(0);
  const row = dlg.getByTestId('deduction-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('deduction-label')).toHaveValue('Abzug 1');
  const l = Number((await row.getByTestId('deduction-length').inputValue()).replace(',', '.'));
  const w = Number((await row.getByTestId('deduction-width').inputValue()).replace(',', '.'));
  expect(l).toBeGreaterThan(0);
  expect(w).toBeGreaterThan(l); // höher als breit gezogen
  await expect(page.getByTestId('ded-shape')).toHaveCount(1);
  // zweiter Abzug → „Abzug 2“
  await dlg.getByTestId('deduction-draw').click();
  await drawRect(page, ...at(0.5, 0.35), ...at(0.55, 0.4));
  await expect(dlg.getByTestId('deduction-row')).toHaveCount(2);
  await expect(dlg.getByTestId('deduction-row').nth(1).getByTestId('deduction-label')).toHaveValue('Abzug 2');
  await expect(dlg.getByTestId('deduction-sum')).toContainText('netto');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await waitSaved(page);
  // gespeichert: im Plan schraffiert mit Nummer der Messung
  await expect(page.getByTestId('ded-shape')).toHaveCount(2);
  await expect(page.getByTestId('ded-overlay').locator('text')).toHaveText(['1-A1', '1-A2']);
  await page.reload();
  await waitForPlan(page);
  await expect(page.getByTestId('ded-shape')).toHaveCount(2);
});
