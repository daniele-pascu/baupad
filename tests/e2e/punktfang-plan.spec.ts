import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { createProject, drawRect, FIXTURES, freshStart, pickTool, planBox, waitForPlan, waitSaved } from './helpers';

/**
 * Punktfang auf den Linien des PDF-Plans (Vektor-PDF): Rechteck von Ecke zu Ecke des
 * Grundrisses – trifft die Ecken exakt, die Fläche stimmt mit dem Plan überein. Ohne Fang (X)
 * landet der Punkt dort, wo geklickt wurde.
 */

// Grundriss in massketten.pdf (Seitenkoordinaten, Ursprung oben links): 15,15 × 7,70 m bei 1:50
const K = 72 / 0.0254 / 50;
const ROOM = { x1: 120, y1: 842 - 160 - 7.7 * K, x2: 120 + 15.15 * K, y2: 842 - 160 };

type D = { number: number; shape: { x: number; y: number; w: number; h: number }; area: number | null };
async function damages(page: Page): Promise<D[]> {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('damages').objectStore('damages').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve(all.result.filter((d: { deletedAt: number | null }) => !d.deletedAt).sort((a: D, b: D) => a.number - b.number));
          };
        };
      }),
  );
}

test('Vektor-PDF: Ecken des Grundrisses werden exakt gefangen, Fläche aus dem Plan stimmt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Fang', {}, ['Keller']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'massketten.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('K-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  await waitSaved(page);
  const box = await planBox(page);
  const s = box.width / 1191; // Pixel je Seiteneinheit
  const scr = (x: number, y: number) => ({ x: box.x + x * s, y: box.y + y * s });

  // knapp neben den Ecken ansetzen (ca. 4 px)
  const a = scr(ROOM.x1 + 4 / s, ROOM.y2 - 4 / s);
  const b = scr(ROOM.x2 - 4 / s, ROOM.y1 + 4 / s);
  await pickTool(page, 'tool-rect');
  await page.mouse.move(a.x, a.y);
  await expect(page.getByTestId('snap-marker')).toBeVisible(); // Fangpunkt wird angezeigt
  await drawRect(page, a.x, a.y, b.x, b.y);
  const dlg = page.getByTestId('damage-dialog');
  await expect(dlg.getByTestId('use-geometry')).toContainText('116,66 m²'); // 15,15 × 7,70 = 116,655 m²
  await dlg.getByTestId('use-geometry').click();
  await expect(dlg.getByTestId('geometry-perimeter')).toHaveValue('45,70');
  await dlg.getByTestId('damage-save').click();
  await waitSaved(page);
  const [d1] = await damages(page);
  expect(d1.shape.x).toBeCloseTo(ROOM.x1, 1);
  expect(d1.shape.y).toBeCloseTo(ROOM.y1, 1);
  expect(d1.shape.x + d1.shape.w).toBeCloseTo(ROOM.x2, 1);
  expect(d1.shape.y + d1.shape.h).toBeCloseTo(ROOM.y2, 1);

  // Fang aus (X): Punkt bleibt, wo geklickt wurde
  // (an einer anderen Ecke, die noch nicht markiert ist: Linie der Maßkette oben)
  await pickTool(page, 'tool-rect');
  const c = scr(ROOM.x1 + 4 / s, ROOM.y1 - 30 - 4 / s);
  await page.mouse.move(c.x, c.y);
  await expect(page.getByTestId('snap-marker')).toBeVisible();
  await page.keyboard.press('x');
  await page.mouse.move(c.x - 1, c.y);
  await expect(page.getByTestId('snap-marker')).toHaveCount(0);
  await page.keyboard.press('x');
  await page.mouse.move(c.x + 1, c.y);
  await expect(page.getByTestId('snap-marker')).toBeVisible(); // Anfang der Maßlinie
});
