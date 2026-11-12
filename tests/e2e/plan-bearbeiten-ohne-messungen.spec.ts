import { expect, test } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';

/** Plan bearbeiten zeigt nur die Zeichnung – Messungen aus dem Aufmaß bleiben dort unsichtbar (keine „Reste“ im Hintergrund). */
test('Messungen erscheinen unter „Plan bearbeiten“ nicht, im Aufmaß schon', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshStart(page);
  await createProject(page, 'Ohne Reste', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('R-1');
  await nd.getByTestId('new-drawing-save').click();
  await page.getByTestId('mode-measure').click();
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  await pickTool(page, 'tool-rect');
  await page.mouse.move(sb.x + 200, sb.y + 200);
  await page.mouse.down();
  await page.mouse.move(sb.x + 260, sb.y + 240, { steps: 4 });
  await page.mouse.move(sb.x + 320, sb.y + 280, { steps: 4 });
  await page.mouse.up();
  const dlg = page.getByTestId('damage-dialog');
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('input-width').fill('1');
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toBeHidden();
  await waitSaved(page);
  await expect(page.locator('[data-damage]')).not.toHaveCount(0);
  const svgPaths = () => page.locator('[data-testid="plan-viewer"] svg path[stroke-dasharray="5 4"]');

  await page.getByTestId('mode-draw').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await expect(page.locator('[data-damage]')).toHaveCount(0);
  await expect(page.locator('.faded-markers')).toHaveCount(0);
  await expect(svgPaths()).toHaveCount(0);

  await page.getByTestId('mode-measure').click();
  await expect(page.locator('[data-damage]')).not.toHaveCount(0);
});
