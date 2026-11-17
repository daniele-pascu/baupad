import { join } from 'node:path';
import { expect, test } from './fixtures';
import { chooseMeasureType, createProject, FIXTURES, freshStart, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

test('Spurlinien im Aufmaß (importierter Plan): Ecke anfahren, Linie beginnt genau in ihrer Flucht', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Spuren', {}, ['Hof']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('S-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  // Kreis als Bezug (Mittelpunkt = angeklickte Stelle)
  await pickTool(page, 'tool-ellipse');
  await page.mouse.click(box.x + 260, box.y + 240);
  await dlg.getByTestId('input-length').fill('2');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  await page.keyboard.press('Escape');
  // Linie: Mittelpunkt anfahren (gemerkt), dann rechts davon knapp daneben → waagrechte Spurlinie
  await chooseMeasureType(page, 'laenge');
  await pickTool(page, 'tool-line');
  await page.mouse.move(box.x + 260, box.y + 240, { steps: 4 });
  await page.mouse.move(box.x + 420, box.y + 243, { steps: 1 });
  await page.mouse.move(box.x + 421, box.y + 243);
  await expect(page.locator('[data-testid="track-line"][data-axis="h"]')).toHaveCount(1);
  await page.mouse.click(box.x + 421, box.y + 243);
  await page.mouse.move(box.x + 421, box.y + 360, { steps: 6 });
  await page.mouse.click(box.x + 421, box.y + 360);
  await expect(dlg).toBeVisible();
  await dlg.getByTestId('input-length').fill('3'); // Plan ist nicht kalibriert
  await dlg.getByTestId('damage-save').click();
  await expect(dlg).toHaveCount(0);
  await waitSaved(page);
  const shapes = await page.evaluate(
    () =>
      new Promise<{ y: number; h: number; type: string }[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('damages').objectStore('damages').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as { shape: { y: number; h: number; type: string }; createdAt: number }[]).sort((a, b) => a.createdAt - b.createdAt).map((d) => d.shape));
          };
        };
      }),
  );
  expect(shapes).toHaveLength(2);
  // die Linie beginnt genau auf der Höhe des Kreismittelpunkts (nicht 3 px darunter)
  expect(shapes[1].y).toBeCloseTo(shapes[0].y + shapes[0].h / 2, 6);
});
