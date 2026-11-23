import { expect, test, type Page } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, freshStart, pickTool, saveDownload, waitSaved } from './helpers';

/** Plan zeichnen: Text mit Pfeil – Pfeilspitze, dann Textstelle; Spitze verschiebbar; in Ansicht und PDF. */

async function newDrawing(page: Page) {
  await freshStart(page);
  await createProject(page, 'Text mit Pfeil', {}, ['Keller']);
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('TP-1');
  await nd.getByTestId('new-drawing-save').click();
  const sheet = page.getByTestId('drawing-sheet');
  await expect(sheet).toBeVisible();
  return (await sheet.boundingBox())!;
}
const center = async (page: Page, id: string) => {
  const b = (await page.getByTestId(id).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('Text mit Pfeil: einfügen, Spitze verschieben, gespeichert und im PDF', async ({ page }) => {
  const sb = await newDrawing(page);
  await pickTool(page, 'draw-textArrow');
  await expect(page.getByTestId('insert-bar')).toContainText('Pfeilspitze');
  const tip = { x: sb.x + 200, y: sb.y + 300 };
  const at = { x: sb.x + 360, y: sb.y + 200 };
  await page.mouse.click(tip.x, tip.y);
  await page.mouse.click(at.x, at.y);
  const td = page.getByTestId('text-dialog');
  await td.getByTestId('text-input').fill('Riss prüfen');
  await td.getByRole('button', { name: 'Einfügen' }).click();
  const callout = page.locator('[data-element="text"][data-callout="1"]');
  await expect(callout).toContainText('Riss prüfen');
  await expect(callout.getByTestId('callout-arrow')).toHaveCount(1);
  // Text rechts der Spitze: Text beginnt an der angetippten Stelle
  const tb = (await callout.locator('text').boundingBox())!;
  expect(tb.x).toBeGreaterThan(at.x - 6);
  // Spitze liegt dort, wo angetippt wurde (Anfasser)
  const h0 = await center(page, 'tip-handle');
  expect(Math.hypot(h0.x - tip.x, h0.y - tip.y)).toBeLessThan(4);

  // Spitze ziehen: Pfeil folgt, Text bleibt
  await page.mouse.move(h0.x, h0.y);
  await page.mouse.down();
  await page.mouse.move(h0.x - 40, h0.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await center(page, 'tip-handle')).y).toBeGreaterThan(h0.y + 40);
  const tb2 = (await callout.locator('text').boundingBox())!;
  expect(Math.abs(tb2.x - tb.x)).toBeLessThan(2);
  await waitSaved(page);

  // Text verschieben: Pfeil wandert mit (Antippen des Pfeils wählt den Text)
  await page.locator('body').press('Escape');
  await expect(page.getByTestId('tip-handle')).toHaveCount(0);
  // Mitte des Pfeils (zwischen neuer Spitze und Text) antippen
  const tip2 = { x: h0.x - 40, y: h0.y + 60 };
  await page.mouse.click(tip2.x + (tb.x - tip2.x) * 0.3, tip2.y + (tb.y + tb.height / 2 - tip2.y) * 0.3);
  await expect(page.getByTestId('tip-handle')).toBeVisible();

  // Text ziehen: der Text wandert, das Ende der Linie bleibt stehen
  const tipA = await center(page, 'tip-handle');
  const tbA = (await callout.locator('text').boundingBox())!;
  await page.mouse.move(tbA.x + tbA.width / 2, tbA.y + tbA.height / 2);
  await page.mouse.down();
  await page.mouse.move(tbA.x + tbA.width / 2 + 70, tbA.y + tbA.height / 2 - 40, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await callout.locator('text').boundingBox())!.x).toBeGreaterThan(tbA.x + 50);
  const tipB = await center(page, 'tip-handle');
  expect(Math.hypot(tipB.x - tipA.x, tipB.y - tipA.y)).toBeLessThan(2);
  await waitSaved(page);

  // Text-Fenster: Schrift größer – das Ende der Linie und die Pfeilspitze bleiben; Ende als Punkt bzw. nur Linie
  const headBox = async () => (await page.getByTestId('callout-head').boundingBox())!;
  const head0 = await headBox();
  await page.getByTestId('element-bar').getByTestId('element-text-edit').click();
  await expect(td.getByTestId('text-leader-arrow')).toHaveAttribute('aria-checked', 'true');
  for (let i = 0; i < 6; i++) await td.getByTestId('text-bigger').click(); // 10 → 11 → … → 16 pt
  await td.getByTestId('text-save').click();
  await expect.poll(async () => (await callout.locator('text').boundingBox())!.height).toBeGreaterThan(tbA.height * 1.3);
  const tipC = await center(page, 'tip-handle');
  expect(Math.hypot(tipC.x - tipB.x, tipC.y - tipB.y)).toBeLessThan(2);
  const head1 = await headBox();
  expect(Math.abs(head1.width - head0.width)).toBeLessThan(3); // Pfeilspitze wächst nicht mit der Schrift
  await page.getByTestId('element-bar').getByTestId('element-text-edit').click();
  await td.getByTestId('text-leader-dot').click();
  await td.getByTestId('text-save').click();
  await expect(page.getByTestId('callout-dot')).toHaveCount(1);
  await expect(page.getByTestId('callout-head')).toHaveCount(0);
  await page.getByTestId('element-bar').getByTestId('element-text-edit').click();
  await td.getByTestId('text-leader-none').click();
  await td.getByTestId('text-save').click();
  await expect(page.getByTestId('callout-dot')).toHaveCount(0);
  await expect(page.getByTestId('callout-arrow')).toHaveAttribute('data-end', 'none');
  await page.getByTestId('element-bar').getByTestId('element-text-edit').click();
  await td.getByTestId('text-leader-arrow').click();
  await td.getByTestId('text-save').click();
  await expect(page.getByTestId('callout-head')).toHaveCount(1);
  await waitSaved(page);

  // nach dem Neuladen erhalten
  await page.reload();
  await expect(page.locator('[data-element="text"][data-callout="1"]')).toContainText('Riss prüfen');

  // PDF: Pfeil als Linien und gefüllte Spitze
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'text-pfeil.pdf');
  execFileSync('pdftoppm', ['-png', '-r', '80', '-singlefile', pdf, join('tests', 'output', 'text-pfeil')]);
});
