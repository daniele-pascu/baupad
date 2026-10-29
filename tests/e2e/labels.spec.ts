import { expect, test } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { FIXTURES, OUT, catchDownload, createProject, fillMeasures, freshStart, planBox, saveDownload, waitForPlan, waitSaved, pickTool } from './helpers';
test('Nummern dicht nebeneinander liegender Schadstellen überlappen nicht (Ansicht und PDF)', async ({ page }) => {
  test.setTimeout(180000);
  await freshStart(page);
  await createProject(page, 'Cluster', {}, ['TG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'plaene.pdf'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('page-tile').nth(1).click();
  await wiz.getByTestId('pages-next').click();
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('A-101');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  await pickTool(page, 'tool-ellipse');
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) pts.push([0.30 + i * 0.035, 0.45]); // Reihe dicht nebeneinander
  pts.push([0.30, 0.52], [0.335, 0.52], [0.37, 0.52]); // zweite Reihe direkt darunter
  for (const [fx, fy] of pts) {
    await pickTool(page, 'tool-ellipse'); // nach jeder Messung ist wieder „Auswahl“ aktiv
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await fillMeasures(page, '1', '1', '0,02', false);
  }
  await waitSaved(page);
  await pickTool(page, 'tool-select');
  await page.mouse.click(box.x + 5, box.y + box.height - 5);
  const v = (await page.getByTestId('plan-viewer').boundingBox())!;
  await page.screenshot({ path: join(OUT, 'cluster-ansicht.png'), clip: { x: box.x + box.width * 0.22, y: box.y + box.height * 0.33, width: box.width * 0.38, height: box.height * 0.3 } });
  // Nummern überlappen sich in der Ansicht nicht
  const rects = await page.locator('.damage-label rect').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).toBe(false);
  }
  // hineinzoomen
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.48);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, 'cluster-zoom.png'), clip: { x: v.x, y: v.y, width: v.width, height: v.height } });
  const dl = await catchDownload(page, async () => {
    await page.getByTestId('export-pdf-plan').click();
    await page.getByTestId('pdf-export-run').click();
  });
  const pdf = await saveDownload(dl, 'cluster.pdf');
  // Im PDF: alle Nummern vorhanden
  const text = execFileSync('pdftotext', [pdf, '-'], { encoding: 'utf8' });
  for (let n = 1; n <= 9; n++) expect(text).toMatch(new RegExp(`(^|\\s)${n}(\\s|$)`));
  execFileSync('pdftoppm', ['-png', '-r', '220', '-x', '700', '-y', '1150', '-W', '1100', '-H', '650', pdf, join(OUT, 'cluster-pdf')]);
});
