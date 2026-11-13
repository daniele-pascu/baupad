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

test('Beispiel-LV „Betoninstandsetzung“ (PDF): Klassen, Zulage, Folgeleistungen und Bewehrung erkannt – eine Schadstelle zählt von A bis Z', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Beispiel-LV', {}, ['UG']);
  await page.getByTestId('lv-file-input').setInputFiles(join(FIXTURES, 'schadstellen-lv.pdf'));
  const review = page.getByTestId('lv-review');
  const summary = review.getByTestId('lv-review-summary');
  await expect(summary).toContainText('18 Positionen');
  await expect(summary).toContainText('230.612,13 €');
  await expect(review.getByTestId('lv-total-check')).toContainText('Summe stimmt mit dem Dokument überein');
  await expect(summary).not.toContainText('unsicheren Angaben');
  await review.getByTestId('lv-review-save').click();
  await page.getByTestId('lv-doc-tab').last().click();
  await expect(page.getByTestId('lv-row')).toHaveCount(18);
  await expect(page.getByTestId('lv-flagged')).toHaveCount(0);
  // erkannt: fünf Klassen, Zulage, Reprofilierung (zwei Tiefen), Haftbrücke (Folgeleistung), Bewehrung –
  // nicht: Streifen (lfm), Sandstrahlen, Egalisierung, Risse …
  await expect(page.getByTestId('lv-rules-hint')).toContainText('10 Schadstellen-Positionen erkannt');
  await page.getByTestId('lv-rules-review').click();
  const rules = page.getByTestId('lv-rules-dialog');
  const numbers = await rules.getByTestId('rule-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.number));
  expect(numbers).toEqual([
    '01.14.20.01A.',
    '01.14.20.01B.',
    '01.14.20.01C.',
    '01.14.20.01D.',
    '01.14.20.01E.',
    '01.14.20.02A.',
    '01.14.25.01A.',
    '01.14.25.01B.',
    '01.14.25.02A.',
    '01.14.40.02A.',
  ]);
  expect(await rules.getByTestId('rule-summary').allTextContents()).toEqual([
    'Größe bis 0,25 m² · Tiefe bis 20 mm',
    'Größe bis 0,25 m² · Tiefe über 20 bis 40 mm',
    'Größe über 0,25 bis 1,5 m² · Tiefe bis 20 mm',
    'Größe über 0,25 bis 1,5 m² · Tiefe über 20 bis 40 mm',
    'Größe über 1,5 m² · Tiefe bis 40 mm',
    'je weitere 10 mm ab der größten Tiefenposition',
    'Tiefe bis 20 mm',
    'Tiefe über 20 bis 40 mm',
    'jede Schadstelle',
    'Bewehrung der Schadstelle (lfm)',
  ]);
  const mode = (no: string) => rules.locator(`[data-testid="rule-row"][data-number="${no}"]`).getByTestId('rule-mode');
  await expect(mode('01.14.20.01A.')).toHaveValue('class');
  await expect(mode('01.14.25.02A.')).toHaveValue('always');
  await expect(mode('01.14.40.02A.')).toHaveValue('rebar');
  await rules.getByTestId('lv-rules-save').click();
  await expect(page.getByTestId('lv-rule')).toHaveCount(10);
  await expect(page.locator('[data-testid="lv-row"][data-number="01.14.20.02A."]').getByTestId('lv-rule')).toHaveText('je weitere 10 mm ab 40 mm');
  await waitSaved(page);
  const projectUrl = page.url();

  // eine Schadstelle: 0,40 × 0,50 m, 61 mm tief, 2 × 0,60 m Bewehrung
  await page.getByTestId('draw-plan').click();
  const nd = page.getByTestId('new-drawing');
  await nd.locator('[data-field="planNumber"]').fill('S-1');
  await nd.getByTestId('new-drawing-save').click();
  await page.getByTestId('mode-measure').click();
  await chooseMeasureType(page, 'schadstelle');
  const sb = (await page.getByTestId('drawing-sheet').boundingBox())!;
  await pickTool(page, 'tool-rect');
  await page.mouse.move(sb.x + 150, sb.y + 150);
  await page.mouse.down();
  await page.mouse.move(sb.x + 190, sb.y + 180, { steps: 4 });
  await page.mouse.move(sb.x + 230, sb.y + 210, { steps: 4 });
  await page.mouse.up();
  const md = page.getByTestId('damage-dialog');
  await md.getByTestId('input-length').fill('0,4');
  await md.getByTestId('input-width').fill('0,5');
  await md.getByTestId('input-depth').fill('0,061');
  const auto = () => md.getByTestId('auto-position').evaluateAll((els) => els.map((e) => [(e as HTMLElement).closest('label')!.textContent!.trim().split(' ')[0], Number((e as HTMLElement).dataset.factor)]));
  // Abtrag (größte Tiefenklasse), Zulage 3 Stufen, Reprofilierung (größte Tiefe), Haftbrücke – Bewehrung erst mit Länge
  expect(await auto()).toEqual([
    ['01.14.20.01B.', 1],
    ['01.14.20.02A.', 3],
    ['01.14.25.01B.', 1],
    ['01.14.25.02A.', 1],
  ]);
  await md.getByTestId('rebar-add').click();
  await md.getByTestId('rebar-count').nth(0).fill('2');
  await md.getByTestId('rebar-length').nth(0).fill('0,6');
  expect((await auto()).at(-1)).toEqual(['01.14.40.02A.', 1]);
  expect(await auto()).toHaveLength(5);
  await md.getByTestId('damage-save').click();
  await expect(md).toBeHidden();
  await waitSaved(page);

  // zweite Schadstelle, groß: 7,22 × 5,43 = 39,20 m², 75 mm tief – und von Hand die falsche Position gewählt
  // („bis 0,25 m²“): Hinweis im Dialog, sie zählt dort nicht, sondern bei der passenden Klasse
  await pickTool(page, 'tool-rect');
  await page.mouse.move(sb.x + 420, sb.y + 150);
  await page.mouse.down();
  await page.mouse.move(sb.x + 470, sb.y + 190, { steps: 4 });
  await page.mouse.move(sb.x + 520, sb.y + 230, { steps: 4 });
  await page.mouse.up();
  await md.getByTestId('input-length').fill('7,22');
  await md.getByTestId('input-width').fill('5,43');
  await md.getByTestId('input-depth').fill('0,075');
  await expect(md.getByTestId('position-mismatch')).toHaveCount(0);
  await md.getByTestId('input-position-search').fill('01.14.20.01B');
  await md.getByTestId('position-suggestion').first().click();
  await expect(md.getByTestId('input-position')).toContainText('01.14.20.01B.');
  await expect(md.getByTestId('position-mismatch')).toContainText('Größe bis 0,25 m² · Tiefe über 20 bis 40 mm');
  // automatisch: Klasse „über 1,5 m²“, Zulage 4 Stufen (75 mm ab 40 mm), Reprofilierung, Haftbrücke
  expect(await auto()).toEqual([
    ['01.14.20.01E.', 1],
    ['01.14.20.02A.', 4],
    ['01.14.25.01B.', 1],
    ['01.14.25.02A.', 1],
  ]);
  await md.getByTestId('damage-save').click();
  await expect(md).toBeHidden();
  await waitSaved(page);
  // Aufmaß-Tabelle: gruppiert nach der Position, bei der die Schadstelle wirklich zählt – nicht nach der falschen
  const tr = (no: number) => page.locator(`[data-testid="aufmass-row"][data-number="${no}"]`);
  await expect(tr(2).getByTestId('row-position')).toHaveText('01.14.20.01E.');
  await expect(tr(2).getByTestId('row-position-more')).toHaveText('+3');
  await expect(tr(1).getByTestId('row-position')).toHaveText('01.14.20.01B.');
  await expect(tr(1).getByTestId('row-position-more')).toHaveText('+4');
  expect(await page.getByTestId('position-group').allTextContents()).toEqual([
    expect.stringContaining('01.14.20.01B. Schadstelle bis 0,25 m²'),
    expect.stringContaining('01.14.20.01E. Schadstelle über 1,5 m²'),
  ]);

  // Excel: die Schadstelle steht bei allen fünf Positionen – Bewehrung mit ihren 1,20 lfm
  const dl = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  const wb = readXlsx(await saveDownload(dl, 'schadstelle-a-bis-z.xlsx'));
  const ws = wb[Object.keys(wb)[0]].map((r) => r.map((c) => c?.v ?? null));
  const band = (no: string) => ws.findIndex((r, i) => r[0] === no && ws[i + 1]?.[0] === 'Plan');
  for (const no of ['01.14.20.01B.', '01.14.20.02A.', '01.14.25.01B.', '01.14.25.02A.', '01.14.40.02A.']) expect(band(no), no).toBeGreaterThan(0);
  expect(band('01.14.20.01A.')).toBe(-1);
  const rb = band('01.14.40.02A.');
  expect([ws[rb + 2][0], ws[rb + 2][1], ws[rb + 2][5]]).toEqual(['S-1', 1, 1.2]);
  expect(String(ws[rb + 2][7])).toContain('Bewehrung der Schadstelle');
  expect(ws.some((r) => r[0] === 'Aufmaß ohne Leistungsposition')).toBe(false);

  // LV-Liste: Mengen ohne eine einzige Zuordnung von Hand
  await page.goto(projectUrl);
  if (!(await page.getByTestId('lv-table').isVisible())) await page.getByTestId('lv-doc-tab').first().click();
  const measured = (no: string) => page.locator(`[data-testid="lv-row"][data-number="${no}"]`).getByTestId('lv-measured');
  await expect(measured('01.14.20.01B.')).toHaveText('1,00'); // Stück – die große Schadstelle zählt hier nicht mit
  await expect(measured('01.14.20.01E.')).toHaveText('39,20');
  await expect(measured('01.14.20.02A.')).toHaveText('157,40'); // 3 × 0,20 + 4 × 39,20 m²
  await expect(measured('01.14.25.01B.')).toHaveText('39,40');
  await expect(measured('01.14.25.02A.')).toHaveText('39,40');
  await expect(measured('01.14.40.02A.')).toHaveText('1,20'); // lfm Bewehrung
  await expect(measured('01.14.10.02A.')).toHaveText('–'); // Sandstrahlen: keine Schadstellen-Position
});
