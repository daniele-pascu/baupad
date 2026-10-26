import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

/** Maßstab beim PDF-Import automatisch erkennen (Maßketten bzw. Maßstabsangabe) – Messwerte bleiben unverändert */

type Cal = { a: { x: number; y: number }; b: { x: number; y: number }; meters: number; auto?: { source: string; label: string } };
async function plans(page: Page): Promise<{ planNumber: string; calibration?: Cal }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('plans').objectStore('plans').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve(all.result);
          };
        };
      }),
  );
}
const upm = (c: Cal) => Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) / c.meters;

test('PDF mit Maßketten: Maßstab 1:50 erkannt und sofort skaliert; bestätigen, entfernen, neu erkennen', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Maßstab', {}, ['Keller']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const banner = page.getByTestId('scale-detected');
  await expect(page.getByTestId('scale-status')).toHaveAttribute('data-state', 'auto');
  await expect(page.getByTestId('scale-status')).toContainText('1:50 – prüfen');
  await expect(banner).toContainText('Maßstab 1:50');
  await expect(banner).toContainText('Maßlinien im Plan: 4 Maße in m'); // Maßzahlen an ihren Maßlinien
  await waitSaved(page);
  let cal = (await plans(page))[0].calibration!;
  expect(cal.auto).toMatchObject({ source: 'lines', label: '1:50', unit: 'm', count: 4 });
  expect(upm(cal)).toBeCloseTo(72 / 0.0254 / 50, 3);

  // Messen: Maßvorschlag und Fläche aus dem Plan sofort verfügbar
  const box = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, box.x + box.width * 0.3, box.y + box.height * 0.4, box.x + box.width * 0.5, box.y + box.height * 0.6);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg.getByTestId('use-suggestion')).toBeVisible();
  await expect(dlg.getByTestId('use-geometry')).toBeVisible();
  await dlg.getByTestId('damage-cancel').click();

  // bestätigen: Hinweis weg, Maßstab bleibt
  await page.getByTestId('scale-confirm').click();
  await expect(banner).toHaveCount(0);
  await waitSaved(page);
  cal = (await plans(page))[0].calibration!;
  expect(cal.auto).toMatchObject({ label: '1:50', confirmed: true }); // bleibt als „automatisch erkannt“ gekennzeichnet
  await expect(page.getByTestId('scale-status')).toHaveAttribute('data-state', 'confirmed');
  expect(upm(cal)).toBeCloseTo(72 / 0.0254 / 50, 3);

  // Kalibrierung entfernen und über „Automatisch erkennen“ wiederherstellen
  await pickTool(page, 'tool-calibrate');
  await page.getByTestId('calibration-remove').click();
  await waitSaved(page);
  expect((await plans(page))[0].calibration).toBeUndefined();
  await page.getByTestId('calibration-detect').click();
  await expect(page.getByTestId('calibration-info')).toContainText('Erkannt: 1:50');
  await waitSaved(page);
  expect(upm((await plans(page))[0].calibration!)).toBeCloseTo(72 / 0.0254 / 50, 3);
});

test('Foto ohne Text: kein Maßstab, kein Hinweis – Kalibrieren wie bisher', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Foto', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('F-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await expect(page.getByTestId('scale-detected')).toHaveCount(0);
  await waitSaved(page);
  expect((await plans(page))[0].calibration).toBeUndefined();
  await pickTool(page, 'tool-calibrate');
  await expect(page.getByTestId('calibration-detect')).toHaveCount(0);
});
