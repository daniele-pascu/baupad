import { expect, test } from './fixtures';
import { join } from 'node:path';
import { FIXTURES, createProject, drawRect, fillMeasures, freshStart, planBox, waitForPlan, waitSaved, pickTool } from './helpers';

/**
 * Autospeichern unter Last: Viele schnelle Änderungen am selben Datensatz – auch während eine
 * Speicherung noch läuft – dürfen keinen falschen „Konflikt“ auslösen und müssen alle
 * gespeichert werden.
 */
test('Schnelle Folgeänderungen an derselben Schadstelle werden ohne Fehlkonflikt gespeichert', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Autospeichern', {}, ['TG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('S-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.3, box.y + box.height * 0.3, box.x + box.width * 0.45, box.y + box.height * 0.45);
  await fillMeasures(page, '1', '1', '0,02');
  await pickTool(page, 'tool-select');
  await page.locator('[data-testid="aufmass-row"][data-number="1"]').click();

  // Farbwechsel in unregelmäßigen Abständen rund um die Speicherverzögerung (250 ms)
  const colors = ['Blau', 'Grün', 'Gelb', 'Orange', 'Violett', 'Rot'];
  const waits = [0, 240, 255, 260, 5, 250, 270, 245, 252, 30, 258, 262, 249, 251, 0, 256, 300, 248, 253, 247];
  for (let i = 0; i < waits.length; i++) {
    await page.getByRole('button', { name: `Farbe ${colors[i % colors.length]}` }).click();
    await page.waitForTimeout(waits[i]);
    await expect(page.getByTestId('save-status')).not.toHaveAttribute('data-status', /conflict|error/, { timeout: 100 });
  }
  const last = colors[(waits.length - 1) % colors.length];
  await waitSaved(page);
  await page.reload();
  await waitForPlan(page);
  await page.locator('[data-testid="aufmass-row"][data-number="1"]').click();
  // Die zuletzt gewählte Farbe ist dauerhaft gespeichert
  const hex = { Rot: '#e03131', Blau: '#1c7ed6', Grün: '#2f9e44', Gelb: '#f5b800', Orange: '#f76707', Violett: '#9c36b5' }[last];
  await expect(page.locator('.viewer-overlay path[data-damage]').first()).toHaveAttribute('stroke', hex!);
});
