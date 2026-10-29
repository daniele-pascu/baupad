import { expect, test, type Page } from './fixtures';
import { join } from 'node:path';
import { createProject, FIXTURES, freshStart, OUT, pickTool, waitForPlan, waitSaved } from './helpers';

/**
 * Maßangaben aus dem Plan: Maßzahl (Einheit cm, auch „515,5“) ↔ Maßlinie mit Begrenzungen →
 * Maßstab; falsches Maß gekennzeichnet und nicht verwendet; Prüfen, Korrigieren, Übernehmen.
 */

const K = 72 / 0.0254 / 50;
type Cal = { a: { x: number; y: number }; b: { x: number; y: number }; meters: number; auto?: { source: string; label: string; unit?: string; count?: number; confirmed?: boolean; warning?: string } };
async function calibration(page: Page): Promise<Cal> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('plans').objectStore('plans').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve(all.result[0].calibration);
          };
        };
      }),
  );
}
const upm = (c: Cal) => Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) / c.meters;

test('Maßlinien in cm: automatisch 1:50 beim Import, falsches Maß gekennzeichnet; prüfen, korrigieren, übernehmen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Maßlinien', {}, ['EG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'masslinien.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('G-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);

  // Import: Maßstab aus den Maßlinien (cm), Raumnummer/Fläche ignoriert, „420“ passt nicht
  const banner = page.getByTestId('scale-detected');
  await expect(banner).toContainText('Maßstab 1:50');
  await expect(banner).toContainText('Maßlinien im Plan: 4 Maße in cm');
  await expect(banner).toContainText('1 von 5 Maßen passen nicht');
  let cal = await calibration(page);
  expect(cal.auto).toMatchObject({ source: 'lines', unit: 'cm', count: 4 });
  expect(upm(cal)).toBeCloseTo(K, 3); // genau 1:50

  // Prüfen
  await pickTool(page, 'tool-calibrate');
  await page.getByTestId('calibration-dims').click();
  const dlg = page.getByTestId('dimension-review');
  await expect(dlg.getByTestId('dims-summary')).toContainText('4 von 5');
  await expect(dlg.getByTestId('dims-summary')).toContainText('1:50');
  const row = (v: string) => dlg.getByTestId('dims-row').filter({ has: page.locator(`input[data-testid="dims-value"][value="${v}"]`) });
  await expect(row('515,5')).toContainText('5,155'); // 515,5 cm = 5,155 m
  await expect(row('515,5')).toContainText('passt');
  await expect(row('420')).toContainText('widersprüchlich');
  await expect(row('420').getByTestId('dims-use')).not.toBeChecked();
  await page.screenshot({ path: join(OUT, 'masse-aus-plan.png') });

  // Einheit mm: andere Deutung → anderer Maßstab
  await dlg.getByTestId('dims-unit').selectOption('mm');
  await expect(dlg.getByTestId('dims-summary')).toContainText('1:5');
  await dlg.getByTestId('dims-unit').selectOption('auto');

  // falsches Maß korrigieren (400 statt 420) → alle 5 passen
  await row('420').getByTestId('dims-value').fill('400');
  await expect(dlg.getByTestId('dims-summary')).toContainText('5 von 5');
  await dlg.getByTestId('dims-apply').click();
  await waitSaved(page);
  cal = await calibration(page);
  expect(cal.auto).toMatchObject({ source: 'lines', unit: 'cm', count: 5, confirmed: true });
  expect(upm(cal)).toBeCloseTo(K, 3);
  await expect(page.getByTestId('scale-status')).toHaveAttribute('data-state', 'confirmed');
});
