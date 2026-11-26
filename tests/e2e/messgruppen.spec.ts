import { expect, test } from './fixtures';
import { join } from 'node:path';
import { FIXTURES, catchDownload, createProject, freshStart, pickTool, planBox, readXlsx, saveDownload, stored, waitForPlan, waitSaved } from './helpers';

test('Neue Messung = eigene Tabelle (auch bei gleicher Messart); Titel ändern; Messungen in eine andere Tabelle verschieben', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Gruppen', {}, ['TG']);
  await page.getByTestId('plan-file-input').setInputFiles(join(FIXTURES, 'parkdeck.png'));
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByTestId('areas-next').click();
  await wiz.locator('[data-field="planNumber"]').fill('G-1');
  await wiz.getByTestId('import-save').click();
  await waitForPlan(page);
  const box = await planBox(page);
  const dlg = page.getByTestId('damage-dialog');
  /** „Neue Messung“ → Länge → eine Linie mit dieser Länge */
  const lineAt = async (fy: number, length: string, fresh: boolean) => {
    if (fresh) {
      await page.getByTestId('new-measure').click();
      await page.getByTestId('mtype-laenge').click();
    }
    await pickTool(page, 'tool-line');
    const y = box.y + box.height * fy;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 4 });
    await page.mouse.up();
    await dlg.getByTestId('input-length').fill(length);
    await dlg.getByTestId('damage-save').click();
    await expect(dlg).toBeHidden();
  };
  await lineAt(0.3, '4', true);
  await lineAt(0.4, '1,5', false); // gleiche „Neue Messung“: dieselbe Tabelle
  await lineAt(0.55, '7', true); // neue „Neue Messung“, wieder Länge: eigene Tabelle darunter
  await waitSaved(page);
  const tables = page.getByTestId('aufmass-type');
  await expect(tables).toHaveCount(2);
  await expect(tables.nth(0).getByTestId('type-sum-value')).toHaveText('5,50 m');
  await expect(tables.nth(1).getByTestId('type-sum-value')).toHaveText('7,00 m');

  // Titel der zweiten Tabelle ändern
  await tables.nth(1).getByTestId('table-rename').click();
  await tables.nth(1).getByTestId('table-title').fill('Fugen');
  await tables.nth(1).getByTestId('table-title-save').click();
  await expect(tables.nth(1).locator('.aufmass-type-label')).toHaveText('Fugen');
  await waitSaved(page);

  // Aufmaßblatt: zwei Tabellen, „Länge“ und „Fugen“, jede mit eigener Summe
  await page.getByTestId('export-xlsx-plan').click();
  const dl = await catchDownload(page, () => page.getByTestId('excel-export').getByTestId('blatt-export').click());
  const ws = readXlsx(await saveDownload(dl, 'messgruppen.xlsx'))['Aufmaßblatt 001'].map((r) => r.map((c) => c?.v ?? null));
  const heads = ws.filter((r) => r[0] === 'Länge' || r[0] === 'Fugen').map((r) => r[0]);
  expect(heads).toEqual(['Länge', 'Fugen']);
  expect(ws.filter((r) => typeof r[2] === 'string' && String(r[2]).startsWith('=SUM(')).length).toBe(2);

  // Messung Nr. 1 in die Tabelle „Fugen“ verschieben
  await page.getByTestId('damages-select').click();
  await tables.nth(0).locator('tbody tr').first().click();
  await page.getByTestId('damages-bulk-edit').click();
  const bulk = page.getByTestId('bulk-damage-dialog');
  await bulk.getByTestId('bulk-damage-table').selectOption({ label: 'Fugen · Nr. 3' });
  await bulk.getByTestId('bulk-damage-save').click();
  await expect(tables.nth(0).getByTestId('type-sum-value')).toHaveText('1,50 m');
  await expect(tables.nth(1).getByTestId('type-sum-value')).toHaveText('11,00 m');
  await waitSaved(page);
  const groups = (await stored(page, 'damages')).filter((d: { deletedAt: unknown }) => !d.deletedAt).map((d: { number: number; groupTitle?: string }) => [d.number, d.groupTitle ?? null]);
  expect(groups.sort()).toEqual([
    [1, 'Fugen'],
    [2, null],
    [3, 'Fugen'],
  ]);
});
