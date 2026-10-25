import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { catchDownload, createProject, drawRect, FIXTURES, fillMeasures, freshStart, pickTool, planBox, readXlsxPrint, saveDownload, waitForPlan, waitSaved } from './helpers';

/** Firmenlogo in Konto → Einstellungen: wird auf dem Gerät gespeichert und in jede Excel-Kopfzeile (rechts) übernommen */

const unzipList = (file: string) => execFileSync('python3', ['-c', 'import sys,zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', file], { encoding: 'utf8' });
const unzipRead = (file: string, name: string) =>
  execFileSync('python3', ['-c', 'import sys,zipfile; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode("utf8"))', file, name], { encoding: 'utf8' });

test('Logo hochladen, in der Excel-Kopfzeile rechts; Projekt/Kostenstelle links, Seite in der Mitte; entfernen', async ({ page }) => {
  await freshStart(page);
  await page.goto('./#/konto');
  const box = page.getByTestId('logo-settings');
  await expect(box).toContainText('Kein Logo');
  await page.getByTestId('logo-input').setInputFiles(join(FIXTURES, 'firmenlogo.png'));
  await expect(page.getByTestId('logo-image')).toBeVisible();
  await expect(page.getByTestId('logo-pick')).toHaveText(/Logo ersetzen/);
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
  const dl = await catchDownload(page, () => page.getByTestId('export-xlsx-plan').click());
  const file = await saveDownload(dl, 'logo.xlsx');
  const names = unzipList(file);
  expect(names).toContain('xl/media/logo.png');
  expect(names).toContain('xl/drawings/vmlDrawingHF1.vml');
  const vml = unzipRead(file, 'xl/drawings/vmlDrawingHF1.vml');
  expect(vml).toContain('id="RH"'); // rechte Kopfzeile
  const pr = readXlsxPrint(file)['Aufmaß'];
  expect(pr.header.left).toContain('Logo Test / 91092');
  expect(pr.header.center).toContain('Seite &P von &N');
  expect(pr.header.right).toContain('&G');
  expect(unzipRead(file, 'xl/worksheets/sheet1.xml')).toContain('view="pageLayout"');

  // Logo entfernen → Export ohne Bild
  await page.goto('./#/konto');
  await page.getByTestId('logo-remove').click();
  await page.getByRole('button', { name: 'Entfernen' }).last().click();
  await expect(page.getByTestId('logo-settings')).toContainText('Kein Logo');
  await page.goBack();
  await waitForPlan(page);
  const dl2 = await catchDownload(page, () => page.getByTestId('export-xlsx-plan').click());
  const file2 = await saveDownload(dl2, 'ohne-logo.xlsx');
  expect(unzipList(file2)).not.toContain('xl/media/logo.png');
  expect(readXlsxPrint(file2)['Aufmaß'].header.right).toBe('');
});
