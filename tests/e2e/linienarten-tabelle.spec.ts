import { join } from 'node:path';
import { expect, test } from './fixtures';
import { chooseMeasureType, createProject, FIXTURES, freshStart, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

test('Aufmaß-Tabelle: Längen je Linienart getrennt, jede mit eigener Summe', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Linienarten', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('L-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  await chooseMeasureType(page, 'laenge');
  const line = async (y: number, len: string) => {
    await pickTool(page, 'tool-line');
    await page.mouse.click(box.x + 200, box.y + y);
    await page.mouse.click(box.x + 400, box.y + y);
    await dlg.getByTestId('input-length').fill(len);
    await dlg.getByTestId('damage-save').click();
    await expect(dlg).toHaveCount(0);
    await waitSaved(page);
  };
  await line(200, '3');
  await page.keyboard.press('Escape');
  await line(300, '5');
  const types = page.locator('[data-testid="aufmass-type"][data-type="laenge"]');
  // beide durchgezogen: eine Tabelle ohne Zusatz
  await expect(types).toHaveCount(1);
  await expect(types.locator('h3')).toContainText('2 Messungen');
  // zweite Linie gestrichelt → zwei Tabellen, jede mit eigener Summe
  await page.getByTestId('style-toggle').click();
  await page.getByTestId('style-panel').getByTestId('style-line-type').selectOption('dashed');
  await waitSaved(page);
  await expect(types).toHaveCount(2);
  await expect(types.nth(0).locator('h3')).toContainText('Durchgezogen');
  await expect(types.nth(0)).toContainText('3,00 m');
  await expect(types.nth(0)).not.toContainText('5,00');
  await expect(types.nth(1).locator('h3')).toContainText('Gestrichelt');
  await expect(types.nth(1)).toContainText('5,00 m');
  // Gesamtsumme der Linien bleibt
  await expect(page.getByTestId('sum-length')).toHaveText('8,00 m');
});
