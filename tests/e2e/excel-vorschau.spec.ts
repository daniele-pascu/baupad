import { expect, test } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { FIXTURES, OUT, catchDownload, createProject, drawRect, fillMeasures, freshStart, pickTool, planBox, readXlsx, saveDownload, toMeasureMode, waitForPlan, waitSaved } from './helpers';

test('Aufmaßblatt: erst die Ansicht, dort Dateiname ändern und als Excel oder PDF speichern; Zurück ändert nichts', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Vorschau', {}, ['TG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('V-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  await pickTool(page, 'tool-rect', 'click', 'schadstelle');
  await drawRect(page, box.x + box.width * 0.3, box.y + box.height * 0.3, box.x + box.width * 0.5, box.y + box.height * 0.45);
  await fillMeasures(page, '2', '1,5', '0,05');
  await waitSaved(page);

  await toMeasureMode(page);
  await page.getByTestId('export-xlsx-plan').click();
  const dlg = page.getByTestId('excel-export');
  await expect(dlg.getByTestId('blatt-no')).toHaveValue('001');
  await dlg.getByTestId('blatt-export').click();
  // Vorschau: das Blatt mit Kopf, Tabelle und Summe – so, wie es in Excel aussieht
  const prev = page.getByTestId('excel-preview');
  const sheet = prev.getByTestId('sheet-preview');
  await expect(sheet).toContainText('Aufmaßblatt 001');
  await expect(sheet).toContainText('Bauvorhaben');
  await expect(sheet.locator('td.x-amTHead')).toHaveText(['Plan', 'Nr.', 'Länge', 'Breite', 'Tiefe', 'm²']);
  await expect(sheet.locator('td.xt-Q').first()).toHaveText('3,00');
  // links und rechts derselbe Rand
  const pad = await sheet.locator('.sheet-view').evaluate((el) => [getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]);
  expect(pad[0]).toBe(pad[1]);
  await page.screenshot({ path: join(OUT, 'excel-vorschau.png') });
  // Zurück: nichts gespeichert, die Nummer wird nicht hochgezählt
  await prev.getByTestId('preview-back').click();
  await expect(dlg.getByTestId('blatt-no')).toHaveValue('001');
  // erneut Vorschau, Dateiname ändern, herunterladen
  await dlg.getByTestId('blatt-export').click();
  await prev.getByTestId('excel-file-name').fill('Mein Aufmass');
  const dl = await catchDownload(page, () => prev.getByTestId('preview-download').click());
  expect(dl.suggestedFilename()).toBe('Mein_Aufmass.xlsx');
  const wb = readXlsx(await saveDownload(dl, 'excel-vorschau.xlsx'));
  expect(Object.keys(wb)).toEqual(['Aufmaßblatt 001']);
  await expect(prev).toHaveCount(0);
  // gespeichert: die nächste Nummer ist 002
  await expect(page.getByTestId('export-xlsx-plan')).toContainText('Aufmaßblatt');
  await page.getByTestId('export-xlsx-plan').click();
  await expect(dlg.getByTestId('blatt-no')).toHaveValue('002');
  // dasselbe Blatt als PDF: Schalter „Speichern als“, Endung und Datei wechseln
  await dlg.getByTestId('blatt-export').click();
  await prev.getByTestId('format-pdf').click();
  await expect(prev.locator('.preview-name .unit')).toHaveText('.pdf');
  const dl2 = await catchDownload(page, () => prev.getByTestId('preview-download').click());
  expect(dl2.suggestedFilename()).toMatch(/Aufmassblatt_002\.pdf$/);
  const pdf = await saveDownload(dl2, 'excel-vorschau.pdf');
  expect(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' })).toMatch(/Pages:\s+1\n[\s\S]*\(A4\)/);
  const text = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' });
  for (const t of ['Aufmaßblatt 002', 'Bauvorhaben', 'Betoninstandsetzung', 'Plan', 'Nr.', 'Länge', 'Breite', 'Tiefe', 'V-1', '3,00', '1 von 1']) expect(text).toContain(t);
});
