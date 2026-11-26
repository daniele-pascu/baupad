import { expect, test } from './fixtures';
import { join } from 'node:path';
import { FIXTURES, createProject, freshStart, pickFreeColor, waitForPlan } from './helpers';

test('Eigene Farbe aus „Weitere Farben“ bleibt nach dem Neuladen gewählt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Farbe', {}, ['TG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('F-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  if (await page.getByTestId('tools-open').isVisible()) await page.getByTestId('tools-open').click();
  const more = page.getByTestId('color-more');
  await pickFreeColor(page, more, '#12ab9c');
  await expect(more).toHaveAttribute('data-value', '#12ab9c');
  await page.reload();
  await waitForPlan(page);
  if (await page.getByTestId('tools-open').isVisible()) await page.getByTestId('tools-open').click();
  await expect(page.getByTestId('color-more')).toHaveAttribute('data-value', '#12ab9c');
});
