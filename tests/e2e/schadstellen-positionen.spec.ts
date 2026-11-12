import { join } from 'node:path';
import { expect, test } from './fixtures';
import { catchDownload, chooseMeasureType, createProject, excelExport, FIXTURES, freshStart, pickTool, readXlsx, saveDownload, waitSaved } from './helpers';

/**
 * Schadstellen-Positionen: Das LV nennt Positionen nach Größe je Schadstelle, nach Tiefe und als Zulage
 * „je weitere 10 mm“. Die App liest das aus dem Positionstext, der Benutzer bestätigt es einmal – danach zählt
 * jede Schadstelle automatisch bei den passenden Positionen (LV-Liste, Messdialog, Excel).
 */
test('Positionen nach Größe und Tiefe werden erkannt, bestätigt und Schadstellen automatisch zugeordnet', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Betoninstandsetzung', {}, ['UG']);
  const projectUrl = page.url();

  // LV von Hand: drei Klassen, eine Zulage, eine Position ohne Klasse
  await page.getByTestId('lv-new').click();
  const dlg = page.getByTestId('lv-doc-dialog');
  await dlg.getByTestId('lv-doc-name').fill('Betoninstandsetzung');
  await dlg.getByTestId('lv-doc-name').press('Enter');
  const positions = [
    ['B1', 'Schadstelle bis 0,25 m², Abtragstiefe bis 20 mm', 'Stk', '50'],
    ['B2', 'Schadstelle bis 0,25 m², Abtragstiefe über 20 bis 40 mm', 'Stk', '80'],
    ['B3', 'Schadstelle über 0,25 bis 1,5 m², Abtragstiefe bis 40 mm', 'm²', '120'],
    ['B4', 'Aufzahlung je weitere 10 mm Abtragstiefe', 'm²', '15'],
    ['A1', 'Sandstrahlen', 'm²', '37,75'],
  ];
  const grid = dlg.getByTestId('lv-grid-row');
  for (const [i, [no, text, unit, price]] of positions.entries()) {
    await expect(grid).toHaveCount(i + 1);
    await grid.nth(i).getByTestId('grid-number').fill(no);
    await grid.nth(i).getByTestId('grid-shortText').fill(text);
    await grid.nth(i).getByTestId('grid-unit').fill(unit);
    await grid.nth(i).getByTestId('grid-unitPrice').fill(price);
    await grid.nth(i).getByTestId('grid-unitPrice').press('Enter');
  }
  await dlg.getByTestId('lv-doc-save').click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('lv-row')).toHaveCount(5);

  // erkannt, aber noch nicht bestätigt: Hinweis – und noch keine Regel an den Positionen
  await expect(page.getByTestId('lv-rules-hint')).toContainText('4 Schadstellen-Positionen erkannt');
  await expect(page.getByTestId('lv-rule')).toHaveCount(0);
  await page.getByTestId('lv-rules-review').click();
  const rules = page.getByTestId('lv-rules-dialog');
  const row = (no: string) => rules.locator(`[data-testid="rule-row"][data-number="${no}"]`);
  await expect(rules.getByTestId('rule-row')).toHaveCount(4); // „Sandstrahlen“ hat keine Klasse
  // Werte aus dem Text gelesen
  await expect(row('B1').getByTestId('rule-areaTo')).toHaveValue('0,25');
  await expect(row('B1').getByTestId('rule-depthTo')).toHaveValue('20');
  await expect(row('B2').getByTestId('rule-depthFrom')).toHaveValue('20');
  await expect(row('B2').getByTestId('rule-depthTo')).toHaveValue('40');
  await expect(row('B3').getByTestId('rule-areaFrom')).toHaveValue('0,25');
  await expect(row('B3').getByTestId('rule-areaTo')).toHaveValue('1,5');
  await expect(row('B4').getByTestId('rule-stepMm')).toHaveValue('10');
  await expect(row('B4').getByTestId('rule-stepFrom')).toHaveValue(''); // Beginn = größte Tiefenposition
  await expect(row('B3').getByTestId('rule-summary')).toHaveText('Größe über 0,25 bis 1,5 m² · Tiefe bis 40 mm');
  await rules.getByTestId('lv-rules-save').click();
  await expect(rules).toBeHidden();
  await expect(page.getByTestId('lv-rules-hint')).toHaveCount(0);
  await expect(page.getByTestId('lv-rule')).toHaveCount(4);
  await expect(page.locator('[data-testid="lv-row"][data-number="B4"]').getByTestId('lv-rule')).toHaveText('je weitere 10 mm ab 40 mm');
  await waitSaved(page);

  // Plan zeichnen und zwei Schadstellen messen
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('S-1');
  await nd.getByTestId('new-drawing-save').click();
  await page.getByTestId('mode-measure').click();
  await chooseMeasureType(page, 'schadstelle');
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  const md = page.getByTestId('damage-dialog');
  const draw = async (x: number, y: number) => {
    await pickTool(page, 'tool-rect');
    await page.mouse.move(sb.x + x, sb.y + y);
    await page.mouse.down();
    await page.mouse.move(sb.x + x + 40, sb.y + y + 30, { steps: 4 });
    await page.mouse.move(sb.x + x + 80, sb.y + y + 60, { steps: 4 });
    await page.mouse.up();
    await expect(md).toBeVisible();
  };
  const auto = () => md.getByTestId('auto-position').evaluateAll((els) => els.map((e) => [(e as HTMLElement).closest('label')!.textContent!.trim().split(' ')[0], Number((e as HTMLElement).dataset.factor)]));

  // 1) 0,40 × 0,50 = 0,20 m²: je nach Tiefe eine andere Klasse; 1 mm über der Grenze ist schon die nächste
  await draw(150, 150);
  await md.getByTestId('input-length').fill('0,4');
  await md.getByTestId('input-width').fill('0,5');
  await md.getByTestId('input-depth').fill('0,02');
  expect(await auto()).toEqual([['B1', 1]]);
  await md.getByTestId('input-depth').fill('0,021');
  expect(await auto()).toEqual([['B2', 1]]);
  // 61 mm: Grundposition ist die größte Tiefenklasse (bis 40 mm), dazu die Zulage mit 3 Stufen (41–50, 51–60, 61–70)
  await md.getByTestId('input-depth').fill('0,061');
  expect(await auto()).toEqual([
    ['B2', 1],
    ['B4', 3],
  ]);
  await expect(md.getByTestId('auto-positions')).toContainText('3 Stufen');
  await md.getByTestId('auto-positions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/output/schadstelle-automatisch.png' });
  await md.getByTestId('damage-save').click();
  await expect(md).toBeHidden();

  // 2) 1,00 × 0,60 = 0,60 m², 30 mm tief → größere Klasse
  await draw(400, 150);
  await md.getByTestId('input-length').fill('1');
  await md.getByTestId('input-width').fill('0,6');
  await md.getByTestId('input-depth').fill('0,03');
  expect(await auto()).toEqual([['B3', 1]]);
  await md.getByTestId('damage-save').click();
  await expect(md).toBeHidden();
  await waitSaved(page);

  // Excel: die Schadstelle steht unter ihrer Grundposition und unter der Zulage (3 × 0,2 als Formel)
  const dl = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  const wb = readXlsx(await saveDownload(dl, 'schadstellen-positionen.xlsx'));
  const ws = wb[Object.keys(wb)[0]].map((r) => r.map((c) => c?.v ?? null));
  const band = (no: string) => ws.findIndex((r, i) => r[0] === no && ws[i + 1]?.[0] === 'Plan');
  expect(band('B1')).toBe(-1); // keine Schadstelle in dieser Klasse
  const b4 = band('B4');
  expect(ws[b4 + 2].slice(0, 6)).toEqual(['S-1', 1, 0.4, 0.5, 0.061, '=3*0.2']); // Tiefe auf den Millimeter
  expect(String(ws[b4 + 2][7])).toContain('3 Stufen');
  expect(ws[band('B2') + 2].slice(0, 2)).toEqual(['S-1', 1]);
  expect(ws[band('B3') + 2].slice(0, 2)).toEqual(['S-1', 2]);
  // nichts bleibt „ohne Leistungsposition“
  expect(ws.some((r) => r[0] === 'Aufmaß ohne Leistungsposition')).toBe(false);


  // LV-Liste: Mengen je Position ohne Zuordnung von Hand
  await page.goto(projectUrl);
  if (!(await page.getByTestId('lv-table').isVisible())) await page.getByTestId('lv-doc-tab').first().click();
  const measured = (no: string) => page.locator(`[data-testid="lv-row"][data-number="${no}"]`).getByTestId('lv-measured');
  await expect(measured('B1')).toHaveText('–');
  await expect(measured('B2')).toHaveText('1,00'); // 1 Stück
  await expect(measured('B3')).toHaveText('0,60');
  await expect(measured('B4')).toHaveText('0,60'); // 3 Stufen × 0,20 m²
  await expect(measured('A1')).toHaveText('–');
  // aufgeklappt: Schadstelle mit Stufen, als automatisch gekennzeichnet
  await page.locator('[data-testid="lv-row"][data-number="B4"]').click();
  const li = page.getByTestId('lv-measure');
  await expect(li).toHaveCount(1);
  await expect(li).toContainText('3 Stufen');
  await expect(li).toContainText('automatisch');
  await expect(li).toContainText('Tiefe 61,00 mm');

});

test('Beispiel-LV „Betoninstandsetzung“ (PDF) importieren: alle Positionen, Schadstellen-Positionen werden erkannt', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Beispiel-LV', {}, ['UG']);
  await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, 'schadstellen-lv.pdf'));
  const review = page.getByTestId('lv-review');
  const summary = review.getByTestId('lv-review-summary');
  await expect(summary).toContainText('15 Positionen');
  await expect(summary).toContainText('193.142,13 €');
  await expect(review.getByTestId('lv-total-check')).toContainText('Summe stimmt mit dem Dokument überein');
  await expect(summary).not.toContainText('unsicheren Angaben');
  await review.getByTestId('lv-review-save').click();
  await page.getByTestId('lv-doc-tab').last().click();
  await expect(page.getByTestId('lv-row')).toHaveCount(15);
  await expect(page.getByTestId('lv-flagged')).toHaveCount(0);
  // fünf Klassen und die Zulage erkannt; Streifen (lfm), Sandstrahlen, Egalisierung … nicht
  await expect(page.getByTestId('lv-rules-hint')).toContainText('6 Schadstellen-Positionen erkannt');
  await page.getByTestId('lv-rules-review').click();
  const rules = page.getByTestId('lv-rules-dialog');
  const numbers = await rules.getByTestId('rule-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.number));
  expect(numbers).toEqual(['01.14.20.01A.', '01.14.20.01B.', '01.14.20.01C.', '01.14.20.01D.', '01.14.20.01E.', '01.14.20.02A.']);
  const summaries = await rules.getByTestId('rule-summary').allTextContents();
  expect(summaries).toEqual([
    'Größe bis 0,25 m² · Tiefe bis 20 mm',
    'Größe bis 0,25 m² · Tiefe über 20 bis 40 mm',
    'Größe über 0,25 bis 1,5 m² · Tiefe bis 20 mm',
    'Größe über 0,25 bis 1,5 m² · Tiefe über 20 bis 40 mm',
    'Größe über 1,5 m² · Tiefe bis 40 mm',
    'je weitere 10 mm ab der größten Tiefenposition',
  ]);
  await rules.getByTestId('lv-rules-save').click();
  await expect(page.getByTestId('lv-rule')).toHaveCount(6);
  await expect(page.locator('[data-testid="lv-row"][data-number="01.14.20.02A."]').getByTestId('lv-rule')).toHaveText('je weitere 10 mm ab 40 mm');
});
