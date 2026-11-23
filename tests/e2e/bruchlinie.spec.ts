import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, freshStart, pickTool, saveDownload, waitSaved } from './helpers';

/** Plan zeichnen: Bruchlinie – Linie mit Zickzack, blendet die Zeichnung dahinter aus; Seite wechselbar; im PDF. */

type El = { id: string; type: string; breakSide?: number; createdAt: number; deletedAt: number | null };
const elements = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<El[]>((resolve) => {
        const req = indexedDB.open('schadstellen-aufmass');
        req.onsuccess = () => {
          const all = req.result.transaction('elements').objectStore('elements').getAll();
          all.onsuccess = () => {
            req.result.close();
            resolve((all.result as El[]).filter((d) => !d.deletedAt).sort((a, b) => a.createdAt - b.createdAt));
          };
        };
      }),
  );

test('Bruchlinie: blendet die Zeichnung dahinter aus, Seite wechseln, Text bleibt sichtbar, PDF', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Bruchlinie', {}, ['EG']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('BL-1');
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  const sb = (await sheet.boundingBox())!;
  // Bauteil: Rechteck von x = 200 bis 700
  await pickTool(page, 'draw-rect');
  await page.mouse.move(sb.x + 200, sb.y + 250);
  await page.mouse.down();
  await page.mouse.move(sb.x + 450, sb.y + 300, { steps: 4 });
  await page.mouse.move(sb.x + 700, sb.y + 350, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  // Bruchlinie senkrecht bei x = 300 (links davon ist weniger Zeichnung → wird ausgeblendet)
  await pickTool(page, 'draw-breakline');
  await expect(page.getByTestId('insert-bar')).toContainText('Bruchlinie');
  await page.mouse.click(sb.x + 300, sb.y + 200);
  await page.mouse.click(sb.x + 300, sb.y + 400);
  const br = page.locator('[data-element="break"]');
  await expect(br).toHaveCount(1);
  const mask = page.getByTestId('break-mask');
  await expect(mask).toHaveCount(1);
  const m0 = (await mask.boundingBox())!;
  // links der Linie, bis zur linken Kante des Rechtecks (mit etwas Zugabe)
  expect(m0.x + m0.width).toBeLessThan(sb.x + 302);
  expect(m0.x).toBeLessThan(sb.x + 201);
  // liegt über dem Rechteck: Bruchlinie wird nach der Zeichnung gezeichnet
  const order = await page.evaluate(() => [...document.querySelectorAll('[data-element]')].map((e) => e.getAttribute('data-element')));
  expect(order.indexOf('break')).toBeGreaterThan(order.indexOf('rect'));
  await waitSaved(page);
  // von oben nach unten gezeichnet: Bildschirm links = in Zeichenrichtung rechts (-1)
  expect((await elements(page)).find((e) => e.type === 'break')!.breakSide).toBe(-1);

  // Seite wechseln: jetzt wird rechts ausgeblendet
  await page.getByTestId('element-bar').getByTestId('break-flip').click();
  await expect.poll(async () => (await mask.boundingBox())!.x).toBeGreaterThan(sb.x + 298);
  const m1 = (await mask.boundingBox())!;
  expect(m1.x + m1.width).toBeGreaterThan(sb.x + 699);
  await waitSaved(page);
  expect((await elements(page)).find((e) => e.type === 'break')!.breakSide).toBe(1);
  await page.getByTestId('element-bar').getByTestId('break-flip').click();
  await expect.poll(async () => (await mask.boundingBox())!.x).toBeLessThan(sb.x + 201);
  await page.keyboard.press('Escape');

  // Text im ausgeblendeten Bereich bleibt sichtbar (über der Bruchlinie)
  await pickTool(page, 'draw-text');
  await page.mouse.click(sb.x + 215, sb.y + 300);
  const td = page.getByTestId('text-dialog');
  await td.getByTestId('text-input').fill('Estrich');
  await td.getByRole('button', { name: 'Einfügen' }).click();
  await expect(page.locator('[data-element="text"]')).toContainText('Estrich');
  const order2 = await page.evaluate(() => [...document.querySelectorAll('[data-element]')].map((e) => e.getAttribute('data-element')));
  expect(order2.indexOf('text')).toBeGreaterThan(order2.indexOf('break'));
  await waitSaved(page);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join('tests', 'output', 'bruchlinie.png') });

  // nach dem Neuladen erhalten; PDF
  await page.reload();
  await expect(page.getByTestId('break-mask')).toHaveCount(1);
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'bruchlinie.pdf');
  execFileSync('pdftoppm', ['-png', '-r', '80', '-singlefile', pdf, join('tests', 'output', 'bruchlinie-pdf')]);
});
