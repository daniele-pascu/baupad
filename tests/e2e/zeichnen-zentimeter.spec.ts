import { expect, test } from './fixtures';
import { createProject, freshStart, pickTool, waitSaved } from './helpers';
import type { Page } from '@playwright/test';

/** gespeicherte Zeichnungsobjekte (Meter) aus der Datenbank der App */
const elements = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ type: string; shape: { x: number; y: number; w: number; h: number }; createdAt: number }[]>((resolve, reject) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as { deletedAt: number | null; createdAt: number; type: string; shape: { x: number; y: number; w: number; h: number } }[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );
/** ganzes Vielfaches von 1 cm (Rundungsrest der Gleitkommazahl erlaubt) */
const isCm = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

test('Plan zeichnen: gezogene Formen und Linien sind immer zentimetergenau – auch von einem Punkt mit Millimeterwert aus', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Zentimeter', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  await page.getByTestId('new-drawing').locator('[data-field="planNumber"]').fill('Z-1');
  await page.getByTestId('new-drawing-save').click();
  await expect(page.getByTestId('drawing-sheet')).toBeVisible();
  // Rechteck mit Millimetermaß eintippen: seine rechte Kante liegt auf einem Millimeterwert
  await pickTool(page, 'draw-rect');
  await page.getByTestId('insert-length').fill('8,385');
  await page.getByTestId('insert-width').fill('5,005');
  await page.getByTestId('insert-submit').click();
  await expect(page.locator('[data-element="rect"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await waitSaved(page);
  const first = (await elements(page))[0].shape;
  expect([first.w, first.h]).toEqual([8.385, 5.005]); // getippte Maße bleiben millimetergenau
  expect(isCm(first.x + first.w) && isCm(first.y + first.h)).toBe(false); // Ecke unten rechts: Millimeterwert
  const b = (await page.locator('[data-element="rect"] path:last-child').first().boundingBox())!;
  // neues Rechteck: an der Ecke unten rechts des ersten ansetzen (rastet dort ein) und schräg ins Freie ziehen
  await pickTool(page, 'draw-rect');
  const [sx, sy] = [b.x + b.width, b.y + b.height];
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 37, sy + 23, { steps: 5 });
  await page.mouse.move(sx + 83.7, sy + 51.3, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-element="rect"]')).toHaveCount(2);
  await waitSaved(page);
  const second = (await elements(page))[1].shape;
  expect(Math.abs(second.x - (first.x + first.w))).toBeLessThan(1e-6); // an der Ecke eingerastet
  expect(second.w).toBeGreaterThan(0.5);
  expect([isCm(second.w), isCm(second.h)]).toEqual([true, true]); // Breite und Höhe in ganzen Zentimetern
  await page.keyboard.press('Escape');
  // Linie: Klick – Klick von derselben Ecke aus ins Freie → Länge in ganzen Zentimetern
  await pickTool(page, 'draw-line');
  await page.mouse.click(sx, sy);
  await page.mouse.click(sx - 61.3, sy + 47.9);
  await expect(page.locator('[data-element="line"]')).toHaveCount(1);
  await waitSaved(page);
  const line = (await elements(page)).find((e) => e.type === 'line')!.shape;
  // Länge aus den auf 0,1 mm gespeicherten Koordinaten: bis auf diese Rundung ein ganzer Zentimeterwert
  const len = Math.hypot(line.w, line.h);
  expect(len).toBeGreaterThan(0.5);
  expect(Math.abs(len - Math.round(len * 100) / 100)).toBeLessThan(2e-4);
});
