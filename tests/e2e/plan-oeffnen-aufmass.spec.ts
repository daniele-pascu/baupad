import { expect, test } from './fixtures';
import { chooseMeasureType, createProject, freshStart, pickTool, waitSaved } from './helpers';

/**
 * Gezeichneter Plan: ohne Messungen öffnet er in „Plan bearbeiten“; sobald ein Aufmaß darauf gemacht wurde,
 * öffnet er im Aufmaß. Der zuletzt gewählte Modus gilt nur kurz weiter (Neuladen mitten in der Arbeit).
 */
test('Gezeichneter Plan mit Messungen öffnet im Aufmaß, ohne Messungen in „Plan bearbeiten“', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Öffnen', {}, ['EG']);
  const projectUrl = page.url();
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('Z-1');
  await nd.getByTestId('new-drawing-save').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  const drawTab = page.getByTestId('mode-draw');
  await expect(drawTab).toHaveAttribute('aria-selected', 'true');
  /** so tun, als wäre der Plan zuletzt vor längerer Zeit geöffnet gewesen (gemerkter Modus ist abgelaufen) */
  const expire = () =>
    page.evaluate(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith('editorMode:')) localStorage.setItem(k, `${localStorage.getItem(k)!.split('|')[0]}|1`);
    });

  // noch keine Messung: später wieder geöffnet → „Plan bearbeiten“
  await expire();
  await page.goto(projectUrl);
  await page.getByTestId('plan-row').first().getByTestId('plan-open').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await expect(drawTab).toHaveAttribute('aria-selected', 'true');

  // eine Messung im Aufmaß erfassen, danach zurück in „Plan bearbeiten“ wechseln
  await page.getByTestId('mode-measure').click();
  await chooseMeasureType(page, 'flaeche');
  await pickTool(page, 'tool-rect');
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  await page.mouse.move(sb.x + 150, sb.y + 150);
  await page.mouse.down();
  await page.mouse.move(sb.x + 200, sb.y + 190, { steps: 4 });
  await page.mouse.move(sb.x + 250, sb.y + 230, { steps: 4 });
  await page.mouse.up();
  const md = page.getByTestId('damage-dialog');
  await md.getByTestId('input-length').fill('2');
  await md.getByTestId('input-width').fill('1');
  await md.getByTestId('damage-save').click();
  await expect(md).toBeHidden();
  await waitSaved(page);
  await drawTab.click();
  await expect(drawTab).toHaveAttribute('aria-selected', 'true');

  // gleich neu geladen (mitten in der Arbeit): bleibt in „Plan bearbeiten“
  await page.reload();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await expect(drawTab).toHaveAttribute('aria-selected', 'true');

  // später wieder geöffnet: der Plan hat ein Aufmaß → öffnet im Aufmaß
  await expire();
  await page.goto(projectUrl);
  await page.getByTestId('plan-row').first().getByTestId('plan-open').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  await expect(page.getByTestId('mode-measure-tab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('aufmass-row')).toHaveCount(1);
});
