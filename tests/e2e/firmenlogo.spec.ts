import { expect, test } from './fixtures';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { excelExport, catchDownload, createProject, drawRect, FIXTURES, fillMeasures, freshStart, pickTool, planBox, readXlsxPrint, saveDownload, waitForPlan, waitSaved } from './helpers';

/** Firmenlogo in Konto → Einstellungen: wird auf dem Gerät gespeichert und in jede Excel-Kopfzeile übernommen (links im Aufmaßblatt) */

const unzipList = (file: string) => execFileSync('python3', ['-c', 'import sys,zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', file], { encoding: 'utf8' });
const unzipRead = (file: string, name: string) =>
  execFileSync('python3', ['-c', 'import sys,zipfile; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode("utf8"))', file, name], { encoding: 'utf8' });

test('Logo hochladen, im Aufmaßblatt links in der Kopfzeile, rechts Seite von Seiten; entfernen', async ({ page }) => {
  await freshStart(page);
  await page.goto('./konto/firma');
  const box = page.getByTestId('logo-settings');
  await expect(box).toContainText('Kein Logo');
  await page.getByTestId('logo-input').setInputFiles(join(FIXTURES, 'firmenlogo.png'));
  await expect(page.getByTestId('logo-image')).toBeVisible();
  await expect(page.getByTestId('logo-pick')).toHaveText(/Logo ersetzen/);
  // Vorschau der Kopfzeile: Logo in passender Größe (höchstens 42 pt hoch, 170 pt breit)
  const prev = await page.getByTestId('logo-header-preview').locator('img').boundingBox();
  expect(prev!.height).toBeLessThanOrEqual(42 * 1.333 + 1);
  expect(prev!.width).toBeLessThanOrEqual(170 * 1.333 + 1);
  // bleibt nach dem Neuladen erhalten
  await page.reload();
  await expect(page.getByTestId('logo-image')).toBeVisible();

  // Projekt mit Messung → Excel
  await page.goto('./#/projekte');
  await createProject(page, 'Logo Test', {}, [{ number: '91092', name: 'Hof' }]);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('067');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const b = await planBox(page);
  await pickTool(page, 'tool-rect');
  await drawRect(page, b.x + b.width * 0.2, b.y + b.height * 0.2, b.x + b.width * 0.4, b.y + b.height * 0.4);
  await fillMeasures(page, '2', '3', '', false);
  await waitSaved(page);
  // Aufmaßblatt: Logo links in der Kopfzeile, rechts „Seite von Seiten“
  const dlb = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  const fileB = await saveDownload(dlb, 'logo-blatt.xlsx');
  expect(unzipList(fileB)).toContain('xl/media/logo.png');
  const vmlB = unzipRead(fileB, 'xl/drawings/vmlDrawingHF1.vml');
  expect(vmlB).toContain('id="LH"'); // linke Kopfzeile
  const [, w, h] = /width:([\d.]+)pt;height:([\d.]+)pt/.exec(vmlB)!.map(Number);
  expect(h).toBeLessThanOrEqual(42);
  expect(w).toBeLessThanOrEqual(170);
  const prB = readXlsxPrint(fileB)['Aufmaßblatt 001'];
  expect(prB.header.left).toBe('&G');
  expect(prB.header.right).toBe('&P von &N');
  expect(unzipRead(fileB, 'xl/worksheets/sheet1.xml')).toContain('view="pageLayout"');

  // Logo entfernen → Export ohne Bild
  await page.goto('./konto/firma');
  await page.getByTestId('logo-remove').click();
  await page.getByRole('button', { name: 'Entfernen' }).last().click();
  await expect(page.getByTestId('logo-settings')).toContainText('Kein Logo');
  await page.goBack();
  await waitForPlan(page);
  const dl2 = await catchDownload(page, () => excelExport(page, 'export-xlsx-plan'));
  const file2 = await saveDownload(dl2, 'ohne-logo.xlsx');
  expect(unzipList(file2)).not.toContain('xl/media/logo.png');
  const pr2 = readXlsxPrint(file2)['Aufmaßblatt 002'];
  expect(pr2.header.left).not.toContain('&G');
  expect(pr2.header.right).toBe('&P von &N');
});
